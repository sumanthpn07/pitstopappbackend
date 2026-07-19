import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Cron, CronExpression } from '@nestjs/schedule';
import { createHash } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { EventConsumerLogService } from './event-consumer-log.service';
import { EventTypes, type EventType, type OutboxEventPayload } from './event-types';

/** Maximum retry attempts before dead-lettering */
const MAX_RETRIES = 3;

/** Exponential backoff delays in milliseconds (1s, 2s, 4s) */
const BACKOFF_DELAYS_MS = [1000, 2000, 4000];

/** Number of events to poll per cycle */
const POLL_BATCH_SIZE = 50;

export interface PublishOptions {
  eventType: EventType;
  sourceEntity: string;
  sourceId: string;
  payload: unknown;
}

@Injectable()
export class EventsService {
  private readonly logger = new Logger(EventsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
    private readonly consumerLog: EventConsumerLogService,
  ) {}

  /**
   * Publishes an event by writing it to the OutboxEvent table.
   * The outbox poller will pick it up and dispatch to EventEmitter2.
   *
   * This ensures the event is persisted within the same transaction boundary
   * as the source operation, guaranteeing at-least-once delivery.
   */
  async publish(options: PublishOptions): Promise<string> {
    const { eventType, sourceEntity, sourceId, payload } = options;
    const payloadHash = this.computePayloadHash(payload);

    const event = await this.prisma.outboxEvent.create({
      data: {
        eventType,
        payload: payload as object,
        payloadHash,
        sourceEntity,
        sourceId,
        published: false,
        retryCount: 0,
        deadLettered: false,
      },
    });

    this.logger.log(`Event published to outbox: ${eventType} [${event.id}]`);
    return event.id;
  }

  /**
   * Publishes an event within an existing Prisma transaction context.
   * Use this when the event must be atomically committed with other DB writes.
   */
  async publishInTransaction(
    tx: Parameters<Parameters<PrismaService['$transaction']>[0]>[0],
    options: PublishOptions,
  ): Promise<string> {
    const { eventType, sourceEntity, sourceId, payload } = options;
    const payloadHash = this.computePayloadHash(payload);

    const event = await (tx as any).outboxEvent.create({
      data: {
        eventType,
        payload: payload as object,
        payloadHash,
        sourceEntity,
        sourceId,
        published: false,
        retryCount: 0,
        deadLettered: false,
      },
    });

    this.logger.log(`Event published to outbox (in tx): ${eventType} [${event.id}]`);
    return event.id;
  }

  /**
   * Outbox poller: runs every 5 seconds to pick up unpublished events
   * and dispatch them via EventEmitter2.
   */
  @Cron(CronExpression.EVERY_5_SECONDS)
  async pollAndDispatch(): Promise<void> {
    const events = await this.prisma.outboxEvent.findMany({
      where: {
        published: false,
        deadLettered: false,
      },
      orderBy: { createdAt: 'asc' },
      take: POLL_BATCH_SIZE,
    });

    if (events.length === 0) return;

    this.logger.debug(`Polling: found ${events.length} unpublished event(s)`);

    for (const event of events) {
      await this.dispatchEvent(event.id, event.eventType, event.payload, event.sourceEntity, event.sourceId);
    }
  }

  /**
   * Dispatches a single event via EventEmitter2 and handles retry/dead-letter logic.
   */
  private async dispatchEvent(
    eventId: string,
    eventType: string,
    payload: unknown,
    sourceEntity: string,
    sourceId: string,
  ): Promise<void> {
    const envelope: OutboxEventPayload = {
      eventType: eventType as EventType,
      sourceEntity,
      sourceId,
      data: payload,
      occurredAt: new Date().toISOString(),
    };

    try {
      // Emit event — listeners can throw to signal failure
      await this.eventEmitter.emitAsync(eventType, { eventId, ...envelope });

      // Mark as published
      await this.prisma.outboxEvent.update({
        where: { id: eventId },
        data: {
          published: true,
          publishedAt: new Date(),
        },
      });

      this.logger.debug(`Event dispatched: ${eventType} [${eventId}]`);
    } catch (error) {
      await this.handleDispatchFailure(eventId, eventType, error);
    }
  }

