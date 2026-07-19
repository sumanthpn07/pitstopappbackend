import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InventoryService } from './inventory.service';
import { EventTypes } from '../events/event-types';

describe('InventoryService', () => {
  let service: InventoryService;
  let mockPrisma: any;
  let mockTenantContext: any;
  let mockEventsService: any;

  beforeEach(() => {
    mockPrisma = {
      inventoryItem: {
        findMany: vi.fn(),
        findFirst: vi.fn(),
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      inventoryMovement: {
        findMany: vi.fn(),
        create: vi.fn(),
      },
      $transaction: vi.fn(),
    };

    mockTenantContext = { tenantId: 'tenant-1' };
    mockEventsService = {
      publish: vi.fn().mockResolvedValue('event-1'),
      processWithIdempotency: vi.fn().mockImplementation(
        async (_eventId: string, _consumer: string, handler: () => Promise<void>) => {
          await handler();
          return true;
        },
      ),
    };

    service = new InventoryService(mockPrisma, mockTenantContext, mockEventsService);
  });

  // ─── Weighted Average Cost ───────────────────────────────────────

  describe('calculateWeightedAverageCost', () => {
    it('calculates weighted average correctly with equal quantities', () => {
      // 10 units at 100 + 10 units at 200 => avg = (1000 + 2000) / 20 = 150
      const result = service.calculateWeightedAverageCost(10, 100, 10, 200);
      expect(result).toBe(150);
    });

    it('calculates weighted average correctly with different quantities', () => {
      // 5 units at 1000 + 15 units at 2000 => (5000 + 30000) / 20 = 1750
      const result = service.calculateWeightedAverageCost(5, 1000, 15, 2000);
      expect(result).toBe(1750);
    });

    it('rounds to nearest integer', () => {
      // 3 units at 100 + 2 units at 200 => (300 + 400) / 5 = 140
      const result = service.calculateWeightedAverageCost(3, 100, 2, 200);
      expect(result).toBe(140);
    });

    it('rounds half up', () => {
      // 1 unit at 1 + 2 units at 2 => (1 + 4) / 3 = 1.666... => 2
      const result = service.calculateWeightedAverageCost(1, 1, 2, 2);
      expect(result).toBe(2);
    });

    it('handles zero current quantity (first purchase)', () => {
      // 0 units at 0 + 10 units at 500 => 500
      const result = service.calculateWeightedAverageCost(0, 0, 10, 500);
      expect(result).toBe(500);
    });

    it('returns 0 when total quantity is 0', () => {
      const result = service.calculateWeightedAverageCost(0, 100, 0, 200);
      expect(result).toBe(0);
    });

    it('preserves existing cost when purchase qty is 0', () => {
      // Edge case: mathematically same since total is just current
      const result = service.calculateWeightedAverageCost(10, 500, 0, 0);
      // totalValue = 5000, totalQty = 10 => 500
      expect(result).toBe(500);
    });
  });

  // ─── Consumption Rejection ───────────────────────────────────────

  describe('consume', () => {
    it('rejects consumption when quantity would go below 0', async () => {
      mockPrisma.inventoryItem.findFirst.mockResolvedValue({
        id: 'inv-1',
        tenantId: 'tenant-1',
        quantity: 5,
        reorderThreshold: 2,
        name: 'Brake Pad',
      });

      await expect(
        service.consume('inv-1', { quantity: 6 }, 'staff-1'),
      ).rejects.toThrow('Insufficient stock');
    });

    it('rejects consumption when quantity equals available (would hit 0 but not below)', async () => {
      mockPrisma.inventoryItem.findFirst.mockResolvedValue({
        id: 'inv-1',
        tenantId: 'tenant-1',
        quantity: 5,
        reorderThreshold: 2,
        name: 'Brake Pad',
      });
      mockPrisma.$transaction.mockResolvedValue([
        { id: 'inv-1', quantity: 0 },
        { id: 'mov-1' },
      ]);

      const result = await service.consume('inv-1', { quantity: 5 }, 'staff-1');
      expect(result.quantity).toBe(0);
    });

    it('deducts quantity on valid consumption', async () => {
      mockPrisma.inventoryItem.findFirst.mockResolvedValue({
        id: 'inv-1',
        tenantId: 'tenant-1',
        quantity: 10,
        reorderThreshold: 2,
        name: 'Oil Filter',
      });
      mockPrisma.$transaction.mockResolvedValue([
        { id: 'inv-1', quantity: 7 },
        { id: 'mov-1' },
      ]);

      const result = await service.consume('inv-1', { quantity: 3 }, 'staff-1');
      expect(result.quantity).toBe(7);
    });

    it('rejects zero quantity consumption', async () => {
      await expect(
        service.consume('inv-1', { quantity: 0 }, 'staff-1'),
      ).rejects.toThrow('greater than 0');
    });

    it('rejects negative quantity consumption', async () => {
      await expect(
        service.consume('inv-1', { quantity: -1 }, 'staff-1'),
      ).rejects.toThrow('greater than 0');
    });

    it('rejects when item not found', async () => {
      mockPrisma.inventoryItem.findFirst.mockResolvedValue(null);

      await expect(
        service.consume('inv-invalid', { quantity: 1 }, 'staff-1'),
      ).rejects.toThrow('Inventory item not found');
    });

    it('triggers reorder alert when quantity falls to threshold', async () => {
      mockPrisma.inventoryItem.findFirst.mockResolvedValue({
        id: 'inv-1',
        tenantId: 'tenant-1',
        quantity: 3,
        reorderThreshold: 2,
        name: 'Brake Pad',
      });
      mockPrisma.$transaction.mockResolvedValue([
        { id: 'inv-1', quantity: 2 },
        { id: 'mov-1' },
      ]);

      await service.consume('inv-1', { quantity: 1 }, 'staff-1');

      expect(mockEventsService.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: EventTypes.INVENTORY_LOW_STOCK,
          sourceEntity: 'InventoryItem',
          sourceId: 'inv-1',
        }),
      );
    });
  });

  // ─── Purchase ────────────────────────────────────────────────────

  describe('purchase', () => {
    it('increases quantity and updates weighted average cost', async () => {
      mockPrisma.inventoryItem.findFirst.mockResolvedValue({
        id: 'inv-1',
        tenantId: 'tenant-1',
        quantity: 10,
        unitCostPaise: 1000,
        reorderThreshold: 5,
        name: 'Oil Filter',
      });
      // Weighted average: (10 * 1000 + 5 * 1200) / 15 = 16000 / 15 = 1067
      mockPrisma.$transaction.mockResolvedValue([
        { id: 'inv-1', quantity: 15, unitCostPaise: 1067 },
        { id: 'mov-1' },
      ]);

      const result = await service.purchase(
        'inv-1',
        { quantity: 5, unitCostPaise: 1200 },
        'staff-1',
      );

      expect(result.quantity).toBe(15);
      expect(result.unitCostPaise).toBe(1067);
    });

    it('rejects zero quantity purchase', async () => {
      await expect(
        service.purchase('inv-1', { quantity: 0, unitCostPaise: 100 }, 'staff-1'),
      ).rejects.toThrow('greater than 0');
    });

    it('rejects zero unit cost purchase', async () => {
      await expect(
        service.purchase('inv-1', { quantity: 5, unitCostPaise: 0 }, 'staff-1'),
      ).rejects.toThrow('greater than 0');
    });
  });

  // ─── Event Handlers ──────────────────────────────────────────────

  describe('handleJobCardCompleted', () => {
    it('deducts parts from inventory on job card completion', async () => {
      const event = {
        eventId: 'evt-1',
        eventType: 'job-card.completed' as const,
        sourceEntity: 'JobCard',
        sourceId: 'jc-1',
        occurredAt: new Date().toISOString(),
        data: {
          jobCardId: 'jc-1',
          tenantId: 'tenant-1',
          vehicleRecordId: 'vr-1',
          customerId: 'cust-1',
          services: [],
          partsConsumed: [
            { inventoryItemId: 'inv-1', quantity: 2, unitCostPaise: 500 },
            { inventoryItemId: 'inv-2', quantity: 1, unitCostPaise: 800 },
          ],
          assignedTechId: 'tech-1',
          completedAt: new Date().toISOString(),
        },
      };

      mockPrisma.inventoryItem.findUnique
        .mockResolvedValueOnce({ id: 'inv-1', quantity: 10, reorderThreshold: 5, name: 'Part A' })
        .mockResolvedValueOnce({ id: 'inv-2', quantity: 5, reorderThreshold: 2, name: 'Part B' });
      mockPrisma.$transaction.mockResolvedValue([{}, {}]);

      await service.handleJobCardCompleted(event);

      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(2);
    });

    it('throws when insufficient stock during event processing', async () => {
      const event = {
        eventId: 'evt-2',
        eventType: 'job-card.completed' as const,
        sourceEntity: 'JobCard',
        sourceId: 'jc-2',
        occurredAt: new Date().toISOString(),
        data: {
          jobCardId: 'jc-2',
          tenantId: 'tenant-1',
          vehicleRecordId: 'vr-1',
          customerId: 'cust-1',
          services: [],
          partsConsumed: [
            { inventoryItemId: 'inv-1', quantity: 20, unitCostPaise: 500 },
          ],
          assignedTechId: 'tech-1',
          completedAt: new Date().toISOString(),
        },
      };

      mockPrisma.inventoryItem.findUnique.mockResolvedValue({
        id: 'inv-1',
        quantity: 5,
        reorderThreshold: 2,
        name: 'Part A',
      });

      await expect(service.handleJobCardCompleted(event)).rejects.toThrow(
        'Insufficient stock',
      );
    });
  });

  describe('handleJobCardCancelled', () => {
    it('reverses parts on job card cancellation', async () => {
      const event = {
        eventId: 'evt-3',
        eventType: 'job-card.cancelled' as const,
        sourceEntity: 'JobCard',
        sourceId: 'jc-3',
        occurredAt: new Date().toISOString(),
        data: {
          jobCardId: 'jc-3',
          tenantId: 'tenant-1',
          vehicleRecordId: 'vr-1',
          partsToReverse: [
            { inventoryItemId: 'inv-1', quantity: 3 },
            { inventoryItemId: 'inv-2', quantity: 1 },
          ],
          cancellationReason: 'Customer changed mind',
        },
      };

      mockPrisma.$transaction.mockResolvedValue([{}, {}]);

      await service.handleJobCardCancelled(event);

      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(2);
    });
  });

  // ─── SKU Uniqueness ──────────────────────────────────────────────

  describe('create - SKU uniqueness', () => {
    it('rejects duplicate SKU within same tenant', async () => {
      mockPrisma.inventoryItem.findUnique.mockResolvedValue({
        id: 'existing-1',
        sku: 'SKU-001',
      });

      await expect(
        service.create({
          name: 'Oil Filter',
          sku: 'SKU-001',
          quantity: 10,
          unitCostPaise: 500,
          sellingPricePaise: 800,
        }),
      ).rejects.toThrow('already exists');
    });

    it('creates item when SKU is unique within tenant', async () => {
      mockPrisma.inventoryItem.findUnique.mockResolvedValue(null);
      mockPrisma.inventoryItem.create.mockResolvedValue({
        id: 'new-1',
        tenantId: 'tenant-1',
        name: 'Oil Filter',
        sku: 'SKU-002',
        quantity: 10,
        unitCostPaise: 500,
        sellingPricePaise: 800,
      });

      const result = await service.create({
        name: 'Oil Filter',
        sku: 'SKU-002',
        quantity: 10,
        unitCostPaise: 500,
        sellingPricePaise: 800,
      });

      expect(result.sku).toBe('SKU-002');
    });
  });

  // ─── Validation ──────────────────────────────────────────────────

  describe('create - validation', () => {
    it('rejects name exceeding 120 characters', async () => {
      await expect(
        service.create({
          name: 'x'.repeat(121),
          sku: 'SKU-001',
          quantity: 10,
          unitCostPaise: 500,
          sellingPricePaise: 800,
        }),
      ).rejects.toThrow('120 characters');
    });

    it('rejects SKU exceeding 40 characters', async () => {
      await expect(
        service.create({
          name: 'Oil Filter',
          sku: 'x'.repeat(41),
          quantity: 10,
          unitCostPaise: 500,
          sellingPricePaise: 800,
        }),
      ).rejects.toThrow('40 characters');
    });

    it('rejects negative quantity', async () => {
      await expect(
        service.create({
          name: 'Oil Filter',
          sku: 'SKU-001',
          quantity: -1,
          unitCostPaise: 500,
          sellingPricePaise: 800,
        }),
      ).rejects.toThrow('0 or greater');
    });
  });
});
