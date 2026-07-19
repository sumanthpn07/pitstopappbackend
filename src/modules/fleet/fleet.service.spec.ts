import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FleetService } from './fleet.service';
import { TransferType, TransferStatus } from '@prisma/client';

describe('FleetService', () => {
  let service: FleetService;
  let mockPrisma: any;
  let mockEventsService: any;

  beforeEach(() => {
    mockPrisma = {
      fleet: {
        create: vi.fn(),
        findFirst: vi.fn(),
      },
      fleetVehicle: {
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      fleetDriver: {
        findFirst: vi.fn(),
      },
      vehicleRecord: {
        findUnique: vi.fn(),
      },
      ownershipRecord: {
        create: vi.fn(),
        updateMany: vi.fn(),
      },
      serviceEvent: {
        findMany: vi.fn(),
      },
      $transaction: vi.fn(),
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

    service = new FleetService(mockPrisma, mockEventsService);
  });

  // ─── Create Fleet ────────────────────────────────────────────────

  describe('createFleet', () => {
    it('creates a fleet with valid data', async () => {
      const dto = {
        name: 'Test Fleet',
        organizationName: 'Test Org',
        organizationRegNumber: 'REG123',
        drivers: [{ name: 'John', contactPhone: '+1234567890' }],
      };

      mockPrisma.fleet.create.mockResolvedValue({
        id: 'fleet-1',
        ownerId: 'user-1',
        name: 'Test Fleet',
        organizationName: 'Test Org',
        organizationRegNumber: 'REG123',
        drivers: [{ id: 'driver-1', name: 'John', contactPhone: '+1234567890' }],
        vehicles: [],
      });

      const result = await service.createFleet('user-1', dto);

      expect(mockPrisma.fleet.create).toHaveBeenCalledWith({
        data: {
          ownerId: 'user-1',
          name: 'Test Fleet',
          organizationName: 'Test Org',
          organizationRegNumber: 'REG123',
          drivers: {
            create: [{ name: 'John', contactPhone: '+1234567890' }],
          },
        },
        include: { drivers: true, vehicles: true },
      });
      expect(result.id).toBe('fleet-1');
    });

    it('rejects empty fleet name', async () => {
      const dto = { name: '', organizationName: 'Org' };
      await expect(service.createFleet('user-1', dto)).rejects.toThrow(
        'Fleet name is required.',
      );
    });

    it('rejects fleet name exceeding 100 characters', async () => {
      const dto = { name: 'A'.repeat(101), organizationName: 'Org' };
      await expect(service.createFleet('user-1', dto)).rejects.toThrow(
        'Fleet name must be at most 100 characters.',
      );
    });

    it('rejects empty organization name', async () => {
      const dto = { name: 'Fleet', organizationName: '' };
      await expect(service.createFleet('user-1', dto)).rejects.toThrow(
        'Organization name is required.',
      );
    });

    it('creates fleet without drivers', async () => {
      const dto = { name: 'Fleet', organizationName: 'Org' };

      mockPrisma.fleet.create.mockResolvedValue({
        id: 'fleet-1',
        ownerId: 'user-1',
        name: 'Fleet',
        organizationName: 'Org',
        organizationRegNumber: null,
        drivers: [],
        vehicles: [],
      });

      const result = await service.createFleet('user-1', dto);
      expect(result.id).toBe('fleet-1');
    });
  });

  // ─── Add Vehicle to Fleet ────────────────────────────────────────

  describe('addVehicle', () => {
    it('adds a vehicle to a fleet and creates OwnershipRecord', async () => {
      const dto = { vehicleRecordId: 'vr-1' };

      mockPrisma.fleet.findFirst.mockResolvedValue({ id: 'fleet-1', ownerId: 'user-1' });
      mockPrisma.vehicleRecord.findUnique.mockResolvedValue({ id: 'vr-1' });
      mockPrisma.fleetVehicle.findUnique.mockResolvedValue(null);

      const createdFleetVehicle = {
        id: 'fv-1',
        fleetId: 'fleet-1',
        vehicleRecordId: 'vr-1',
        assignedDriverId: null,
      };
      mockPrisma.$transaction.mockResolvedValue([createdFleetVehicle, {}]);

      const result = await service.addVehicle('fleet-1', 'user-1', dto);

      expect(result).toEqual(createdFleetVehicle);
      expect(mockPrisma.$transaction).toHaveBeenCalled();
    });

    it('rejects if fleet not found', async () => {
      mockPrisma.fleet.findFirst.mockResolvedValue(null);

      await expect(
        service.addVehicle('fleet-1', 'user-1', { vehicleRecordId: 'vr-1' }),
      ).rejects.toThrow('Fleet not found.');
    });

    it('rejects if vehicle record not found', async () => {
      mockPrisma.fleet.findFirst.mockResolvedValue({ id: 'fleet-1', ownerId: 'user-1' });
      mockPrisma.vehicleRecord.findUnique.mockResolvedValue(null);

      await expect(
        service.addVehicle('fleet-1', 'user-1', { vehicleRecordId: 'vr-1' }),
      ).rejects.toThrow('Vehicle record not found.');
    });

    it('rejects if vehicle is already assigned to another fleet', async () => {
      mockPrisma.fleet.findFirst.mockResolvedValue({ id: 'fleet-1', ownerId: 'user-1' });
      mockPrisma.vehicleRecord.findUnique.mockResolvedValue({ id: 'vr-1' });
      mockPrisma.fleetVehicle.findUnique.mockResolvedValue({
        id: 'fv-existing',
        fleetId: 'fleet-other',
        vehicleRecordId: 'vr-1',
        removedAt: null,
      });

      await expect(
        service.addVehicle('fleet-1', 'user-1', { vehicleRecordId: 'vr-1' }),
      ).rejects.toThrow('Vehicle is currently assigned to a different fleet.');
    });

    it('rejects if vehicle is already assigned to the same fleet', async () => {
      mockPrisma.fleet.findFirst.mockResolvedValue({ id: 'fleet-1', ownerId: 'user-1' });
      mockPrisma.vehicleRecord.findUnique.mockResolvedValue({ id: 'vr-1' });
      mockPrisma.fleetVehicle.findUnique.mockResolvedValue({
        id: 'fv-existing',
        fleetId: 'fleet-1',
        vehicleRecordId: 'vr-1',
        removedAt: null,
      });

      await expect(
        service.addVehicle('fleet-1', 'user-1', { vehicleRecordId: 'vr-1' }),
      ).rejects.toThrow('Vehicle is already assigned to this fleet.');
    });

    it('allows adding a vehicle that was previously removed from another fleet', async () => {
      const dto = { vehicleRecordId: 'vr-1' };

      mockPrisma.fleet.findFirst.mockResolvedValue({ id: 'fleet-1', ownerId: 'user-1' });
      mockPrisma.vehicleRecord.findUnique.mockResolvedValue({ id: 'vr-1' });
      // Previously removed from another fleet (removedAt is set)
      mockPrisma.fleetVehicle.findUnique.mockResolvedValue({
        id: 'fv-old',
        fleetId: 'fleet-other',
        vehicleRecordId: 'vr-1',
        removedAt: new Date('2024-01-01'),
      });

      const createdFleetVehicle = {
        id: 'fv-2',
        fleetId: 'fleet-1',
        vehicleRecordId: 'vr-1',
        assignedDriverId: null,
      };
      mockPrisma.$transaction.mockResolvedValue([createdFleetVehicle, {}]);

      const result = await service.addVehicle('fleet-1', 'user-1', dto);
      expect(result).toEqual(createdFleetVehicle);
    });

    it('validates assignedDriverId belongs to the fleet', async () => {
      const dto = { vehicleRecordId: 'vr-1', assignedDriverId: 'driver-x' };

      mockPrisma.fleet.findFirst.mockResolvedValue({ id: 'fleet-1', ownerId: 'user-1' });
      mockPrisma.vehicleRecord.findUnique.mockResolvedValue({ id: 'vr-1' });
      mockPrisma.fleetVehicle.findUnique.mockResolvedValue(null);
      mockPrisma.fleetDriver.findFirst.mockResolvedValue(null);

      await expect(
        service.addVehicle('fleet-1', 'user-1', dto),
      ).rejects.toThrow('Assigned driver does not belong to this fleet.');
    });
  });

  // ─── Remove Vehicle from Fleet ──────────────────────────────────

  describe('removeVehicle', () => {
    it('removes a vehicle from the fleet and closes OwnershipRecord', async () => {
      mockPrisma.fleet.findFirst.mockResolvedValue({ id: 'fleet-1', ownerId: 'user-1' });
      mockPrisma.fleetVehicle.findFirst.mockResolvedValue({
        id: 'fv-1',
        fleetId: 'fleet-1',
        vehicleRecordId: 'vr-1',
        removedAt: null,
      });
      mockPrisma.$transaction.mockResolvedValue([{}, {}]);

      const result = await service.removeVehicle('fleet-1', 'vr-1', 'user-1');

      expect(result.success).toBe(true);
      expect(result.removedAt).toBeInstanceOf(Date);
      expect(mockPrisma.$transaction).toHaveBeenCalled();
    });

    it('rejects if fleet not found', async () => {
      mockPrisma.fleet.findFirst.mockResolvedValue(null);

      await expect(
        service.removeVehicle('fleet-1', 'vr-1', 'user-1'),
      ).rejects.toThrow('Fleet not found.');
    });

    it('rejects if vehicle is not assigned to this fleet', async () => {
      mockPrisma.fleet.findFirst.mockResolvedValue({ id: 'fleet-1', ownerId: 'user-1' });
      mockPrisma.fleetVehicle.findFirst.mockResolvedValue(null);

      await expect(
        service.removeVehicle('fleet-1', 'vr-1', 'user-1'),
      ).rejects.toThrow('Vehicle is not currently assigned to this fleet.');
    });
  });

  // ─── Fleet Dashboard ─────────────────────────────────────────────

  describe('getFleetDashboard', () => {
    it('returns dashboard with vehicle health scores and maintenance data', async () => {
      mockPrisma.fleet.findFirst.mockResolvedValue({
        id: 'fleet-1',
        name: 'Test Fleet',
        organizationName: 'Test Org',
        organizationRegNumber: 'REG123',
        drivers: [
          { id: 'driver-1', name: 'John', contactPhone: '+123' },
        ],
        vehicles: [
          {
            vehicleRecordId: 'vr-1',
            assignedDriverId: 'driver-1',
            vehicleRecord: {
              id: 'vr-1',
              make: 'Toyota',
              model: 'Corolla',
              year: 2020,
              registrationPlate: 'ABC123',
              healthScore: { score: 75, calculatedAt: new Date() },
              serviceEvents: [
                { completedAt: new Date('2024-06-01'), serviceType: 'Oil Change' },
              ],
              maintenanceSchedule: [
                { dueDate: new Date('2024-12-01'), serviceType: 'Brake Check' },
              ],
            },
          },
        ],
      });

      const result = await service.getFleetDashboard('fleet-1', 'user-1');

      expect(result.id).toBe('fleet-1');
      expect(result.name).toBe('Test Fleet');
      expect(result.vehicles).toHaveLength(1);
      expect(result.vehicles[0].healthScore).toBe(75);
      expect(result.vehicles[0].assignedDriver).toEqual({
        id: 'driver-1',
        name: 'John',
        contactPhone: '+123',
      });
    });

    it('rejects if fleet not found', async () => {
      mockPrisma.fleet.findFirst.mockResolvedValue(null);

      await expect(
        service.getFleetDashboard('fleet-1', 'user-1'),
      ).rejects.toThrow('Fleet not found.');
    });
  });

  // ─── Fleet Analytics ─────────────────────────────────────────────

  describe('getFleetAnalytics', () => {
    it('returns empty analytics when fleet has no vehicles', async () => {
      mockPrisma.fleet.findFirst.mockResolvedValue({
        id: 'fleet-1',
        ownerId: 'user-1',
        vehicles: [],
      });

      const result = await service.getFleetAnalytics('fleet-1', 'user-1');

      expect(result.totalSpendByMonth).toEqual([]);
      expect(result.spendPerVehicle).toEqual([]);
      expect(result.spendByCategory).toEqual([]);
      expect(result.costTrend12Months).toEqual([]);
    });

    it('computes analytics with service event data', async () => {
      mockPrisma.fleet.findFirst.mockResolvedValue({
        id: 'fleet-1',
        ownerId: 'user-1',
        vehicles: [{ vehicleRecordId: 'vr-1' }, { vehicleRecordId: 'vr-2' }],
      });

      const now = new Date();
      mockPrisma.serviceEvent.findMany.mockResolvedValue([
        {
          vehicleRecordId: 'vr-1',
          totalCostPaise: 500000,
          category: 'ROUTINE_MAINTENANCE',
          completedAt: now,
        },
        {
          vehicleRecordId: 'vr-2',
          totalCostPaise: 300000,
          category: 'REPAIR',
          completedAt: now,
        },
      ]);

      const result = await service.getFleetAnalytics('fleet-1', 'user-1');

      expect(result.spendPerVehicle).toHaveLength(2);
      expect(result.spendByCategory).toHaveLength(2);
      expect(result.costTrend12Months).toHaveLength(12);

      // Verify the current month has data
      const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const currentMonthEntry = result.costTrend12Months.find(
        (e: any) => e.month === currentMonth,
      );
      expect(currentMonthEntry?.totalPaise).toBe(800000);
    });

    it('rejects if fleet not found', async () => {
      mockPrisma.fleet.findFirst.mockResolvedValue(null);

      await expect(
        service.getFleetAnalytics('fleet-1', 'user-1'),
      ).rejects.toThrow('Fleet not found.');
    });
  });

  // ─── Health Score Alert Handler ──────────────────────────────────

  describe('handleHealthScoreAlert', () => {
    it('notifies fleet owner when vehicle health drops below 50', async () => {
      const event = {
        eventId: 'evt-1',
        eventType: 'health-score.alert' as const,
        sourceEntity: 'HealthScore',
        sourceId: 'vr-1',
        data: {
          vehicleRecordId: 'vr-1',
          userId: 'vehicle-owner-1',
          previousScore: 55,
          newScore: 45,
        },
        occurredAt: new Date().toISOString(),
      };

      mockPrisma.fleetVehicle.findUnique.mockResolvedValue({
        id: 'fv-1',
        vehicleRecordId: 'vr-1',
        removedAt: null,
        fleet: { ownerId: 'fleet-owner-1', name: 'Fleet A' },
      });

      await service.handleHealthScoreAlert(event);

      expect(mockEventsService.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'health-score.alert',
          payload: expect.objectContaining({
            vehicleRecordId: 'vr-1',
            userId: 'fleet-owner-1',
            fleetName: 'Fleet A',
            newScore: 45,
          }),
        }),
      );
    });

    it('skips alert if vehicle is not in a fleet', async () => {
      const event = {
        eventId: 'evt-2',
        eventType: 'health-score.alert' as const,
        sourceEntity: 'HealthScore',
        sourceId: 'vr-1',
        data: {
          vehicleRecordId: 'vr-1',
          userId: 'user-1',
          previousScore: 55,
          newScore: 45,
        },
        occurredAt: new Date().toISOString(),
      };

      mockPrisma.fleetVehicle.findUnique.mockResolvedValue(null);

      await service.handleHealthScoreAlert(event);

      expect(mockEventsService.publish).not.toHaveBeenCalled();
    });

    it('respects 24h cooldown per vehicle', async () => {
      const event = {
        eventId: 'evt-3',
        eventType: 'health-score.alert' as const,
        sourceEntity: 'HealthScore',
        sourceId: 'vr-1',
        data: {
          vehicleRecordId: 'vr-1',
          userId: 'user-1',
          previousScore: 55,
          newScore: 45,
        },
        occurredAt: new Date().toISOString(),
      };

      mockPrisma.fleetVehicle.findUnique.mockResolvedValue({
        id: 'fv-1',
        vehicleRecordId: 'vr-1',
        removedAt: null,
        fleet: { ownerId: 'fleet-owner-1', name: 'Fleet A' },
      });

      // First alert
      await service.handleHealthScoreAlert(event);
      expect(mockEventsService.publish).toHaveBeenCalledTimes(1);

      // Second alert within 24h — should be skipped
      const event2 = { ...event, eventId: 'evt-4' };
      mockEventsService.processWithIdempotency.mockImplementation(
        async (_eventId: string, _consumer: string, handler: () => Promise<void>) => {
          await handler();
          return true;
        },
      );
      await service.handleHealthScoreAlert(event2);
      expect(mockEventsService.publish).toHaveBeenCalledTimes(1); // Still only 1
    });

    it('skips if score is >= 50', async () => {
      const event = {
        eventId: 'evt-5',
        eventType: 'health-score.alert' as const,
        sourceEntity: 'HealthScore',
        sourceId: 'vr-1',
        data: {
          vehicleRecordId: 'vr-1',
          userId: 'user-1',
          previousScore: 60,
          newScore: 55,
        },
        occurredAt: new Date().toISOString(),
      };

      await service.handleHealthScoreAlert(event);

      expect(mockPrisma.fleetVehicle.findUnique).not.toHaveBeenCalled();
      expect(mockEventsService.publish).not.toHaveBeenCalled();
    });
  });
});
