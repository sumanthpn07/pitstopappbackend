import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { MigrationService } from '../migration.service';
import type { MigrationReport } from '../migration.service';

describe('MigrationService', () => {
  let service: MigrationService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      vehicle: { findMany: vi.fn() },
      vehicleRecord: { findFirst: vi.fn(), create: vi.fn(), count: vi.fn() },
      booking: { findMany: vi.fn() },
      serviceEvent: { findFirst: vi.fn(), create: vi.fn(), count: vi.fn() },
      ownershipRecord: { findFirst: vi.fn(), create: vi.fn(), count: vi.fn() },
      jobCard: { findFirst: vi.fn(), create: vi.fn(), count: vi.fn() },
      tenant: { findFirst: vi.fn() },
    };
    service = new MigrationService(mockPrisma);
  });

  // ─── parseMakeModel ────────────────────────────────────────────

  describe('parseMakeModel', () => {
    it('splits "Toyota Camry" into make=Toyota, model=Camry', () => {
      const result = service.parseMakeModel('Toyota Camry');
      expect(result).toEqual({ make: 'Toyota', model: 'Camry' });
    });

    it('splits "Honda Civic EX" into make=Honda, model=Civic EX', () => {
      const result = service.parseMakeModel('Honda Civic EX');
      expect(result).toEqual({ make: 'Honda', model: 'Civic EX' });
    });

    it('handles single word as make with model=Unknown', () => {
      const result = service.parseMakeModel('Tesla');
      expect(result).toEqual({ make: 'Tesla', model: 'Unknown' });
    });

    it('trims whitespace', () => {
      const result = service.parseMakeModel('  Ford  F150  ');
      expect(result).toEqual({ make: 'Ford', model: 'F150' });
    });

    it('handles empty string as make with model=Unknown', () => {
      const result = service.parseMakeModel('');
      expect(result).toEqual({ make: '', model: 'Unknown' });
    });
  });

  // ─── migrateVehicles ───────────────────────────────────────────

  describe('migrateVehicles', () => {
    it('migrates a vehicle with plate to VehicleRecord', async () => {
      const report = createEmptyReport();

      mockPrisma.vehicle.findMany.mockResolvedValue([
        {
          id: 'v-1',
          membershipId: 'm-1',
          makeModel: 'Toyota Camry',
          plate: 'KA-01-AB-1234',
          color: 'Red',
          type: 'Sedan',
          createdAt: new Date('2023-01-15'),
          membership: { userId: 'u-1', createdAt: new Date('2023-01-01') },
        },
      ]);

      mockPrisma.vehicleRecord.findFirst.mockResolvedValue(null);
      mockPrisma.vehicleRecord.create.mockResolvedValue({ id: 'vr-1' });

      await service.migrateVehicles(report);

      expect(report.vehicles.source).toBe(1);
      expect(report.vehicles.migrated).toBe(1);
      expect(report.discrepancies).toHaveLength(0);
      expect(mockPrisma.vehicleRecord.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          registrationPlate: 'KA-01-AB-1234',
          make: 'Toyota',
          model: 'Camry',
          year: 2023,
          color: 'Red',
          legacyVehicleId: 'v-1',
        }),
      });
    });

    it('assigns TEMP- prefix for vehicles without plate (Req 16.6)', async () => {
      const report = createEmptyReport();

      mockPrisma.vehicle.findMany.mockResolvedValue([
        {
          id: 'v-no-plate',
          membershipId: 'm-1',
          makeModel: 'Honda Civic',
          plate: null,
          color: null,
          type: null,
          createdAt: new Date('2022-06-01'),
          membership: { userId: 'u-1', createdAt: new Date('2022-01-01') },
        },
      ]);

      mockPrisma.vehicleRecord.findFirst.mockResolvedValue(null);
      mockPrisma.vehicleRecord.create.mockResolvedValue({ id: 'vr-2' });

      await service.migrateVehicles(report);

      expect(report.vehicles.migrated).toBe(1);
      expect(report.discrepancies).toHaveLength(1);
      expect(report.discrepancies[0].reason).toContain('TEMP-');
      expect(report.discrepancies[0].reason).toContain('manual review');
      expect(mockPrisma.vehicleRecord.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          registrationPlate: 'TEMP-v-no-plate',
          legacyVehicleId: 'v-no-plate',
        }),
      });
    });

    it('skips already-migrated vehicles (idempotency, Req 16.7)', async () => {
      const report = createEmptyReport();

      mockPrisma.vehicle.findMany.mockResolvedValue([
        {
          id: 'v-existing',
          membershipId: 'm-1',
          makeModel: 'Ford Mustang',
          plate: 'XYZ-999',
          color: null,
          type: null,
          createdAt: new Date('2021-03-01'),
          membership: { userId: 'u-1', createdAt: new Date('2021-01-01') },
        },
      ]);

      // Already migrated
      mockPrisma.vehicleRecord.findFirst.mockResolvedValue({ id: 'vr-existing', legacyVehicleId: 'v-existing' });

      await service.migrateVehicles(report);

      expect(report.vehicles.source).toBe(1);
      expect(report.vehicles.skipped).toBe(1);
      expect(report.vehicles.migrated).toBe(0);
      expect(mockPrisma.vehicleRecord.create).not.toHaveBeenCalled();
    });

    it('handles empty plate string as missing plate', async () => {
      const report = createEmptyReport();

      mockPrisma.vehicle.findMany.mockResolvedValue([
        {
          id: 'v-empty-plate',
          membershipId: 'm-1',
          makeModel: 'BMW X5',
          plate: '   ',
          color: null,
          type: null,
          createdAt: new Date('2023-05-01'),
          membership: { userId: 'u-1', createdAt: new Date('2023-01-01') },
        },
      ]);

      mockPrisma.vehicleRecord.findFirst.mockResolvedValue(null);
      mockPrisma.vehicleRecord.create.mockResolvedValue({ id: 'vr-3' });

      await service.migrateVehicles(report);

      expect(mockPrisma.vehicleRecord.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          registrationPlate: 'TEMP-v-empty-plate',
        }),
      });
      expect(report.discrepancies).toHaveLength(1);
    });
  });

  // ─── migrateCompletedBookings ──────────────────────────────────

  describe('migrateCompletedBookings', () => {
    it('converts completed booking to ServiceEvent with correct field mapping', async () => {
      const report = createEmptyReport();

      mockPrisma.booking.findMany.mockResolvedValue([
        {
          id: 'b-1',
          shopId: 'shop-1',
          vehicleId: 'v-1',
          status: 'COMPLETED',
          scheduledAt: new Date('2023-06-15T10:00:00Z'),
          pricePaise: 50000,
          notes: 'Test booking',
          service: { name: 'Full Wash', description: 'Complete car wash service' },
          shop: { name: 'SpeedWash Garage' },
          serviceEmployee: { user: { name: 'John Tech' } },
        },
      ]);

      mockPrisma.serviceEvent.findFirst.mockResolvedValue(null);
      mockPrisma.vehicleRecord.findFirst.mockResolvedValue({ id: 'vr-1' });
      mockPrisma.serviceEvent.create.mockResolvedValue({ id: 'se-1' });

      await service.migrateCompletedBookings(report);

      expect(report.serviceEvents.source).toBe(1);
      expect(report.serviceEvents.migrated).toBe(1);
      expect(mockPrisma.serviceEvent.create).toHaveBeenCalledWith({
        data: {
          vehicleRecordId: 'vr-1',
          tenantId: null,
          tenantName: 'SpeedWash Garage',
          serviceType: 'Full Wash',
          category: 'ROUTINE_MAINTENANCE',
          description: 'Complete car wash service',
          partsUsed: Prisma.JsonNull,
          laborCostPaise: null,
          partsCostPaise: null,
          totalCostPaise: 50000,
          odometerKm: null,
          technicianName: 'John Tech',
          source: 'MIGRATION',
          jobCardId: 'b-1',
          completedAt: new Date('2023-06-15T10:00:00Z'),
        },
      });
    });

    it('skips bookings with null vehicleId and logs discrepancy (Req 16.3)', async () => {
      const report = createEmptyReport();

      mockPrisma.booking.findMany.mockResolvedValue([
        {
          id: 'b-null-vehicle',
          shopId: 'shop-1',
          vehicleId: null,
          status: 'COMPLETED',
          scheduledAt: new Date('2023-06-15T10:00:00Z'),
          pricePaise: 30000,
          service: { name: 'Quick Wash', description: null },
          shop: { name: 'TestShop' },
          serviceEmployee: null,
        },
      ]);

      await service.migrateCompletedBookings(report);

      expect(report.serviceEvents.source).toBe(1);
      expect(report.serviceEvents.skipped).toBe(1);
      expect(report.serviceEvents.migrated).toBe(0);
      expect(report.discrepancies).toHaveLength(1);
      expect(report.discrepancies[0].entityType).toBe('Booking');
      expect(report.discrepancies[0].sourceId).toBe('b-null-vehicle');
      expect(report.discrepancies[0].reason).toContain('Null vehicle reference');
    });

    it('skips already-migrated bookings (idempotency, Req 16.7)', async () => {
      const report = createEmptyReport();

      mockPrisma.booking.findMany.mockResolvedValue([
        {
          id: 'b-already-done',
          shopId: 'shop-1',
          vehicleId: 'v-1',
          status: 'COMPLETED',
          scheduledAt: new Date('2023-06-15T10:00:00Z'),
          pricePaise: 50000,
          service: { name: 'Wash', description: null },
          shop: { name: 'Shop1' },
          serviceEmployee: null,
        },
      ]);

      // Already migrated
      mockPrisma.serviceEvent.findFirst.mockResolvedValue({ id: 'se-existing' });

      await service.migrateCompletedBookings(report);

      expect(report.serviceEvents.skipped).toBe(1);
      expect(report.serviceEvents.migrated).toBe(0);
      expect(mockPrisma.serviceEvent.create).not.toHaveBeenCalled();
    });

    it('handles null technician name when no service employee', async () => {
      const report = createEmptyReport();

      mockPrisma.booking.findMany.mockResolvedValue([
        {
          id: 'b-no-tech',
          shopId: 'shop-1',
          vehicleId: 'v-1',
          status: 'COMPLETED',
          scheduledAt: new Date('2023-07-01T10:00:00Z'),
          pricePaise: 20000,
          service: { name: 'Basic Wash', description: null },
          shop: { name: 'Shop2' },
          serviceEmployee: null,
        },
      ]);

      mockPrisma.serviceEvent.findFirst.mockResolvedValue(null);
      mockPrisma.vehicleRecord.findFirst.mockResolvedValue({ id: 'vr-1' });
      mockPrisma.serviceEvent.create.mockResolvedValue({ id: 'se-2' });

      await service.migrateCompletedBookings(report);

      expect(mockPrisma.serviceEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          technicianName: null,
        }),
      });
    });
  });

  // ─── migrateActiveBookings ─────────────────────────────────────

  describe('migrateActiveBookings', () => {
    it('converts BOOKED booking to CREATED JobCard (Req 16.8)', async () => {
      const report = createEmptyReport();

      mockPrisma.booking.findMany.mockResolvedValue([
        {
          id: 'b-active-1',
          shopId: 'shop-1',
          vehicleId: 'v-1',
          status: 'BOOKED',
          scheduledAt: new Date('2023-08-01T10:00:00Z'),
          customer: { userId: 'u-1', user: { name: 'Customer 1' } },
          shop: { name: 'TestShop' },
        },
      ]);

      mockPrisma.jobCard.findFirst.mockResolvedValue(null);
      mockPrisma.vehicleRecord.findFirst.mockResolvedValue({ id: 'vr-1' });
      mockPrisma.tenant.findFirst.mockResolvedValue({ id: 'tenant-1' });
      mockPrisma.jobCard.create.mockResolvedValue({ id: 'jc-1' });

      await service.migrateActiveBookings(report);

      expect(report.jobCards.migrated).toBe(1);
      expect(mockPrisma.jobCard.create).toHaveBeenCalledWith({
        data: {
          tenantId: 'tenant-1',
          vehicleRecordId: 'vr-1',
          customerId: 'u-1',
          status: 'CREATED',
          scheduledAt: new Date('2023-08-01T10:00:00Z'),
          notes: 'legacy-booking:b-active-1',
        },
      });
    });

    it('converts ASSIGNED booking to ASSIGNED JobCard (Req 16.8)', async () => {
      const report = createEmptyReport();

      mockPrisma.booking.findMany.mockResolvedValue([
        {
          id: 'b-assigned',
          shopId: 'shop-1',
          vehicleId: 'v-1',
          status: 'ASSIGNED',
          scheduledAt: new Date('2023-08-02T10:00:00Z'),
          customer: { userId: 'u-2', user: { name: 'Customer 2' } },
          shop: { name: 'TestShop' },
        },
      ]);

      mockPrisma.jobCard.findFirst.mockResolvedValue(null);
      mockPrisma.vehicleRecord.findFirst.mockResolvedValue({ id: 'vr-2' });
      mockPrisma.tenant.findFirst.mockResolvedValue({ id: 'tenant-1' });
      mockPrisma.jobCard.create.mockResolvedValue({ id: 'jc-2' });

      await service.migrateActiveBookings(report);

      expect(mockPrisma.jobCard.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          status: 'ASSIGNED',
        }),
      });
    });

    it('converts IN_PROGRESS booking to IN_PROGRESS JobCard (Req 16.8)', async () => {
      const report = createEmptyReport();

      mockPrisma.booking.findMany.mockResolvedValue([
        {
          id: 'b-in-progress',
          shopId: 'shop-1',
          vehicleId: 'v-1',
          status: 'IN_PROGRESS',
          scheduledAt: new Date('2023-08-03T10:00:00Z'),
          customer: { userId: 'u-3', user: { name: 'Customer 3' } },
          shop: { name: 'TestShop' },
        },
      ]);

      mockPrisma.jobCard.findFirst.mockResolvedValue(null);
      mockPrisma.vehicleRecord.findFirst.mockResolvedValue({ id: 'vr-3' });
      mockPrisma.tenant.findFirst.mockResolvedValue({ id: 'tenant-1' });
      mockPrisma.jobCard.create.mockResolvedValue({ id: 'jc-3' });

      await service.migrateActiveBookings(report);

      expect(mockPrisma.jobCard.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          status: 'IN_PROGRESS',
        }),
      });
    });

    it('skips active bookings with null vehicleId', async () => {
      const report = createEmptyReport();

      mockPrisma.booking.findMany.mockResolvedValue([
        {
          id: 'b-no-vehicle',
          shopId: 'shop-1',
          vehicleId: null,
          status: 'BOOKED',
          scheduledAt: new Date('2023-08-01T10:00:00Z'),
          customer: { userId: 'u-1', user: { name: 'Customer 1' } },
          shop: { name: 'TestShop' },
        },
      ]);

      await service.migrateActiveBookings(report);

      expect(report.jobCards.skipped).toBe(1);
      expect(report.discrepancies).toHaveLength(1);
      expect(report.discrepancies[0].reason).toContain('Null vehicle reference');
    });

    it('skips already-migrated active bookings (idempotency)', async () => {
      const report = createEmptyReport();

      mockPrisma.booking.findMany.mockResolvedValue([
        {
          id: 'b-already-migrated',
          shopId: 'shop-1',
          vehicleId: 'v-1',
          status: 'BOOKED',
          scheduledAt: new Date('2023-08-01T10:00:00Z'),
          customer: { userId: 'u-1', user: { name: 'Customer' } },
          shop: { name: 'TestShop' },
        },
      ]);

      // Already exists
      mockPrisma.jobCard.findFirst.mockResolvedValue({ id: 'jc-existing' });

      await service.migrateActiveBookings(report);

      expect(report.jobCards.skipped).toBe(1);
      expect(mockPrisma.jobCard.create).not.toHaveBeenCalled();
    });

    it('logs discrepancy when no tenant found for shop', async () => {
      const report = createEmptyReport();

      mockPrisma.booking.findMany.mockResolvedValue([
        {
          id: 'b-no-tenant',
          shopId: 'shop-orphan',
          vehicleId: 'v-1',
          status: 'BOOKED',
          scheduledAt: new Date('2023-08-01T10:00:00Z'),
          customer: { userId: 'u-1', user: { name: 'Customer' } },
          shop: { name: 'OrphanShop' },
        },
      ]);

      mockPrisma.jobCard.findFirst.mockResolvedValue(null);
      mockPrisma.vehicleRecord.findFirst.mockResolvedValue({ id: 'vr-1' });
      mockPrisma.tenant.findFirst.mockResolvedValue(null); // No tenant

      await service.migrateActiveBookings(report);

      expect(report.jobCards.skipped).toBe(1);
      expect(report.discrepancies).toHaveLength(1);
      expect(report.discrepancies[0].reason).toContain('no corresponding Tenant');
    });
  });

  // ─── migrateOwnerships ────────────────────────────────────────

  describe('migrateOwnerships', () => {
    it('creates OwnershipRecord with LEGACY_MIGRATION transfer type (Req 16.4)', async () => {
      const report = createEmptyReport();

      mockPrisma.vehicle.findMany.mockResolvedValue([
        {
          id: 'v-1',
          membershipId: 'm-1',
          makeModel: 'Toyota Camry',
          plate: 'KA-01-AB-1234',
          createdAt: new Date('2023-01-15'),
          membership: {
            id: 'm-1',
            userId: 'u-1',
            createdAt: new Date('2022-06-01'),
            user: { id: 'u-1', name: 'User 1' },
          },
        },
      ]);

      mockPrisma.vehicleRecord.findFirst.mockResolvedValue({ id: 'vr-1' });
      mockPrisma.ownershipRecord.findFirst.mockResolvedValue(null);
      mockPrisma.ownershipRecord.create.mockResolvedValue({ id: 'or-1' });

      await service.migrateOwnerships(report);

      expect(report.ownershipRecords.migrated).toBe(1);
      expect(mockPrisma.ownershipRecord.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          vehicleRecordId: 'vr-1',
          userId: 'u-1',
          transferType: 'LEGACY_MIGRATION',
          transferStatus: 'CONFIRMED',
          startDate: new Date('2022-06-01'),
        }),
      });
    });

    it('skips already-migrated ownership records (idempotency, Req 16.7)', async () => {
      const report = createEmptyReport();

      mockPrisma.vehicle.findMany.mockResolvedValue([
        {
          id: 'v-1',
          membershipId: 'm-1',
          makeModel: 'Toyota Camry',
          plate: 'KA-01-AB-1234',
          createdAt: new Date('2023-01-15'),
          membership: {
            id: 'm-1',
            userId: 'u-1',
            createdAt: new Date('2022-06-01'),
            user: { id: 'u-1', name: 'User 1' },
          },
        },
      ]);

      mockPrisma.vehicleRecord.findFirst.mockResolvedValue({ id: 'vr-1' });
      // Already migrated
      mockPrisma.ownershipRecord.findFirst.mockResolvedValue({ id: 'or-existing' });

      await service.migrateOwnerships(report);

      expect(report.ownershipRecords.skipped).toBe(1);
      expect(report.ownershipRecords.migrated).toBe(0);
      expect(mockPrisma.ownershipRecord.create).not.toHaveBeenCalled();
    });

    it('logs discrepancy when no VehicleRecord exists for vehicle', async () => {
      const report = createEmptyReport();

      mockPrisma.vehicle.findMany.mockResolvedValue([
        {
          id: 'v-orphan',
          membershipId: 'm-1',
          makeModel: 'Orphan Car',
          plate: 'ORPHAN-1',
          createdAt: new Date('2023-01-15'),
          membership: {
            id: 'm-1',
            userId: 'u-1',
            createdAt: new Date('2022-06-01'),
            user: { id: 'u-1', name: 'User 1' },
          },
        },
      ]);

      mockPrisma.vehicleRecord.findFirst.mockResolvedValue(null);

      await service.migrateOwnerships(report);

      expect(report.ownershipRecords.skipped).toBe(1);
      expect(report.discrepancies).toHaveLength(1);
      expect(report.discrepancies[0].entityType).toBe('Membership');
      expect(report.discrepancies[0].reason).toContain('no corresponding VehicleRecord');
    });
  });

  // ─── runFullMigration (integration of all steps) ────────────────

  describe('runFullMigration', () => {
    it('orchestrates all migration steps and produces a complete report', async () => {
      // Set up minimal data for each step
      mockPrisma.vehicle.findMany.mockResolvedValue([]);
      mockPrisma.booking.findMany.mockResolvedValue([]);

      const report = await service.runFullMigration();

      expect(report.vehicles.source).toBe(0);
      expect(report.serviceEvents.source).toBe(0);
      expect(report.jobCards.source).toBe(0);
      expect(report.ownershipRecords.source).toBe(0);
      expect(report.discrepancies).toHaveLength(0);
    });
  });
});

// ─── Helpers ──────────────────────────────────────────────────────

function createEmptyReport(): MigrationReport {
  return {
    vehicles: { source: 0, migrated: 0, skipped: 0 },
    serviceEvents: { source: 0, migrated: 0, skipped: 0 },
    ownershipRecords: { source: 0, migrated: 0, skipped: 0 },
    jobCards: { source: 0, migrated: 0, skipped: 0 },
    discrepancies: [],
  };
}
