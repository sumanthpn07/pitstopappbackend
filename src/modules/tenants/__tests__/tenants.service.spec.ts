import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TenantsService } from '../tenants.service';
import { HttpStatus } from '@nestjs/common';

function createMockPrisma() {
  return {
    tenant: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    tenantWorkingHour: {
      createMany: vi.fn(),
      findMany: vi.fn(),
      upsert: vi.fn(),
    },
    tenantMembership: {
      count: vi.fn(),
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  };
}

describe('TenantsService', () => {
  let service: TenantsService;
  let prisma: ReturnType<typeof createMockPrisma>;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = new TenantsService(prisma as any);
  });

  describe('createTenant', () => {
    it('should create a tenant with default provisioning', async () => {
      const userId = 'user-1';
      const dto = { name: 'My Garage' };

      prisma.tenantMembership.count.mockResolvedValue(0);

      const createdTenant = {
        id: 'tenant-1',
        name: 'My Garage',
        tagline: null,
        logoUrl: null,
        address: null,
        lat: null,
        lng: null,
        timezone: 'Asia/Kolkata',
        gstRate: 0,
        gstin: null,
        contactPhone: null,
        slotDurationMin: 30,
        slotCapacity: 1,
        active: true,
        createdAt: new Date(),
        legacyShopId: null,
      };

      // The $transaction mock executes the callback with a mock tx
      prisma.$transaction.mockImplementation(async (fn: Function) => {
        const tx = {
          tenant: { create: vi.fn().mockResolvedValue(createdTenant) },
          tenantWorkingHour: { createMany: vi.fn().mockResolvedValue({ count: 7 }) },
          tenantMembership: { create: vi.fn().mockResolvedValue({ id: 'mem-1' }) },
        };
        return fn(tx);
      });

      const workingHours = [
        { id: 'wh-1', tenantId: 'tenant-1', day: 'mon', open: '09:00', close: '18:00', capacity: 1, closed: false },
        { id: 'wh-2', tenantId: 'tenant-1', day: 'tue', open: '09:00', close: '18:00', capacity: 1, closed: false },
        { id: 'wh-3', tenantId: 'tenant-1', day: 'wed', open: '09:00', close: '18:00', capacity: 1, closed: false },
        { id: 'wh-4', tenantId: 'tenant-1', day: 'thu', open: '09:00', close: '18:00', capacity: 1, closed: false },
        { id: 'wh-5', tenantId: 'tenant-1', day: 'fri', open: '09:00', close: '18:00', capacity: 1, closed: false },
        { id: 'wh-6', tenantId: 'tenant-1', day: 'sat', open: '09:00', close: '18:00', capacity: 1, closed: false },
        { id: 'wh-7', tenantId: 'tenant-1', day: 'sun', open: '09:00', close: '18:00', capacity: 1, closed: true },
      ];
      prisma.tenantWorkingHour.findMany.mockResolvedValue(workingHours);

      const result = await service.createTenant(userId, dto);

      expect(result.id).toBe('tenant-1');
      expect(result.name).toBe('My Garage');
      expect(result.gstRate).toBe(0);
      expect(result.workingHours).toHaveLength(7);
      expect(result.workingHours[6].closed).toBe(true);
    });

    it('should reject when user already has 20 memberships', async () => {
      prisma.tenantMembership.count.mockResolvedValue(20);

      await expect(
        service.createTenant('user-1', { name: 'Another Garage' }),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'VALIDATION' }),
      });
    });

    it('should provision Monday-Saturday open, Sunday closed', async () => {
      prisma.tenantMembership.count.mockResolvedValue(0);

      let capturedWorkingHoursData: any = null;

      prisma.$transaction.mockImplementation(async (fn: Function) => {
        const tx = {
          tenant: { create: vi.fn().mockResolvedValue({ id: 'tenant-2', name: 'Test' }) },
          tenantWorkingHour: {
            createMany: vi.fn().mockImplementation(({ data }) => {
              capturedWorkingHoursData = data;
              return { count: data.length };
            }),
          },
          tenantMembership: { create: vi.fn().mockResolvedValue({ id: 'mem-1' }) },
        };
        return fn(tx);
      });

      prisma.tenantWorkingHour.findMany.mockResolvedValue([]);

      await service.createTenant('user-1', { name: 'Test' });

      expect(capturedWorkingHoursData).toHaveLength(7);

      const sunday = capturedWorkingHoursData.find((wh: any) => wh.day === 'sun');
      expect(sunday.closed).toBe(true);

      const monday = capturedWorkingHoursData.find((wh: any) => wh.day === 'mon');
      expect(monday.open).toBe('09:00');
      expect(monday.close).toBe('18:00');
      expect(monday.closed).toBe(false);
    });
  });

  describe('getConfig', () => {
    it('should return tenant config with working hours', async () => {
      const tenant = {
        id: 'tenant-1',
        name: 'Garage',
        tagline: 'Best garage',
        address: '123 Street',
        contactPhone: '+91999',
        gstin: 'GSTIN123',
        gstRate: 18,
        slotDurationMin: 30,
        slotCapacity: 2,
        timezone: 'Asia/Kolkata',
        active: true,
        workingHours: [
          { id: 'wh-1', tenantId: 'tenant-1', day: 'mon', open: '09:00', close: '18:00', capacity: 1, closed: false },
        ],
      };

      prisma.tenant.findUnique.mockResolvedValue(tenant);

      const result = await service.getConfig('tenant-1');

      expect(result.id).toBe('tenant-1');
      expect(result.gstRate).toBe(18);
      expect(result.workingHours).toHaveLength(1);
    });

    it('should throw not found for non-existent tenant', async () => {
      prisma.tenant.findUnique.mockResolvedValue(null);

      await expect(service.getConfig('invalid-id')).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'NOT_FOUND' }),
      });
    });
  });

  describe('updateConfig', () => {
    it('should update scalar fields on the tenant', async () => {
      prisma.tenant.findUnique.mockResolvedValue({ id: 'tenant-1', active: true });
      prisma.$transaction.mockImplementation(async (fn: Function) => {
        const tx = {
          tenant: { update: vi.fn().mockResolvedValue({}) },
          tenantWorkingHour: { upsert: vi.fn() },
        };
        return fn(tx);
      });

      // Mock getConfig for the return value
      const configResult = {
        id: 'tenant-1',
        name: 'Updated Name',
        tagline: null,
        address: null,
        contactPhone: null,
        gstin: null,
        gstRate: 5,
        slotDurationMin: 30,
        slotCapacity: 1,
        timezone: 'Asia/Kolkata',
        active: true,
        workingHours: [],
      };
      // Override getConfig by mocking subsequent findUnique
      prisma.tenant.findUnique
        .mockResolvedValueOnce({ id: 'tenant-1', active: true }) // first call in updateConfig
        .mockResolvedValueOnce({ ...configResult, workingHours: [] }); // second call in getConfig

      const result = await service.updateConfig('tenant-1', { name: 'Updated Name', gstRate: 5 });

      expect(result).toBeDefined();
    });

    it('should reject updates to a deactivated tenant', async () => {
      prisma.tenant.findUnique.mockResolvedValue({ id: 'tenant-1', active: false });

      await expect(
        service.updateConfig('tenant-1', { name: 'Test' }),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'VALIDATION' }),
      });
    });
  });

  describe('deactivate', () => {
    it('should set active to false', async () => {
      prisma.tenant.findUnique.mockResolvedValue({ id: 'tenant-1', active: true });
      prisma.tenant.update.mockResolvedValue({ id: 'tenant-1', active: false });

      const result = await service.deactivate('tenant-1');

      expect(result.active).toBe(false);
      expect(prisma.tenant.update).toHaveBeenCalledWith({
        where: { id: 'tenant-1' },
        data: { active: false },
      });
    });

    it('should throw not found for non-existent tenant', async () => {
      prisma.tenant.findUnique.mockResolvedValue(null);

      await expect(service.deactivate('invalid-id')).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'NOT_FOUND' }),
      });
    });

    it('should reject if already deactivated', async () => {
      prisma.tenant.findUnique.mockResolvedValue({ id: 'tenant-1', active: false });

      await expect(service.deactivate('tenant-1')).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'VALIDATION' }),
      });
    });
  });
});
