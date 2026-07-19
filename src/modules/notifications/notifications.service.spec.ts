import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotificationChannel, NotificationStatus } from '@prisma/client';
import { NotificationsService, NOTIFICATION_EVENT_TYPES } from './notifications.service';
import { EventTypes } from '../events/event-types';

describe('NotificationsService', () => {
  let service: NotificationsService;
  let mockPrisma: any;
  let mockEventsService: any;

  beforeEach(() => {
    mockPrisma = {
      notification: {
        create: vi.fn(),
        update: vi.fn(),
        findMany: vi.fn(),
      },
      notificationPreference: {
        findMany: vi.fn(),
        upsert: vi.fn(),
      },
      tenantMembership: {
        findMany: vi.fn(),
      },
      ownershipRecord: {
        findFirst: vi.fn(),
      },
    };

    mockEventsService = {
      publish: vi.fn().mockResolvedValue('event-1'),
      processWithIdempotency: vi.fn().mockImplementation(
        async (_eventId: string, _consumer: string, handler: () => Promise<void>) => {
          await handler();
          return true;
        },
      ),
    };

    service = new NotificationsService(mockPrisma, mockEventsService);
  });

  // ─── Dispatch Logic ──────────────────────────────────────────────

  describe('send', () => {
    it('sends notification via preferred channel and marks DELIVERED', async () => {
      mockPrisma.notificationPreference.findMany.mockResolvedValue([
        { channel: NotificationChannel.EMAIL, enabled: true },
      ]);
      mockPrisma.notification.create.mockResolvedValue({
        id: 'notif-1',
        channel: NotificationChannel.EMAIL,
        status: NotificationStatus.PENDING,
      });
      mockPrisma.notification.update.mockResolvedValue({
        id: 'notif-1',
        channel: NotificationChannel.EMAIL,
        status: NotificationStatus.DELIVERED,
      });

      const result = await service.send('user-1', 'invoice.generated', 'Invoice', 'Your invoice');

      expect(result.status).toBe(NotificationStatus.DELIVERED);
      expect(result.channel).toBe(NotificationChannel.EMAIL);
    });

    it('defaults to Push channel when no preferences exist', async () => {
      mockPrisma.notificationPreference.findMany.mockResolvedValue([]);
      mockPrisma.notification.create.mockResolvedValue({
        id: 'notif-2',
        channel: NotificationChannel.PUSH,
        status: NotificationStatus.PENDING,
      });
      mockPrisma.notification.update.mockResolvedValue({
        id: 'notif-2',
        channel: NotificationChannel.PUSH,
        status: NotificationStatus.DELIVERED,
      });

      const result = await service.send('user-1', 'health-score.alert', 'Alert', 'Score dropped');

      expect(result.channel).toBe(NotificationChannel.PUSH);
      expect(result.status).toBe(NotificationStatus.DELIVERED);
    });
  });

  // ─── Fallback Logic ──────────────────────────────────────────────

  describe('dispatchWithFallback', () => {
    it('returns true when preferred channel succeeds', async () => {
      const result = await service.dispatchWithFallback(
        'notif-1',
        NotificationChannel.EMAIL,
        'Title',
        'Body',
      );
      expect(result).toBe(true);
    });

    it('falls back to Push when preferred channel fails', async () => {
      // Make EMAIL fail, PUSH succeed
      vi.spyOn(service, 'sendEmail').mockResolvedValue(false);
      vi.spyOn(service, 'sendPush').mockResolvedValue(true);
      mockPrisma.notification.update.mockResolvedValue({});

      const result = await service.dispatchWithFallback(
        'notif-1',
        NotificationChannel.EMAIL,
        'Title',
        'Body',
      );

      expect(result).toBe(true);
      expect(mockPrisma.notification.update).toHaveBeenCalledWith({
        where: { id: 'notif-1' },
        data: { channel: NotificationChannel.PUSH },
      });
    });

    it('returns false when preferred channel is Push and it fails', async () => {
      vi.spyOn(service, 'sendPush').mockResolvedValue(false);

      const result = await service.dispatchWithFallback(
        'notif-1',
        NotificationChannel.PUSH,
        'Title',
        'Body',
      );

      expect(result).toBe(false);
    });

    it('falls back to Push when WhatsApp fails', async () => {
      vi.spyOn(service, 'sendWhatsApp').mockResolvedValue(false);
      vi.spyOn(service, 'sendPush').mockResolvedValue(true);
      mockPrisma.notification.update.mockResolvedValue({});

      const result = await service.dispatchWithFallback(
        'notif-1',
        NotificationChannel.WHATSAPP,
        'Title',
        'Body',
      );

      expect(result).toBe(true);
    });

    it('falls back to Push when SMS fails', async () => {
      vi.spyOn(service, 'sendSms').mockResolvedValue(false);
      vi.spyOn(service, 'sendPush').mockResolvedValue(true);
      mockPrisma.notification.update.mockResolvedValue({});

      const result = await service.dispatchWithFallback(
        'notif-1',
        NotificationChannel.SMS,
        'Title',
        'Body',
      );

      expect(result).toBe(true);
    });

    it('returns false when both preferred and Push fail', async () => {
      vi.spyOn(service, 'sendEmail').mockResolvedValue(false);
      vi.spyOn(service, 'sendPush').mockResolvedValue(false);
      mockPrisma.notification.update.mockResolvedValue({});

      const result = await service.dispatchWithFallback(
        'notif-1',
        NotificationChannel.EMAIL,
        'Title',
        'Body',
      );

      expect(result).toBe(false);
    });
  });

  // ─── Retry Logic ─────────────────────────────────────────────────

  describe('retryFailedNotifications', () => {
    it('retries failed notifications and marks delivered on success', async () => {
      const failedNotif = {
        id: 'notif-fail-1',
        channel: NotificationChannel.PUSH,
        title: 'Test',
        body: 'Test body',
        retryCount: 1,
        status: NotificationStatus.FAILED,
        lastRetryAt: new Date(Date.now() - 20 * 60 * 1000), // 20 min ago
      };
      mockPrisma.notification.findMany.mockResolvedValue([failedNotif]);
      mockPrisma.notification.update.mockResolvedValue({
        ...failedNotif,
        status: NotificationStatus.DELIVERED,
        retryCount: 2,
      });

      await service.retryFailedNotifications();

      expect(mockPrisma.notification.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'notif-fail-1' },
          data: expect.objectContaining({
            status: NotificationStatus.DELIVERED,
            retryCount: 2,
          }),
        }),
      );
    });

    it('marks permanently failed after 3 retries', async () => {
      const failedNotif = {
        id: 'notif-fail-2',
        channel: NotificationChannel.PUSH,
        title: 'Test',
        body: 'Test body',
        retryCount: 2,
        status: NotificationStatus.FAILED,
        lastRetryAt: new Date(Date.now() - 20 * 60 * 1000),
      };
      mockPrisma.notification.findMany.mockResolvedValue([failedNotif]);
      vi.spyOn(service, 'dispatchToChannel').mockResolvedValue(false);
      mockPrisma.notification.update.mockResolvedValue({
        ...failedNotif,
        status: NotificationStatus.PERMANENTLY_FAILED,
        retryCount: 3,
      });

      await service.retryFailedNotifications();

      expect(mockPrisma.notification.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'notif-fail-2' },
          data: expect.objectContaining({
            status: NotificationStatus.PERMANENTLY_FAILED,
            retryCount: 3,
          }),
        }),
      );
    });

    it('does not retry notifications with lastRetryAt less than 15 min ago', async () => {
      // The query filters these out at the DB level, so findMany returns empty
      mockPrisma.notification.findMany.mockResolvedValue([]);

      await service.retryFailedNotifications();

      expect(mockPrisma.notification.update).not.toHaveBeenCalled();
    });
  });

  // ─── Preferences ─────────────────────────────────────────────────

  describe('getPreferences', () => {
    it('returns default preferences when no stored preferences exist', async () => {
      mockPrisma.notificationPreference.findMany.mockResolvedValue([]);

      const prefs = await service.getPreferences('user-1');

      // Should have entries for all event types * all channels
      expect(prefs.length).toBe(NOTIFICATION_EVENT_TYPES.length * 4);

      // All Push entries should be enabled
      const pushPrefs = prefs.filter((p: any) => p.channel === NotificationChannel.PUSH);
      expect(pushPrefs.every((p: any) => p.enabled)).toBe(true);

      // All non-Push entries should be disabled
      const nonPushPrefs = prefs.filter((p: any) => p.channel !== NotificationChannel.PUSH);
      expect(nonPushPrefs.every((p: any) => !p.enabled)).toBe(true);
    });

    it('merges stored preferences with defaults', async () => {
      mockPrisma.notificationPreference.findMany.mockResolvedValue([
        { eventType: 'invoice.generated', channel: NotificationChannel.EMAIL, enabled: true },
        { eventType: 'invoice.generated', channel: NotificationChannel.PUSH, enabled: false },
      ]);

      const prefs = await service.getPreferences('user-1');

      const invoiceEmail = prefs.find(
        (p: any) => p.eventType === 'invoice.generated' && p.channel === NotificationChannel.EMAIL,
      );
      expect(invoiceEmail?.enabled).toBe(true);

      const invoicePush = prefs.find(
        (p: any) => p.eventType === 'invoice.generated' && p.channel === NotificationChannel.PUSH,
      );
      expect(invoicePush?.enabled).toBe(false);
    });
  });

  describe('updatePreferences', () => {
    it('upserts provided preferences', async () => {
      mockPrisma.notificationPreference.upsert.mockResolvedValue({
        id: 'pref-1',
        userId: 'user-1',
        eventType: 'invoice.generated',
        channel: NotificationChannel.EMAIL,
        enabled: true,
      });

      const result = await service.updatePreferences('user-1', {
        preferences: [
          {
            eventType: 'invoice.generated',
            channel: NotificationChannel.EMAIL,
            enabled: true,
          },
        ],
      });

      expect(result.length).toBe(1);
      expect(mockPrisma.notificationPreference.upsert).toHaveBeenCalledWith({
        where: {
          userId_eventType_channel: {
            userId: 'user-1',
            eventType: 'invoice.generated',
            channel: NotificationChannel.EMAIL,
          },
        },
        update: { enabled: true },
        create: {
          userId: 'user-1',
          eventType: 'invoice.generated',
          channel: NotificationChannel.EMAIL,
          enabled: true,
        },
      });
    });

    it('handles multiple preference updates', async () => {
      mockPrisma.notificationPreference.upsert
        .mockResolvedValueOnce({ id: 'pref-1' })
        .mockResolvedValueOnce({ id: 'pref-2' });

      const result = await service.updatePreferences('user-1', {
        preferences: [
          { eventType: 'invoice.generated', channel: NotificationChannel.EMAIL, enabled: true },
          { eventType: 'health-score.alert', channel: NotificationChannel.SMS, enabled: true },
        ],
      });

      expect(result.length).toBe(2);
      expect(mockPrisma.notificationPreference.upsert).toHaveBeenCalledTimes(2);
    });
  });

  // ─── Preferred Channel Selection ─────────────────────────────────

  describe('getPreferredChannel', () => {
    it('returns Push as default when no preferences stored', async () => {
      mockPrisma.notificationPreference.findMany.mockResolvedValue([]);

      const channel = await service.getPreferredChannel('user-1', 'invoice.generated');
      expect(channel).toBe(NotificationChannel.PUSH);
    });

    it('returns highest-priority enabled channel', async () => {
      mockPrisma.notificationPreference.findMany.mockResolvedValue([
        { channel: NotificationChannel.SMS, enabled: true },
        { channel: NotificationChannel.WHATSAPP, enabled: true },
      ]);

      const channel = await service.getPreferredChannel('user-1', 'invoice.generated');
      expect(channel).toBe(NotificationChannel.WHATSAPP);
    });

    it('respects channel priority order: WHATSAPP > EMAIL > SMS > PUSH', async () => {
      mockPrisma.notificationPreference.findMany.mockResolvedValue([
        { channel: NotificationChannel.PUSH, enabled: true },
        { channel: NotificationChannel.EMAIL, enabled: true },
      ]);

      const channel = await service.getPreferredChannel('user-1', 'invoice.generated');
      expect(channel).toBe(NotificationChannel.EMAIL);
    });
  });

  // ─── Event Handlers ──────────────────────────────────────────────

  describe('handleHealthScoreAlert', () => {
    it('sends a health score alert notification', async () => {
      const sendSpy = vi.spyOn(service, 'send').mockResolvedValue({
        id: 'notif-1',
        channel: NotificationChannel.PUSH,
        status: NotificationStatus.DELIVERED,
      });

      await service.handleHealthScoreAlert({
        eventId: 'evt-1',
        eventType: EventTypes.HEALTH_SCORE_ALERT,
        sourceEntity: 'HealthScore',
        sourceId: 'hs-1',
        occurredAt: new Date().toISOString(),
        data: {
          vehicleRecordId: 'vr-1',
          userId: 'user-1',
          previousScore: 55,
          newScore: 45,
        },
      });

      expect(sendSpy).toHaveBeenCalledWith(
        'user-1',
        EventTypes.HEALTH_SCORE_ALERT,
        'Health Score Alert',
        expect.stringContaining('55'),
      );
    });
  });

  describe('handleInvoiceGenerated', () => {
    it('sends invoice notification to customer', async () => {
      const sendSpy = vi.spyOn(service, 'send').mockResolvedValue({
        id: 'notif-2',
        channel: NotificationChannel.PUSH,
        status: NotificationStatus.DELIVERED,
      });

      await service.handleInvoiceGenerated({
        eventId: 'evt-2',
        eventType: EventTypes.INVOICE_GENERATED,
        sourceEntity: 'Invoice',
        sourceId: 'inv-1',
        occurredAt: new Date().toISOString(),
        data: {
          invoiceId: 'inv-1',
          tenantId: 'tenant-1',
          jobCardId: 'jc-1',
          customerId: 'cust-1',
          totalPaise: 150000,
        },
      });

      expect(sendSpy).toHaveBeenCalledWith(
        'cust-1',
        EventTypes.INVOICE_GENERATED,
        'Invoice Generated',
        expect.stringContaining('1500.00'),
        'tenant-1',
      );
    });
  });

  describe('handleInvoicePaid', () => {
    it('sends payment confirmation to customer', async () => {
      const sendSpy = vi.spyOn(service, 'send').mockResolvedValue({
        id: 'notif-3',
        channel: NotificationChannel.PUSH,
        status: NotificationStatus.DELIVERED,
      });

      await service.handleInvoicePaid({
        eventId: 'evt-3',
        eventType: EventTypes.INVOICE_PAID,
        sourceEntity: 'Invoice',
        sourceId: 'inv-1',
        occurredAt: new Date().toISOString(),
        data: {
          invoiceId: 'inv-1',
          tenantId: 'tenant-1',
          customerId: 'cust-1',
          totalPaise: 150000,
        },
      });

      expect(sendSpy).toHaveBeenCalledWith(
        'cust-1',
        EventTypes.INVOICE_PAID,
        'Payment Confirmed',
        expect.stringContaining('1500.00'),
        'tenant-1',
      );
    });
  });

  describe('handleInventoryLowStock', () => {
    it('sends low stock alert to garage owner', async () => {
      mockPrisma.tenantMembership.findMany.mockResolvedValue([
        { userId: 'owner-1', tenantId: 'tenant-1', role: 'MANAGER' },
      ]);
      const sendSpy = vi.spyOn(service, 'send').mockResolvedValue({
        id: 'notif-4',
        channel: NotificationChannel.PUSH,
        status: NotificationStatus.DELIVERED,
      });

      await service.handleInventoryLowStock({
        eventId: 'evt-4',
        eventType: EventTypes.INVENTORY_LOW_STOCK,
        sourceEntity: 'InventoryItem',
        sourceId: 'item-1',
        occurredAt: new Date().toISOString(),
        data: {
          inventoryItemId: 'item-1',
          tenantId: 'tenant-1',
          name: 'Brake Pad',
          currentQuantity: 2,
          reorderThreshold: 5,
        },
      });

      expect(sendSpy).toHaveBeenCalledWith(
        'owner-1',
        EventTypes.INVENTORY_LOW_STOCK,
        'Low Stock Alert',
        expect.stringContaining('Brake Pad'),
        'tenant-1',
      );
    });
  });

  // ─── Channel Providers (Stubs) ──────────────────────────────────

  describe('channel providers', () => {
    it('sendWhatsApp returns true (stub)', async () => {
      expect(await service.sendWhatsApp('title', 'body')).toBe(true);
    });

    it('sendEmail returns true (stub)', async () => {
      expect(await service.sendEmail('title', 'body')).toBe(true);
    });

    it('sendSms returns true (stub)', async () => {
      expect(await service.sendSms('title', 'body')).toBe(true);
    });

    it('sendPush returns true (stub)', async () => {
      expect(await service.sendPush('title', 'body')).toBe(true);
    });
  });

  describe('dispatchToChannel', () => {
    it('routes to correct channel handler', async () => {
      const whatsAppSpy = vi.spyOn(service, 'sendWhatsApp').mockResolvedValue(true);
      await service.dispatchToChannel(NotificationChannel.WHATSAPP, 'T', 'B');
      expect(whatsAppSpy).toHaveBeenCalled();

      const emailSpy = vi.spyOn(service, 'sendEmail').mockResolvedValue(true);
      await service.dispatchToChannel(NotificationChannel.EMAIL, 'T', 'B');
      expect(emailSpy).toHaveBeenCalled();

      const smsSpy = vi.spyOn(service, 'sendSms').mockResolvedValue(true);
      await service.dispatchToChannel(NotificationChannel.SMS, 'T', 'B');
      expect(smsSpy).toHaveBeenCalled();

      const pushSpy = vi.spyOn(service, 'sendPush').mockResolvedValue(true);
      await service.dispatchToChannel(NotificationChannel.PUSH, 'T', 'B');
      expect(pushSpy).toHaveBeenCalled();
    });

    it('returns false when channel throws an error', async () => {
      vi.spyOn(service, 'sendEmail').mockRejectedValue(new Error('Network error'));
      const result = await service.dispatchToChannel(NotificationChannel.EMAIL, 'T', 'B');
      expect(result).toBe(false);
    });
  });
});
