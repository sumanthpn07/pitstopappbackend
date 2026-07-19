import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Tracks which consumers have processed which events.
 * Enables idempotent (exactly-once per consumer) processing semantics.
 */
@Injectable()
export class EventConsumerLogService {
  private readonly logger = new Logger(EventConsumerLogService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Checks whether the given consumer has already processed the event.
   * Returns true if the event was already successfully processed.
   */
  async hasProcessed(eventId: string, consumer: string): Promise<boolean> {
    const existing = await this.prisma.eventConsumerLog.findUnique({
      where: { eventId_consumer: { eventId, consumer } },
    });
    return existing?.success === true;
  }

  /**
   * Records a successful processing of an event by a consumer.
   * Uses upsert to handle race conditions gracefully.
   */
  async recordSuccess(eventId: string, consumer: string): Promise<void> {
    await this.prisma.eventConsumerLog.upsert({
      where: { eventId_consumer: { eventId, consumer } },
      create: {
        eventId,
        consumer,
        success: true,
      },
      update: {
        success: true,
        processedAt: new Date(),
        error: null,
      },
    });
    this.logger.debug(`Consumer "${consumer}" processed event ${eventId} successfully`);
  }

  /**
   * Records a failed processing attempt of an event by a consumer.
   */
  async recordFailure(eventId: string, consumer: string, error: string): Promise<void> {
    await this.prisma.eventConsumerLog.upsert({
      where: { eventId_consumer: { eventId, consumer } },
      create: {
        eventId,
        consumer,
        success: false,
        error,
      },
      update: {
        success: false,
        processedAt: new Date(),
        error,
      },
    });
    this.logger.warn(`Consumer "${consumer}" failed to process event ${eventId}: ${error}`);
  }
}
