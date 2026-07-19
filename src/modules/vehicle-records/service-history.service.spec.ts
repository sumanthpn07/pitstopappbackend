import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ServiceHistoryService } from './service-history.service';
import { ServiceCategory, ServiceEventSource } from '@prisma/client';
import type { AuthContext } from '../../common/auth.types';

describe('ServiceHistoryService', () => {
  let service: ServiceHistoryService;
  let mockPrisma: any;

  const mockAuth: AuthContext = {
    userId: 'user-1',
    phone: '+919999999999',
    name: 'Test User',
    memberships: [],
    tenantMemberships: [
      { id: 'tm-1', tenantId: 'tenant-1', role: 'OWNER' as any, tenantName: 'Test Garage' },
    ],
  };

  beforeEach(() => {
    mockPrisma = {
      vehicleRecord: {
        findUnique: vi.fn(),
        update: vi.fn(),
      },
      serviceEvent: {
        findMany: vi.fn(),
        count: vi.fn(),
        create: vi.fn(),
      },
      $transaction: vi.fn(),
    };
    service = new ServiceHistoryService(mockPrisma);
  });

  // ─── getHistory ────────────────────────────────────────────────

  describe('getHistory', () => {
    const vehicleId = 'vehicle-1';

    it('returns paginated service events in reverse chronological order (Req 3.3)', async () => {
      mockPrisma.vehicleRecord.findUnique.mockResolvedValue({ id: vehicleId });

      const events = [
        { id: 'e-3', completedAt: new Date('2024-03-01'), serviceType: 'Oil Change', tenantName: 'Garage C' },
        { id: 'e-2', completedAt: new Date('2024-02-01'), serviceType: 'Brake Check', tenantName: 'Garage B' },
        { id: 'e-1', completedAt: new Date('2024-01-01'), serviceType: 'Tire Rotation', tenantName: 'Garage A' },
      ];
      mockPrisma.serviceEvent.findMany.mockResolvedValue(events);
      mockPrisma.serviceEvent.count.mockResolvedValue(3);

      const result = await service.getHistory(vehicleId, 1);

      expect(result.data).toHaveLength(3);
      expect(result.pagination).toEqual({
        page: 1,
        pageSize: 20,
        total: 3,
        totalPages: 1,
      });
      // Verify ordering — findMany called with completedAt desc
      expect(mockPrisma.serviceEvent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { completedAt: 'desc' },
        }),
      );
    });

    it('paginates correctly with 20 items per page', async () => {
      mockPrisma.vehicleRecord.findUnique.mockResolvedValue({ id: vehicleId });
      mockPrisma.serviceEvent.findMany.mockResolvedValue([]);
      mockPrisma.serviceEvent.count.mockResolvedValue(45);

      const result = await service.getHistory(vehicleId, 2);

      expect(result.pagination).toEqual({
        page: 2,
        pageSize: 20,
        total: 45,
        totalPages: 3,
      });
      // skip = (2-1) * 20 = 20
      expect(mockPrisma.serviceEvent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 20,
          take: 20,
        }),
      );
    });

    it('throws not found for non-existent vehicle', async () => {
      mockPrisma.vehicleRecord.findUnique.mockResolvedValue(null);

      await expect(service.getHistory('nonexistent', 1)).rejects.toThrow(
        'Vehicle record not found',
      );
    });

    it('returns empty data array when no events exist', async () => {
      mockPrisma.vehicleRecord.findUnique.mockResolvedValue({ id: vehicleId });
      mockPrisma.serviceEvent.findMany.mockResolvedValue([]);
      mockPrisma.serviceEvent.count.mockResolvedValue(0);

      const result = await service.getHistory(vehicleId, 1);

      expect(result.data).toEqual([]);
      expect(result.pagination.total).toBe(0);
      expect(result.pagination.totalPages).toBe(0);
    });

    it('includes events from all tenants regardless of source (Req 3.3)', async () => {
      mockPrisma.vehicleRecord.findUnique.mockResolvedValue({ id: vehicleId });
      const events = [
        { id: 'e-1', tenantName: 'Garage A', source: ServiceEventSource.JOB_CARD },
        { id: 'e-2', tenantName: 'Garage B', source: ServiceEventSource.JOB_CARD },
        { id: 'e-3', tenantName: 'Self', source: ServiceEventSource.OWNER_REPORTED },
      ];
      mockPrisma.serviceEvent.findMany.mockResolvedValue(events);
      mockPrisma.serviceEvent.count.mockResolvedValue(3);

      const result = await service.getHistory(vehicleId, 1);

      expect(result.data).toHaveLength(3);
      // Verify filter is only by vehicleRecordId (no tenantId filter)
      expect(mockPrisma.serviceEvent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { vehicleRecordId: vehicleId },
        }),
      );
    });
  });

  // ─── getHistoryForExternalView ─────────────────────────────────

  describe('getHistoryForExternalView', () => {
    const vehicleId = 'vehicle-1';

    it('strips internal pricing fields for external view (Req 5.6)', async () => {
      mockPrisma.vehicleRecord.findUnique.mockResolvedValue({ id: vehicleId });

      const fullEvent = {
        id: 'e-1',
        vehicleRecordId: vehicleId,
        tenantId: 'tenant-1',
        tenantName: 'Garage A',
        serviceType: 'Oil Change',
        category: ServiceCategory.ROUTINE_MAINTENANCE,
        description: 'Full synthetic oil',
        partsUsed: [{ name: 'Oil Filter', quantity: 1 }],
        laborCostPaise: 50000,
        partsCostPaise: 30000,
        totalCostPaise: 80000,
        currency: 'INR',
        odometerKm: 50000,
        technicianName: 'John Doe',
        source: ServiceEventSource.JOB_CARD,
        jobCardId: 'jc-1',
        completedAt: new Date('2024-01-15'),
        createdAt: new Date('2024-01-15'),
      };
      mockPrisma.serviceEvent.findMany.mockResolvedValue([fullEvent]);
      mockPrisma.serviceEvent.count.mockResolvedValue(1);

      const result = await service.getHistoryForExternalView(vehicleId, 1);

      const event = result.data[0];
      // Should include these fields
      expect(event.serviceType).toBe('Oil Change');
      expect(event.totalCostPaise).toBe(80000);
      expect(event.tenantName).toBe('Garage A');
      expect(event.category).toBe(ServiceCategory.ROUTINE_MAINTENANCE);
      expect(event.odometerKm).toBe(50000);
      expect(event.completedAt).toEqual(new Date('2024-01-15'));

      // Should NOT include internal fields
      expect(event).not.toHaveProperty('laborCostPaise');
      expect(event).not.toHaveProperty('partsCostPaise');
      expect(event).not.toHaveProperty('technicianName');
      expect(event).not.toHaveProperty('partsUsed');
      expect(event).not.toHaveProperty('tenantId');
      expect(event).not.toHaveProperty('jobCardId');
    });

    it('retains pagination metadata for external view', async () => {
      mockPrisma.vehicleRecord.findUnique.mockResolvedValue({ id: vehicleId });
      mockPrisma.serviceEvent.findMany.mockResolvedValue([]);
      mockPrisma.serviceEvent.count.mockResolvedValue(25);

      const result = await service.getHistoryForExternalView(vehicleId, 1);

      expect(result.pagination).toEqual({
        page: 1,
        pageSize: 20,
        total: 25,
        totalPages: 2,
      });
    });

    it('throws not found for non-existent vehicle', async () => {
      mockPrisma.vehicleRecord.findUnique.mockResolvedValue(null);

      await expect(
        service.getHistoryForExternalView('nonexistent', 1),
      ).rejects.toThrow('Vehicle record not found');
    });
  });

  // ─── addOwnerReported ──────────────────────────────────────────

  describe('addOwnerReported', () => {
    const vehicleId = 'vehicle-1';
    const dto = {
      serviceType: 'Oil Change',
      category: ServiceCategory.ROUTINE_MAINTENANCE,
      description: 'Changed oil at local garage',
      totalCostPaise: 150000,
      odometerKm: 55000,
      completedAt: '2024-06-15T10:00:00.000Z',
      partsUsed: [{ name: 'Oil Filter', quantity: 1 }],
      tenantName: 'Local Garage',
    };

    it('creates service event with source OWNER_REPORTED (Req 3.6)', async () => {
      mockPrisma.vehicleRecord.findUnique.mockResolvedValue({
        id: vehicleId,
        latestOdometerKm: 50000,
      });

      const createdEvent = {
        id: 'se-1',
        vehicleRecordId: vehicleId,
        serviceType: dto.serviceType,
        category: dto.category,
        source: ServiceEventSource.OWNER_REPORTED,
        totalCostPaise: dto.totalCostPaise,
        odometerKm: dto.odometerKm,
      };

      mockPrisma.$transaction.mockImplementation(async (fn: Function) => {
        const tx = {
          serviceEvent: { create: vi.fn().mockResolvedValue(createdEvent) },
          vehicleRecord: { update: vi.fn().mockResolvedValue({}) },
        };
        return fn(tx);
      });

      const result = await service.addOwnerReported(mockAuth, vehicleId, dto);

      expect(result.source).toBe(ServiceEventSource.OWNER_REPORTED);
      expect(result.serviceType).toBe(dto.serviceType);
    });

    it('rejects odometer reading below last recorded value (Req 3.5)', async () => {
      mockPrisma.vehicleRecord.findUnique.mockResolvedValue({
        id: vehicleId,
        latestOdometerKm: 60000,
      });

      await expect(
        service.addOwnerReported(mockAuth, vehicleId, {
          ...dto,
          odometerKm: 55000,
        }),
      ).rejects.toThrow('Odometer reading must be >= the most recent reading (60000 km)');
    });

    it('accepts odometer equal to last recorded value', async () => {
      mockPrisma.vehicleRecord.findUnique.mockResolvedValue({
        id: vehicleId,
        latestOdometerKm: 55000,
      });

      const createdEvent = {
        id: 'se-1',
        source: ServiceEventSource.OWNER_REPORTED,
        odometerKm: 55000,
      };

      mockPrisma.$transaction.mockImplementation(async (fn: Function) => {
        const tx = {
          serviceEvent: { create: vi.fn().mockResolvedValue(createdEvent) },
          vehicleRecord: { update: vi.fn().mockResolvedValue({}) },
        };
        return fn(tx);
      });

      const result = await service.addOwnerReported(mockAuth, vehicleId, {
        ...dto,
        odometerKm: 55000,
      });

      expect(result.odometerKm).toBe(55000);
    });

    it('accepts service event without odometer reading', async () => {
      mockPrisma.vehicleRecord.findUnique.mockResolvedValue({
        id: vehicleId,
        latestOdometerKm: 50000,
      });

      const createdEvent = {
        id: 'se-1',
        source: ServiceEventSource.OWNER_REPORTED,
        odometerKm: null,
      };

      mockPrisma.$transaction.mockImplementation(async (fn: Function) => {
        const tx = {
          serviceEvent: { create: vi.fn().mockResolvedValue(createdEvent) },
          vehicleRecord: { update: vi.fn().mockResolvedValue({}) },
        };
        return fn(tx);
      });

      const result = await service.addOwnerReported(mockAuth, vehicleId, {
        ...dto,
        odometerKm: undefined,
      });

      expect(result.odometerKm).toBeNull();
    });

    it('updates latestOdometerKm on VehicleRecord when odometer provided', async () => {
      mockPrisma.vehicleRecord.findUnique.mockResolvedValue({
        id: vehicleId,
        latestOdometerKm: 50000,
      });

      const txMock = {
        serviceEvent: { create: vi.fn().mockResolvedValue({ id: 'se-1' }) },
        vehicleRecord: { update: vi.fn().mockResolvedValue({}) },
      };
      mockPrisma.$transaction.mockImplementation(async (fn: Function) => fn(txMock));

      await service.addOwnerReported(mockAuth, vehicleId, dto);

      expect(txMock.vehicleRecord.update).toHaveBeenCalledWith({
        where: { id: vehicleId },
        data: { latestOdometerKm: 55000 },
      });
    });

    it('does not update latestOdometerKm when odometer not provided', async () => {
      mockPrisma.vehicleRecord.findUnique.mockResolvedValue({
        id: vehicleId,
        latestOdometerKm: 50000,
      });

      const txMock = {
        serviceEvent: { create: vi.fn().mockResolvedValue({ id: 'se-1' }) },
        vehicleRecord: { update: vi.fn().mockResolvedValue({}) },
      };
      mockPrisma.$transaction.mockImplementation(async (fn: Function) => fn(txMock));

      await service.addOwnerReported(mockAuth, vehicleId, {
        ...dto,
        odometerKm: undefined,
      });

      expect(txMock.vehicleRecord.update).not.toHaveBeenCalled();
    });

    it('throws not found for non-existent vehicle', async () => {
      mockPrisma.vehicleRecord.findUnique.mockResolvedValue(null);

      await expect(
        service.addOwnerReported(mockAuth, 'nonexistent', dto),
      ).rejects.toThrow('Vehicle record not found');
    });

    it('handles null latestOdometerKm (treats as 0)', async () => {
      mockPrisma.vehicleRecord.findUnique.mockResolvedValue({
        id: vehicleId,
        latestOdometerKm: null,
      });

      const createdEvent = {
        id: 'se-1',
        source: ServiceEventSource.OWNER_REPORTED,
        odometerKm: 100,
      };

      mockPrisma.$transaction.mockImplementation(async (fn: Function) => {
        const tx = {
          serviceEvent: { create: vi.fn().mockResolvedValue(createdEvent) },
          vehicleRecord: { update: vi.fn().mockResolvedValue({}) },
        };
        return fn(tx);
      });

      const result = await service.addOwnerReported(mockAuth, vehicleId, {
        ...dto,
        odometerKm: 100,
      });

      expect(result.odometerKm).toBe(100);
    });
  });

  // ─── isUserTenantMember ────────────────────────────────────────

  describe('isUserTenantMember', () => {
    it('returns true when user is a member of the tenant', () => {
      const result = service.isUserTenantMember(mockAuth, 'tenant-1');
      expect(result).toBe(true);
    });

    it('returns false when user is not a member of the tenant', () => {
      const result = service.isUserTenantMember(mockAuth, 'tenant-2');
      expect(result).toBe(false);
    });

    it('returns false when tenantId is null', () => {
      const result = service.isUserTenantMember(mockAuth, null);
      expect(result).toBe(false);
    });
  });
});
