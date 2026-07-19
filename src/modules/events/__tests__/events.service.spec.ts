import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { EventsService } from '../events.service';
import { EventConsumerLogService } from '../event-consumer-log.service';
import { EventTypes } from '../event-types';

// Mock PrismaService
function createMockPrisma() {
  return {
    outboxEvent: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    eventConsumerLog: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
  };
}

describe('EventsService', () => {
  let service: EventsService;
  let prisma: ReturnType<typeof createMockPrisma>;
  let eventEmitter: EventEmitter2;
  let consumerLog: EventConsumerLogService;

  beforeEach(() => {
    prisma = createMockPrisma();
    eventEmitter = new EventEmitter2();
    consumerLog = new EventConsumerLogService(prisma as any);
    service = new EventsService(prisma as any, eventEmitter, consumerLog);
  });

  describe('publish', () => {
    it('should write an event to the outbox table', async () => {
      const eventId = 'evt-1';
      prisma.outboxEvent.create.mockResolvedValue({ id: eventId });

      const result = await service.publish({
        eventType: EventTypes.JOB_CARD_COMPLETED,
        sourceEntity: 'JobCard',
        sourceId: 'jc-1',
        payload: { jobCardId: 'jc-1', tenantId: 'tn-1' },
      });

      expect(result).toBe(eventId);
      expect(prisma.outboxEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          eventType: 'job-card.completed',
          sourceEntity: 'JobCard',
          sourceId: 'jc-1',
          published: false,
          retryCount: 0,
          deadLettered: false,
        }),
      });
    });

    it('should compute a SHA-256 payload hash', async () => {
      prisma.outboxEvent.create.mockResolvedValue({ id: 'evt-2' });

      await service.publish({
        eventType: EventTypes.JOB_CARD_COMPLETED,
        sourceEntity: 'JobCard',
        sourceId: 'jc-2',
        payload: { jobCardId: 'jc-2' },
      });

      const call = prisma.outboxEvent.create.mock.calls[0][0];
      expect(call.data.payloadHash).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  describe('computePayloadHash', () => {
    it('should produce deterministic hash for same payload', () => {
      const payload = { a: 1, b: 'hello' };
      const hash1 = service.computePayloadHash(payload);
      const hash2 = service.computePayloadHash(payload);
      expect(hash1).toBe(hash2);
    });

    it('should produce same hash regardless of key order', () => {
      const hash1 = service.computePayloadHash({ a: 1, b: 2 });
      const hash2 = service.computePayloadHash({ b: 2, a: 1 });
      expect(hash1).toBe(hash2);
    });

    it('should produce different hashes for different payloads', () => {
      const hash1 = service.computePayloadHash({ a: 1 });
      const hash2 = service.computePayloadHash({ a: 2 });
      expect(hash1).not.toBe(hash2);
    });
  });

  describe('pollAndDispatch', () => {
    it('should do nothing when no unpublished events', async () => {
      prisma.outboxEvent.findMany.mockResolvedValue([]);

      await service.pollAndDispatch();

      expect(prisma.outboxEvent.update).not.toHaveBeenCalled();
    });

    it('should dispatch unpublished events and mark them published', async () => {
      const mockEvent = {
        id: 'evt-1',
        eventType: EventTypes.JOB_CARD_COMPLETED,
        payload: { jobCardId: 'jc-1' },
        sourceEntity: 'JobCard',
        sourceId: 'jc-1',
        retryCount: 0,
      };

      prisma.outboxEvent.findMany.mockResolvedValue([mockEvent]);
      prisma.outboxEvent.update.mockResolvedValue({});

      // No listeners — emitAsync resolves successfully
      await service.pollAndDispatch();

      expect(prisma.outboxEvent.update).toHaveBeenCalledWith({
        where: { id: 'evt-1' },
        data: {
          published: true,
          publishedAt: expect.any(Date),
        },
      });
    });

    it('should handle dispatch failure and increment retry count', async () => {
      const mockEvent = {
        id: 'evt-1',
        eventType: EventTypes.JOB_CARD_COMPLETED,
        payload: { jobCardId: 'jc-1' },
        sourceEntity: 'JobCard',
        sourceId: 'jc-1',
        retryCount: 0,
      };

      prisma.outboxEvent.findMany.mockResolvedValue([mockEvent]);
      prisma.outboxEvent.findUnique.mockResolvedValue(mockEvent);
      prisma.outboxEvent.update.mockResolvedValue({});

      // Register a listener that throws
      eventEmitter.on(EventTypes.JOB_CARD_COMPLETED, () => {
        throw new Error('Consumer failed');
      });

      await service.pollAndDispatch();

      // Should increment retry count (not dead-letter since retryCount was 0)
      expect(prisma.outboxEvent.update).toHaveBeenCalledWith({
        where: { id: 'evt-1' },
        data: { retryCount: 1 },
      });
    });

    it('should dead-letter after max retries', async () => {
      const mockEvent = {
        id: 'evt-1',
        eventType: EventTypes.JOB_CARD_COMPLETED,
        payload: { jobCardId: 'jc-1' },
        sourceEntity: 'JobCard',
        sourceId: 'jc-1',
        retryCount: 2, // Already at 2, next failure is the 3rd attempt
      };

      prisma.outboxEvent.findMany.mockResolvedValue([mockEvent]);
      prisma.outboxEvent.findUnique.mockResolvedValue(mockEvent);
      prisma.outboxEvent.update.mockResolvedValue({});
      prisma.outboxEvent.create.mockResolvedValue({ id: 'dead-letter-evt' });

      // Listener that throws
      eventEmitter.on(EventTypes.JOB_CARD_COMPLETED, () => {
        throw new Error('Consumer crashed');
      });

      await service.pollAndDispatch();

      // Should mark as dead-lettered
      expect(prisma.outboxEvent.update).toHaveBeenCalledWith({
        where: { id: 'evt-1' },
        data: {
          retryCount: 3,
          deadLettered: true,
          failureReason: 'Consumer crashed',
        },
      });
    });
  });

  describe('processWithIdempotency', () => {
    it('should skip if already processed', async () => {
      prisma.eventConsumerLog.findUnique.mockResolvedValue({ success: true });
      const handler = vi.fn();

      const result = await service.processWithIdempotency('evt-1', 'inventory', handler);

      expect(result).toBe(false);
      expect(handler).not.toHaveBeenCalled();
    });

    it('should execute handler and record success', async () => {
      prisma.eventConsumerLog.findUnique.mockResolvedValue(null);
      prisma.eventConsumerLog.upsert.mockResolvedValue({});
      const handler = vi.fn().mockResolvedValue(undefined);

      const result = await service.processWithIdempotency('evt-1', 'inventory', handler);

      expect(result).toBe(true);
      expect(handler).toHaveBeenCalled();
    });

    it('should record failure and rethrow on handler error', async () => {
      prisma.eventConsumerLog.findUnique.mockResolvedValue(null);
      prisma.eventConsumerLog.upsert.mockResolvedValue({});
      const handler = vi.fn().mockRejectedValue(new Error('boom'));

      await expect(
        service.processWithIdempotency('evt-1', 'inventory', handler),
      ).rejects.toThrow('boom');
    });
  });

  describe('replayDeadLetter', () => {
    it('should reset dead-letter state', async () => {
      prisma.outboxEvent.update.mockResolvedValue({});

      await service.replayDeadLetter('evt-dl-1');

      expect(prisma.outboxEvent.update).toHaveBeenCalledWith({
        where: { id: 'evt-dl-1' },
        data: {
          published: false,
          deadLettered: false,
          retryCount: 0,
          failureReason: null,
        },
      });
    });
  });

  describe('discardDeadLetter', () => {
    it('should mark event as published without dispatching', async () => {
      prisma.outboxEvent.update.mockResolvedValue({});

      await service.discardDeadLetter('evt-dl-1');

      expect(prisma.outboxEvent.update).toHaveBeenCalledWith({
        where: { id: 'evt-dl-1' },
        data: {
          published: true,
          publishedAt: expect.any(Date),
        },
      });
    });
  });
});
