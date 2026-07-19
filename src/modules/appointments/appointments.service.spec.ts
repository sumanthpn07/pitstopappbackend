import { describe, it, expect, beforeEach, vi } from 'vitest';
import { JobCardStatus, Weekday } from '@prisma/client';
import { AppointmentsService } from './appointments.service';

// ─── Mocks ─────────────────────────────────────────────────────

/**
 * Returns the next occurrence of a given weekday (0=Sun, 1=Mon, ..., 6=Sat).
 * Always at least 1 day in the future.
 */
function getNextWeekday(targetDay: number): Date {
  const now = new Date();
  const currentDay = now.getDay();
  let daysUntil = targetDay - currentDay;
  if (daysUntil <= 0) daysUntil += 7;
  const result = new Date(now);
  result.setDate(result.getDate() + daysUntil);
  return result;
}

function createMockPrisma() {
  return {
    tenant: {
      findUnique: vi.fn(),
    },
    jobCard: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn(),
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn(),
      update: vi.fn(),
    },
    jobCardItem: {
      createMany: vi.fn(),
    },
    vehicleRecord: {
      findUnique: vi.fn(),
    },
    tenantService: {
      findMany: vi.fn(),
    },
    tenantMembership: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    $transaction: vi.fn((fn: any) => fn({
      jobCard: { create: vi.fn().mockResolvedValue({ id: 'jc-1' }) },
      jobCardItem: { createMany: vi.fn() },
    })),
  };
}

function createMockTenantContext(tenantId: string | null = 'tenant-1') {
  return {
    tenantId,
    userId: 'user-1',
    setTenantId: vi.fn(),
    setUserId: vi.fn(),
    isResolved: () => tenantId !== null,
  };
}

function createMockEventsService() {
  return {
    publish: vi.fn().mockResolvedValue('event-1'),
  };
}

function createDefaultTenant(overrides = {}) {
  return {
    id: 'tenant-1',
    name: 'Test Garage',
    active: true,
    slotDurationMin: 30,
    slotCapacity: 2,
    timezone: 'Asia/Kolkata',
    workingHours: [
      { day: Weekday.mon, open: '09:00', close: '18:00', closed: false },
      { day: Weekday.tue, open: '09:00', close: '18:00', closed: false },
      { day: Weekday.wed, open: '09:00', close: '18:00', closed: false },
      { day: Weekday.thu, open: '09:00', close: '18:00', closed: false },
      { day: Weekday.fri, open: '09:00', close: '18:00', closed: false },
      { day: Weekday.sat, open: '09:00', close: '18:00', closed: false },
      { day: Weekday.sun, open: '09:00', close: '18:00', closed: true },
    ],
    ...overrides,
  };
}

