import { describe, it, expect, beforeEach, vi } from 'vitest';
import { JobCardStatus } from '@prisma/client';
import { JobCardsService } from './job-cards.service';

describe('JobCardsService', () => {
  let service: JobCardsService;
  let mockPrisma: any;
  let mockTenantContext: any;
  let mockEventsService: any;

  beforeEach(() => {
    mockPrisma = {
      vehicleRecord: { findUnique: vi.fn() },
      tenantService: { findMany: vi.fn() },
      jobCard: {
        create: vi.fn(),
        findMany: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(),
      },
      jobCardItem: { createMany: vi.fn() },
      jobCardPart: { create: vi.fn(), updateMany: vi.fn() },
      jobCardNote: { create: vi.fn() },
      inventoryItem: { findUnique: vi.fn() },
      $transaction: vi.fn(),
    };

    mockTenantContext = { tenantId: 'tenant-1' };
    mockEventsService = { publish: vi.fn().mockResolvedValue('event-1') };

    service = new JobCardsService(mockPrisma, mockTenantContext, mockEventsService);
  });

  // ─── CREATE ────────────────────────────────────────────────────

  describe('create', () => {
    it('rejects when no services provided', async () => {
      await expect(
        service.create({
          vehicleRecordId: 'vr-1',
          customerId: 'cust-1',
          services: [],
        }),
      ).rejects.toThrow('At least 1 service is required');
    });

    it('rejects when more than 20 services provided', async () => {
      const services = Array.from({ length: 21 }, (_, i) => ({
        serviceId: `svc-${i}`,
      }));
      await expect(
        service.create({
          vehicleRecordId: 'vr-1',
          customerId: 'cust-1',
          services,
        }),
      ).rejects.toThrow('Maximum 20 services');
    });

    it('rejects when vehicle record not found', async () => {
      mockPrisma.vehicleRecord.findUnique.mockResolvedValue(null);
      await expect(
        service.create({
          vehicleRecordId: 'vr-invalid',
          customerId: 'cust-1',
          services: [{ serviceId: 'svc-1' }],
        }),
      ).rejects.toThrow('Vehicle record not found');
    });

    it('rejects when services not in tenant catalog', async () => {
      mockPrisma.vehicleRecord.findUnique.mockResolvedValue({ id: 'vr-1' });
      mockPrisma.tenantService.findMany.mockResolvedValue([]);
      await expect(
        service.create({
          vehicleRecordId: 'vr-1',
          customerId: 'cust-1',
          services: [{ serviceId: 'svc-invalid' }],
        }),
      ).rejects.toThrow('not found in tenant catalog');
    });

    it('creates job card with valid data', async () => {
      mockPrisma.vehicleRecord.findUnique.mockResolvedValue({ id: 'vr-1' });
      mockPrisma.tenantService.findMany.mockResolvedValue([
        { id: 'svc-1', tenantId: 'tenant-1', pricePaise: 50000, durationMin: 60 },
      ]);
      const createdCard = {
        id: 'jc-1',
        tenantId: 'tenant-1',
        vehicleRecordId: 'vr-1',
        customerId: 'cust-1',
        status: JobCardStatus.CREATED,
      };
      mockPrisma.$transaction.mockImplementation(async (fn: any) => {
        const tx = {
          jobCard: { create: vi.fn().mockResolvedValue(createdCard) },
          jobCardItem: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
        };
        return fn(tx);
      });
      mockPrisma.jobCard.findUnique.mockResolvedValue({
        ...createdCard,
        items: [{ serviceId: 'svc-1', pricePaise: 50000, durationMin: 60 }],
        partsConsumed: [],
        laborNotes: [],
      });

      const result = await service.create({
        vehicleRecordId: 'vr-1',
        customerId: 'cust-1',
        services: [{ serviceId: 'svc-1' }],
      });

      expect(result.status).toBe(JobCardStatus.CREATED);
      expect(result.items).toHaveLength(1);
    });
  });

  // ─── TRANSITION (State Machine) ────────────────────────────────

  describe('transition', () => {
    const baseJobCard = {
      id: 'jc-1',
      tenantId: 'tenant-1',
      vehicleRecordId: 'vr-1',
      customerId: 'cust-1',
      assignedTechId: null,
      estimatedCompletion: null,
      reworkCount: 0,
      reworkReason: null,
      items: [{ serviceId: 'svc-1', pricePaise: 50000 }],
      partsConsumed: [],
    };

    it('allows CREATED → ASSIGNED with required fields', async () => {
      mockPrisma.jobCard.findUnique.mockResolvedValue({
        ...baseJobCard,
        status: JobCardStatus.CREATED,
      });
      mockPrisma.jobCard.update.mockResolvedValue({
        ...baseJobCard,
        status: JobCardStatus.ASSIGNED,
        assignedTechId: 'tech-1',
      });

      const result = await service.transition('jc-1', {
        targetStatus: JobCardStatus.ASSIGNED,
        assignedTechId: 'tech-1',
        estimatedCompletion: new Date(Date.now() + 86400000).toISOString(),
      });

      expect(result.status).toBe(JobCardStatus.ASSIGNED);
    });

    it('rejects CREATED → ASSIGNED without assignedTechId', async () => {
      mockPrisma.jobCard.findUnique.mockResolvedValue({
        ...baseJobCard,
        status: JobCardStatus.CREATED,
      });

      await expect(
        service.transition('jc-1', {
          targetStatus: JobCardStatus.ASSIGNED,
          estimatedCompletion: new Date(Date.now() + 86400000).toISOString(),
        }),
      ).rejects.toThrow('assignedTechId is required');
    });

    it('rejects CREATED → ASSIGNED without estimatedCompletion', async () => {
      mockPrisma.jobCard.findUnique.mockResolvedValue({
        ...baseJobCard,
        status: JobCardStatus.CREATED,
      });

      await expect(
        service.transition('jc-1', {
          targetStatus: JobCardStatus.ASSIGNED,
          assignedTechId: 'tech-1',
        }),
      ).rejects.toThrow('estimatedCompletion is required');
    });

    it('rejects CREATED → ASSIGNED with past estimatedCompletion', async () => {
      mockPrisma.jobCard.findUnique.mockResolvedValue({
        ...baseJobCard,
        status: JobCardStatus.CREATED,
      });

      await expect(
        service.transition('jc-1', {
          targetStatus: JobCardStatus.ASSIGNED,
          assignedTechId: 'tech-1',
          estimatedCompletion: '2020-01-01T00:00:00.000Z',
        }),
      ).rejects.toThrow('future datetime');
    });

    it('allows ASSIGNED → IN_PROGRESS', async () => {
      mockPrisma.jobCard.findUnique.mockResolvedValue({
        ...baseJobCard,
        status: JobCardStatus.ASSIGNED,
      });
      mockPrisma.jobCard.update.mockResolvedValue({
        ...baseJobCard,
        status: JobCardStatus.IN_PROGRESS,
      });

      const result = await service.transition('jc-1', {
        targetStatus: JobCardStatus.IN_PROGRESS,
      });
      expect(result.status).toBe(JobCardStatus.IN_PROGRESS);
    });

    it('allows IN_PROGRESS → QUALITY_CHECK', async () => {
      mockPrisma.jobCard.findUnique.mockResolvedValue({
        ...baseJobCard,
        status: JobCardStatus.IN_PROGRESS,
      });
      mockPrisma.jobCard.update.mockResolvedValue({
        ...baseJobCard,
        status: JobCardStatus.QUALITY_CHECK,
      });

      const result = await service.transition('jc-1', {
        targetStatus: JobCardStatus.QUALITY_CHECK,
      });
      expect(result.status).toBe(JobCardStatus.QUALITY_CHECK);
    });

    it('allows QUALITY_CHECK → COMPLETED and publishes event', async () => {
      mockPrisma.jobCard.findUnique.mockResolvedValue({
        ...baseJobCard,
        status: JobCardStatus.QUALITY_CHECK,
        assignedTechId: 'tech-1',
      });
      mockPrisma.jobCard.update.mockResolvedValue({
        ...baseJobCard,
        status: JobCardStatus.COMPLETED,
      });

      const result = await service.transition('jc-1', {
        targetStatus: JobCardStatus.COMPLETED,
      });

      expect(result.status).toBe(JobCardStatus.COMPLETED);
      expect(mockEventsService.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'job-card.completed',
          sourceEntity: 'JobCard',
          sourceId: 'jc-1',
        }),
      );
    });

    it('allows COMPLETED → INVOICED', async () => {
      mockPrisma.jobCard.findUnique.mockResolvedValue({
        ...baseJobCard,
        status: JobCardStatus.COMPLETED,
      });
      mockPrisma.jobCard.update.mockResolvedValue({
        ...baseJobCard,
        status: JobCardStatus.INVOICED,
      });

      const result = await service.transition('jc-1', {
        targetStatus: JobCardStatus.INVOICED,
      });
      expect(result.status).toBe(JobCardStatus.INVOICED);
    });

    it('allows QUALITY_CHECK → IN_PROGRESS (rework) with reason', async () => {
      mockPrisma.jobCard.findUnique.mockResolvedValue({
        ...baseJobCard,
        status: JobCardStatus.QUALITY_CHECK,
        reworkCount: 0,
      });
      mockPrisma.jobCard.update.mockResolvedValue({
        ...baseJobCard,
        status: JobCardStatus.IN_PROGRESS,
        reworkCount: 1,
        reworkReason: 'Paint quality insufficient',
      });

      const result = await service.transition('jc-1', {
        targetStatus: JobCardStatus.IN_PROGRESS,
        reworkReason: 'Paint quality insufficient',
      });

      expect(result.status).toBe(JobCardStatus.IN_PROGRESS);
      expect(result.reworkCount).toBe(1);
    });

    it('rejects QUALITY_CHECK → IN_PROGRESS without reworkReason', async () => {
      mockPrisma.jobCard.findUnique.mockResolvedValue({
        ...baseJobCard,
        status: JobCardStatus.QUALITY_CHECK,
      });

      await expect(
        service.transition('jc-1', {
          targetStatus: JobCardStatus.IN_PROGRESS,
        }),
      ).rejects.toThrow('reworkReason is required');
    });

    // ─── Invalid transitions ─────────────────────────────────────

    it('rejects CREATED → IN_PROGRESS (skip)', async () => {
      mockPrisma.jobCard.findUnique.mockResolvedValue({
        ...baseJobCard,
        status: JobCardStatus.CREATED,
      });

      await expect(
        service.transition('jc-1', {
          targetStatus: JobCardStatus.IN_PROGRESS,
        }),
      ).rejects.toThrow('Cannot transition');
    });

    it('rejects transition from CANCELLED', async () => {
      mockPrisma.jobCard.findUnique.mockResolvedValue({
        ...baseJobCard,
        status: JobCardStatus.CANCELLED,
      });

      await expect(
        service.transition('jc-1', {
          targetStatus: JobCardStatus.CREATED,
        }),
      ).rejects.toThrow('Cannot transition');
    });

    it('rejects transition from INVOICED', async () => {
      mockPrisma.jobCard.findUnique.mockResolvedValue({
        ...baseJobCard,
        status: JobCardStatus.INVOICED,
      });

      await expect(
        service.transition('jc-1', {
          targetStatus: JobCardStatus.COMPLETED,
        }),
      ).rejects.toThrow('Cannot transition');
    });

    it('rejects ASSIGNED → QUALITY_CHECK (skipping IN_PROGRESS)', async () => {
      mockPrisma.jobCard.findUnique.mockResolvedValue({
        ...baseJobCard,
        status: JobCardStatus.ASSIGNED,
      });

      await expect(
        service.transition('jc-1', {
          targetStatus: JobCardStatus.QUALITY_CHECK,
        }),
      ).rejects.toThrow('Cannot transition');
    });

    it('rejects non-existent job card', async () => {
      mockPrisma.jobCard.findUnique.mockResolvedValue(null);

      await expect(
        service.transition('jc-invalid', {
          targetStatus: JobCardStatus.ASSIGNED,
        }),
      ).rejects.toThrow('Job card not found');
    });
  });

  // ─── LOG PARTS ─────────────────────────────────────────────────

  describe('logParts', () => {
    it('logs parts when job card is IN_PROGRESS', async () => {
      mockPrisma.jobCard.findUnique.mockResolvedValue({
        id: 'jc-1',
        status: JobCardStatus.IN_PROGRESS,
      });
      mockPrisma.inventoryItem.findUnique.mockResolvedValue({
        id: 'inv-1',
        unitCostPaise: 1500,
      });
      mockPrisma.jobCardPart.create.mockResolvedValue({
        id: 'part-1',
        jobCardId: 'jc-1',
        inventoryItemId: 'inv-1',
        quantity: 2,
        unitCostPaise: 1500,
        reversed: false,
      });

      const result = await service.logParts('jc-1', {
        inventoryItemId: 'inv-1',
        quantity: 2,
      });

      expect(result.quantity).toBe(2);
      expect(result.unitCostPaise).toBe(1500);
    });

    it('rejects logging parts when not IN_PROGRESS', async () => {
      mockPrisma.jobCard.findUnique.mockResolvedValue({
        id: 'jc-1',
        status: JobCardStatus.CREATED,
      });

      await expect(
        service.logParts('jc-1', { inventoryItemId: 'inv-1', quantity: 2 }),
      ).rejects.toThrow('IN_PROGRESS');
    });

    it('rejects invalid quantity', async () => {
      mockPrisma.jobCard.findUnique.mockResolvedValue({
        id: 'jc-1',
        status: JobCardStatus.IN_PROGRESS,
      });

      await expect(
        service.logParts('jc-1', { inventoryItemId: 'inv-1', quantity: 0 }),
      ).rejects.toThrow('positive quantity');
    });

    it('rejects when inventory item not found', async () => {
      mockPrisma.jobCard.findUnique.mockResolvedValue({
        id: 'jc-1',
        status: JobCardStatus.IN_PROGRESS,
      });
      mockPrisma.inventoryItem.findUnique.mockResolvedValue(null);

      await expect(
        service.logParts('jc-1', { inventoryItemId: 'inv-invalid', quantity: 1 }),
      ).rejects.toThrow('Inventory item not found');
    });
  });

  // ─── ADD NOTE ──────────────────────────────────────────────────

  describe('addNote', () => {
    it('adds note when job card is IN_PROGRESS', async () => {
      mockPrisma.jobCard.findUnique.mockResolvedValue({
        id: 'jc-1',
        status: JobCardStatus.IN_PROGRESS,
      });
      mockPrisma.jobCardNote.create.mockResolvedValue({
        id: 'note-1',
        jobCardId: 'jc-1',
        authorId: 'user-1',
        content: 'Replaced brake pads',
        createdAt: new Date(),
      });

      const result = await service.addNote('jc-1', 'user-1', {
        content: 'Replaced brake pads',
      });

      expect(result.content).toBe('Replaced brake pads');
    });

    it('rejects note exceeding 2000 chars', async () => {
      mockPrisma.jobCard.findUnique.mockResolvedValue({
        id: 'jc-1',
        status: JobCardStatus.IN_PROGRESS,
      });

      await expect(
        service.addNote('jc-1', 'user-1', { content: 'x'.repeat(2001) }),
      ).rejects.toThrow('2000 characters');
    });

    it('rejects note when not IN_PROGRESS', async () => {
      mockPrisma.jobCard.findUnique.mockResolvedValue({
        id: 'jc-1',
        status: JobCardStatus.ASSIGNED,
      });

      await expect(
        service.addNote('jc-1', 'user-1', { content: 'Test note' }),
      ).rejects.toThrow('IN_PROGRESS');
    });
  });

  // ─── CANCEL ────────────────────────────────────────────────────

  describe('cancel', () => {
    it('cancels from CREATED without reason (no parts)', async () => {
      mockPrisma.jobCard.findUnique.mockResolvedValue({
        id: 'jc-1',
        status: JobCardStatus.CREATED,
        tenantId: 'tenant-1',
        vehicleRecordId: 'vr-1',
        partsConsumed: [],
      });
      mockPrisma.$transaction.mockImplementation(async (fn: any) => {
        const tx = {
          jobCardPart: { updateMany: vi.fn() },
          jobCard: {
            update: vi.fn().mockResolvedValue({
              id: 'jc-1',
              status: JobCardStatus.CANCELLED,
            }),
          },
        };
        return fn(tx);
      });

      const result = await service.cancel('jc-1', {});
      expect(result.status).toBe(JobCardStatus.CANCELLED);
      expect(mockEventsService.publish).not.toHaveBeenCalled();
    });

    it('cancels with parts and requires reason + publishes event', async () => {
      mockPrisma.jobCard.findUnique.mockResolvedValue({
        id: 'jc-1',
        status: JobCardStatus.IN_PROGRESS,
        tenantId: 'tenant-1',
        vehicleRecordId: 'vr-1',
        partsConsumed: [
          { inventoryItemId: 'inv-1', quantity: 2, reversed: false },
        ],
      });
      mockPrisma.$transaction.mockImplementation(async (fn: any) => {
        const tx = {
          jobCardPart: { updateMany: vi.fn() },
          jobCard: {
            update: vi.fn().mockResolvedValue({
              id: 'jc-1',
              status: JobCardStatus.CANCELLED,
              cancellationReason: 'Customer request',
            }),
          },
        };
        return fn(tx);
      });

      const result = await service.cancel('jc-1', { reason: 'Customer request' });

      expect(result.status).toBe(JobCardStatus.CANCELLED);
      expect(mockEventsService.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'job-card.cancelled',
          sourceEntity: 'JobCard',
          sourceId: 'jc-1',
        }),
      );
    });

    it('rejects cancellation with parts but no reason', async () => {
      mockPrisma.jobCard.findUnique.mockResolvedValue({
        id: 'jc-1',
        status: JobCardStatus.IN_PROGRESS,
        tenantId: 'tenant-1',
        vehicleRecordId: 'vr-1',
        partsConsumed: [
          { inventoryItemId: 'inv-1', quantity: 2, reversed: false },
        ],
      });

      await expect(service.cancel('jc-1', {})).rejects.toThrow(
        'Cancellation reason is required',
      );
    });

    it('rejects cancellation with reason exceeding 500 chars', async () => {
      mockPrisma.jobCard.findUnique.mockResolvedValue({
        id: 'jc-1',
        status: JobCardStatus.IN_PROGRESS,
        tenantId: 'tenant-1',
        vehicleRecordId: 'vr-1',
        partsConsumed: [
          { inventoryItemId: 'inv-1', quantity: 2, reversed: false },
        ],
      });

      await expect(
        service.cancel('jc-1', { reason: 'x'.repeat(501) }),
      ).rejects.toThrow('1-500 characters');
    });

    it('rejects cancellation from COMPLETED', async () => {
      mockPrisma.jobCard.findUnique.mockResolvedValue({
        id: 'jc-1',
        status: JobCardStatus.COMPLETED,
        partsConsumed: [],
      });

      await expect(service.cancel('jc-1', {})).rejects.toThrow('Cannot cancel');
    });

    it('rejects cancellation from INVOICED', async () => {
      mockPrisma.jobCard.findUnique.mockResolvedValue({
        id: 'jc-1',
        status: JobCardStatus.INVOICED,
        partsConsumed: [],
      });

      await expect(service.cancel('jc-1', {})).rejects.toThrow('Cannot cancel');
    });
  });
});
