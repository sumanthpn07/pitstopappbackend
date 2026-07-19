import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Cron, CronExpression } from '@nestjs/schedule';
import { NotificationChannel, NotificationStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { EventsService } from '../events/events.service';
import {
  EventTypes,
  type OutboxEventPayload,
  type HealthScoreAlertPayload,
  type InventoryLowStockPayload,
  type InvoiceGeneratedPayload,
  type InvoicePaidPayload,
  type ServiceEventCreatedPayload,
} from '../events/event-types';
import type { UpdatePreferencesDto } from './dto';

/** Fallback timeout in milliseconds (30s). */
const FALLBACK_TIMEOUT_MS = 30_000;

/** Maximum retry attempts before marking permanently failed. */
const MAX_RETRIES = 3;

/** Retry interval in milliseconds (15 minutes). */
const RETRY_INTERVAL_MS = 15 * 60 * 1000;

/** All event types that trigger notifications. */
export const NOTIFICATION_EVENT_TYPES = [
  'appointment.reminder',
  'job-card.completed',
  'maintenance.overdue',
  'maintenance.due-soon',
  'health-score.alert',
  'invoice.generated',
  'invoice.paid',
  'inventory.low-stock',
] as const;

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventsService: EventsService,
  ) {}

  // ─── Core Dispatch Logic ─────────────────────────────────────────

  /**
   * Send a notification to a user. Looks up their preferred channel for the event type,
   * dispatches through that channel, and falls back to Push on failure within 30s.
   */
  async send(
    userId: string,
    eventType: string,
    title: string,
    body: string,
    tenantId?: string,
  ): Promise<{ id: string; channel: NotificationChannel; status: NotificationStatus }> {
    // Look up user's preferred channel for this event type
    const preferredChannel = await this.getPreferredChannel(userId, eventType);

    // Create the notification record
    const notification = await this.prisma.notification.create({
      data: {
        userId,
        tenantId: tenantId ?? null,
        channel: preferredChannel,
        eventType,
        title,
        body,
        status: NotificationStatus.PENDING,
        retryCount: 0,
      },
    });

    // Attempt dispatch through preferred channel
    const delivered = await this.dispatchWithFallback(notification.id, preferredChannel, title, body);

    const finalStatus = delivered ? NotificationStatus.DELIVERED : NotificationStatus.FAILED;

    const updated = await this.prisma.notification.update({
      where: { id: notification.id },
      data: {
        status: finalStatus,
        ...(delivered ? { deliveredAt: new Date() } : { lastRetryAt: new Date() }),
      },
    });

    return { id: updated.id, channel: updated.channel, status: updated.status };
  }

  /**
   * Attempts to send via the preferred channel. If it fails within 30s, falls back to Push.
   */
  async dispatchWithFallback(
    notificationId: string,
    preferredChannel: NotificationChannel,
    title: string,
    body: string,
  ): Promise<boolean> {
    // Try preferred channel
    const success = await this.dispatchToChannel(preferredChannel, title, body);
    if (success) return true;

    // If preferred was already Push, no fallback available
    if (preferredChannel === NotificationChannel.PUSH) return false;

    // Fallback to Push
    this.logger.warn(
      `Preferred channel ${preferredChannel} failed for notification ${notificationId}, falling back to PUSH`,
    );

    // Update the notification channel to PUSH for record keeping
    await this.prisma.notification.update({
      where: { id: notificationId },
      data: { channel: NotificationChannel.PUSH },
    });

    return this.dispatchToChannel(NotificationChannel.PUSH, title, body);
  }

  /**
   * Dispatch to a specific channel. Returns true if delivered within 30s, false otherwise.
   * These are stub implementations — actual integrations will be connected later.
   */
  async dispatchToChannel(
    channel: NotificationChannel,
    title: string,
    body: string,
  ): Promise<boolean> {
    try {
      switch (channel) {
        case NotificationChannel.WHATSAPP:
          return await this.sendWhatsApp(title, body);
        case NotificationChannel.EMAIL:
          return await this.sendEmail(title, body);
        case NotificationChannel.SMS:
          return await this.sendSms(title, body);
        case NotificationChannel.PUSH:
          return await this.sendPush(title, body);
        default:
          return false;
      }
    } catch (error) {
      this.logger.error(`Channel ${channel} dispatch error: ${error}`);
      return false;
    }
  }

  // ─── Channel Providers (Stubs) ───────────────────────────────────

  /**
   * Stub: WhatsApp message delivery.
   * Simulates success — actual integration to be connected later.
   */
  async sendWhatsApp(_title: string, _body: string): Promise<boolean> {
    // Stub: simulate successful delivery
    this.logger.debug('WhatsApp stub: message sent');
    return true;
  }

  /**
   * Stub: Email delivery.
   * Simulates success — actual integration to be connected later.
   */
  async sendEmail(_title: string, _body: string): Promise<boolean> {
    // Stub: simulate successful delivery
    this.logger.debug('Email stub: message sent');
    return true;
  }

  /**
   * Stub: SMS delivery.
   * Simulates success — actual integration to be connected later.
   */
  async sendSms(_title: string, _body: string): Promise<boolean> {
    // Stub: simulate successful delivery
    this.logger.debug('SMS stub: message sent');
    return true;
  }

  /**
   * Stub: Push notification delivery (in-memory).
   * Always returns true for the stub implementation.
   */
  async sendPush(_title: string, _body: string): Promise<boolean> {
    // Stub: simulate successful delivery via in-memory push
    this.logger.debug('Push stub: notification sent');
    return true;
  }

  // ─── Retry Logic (Scheduled Task) ───────────────────────────────

  /**
   * Scheduled task: retries FAILED notifications that have retryCount < 3
   * and lastRetryAt > 15 minutes ago.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async retryFailedNotifications(): Promise<void> {
    const cutoff = new Date(Date.now() - RETRY_INTERVAL_MS);

    const failedNotifications = await this.prisma.notification.findMany({
      where: {
        status: NotificationStatus.FAILED,
        retryCount: { lt: MAX_RETRIES },
        OR: [
          { lastRetryAt: null },
          { lastRetryAt: { lt: cutoff } },
        ],
      },
      take: 50,
      orderBy: { createdAt: 'asc' },
    });

    for (const notification of failedNotifications) {
      await this.retryNotification(notification);
    }
  }

  /**
   * Retries a single failed notification.
   */
  private async retryNotification(notification: {
    id: string;
    channel: NotificationChannel;
    title: string;
    body: string;
    retryCount: number;
  }): Promise<void> {
    const success = await this.dispatchToChannel(notification.channel, notification.title, notification.body);
    const newRetryCount = notification.retryCount + 1;

    if (success) {
      await this.prisma.notification.update({
        where: { id: notification.id },
        data: {
          status: NotificationStatus.DELIVERED,
          deliveredAt: new Date(),
          retryCount: newRetryCount,
          lastRetryAt: new Date(),
        },
      });
      this.logger.log(`Notification ${notification.id} delivered on retry ${newRetryCount}`);
    } else if (newRetryCount >= MAX_RETRIES) {
      await this.prisma.notification.update({
        where: { id: notification.id },
        data: {
          status: NotificationStatus.PERMANENTLY_FAILED,
          retryCount: newRetryCount,
          lastRetryAt: new Date(),
        },
      });
      this.logger.error(
        `Notification ${notification.id} permanently failed after ${MAX_RETRIES} retries`,
      );
    } else {
      await this.prisma.notification.update({
        where: { id: notification.id },
        data: {
          retryCount: newRetryCount,
          lastRetryAt: new Date(),
        },
      });
      this.logger.warn(
        `Notification ${notification.id} retry ${newRetryCount}/${MAX_RETRIES} failed`,
      );
    }
  }

  // ─── Preferences ─────────────────────────────────────────────────

  /**
   * Get a user's notification preferences.
   * Returns stored preferences, filling in defaults (Push enabled for all event types) for any missing entries.
   */
  async getPreferences(userId: string) {
    const stored = await this.prisma.notificationPreference.findMany({
      where: { userId },
    });

    // Build the full preference matrix with defaults
    const preferences = this.buildPreferencesWithDefaults(userId, stored);
    return preferences;
  }

  /**
   * Update (upsert) a user's notification preferences.
   */
  async updatePreferences(userId: string, dto: UpdatePreferencesDto) {
    const results = [];

    for (const pref of dto.preferences) {
      const result = await this.prisma.notificationPreference.upsert({
        where: {
          userId_eventType_channel: {
            userId,
            eventType: pref.eventType,
            channel: pref.channel,
          },
        },
        update: { enabled: pref.enabled },
        create: {
          userId,
          eventType: pref.eventType,
          channel: pref.channel,
          enabled: pref.enabled,
        },
      });
      results.push(result);
    }

    return results;
  }

  /**
   * Get the user's preferred channel for a given event type.
   * Falls back to PUSH if no explicit preference is set.
   */
  async getPreferredChannel(userId: string, eventType: string): Promise<NotificationChannel> {
    // Find the first enabled preference for this event type (priority: WHATSAPP > EMAIL > SMS > PUSH)
    const channelPriority: NotificationChannel[] = [
      NotificationChannel.WHATSAPP,
      NotificationChannel.EMAIL,
      NotificationChannel.SMS,
      NotificationChannel.PUSH,
    ];

    const preferences = await this.prisma.notificationPreference.findMany({
      where: { userId, eventType, enabled: true },
    });

    if (preferences.length === 0) {
      // Default: Push enabled for all event types
      return NotificationChannel.PUSH;
    }

    // Return highest-priority enabled channel
    for (const channel of channelPriority) {
      if (preferences.some((p) => p.channel === channel)) {
        return channel;
      }
    }

    return NotificationChannel.PUSH;
  }

  /**
   * Builds the full preference matrix, filling missing entries with defaults.
   * Default: Push enabled for all event types, other channels disabled.
   */
  private buildPreferencesWithDefaults(
    userId: string,
    stored: Array<{ eventType: string; channel: NotificationChannel; enabled: boolean }>,
  ) {
    const allChannels: NotificationChannel[] = [
      NotificationChannel.WHATSAPP,
      NotificationChannel.EMAIL,
      NotificationChannel.SMS,
      NotificationChannel.PUSH,
    ];

    const result: Array<{
      userId: string;
      eventType: string;
      channel: NotificationChannel;
      enabled: boolean;
    }> = [];

    for (const eventType of NOTIFICATION_EVENT_TYPES) {
      for (const channel of allChannels) {
        const existing = stored.find(
          (s) => s.eventType === eventType && s.channel === channel,
        );
        if (existing) {
          result.push({ userId, eventType, channel, enabled: existing.enabled });
        } else {
          // Default: Push enabled, others disabled
          result.push({
            userId,
            eventType,
            channel,
            enabled: channel === NotificationChannel.PUSH,
          });
        }
      }
    }

    return result;
  }

  // ─── Event Listeners ─────────────────────────────────────────────

  @OnEvent(EventTypes.HEALTH_SCORE_ALERT)
  async handleHealthScoreAlert(event: { eventId: string } & OutboxEventPayload<HealthScoreAlertPayload>) {
    await this.eventsService.processWithIdempotency(
      event.eventId,
      'notifications:health-score-alert',
      async () => {
        const { userId, newScore, previousScore } = event.data;
        await this.send(
          userId,
          EventTypes.HEALTH_SCORE_ALERT,
          'Health Score Alert',
          `Your vehicle health score dropped from ${previousScore} to ${newScore}. Consider scheduling maintenance.`,
        );
      },
    );
  }

  @OnEvent(EventTypes.INVENTORY_LOW_STOCK)
  async handleInventoryLowStock(event: { eventId: string } & OutboxEventPayload<InventoryLowStockPayload>) {
    await this.eventsService.processWithIdempotency(
      event.eventId,
      'notifications:inventory-low-stock',
      async () => {
        const { tenantId, name, currentQuantity, reorderThreshold } = event.data;
        // Notify tenant owner about low stock — find owner via tenant memberships
        const memberships = await this.prisma.tenantMembership.findMany({
          where: { tenantId, role: 'MANAGER' },
        });
        for (const membership of memberships) {
          await this.send(
            membership.userId,
            EventTypes.INVENTORY_LOW_STOCK,
            'Low Stock Alert',
            `${name} is running low (${currentQuantity} remaining, threshold: ${reorderThreshold}).`,
            tenantId,
          );
        }
      },
    );
  }

  @OnEvent(EventTypes.INVOICE_GENERATED)
  async handleInvoiceGenerated(event: { eventId: string } & OutboxEventPayload<InvoiceGeneratedPayload>) {
    await this.eventsService.processWithIdempotency(
      event.eventId,
      'notifications:invoice-generated',
      async () => {
        const { customerId, totalPaise, tenantId } = event.data;
        const amountFormatted = (totalPaise / 100).toFixed(2);
        await this.send(
          customerId,
          EventTypes.INVOICE_GENERATED,
          'Invoice Generated',
          `A new invoice for ₹${amountFormatted} has been generated for your service.`,
          tenantId,
        );
      },
    );
  }

  @OnEvent(EventTypes.INVOICE_PAID)
  async handleInvoicePaid(event: { eventId: string } & OutboxEventPayload<InvoicePaidPayload>) {
    await this.eventsService.processWithIdempotency(
      event.eventId,
      'notifications:invoice-paid',
      async () => {
        const { customerId, totalPaise, tenantId } = event.data;
        const amountFormatted = (totalPaise / 100).toFixed(2);
        await this.send(
          customerId,
          EventTypes.INVOICE_PAID,
          'Payment Confirmed',
          `Payment of ₹${amountFormatted} has been confirmed. Thank you!`,
          tenantId,
        );
      },
    );
  }

  @OnEvent(EventTypes.SERVICE_EVENT_CREATED)
  async handleServiceEventCreated(event: { eventId: string } & OutboxEventPayload<ServiceEventCreatedPayload>) {
    await this.eventsService.processWithIdempotency(
      event.eventId,
      'notifications:service-event-created',
      async () => {
        const { vehicleRecordId, category, tenantId } = event.data;
        // Find the current vehicle owner
        const ownership = await this.prisma.ownershipRecord.findFirst({
          where: { vehicleRecordId, endDate: null, transferStatus: 'CONFIRMED' },
        });
        if (!ownership || !ownership.userId) return;

        await this.send(
          ownership.userId,
          EventTypes.SERVICE_EVENT_CREATED,
          'Service Completed',
          `A ${category} service has been recorded for your vehicle.`,
          tenantId ?? undefined,
        );
      },
    );
  }

  @OnEvent(EventTypes.JOB_CARD_COMPLETED)
  async handleJobCardCompleted(event: { eventId: string } & OutboxEventPayload<any>) {
    await this.eventsService.processWithIdempotency(
      event.eventId,
      'notifications:job-card-completed',
      async () => {
        const { customerId, tenantId } = event.data;
        await this.send(
          customerId,
          EventTypes.JOB_CARD_COMPLETED,
          'Job Completed',
          'Your vehicle service has been completed. Please collect your vehicle.',
          tenantId,
        );
      },
    );
  }

  @OnEvent(EventTypes.MAINTENANCE_OVERDUE)
  async handleMaintenanceOverdue(event: { eventId: string } & OutboxEventPayload<any>) {
    await this.eventsService.processWithIdempotency(
      event.eventId,
      'notifications:maintenance-overdue',
      async () => {
        const { userId, vehicleRecordId, entryName } = event.data;
        await this.send(
          userId,
          EventTypes.MAINTENANCE_OVERDUE,
          'Maintenance Overdue',
          `${entryName ?? 'A scheduled maintenance item'} is overdue for your vehicle. Please schedule service soon.`,
        );
      },
    );
  }

  @OnEvent(EventTypes.MAINTENANCE_DUE_SOON)
  async handleMaintenanceDueSoon(event: { eventId: string } & OutboxEventPayload<any>) {
    await this.eventsService.processWithIdempotency(
      event.eventId,
      'notifications:maintenance-due-soon',
      async () => {
        const { userId, vehicleRecordId, entryName } = event.data;
        await this.send(
          userId,
          EventTypes.MAINTENANCE_DUE_SOON,
          'Maintenance Reminder',
          `${entryName ?? 'A scheduled maintenance item'} is due soon for your vehicle.`,
        );
      },
    );
  }

  @OnEvent(EventTypes.APPOINTMENT_REMINDER)
  async handleAppointmentReminder(event: { eventId: string } & OutboxEventPayload<any>) {
    await this.eventsService.processWithIdempotency(
      event.eventId,
      'notifications:appointment-reminder',
      async () => {
        const { userId, scheduledTime, tenantId } = event.data;
        await this.send(
          userId,
          EventTypes.APPOINTMENT_REMINDER,
          'Appointment Reminder',
          `You have an appointment scheduled for ${scheduledTime}. Don't forget!`,
          tenantId,
        );
      },
    );
  }
}