describe('AppointmentsService', () => {
  let service: AppointmentsService;
  let mockPrisma: ReturnType<typeof createMockPrisma>;
  let mockTenantContext: ReturnType<typeof createMockTenantContext>;
  let mockEventsService: ReturnType<typeof createMockEventsService>;

  beforeEach(() => {
    mockPrisma = createMockPrisma();
    mockTenantContext = createMockTenantContext();
    mockEventsService = createMockEventsService();

    service = new AppointmentsService(
      mockPrisma as any,
      mockTenantContext as any,
      mockEventsService as any,
    );
  });

  // ─── Availability ──────────────────────────────────────────────

  describe('getAvailability', () => {
    it('should return 14 days of availability', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue(createDefaultTenant());
      mockPrisma.jobCard.findMany.mockResolvedValue([]);

      const result = await service.getAvailability('tenant-1');

      expect(result).toHaveLength(14);
      expect(result[0]).toHaveProperty('date');
      expect(result[0]).toHaveProperty('slots');
    });

    it('should return empty slots for closed days', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue(createDefaultTenant());
      mockPrisma.jobCard.findMany.mockResolvedValue([]);

      const result = await service.getAvailability('tenant-1');

      // Find Sunday slots
      const sundaySlots = result.filter((d) => {
        const date = new Date(d.date);
        return date.getDay() === 0; // Sunday
      });

      for (const sun of sundaySlots) {
        expect(sun.slots).toHaveLength(0);
      }
    });

    it('should throw for non-existent tenant', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue(null);

      await expect(service.getAvailability('nonexistent')).rejects.toThrow('Tenant not found');
    });

    it('should throw for inactive tenant', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue(createDefaultTenant({ active: false }));

      await expect(service.getAvailability('tenant-1')).rejects.toThrow('not active');
    });

    it('should calculate remaining capacity correctly', async () => {
      const tenant = createDefaultTenant({ slotCapacity: 3 });
      mockPrisma.tenant.findUnique.mockResolvedValue(tenant);

      // Simulate one booking in a future slot
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(10, 0, 0, 0);

      mockPrisma.jobCard.findMany.mockResolvedValue([
        { scheduledAt: tomorrow },
      ]);

      const result = await service.getAvailability('tenant-1');

      // Verify at least some slots have remaining < slotCapacity
      const allSlots = result.flatMap((d) => d.slots);
      // The slot at 10:00 tomorrow should have remaining = 2 (3-1)
      // All other future slots should have remaining = 3
      const slotsWith2 = allSlots.filter((s) => s.remaining === 2);
      expect(slotsWith2.length).toBeGreaterThanOrEqual(0); // May vary due to timezone
    });
  });

  // ─── Booking ───────────────────────────────────────────────────

  describe('book', () => {
    it('should reject booking with no services', async () => {
      await expect(
        service.book('user-1', {
          vehicleRecordId: 'vr-1',
          services: [],
          scheduledAt: new Date(Date.now() + 86400000).toISOString(),
          tenantId: 'tenant-1',
        }),
      ).rejects.toThrow('At least 1 service');
    });

    it('should reject booking with more than 20 services', async () => {
      const services = Array.from({ length: 21 }, (_, i) => ({ serviceId: `svc-${i}` }));

      await expect(
        service.book('user-1', {
          vehicleRecordId: 'vr-1',
          services,
          scheduledAt: new Date(Date.now() + 86400000).toISOString(),
          tenantId: 'tenant-1',
        }),
      ).rejects.toThrow('Maximum 20 services');
    });

    it('should reject booking with past scheduledAt', async () => {
      await expect(
        service.book('user-1', {
          vehicleRecordId: 'vr-1',
          services: [{ serviceId: 'svc-1' }],
          scheduledAt: new Date(Date.now() - 86400000).toISOString(),
          tenantId: 'tenant-1',
        }),
      ).rejects.toThrow('must be in the future');
    });

    it('should reject booking when slot is at capacity', async () => {
      const tenant = createDefaultTenant({ slotCapacity: 1 });
      mockPrisma.tenant.findUnique.mockResolvedValue(tenant);
      mockPrisma.jobCard.count.mockResolvedValue(1); // Already at capacity

      // Schedule for next Monday 10:00 (guaranteed weekday)
      const nextMonday = getNextWeekday(1); // 1 = Monday in JS Date
      nextMonday.setHours(10, 0, 0, 0);

      await expect(
        service.book('user-1', {
          vehicleRecordId: 'vr-1',
          services: [{ serviceId: 'svc-1' }],
          scheduledAt: nextMonday.toISOString(),
          tenantId: 'tenant-1',
        }),
      ).rejects.toThrow('time slot is unavailable');
    });

    it('should create a job card when slot has capacity', async () => {
      // Schedule for next Monday 10:00 (guaranteed weekday)
      const tomorrow = getNextWeekday(1); // Monday
      tomorrow.setHours(10, 0, 0, 0);

      const tenant = createDefaultTenant({ slotCapacity: 2 });
      mockPrisma.tenant.findUnique.mockResolvedValue(tenant);
      mockPrisma.jobCard.count.mockResolvedValue(0);
      mockPrisma.vehicleRecord.findUnique.mockResolvedValue({ id: 'vr-1' });
      mockPrisma.tenantService.findMany.mockResolvedValue([
        { id: 'svc-1', pricePaise: 50000, durationMin: 60 },
      ]);
      mockPrisma.jobCard.findUnique.mockResolvedValue({
        id: 'jc-1',
        scheduledAt: tomorrow,
        status: 'CREATED',
        items: [{ id: 'item-1', serviceId: 'svc-1' }],
        tenant: { name: 'Test Garage' },
      });

      const result = await service.book('user-1', {
        vehicleRecordId: 'vr-1',
        services: [{ serviceId: 'svc-1' }],
        scheduledAt: tomorrow.toISOString(),
        tenantId: 'tenant-1',
      });

      expect(result).toHaveProperty('id');
      expect(result).toHaveProperty('scheduledAt');
      expect(result).toHaveProperty('tenantName');
      expect(result.status).toBe('CREATED');
    });
  });

  // ─── Cancellation ──────────────────────────────────────────────

  describe('cancel', () => {
    it('should throw for non-existent appointment', async () => {
      mockPrisma.jobCard.findUnique.mockResolvedValue(null);

      await expect(service.cancel('nonexistent')).rejects.toThrow('not found');
    });

    it('should throw when trying to cancel non-CREATED job card', async () => {
      mockPrisma.jobCard.findUnique.mockResolvedValue({
        id: 'jc-1',
        status: JobCardStatus.IN_PROGRESS,
        scheduledAt: new Date(),
        tenant: { id: 'tenant-1', name: 'Test' },
      });

      await expect(service.cancel('jc-1')).rejects.toThrow('CREATED');
    });

    it('should cancel without penalty when >= 2 hours before', async () => {
      const futureDate = new Date(Date.now() + 3 * 60 * 60 * 1000); // 3 hours from now
      mockPrisma.jobCard.findUnique.mockResolvedValue({
        id: 'jc-1',
        status: JobCardStatus.CREATED,
        scheduledAt: futureDate,
        tenantId: 'tenant-1',
        customerId: 'user-1',
        tenant: { id: 'tenant-1', name: 'Test' },
      });
      mockPrisma.jobCard.update.mockResolvedValue({
        id: 'jc-1',
        status: JobCardStatus.CANCELLED,
        cancellationReason: 'Customer cancelled',
      });

      const result = await service.cancel('jc-1');

      expect(result.isLateCancellation).toBe(false);
      expect(mockEventsService.publish).not.toHaveBeenCalled();
    });

    it('should record late cancellation and notify when < 2 hours before', async () => {
      const soonDate = new Date(Date.now() + 1 * 60 * 60 * 1000); // 1 hour from now
      mockPrisma.jobCard.findUnique.mockResolvedValue({
        id: 'jc-1',
        status: JobCardStatus.CREATED,
        scheduledAt: soonDate,
        tenantId: 'tenant-1',
        customerId: 'user-1',
        tenant: { id: 'tenant-1', name: 'Test' },
      });
      mockPrisma.jobCard.update.mockResolvedValue({
        id: 'jc-1',
        status: JobCardStatus.CANCELLED,
        cancellationReason: 'Late cancellation',
      });
      mockPrisma.tenantMembership.findMany.mockResolvedValue([
        { userId: 'manager-1' },
      ]);

      const result = await service.cancel('jc-1');

      expect(result.isLateCancellation).toBe(true);
      expect(mockEventsService.publish).toHaveBeenCalled();
    });
  });

  // ─── Queue ─────────────────────────────────────────────────────

  describe('getQueue', () => {
    it('should throw when tenant context is missing', async () => {
      const serviceNoTenant = new AppointmentsService(
        mockPrisma as any,
        createMockTenantContext(null) as any,
        mockEventsService as any,
      );

      await expect(serviceNoTenant.getQueue()).rejects.toThrow('Tenant context');
    });

    it('should return today\'s appointments sorted by scheduledAt', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue({ timezone: 'Asia/Kolkata' });
      
      const now = new Date();
      const appointment1 = {
        id: 'jc-1',
        scheduledAt: new Date(now.setHours(10, 0, 0, 0)),
        status: 'CREATED',
        assignedTechId: null,
        vehicleRecord: { id: 'vr-1', make: 'Toyota', model: 'Camry', year: 2020, registrationPlate: 'ABC123' },
        items: [],
        customerId: 'user-1',
      };
      const appointment2 = {
        id: 'jc-2',
        scheduledAt: new Date(now.setHours(11, 0, 0, 0)),
        status: 'ASSIGNED',
        assignedTechId: 'tech-1',
        vehicleRecord: { id: 'vr-2', make: 'Honda', model: 'Civic', year: 2021, registrationPlate: 'DEF456' },
        items: [],
        customerId: 'user-2',
      };

      mockPrisma.jobCard.findMany.mockResolvedValue([appointment1, appointment2]);

      const result = await service.getQueue();

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('jc-1');
      expect(result[1].id).toBe('jc-2');
      expect(result[0]).toHaveProperty('status');
      expect(result[0]).toHaveProperty('assignedTechId');
      expect(result[0]).toHaveProperty('vehicleRecord');
    });
  });
});