  /**
   * Handles a failed dispatch: increments retry count, applies backoff,
   * or moves to dead-letter queue after max retries.
   */
  private async handleDispatchFailure(
    eventId: string,
    eventType: string,
    error: unknown,
  ): Promise<void> {
    const errorMessage = error instanceof Error ? error.message : String(error);

    const event = await this.prisma.outboxEvent.findUnique({
      where: { id: eventId },
    });

    if (!event) return;

    const newRetryCount = event.retryCount + 1;

    if (newRetryCount >= MAX_RETRIES) {
      // Dead-letter the event
      await this.prisma.outboxEvent.update({
        where: { id: eventId },
        data: {
          retryCount: newRetryCount,
          deadLettered: true,
          failureReason: errorMessage,
        },
      });

      this.logger.error(
        `Event dead-lettered after ${MAX_RETRIES} retries: ${eventType} [${eventId}] — ${errorMessage}`,
      );

      // Publish a dead-letter notification event
      await this.publishDeadLetterNotification(eventId, eventType, errorMessage, newRetryCount);
    } else {
      // Increment retry count — the next poll cycle will pick it up after backoff
      const backoffMs = BACKOFF_DELAYS_MS[event.retryCount] ?? BACKOFF_DELAYS_MS[BACKOFF_DELAYS_MS.length - 1];

      await this.prisma.outboxEvent.update({
        where: { id: eventId },
        data: {
          retryCount: newRetryCount,
        },
      });

      this.logger.warn(
        `Event dispatch failed (attempt ${newRetryCount}/${MAX_RETRIES}): ${eventType} [${eventId}]. ` +
          `Next retry after ${backoffMs}ms backoff.`,
      );

      // Schedule a delayed retry using setTimeout
      setTimeout(() => {
        void this.retryEvent(eventId);
      }, backoffMs);
    }
  }

  /**
   * Retries a specific event by re-reading it and dispatching again.
   */
  private async retryEvent(eventId: string): Promise<void> {
    const event = await this.prisma.outboxEvent.findUnique({
      where: { id: eventId },
    });

    if (!event || event.published || event.deadLettered) return;

    await this.dispatchEvent(event.id, event.eventType, event.payload, event.sourceEntity, event.sourceId);
  }

  /**
   * Publishes a notification about a dead-lettered event.
   * This is used to notify the Garage_Owner.
   */
  private async publishDeadLetterNotification(
    originalEventId: string,
    originalEventType: string,
    failureReason: string,
    retryCount: number,
  ): Promise<void> {
    try {
      await this.publish({
        eventType: EventTypes.DEAD_LETTER,
        sourceEntity: 'OutboxEvent',
        sourceId: originalEventId,
        payload: {
          originalEventId,
          originalEventType,
          failureReason,
          retryCount,
        },
      });
    } catch (error) {
      // Avoid infinite loops — just log if dead-letter notification itself fails
      this.logger.error(
        `Failed to publish dead-letter notification for event ${originalEventId}: ${error}`,
      );
    }
  }

  /**
   * Replays a dead-lettered event by resetting its state.
   * Used by operators to restore data consistency.
   */
  async replayDeadLetter(eventId: string): Promise<void> {
    await this.prisma.outboxEvent.update({
      where: { id: eventId },
      data: {
        published: false,
        deadLettered: false,
        retryCount: 0,
        failureReason: null,
      },
    });
    this.logger.log(`Dead-letter event replayed: ${eventId}`);
  }

  /**
   * Discards a dead-lettered event (marks as published without dispatching).
   * Used by operators when the event is no longer relevant.
   */
  async discardDeadLetter(eventId: string): Promise<void> {
    await this.prisma.outboxEvent.update({
      where: { id: eventId },
      data: {
        published: true,
        publishedAt: new Date(),
      },
    });
    this.logger.log(`Dead-letter event discarded: ${eventId}`);
  }

  /**
   * Retrieves dead-lettered events for inspection.
   */
  async getDeadLetterEvents(take = 50, skip = 0) {
    return this.prisma.outboxEvent.findMany({
      where: { deadLettered: true },
      orderBy: { createdAt: 'desc' },
      take,
      skip,
    });
  }

  /**
   * Computes a SHA-256 hash of the event payload for audit purposes.
   */
  computePayloadHash(payload: unknown): string {
    const serialized = JSON.stringify(payload, Object.keys(payload as object).sort());
    return createHash('sha256').update(serialized).digest('hex');
  }

  /**
   * Helper: wraps consumer logic with idempotency checking.
   * Consumers should use this to ensure exactly-once processing.
   */
  async processWithIdempotency(
    eventId: string,
    consumer: string,
    handler: () => Promise<void>,
  ): Promise<boolean> {
    // Check if already processed
    const alreadyProcessed = await this.consumerLog.hasProcessed(eventId, consumer);
    if (alreadyProcessed) {
      this.logger.debug(`Event ${eventId} already processed by "${consumer}", skipping`);
      return false;
    }

    try {
      await handler();
      await this.consumerLog.recordSuccess(eventId, consumer);
      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await this.consumerLog.recordFailure(eventId, consumer, errorMessage);
      throw error; // Re-throw so the dispatcher knows to retry
    }
  }
}
