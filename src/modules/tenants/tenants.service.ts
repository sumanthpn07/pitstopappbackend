import { Injectable } from '@nestjs/common';
import { Weekday, Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ApiException } from '../../common/api-exception';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { UpdateTenantConfigDto } from './dto/update-tenant-config.dto';

/** Maximum number of tenant memberships a single user can hold. */
const MAX_MEMBERSHIPS = 20;

/** Default working hours provisioned for a new tenant (Mon-Sat). */
const DEFAULT_WORKING_DAYS: { day: Weekday; open: string; close: string; capacity: number; closed: boolean }[] = [
  { day: Weekday.mon, open: '09:00', close: '18:00', capacity: 1, closed: false },
  { day: Weekday.tue, open: '09:00', close: '18:00', capacity: 1, closed: false },
  { day: Weekday.wed, open: '09:00', close: '18:00', capacity: 1, closed: false },
  { day: Weekday.thu, open: '09:00', close: '18:00', capacity: 1, closed: false },
  { day: Weekday.fri, open: '09:00', close: '18:00', capacity: 1, closed: false },
  { day: Weekday.sat, open: '09:00', close: '18:00', capacity: 1, closed: false },
  { day: Weekday.sun, open: '09:00', close: '18:00', capacity: 1, closed: true },
];

@Injectable()
export class TenantsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Creates a new Tenant with default provisioning:
   * - Working hours Mon-Sat 09:00-18:00, Sunday closed
   * - Empty service catalog (no records needed)
   * - 0% GST rate (Prisma default)
   * - Creator linked as MANAGER via TenantMembership
   *
   * Validates that the creating user doesn't already belong to 20 tenants.
   */
  async createTenant(userId: string, dto: CreateTenantDto) {
    // Validate membership cap
    const existingCount = await this.prisma.tenantMembership.count({
      where: { userId },
    });

    if (existingCount >= MAX_MEMBERSHIPS) {
      throw ApiException.validation(
        `You cannot belong to more than ${MAX_MEMBERSHIPS} organizations.`,
      );
    }

    // Create tenant + working hours + membership in a transaction
    const tenant = await this.prisma.$transaction(async (tx) => {
      const created = await tx.tenant.create({
        data: {
          name: dto.name,
          tagline: dto.tagline,
          logoUrl: dto.logoUrl,
          address: dto.address,
          lat: dto.lat,
          lng: dto.lng,
          timezone: dto.timezone ?? 'Asia/Kolkata',
          contactPhone: dto.contactPhone,
          gstin: dto.gstin,
          slotDurationMin: dto.slotDurationMin ?? 30,
          slotCapacity: dto.slotCapacity ?? 1,
          gstRate: 0,
          active: true,
        },
      });

      // Provision default working hours
      await tx.tenantWorkingHour.createMany({
        data: DEFAULT_WORKING_DAYS.map((wh) => ({
          tenantId: created.id,
          ...wh,
        })),
      });

      // Add the creating user as MANAGER
      await tx.tenantMembership.create({
        data: {
          userId,
          tenantId: created.id,
          role: Role.MANAGER,
        },
      });

      return created;
    });

    // Return the tenant with working hours
    const workingHours = await this.prisma.tenantWorkingHour.findMany({
      where: { tenantId: tenant.id },
      orderBy: { day: 'asc' },
    });

    return { ...tenant, workingHours };
  }

  /**
   * Returns tenant config: core fields + working hours.
   */
  async getConfig(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      include: { workingHours: true },
    });

    if (!tenant) {
      throw ApiException.notFound('Tenant not found.');
    }

    return {
      id: tenant.id,
      name: tenant.name,
      tagline: tenant.tagline,
      address: tenant.address,
      contactPhone: tenant.contactPhone,
      gstin: tenant.gstin,
      gstRate: tenant.gstRate,
      slotDurationMin: tenant.slotDurationMin,
      slotCapacity: tenant.slotCapacity,
      timezone: tenant.timezone,
      active: tenant.active,
      workingHours: tenant.workingHours,
    };
  }

  /**
   * Partially updates tenant configuration. If workingHours object is
   * provided, updates only the days specified within it.
   */
  async updateConfig(tenantId: string, dto: UpdateTenantConfigDto) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) {
      throw ApiException.notFound('Tenant not found.');
    }

    if (!tenant.active) {
      throw ApiException.validation('Cannot modify a deactivated organization.');
    }

    // Update scalar fields on tenant
    const { workingHours: workingHoursDto, ...tenantFields } = dto;
    const updateData: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(tenantFields)) {
      if (value !== undefined) {
        updateData[key] = value;
      }
    }

    await this.prisma.$transaction(async (tx) => {
      if (Object.keys(updateData).length > 0) {
        await tx.tenant.update({
          where: { id: tenantId },
          data: updateData,
        });
      }

      // Update working hours if provided
      if (workingHoursDto) {
        const days = Object.entries(workingHoursDto) as [string, { open: string; close: string; capacity: number; closed: boolean } | undefined][];
        for (const [day, entry] of days) {
          if (entry) {
            await tx.tenantWorkingHour.upsert({
              where: { tenantId_day: { tenantId, day: day as Weekday } },
              update: {
                open: entry.open,
                close: entry.close,
                capacity: entry.capacity,
                closed: entry.closed,
              },
              create: {
                tenantId,
                day: day as Weekday,
                open: entry.open,
                close: entry.close,
                capacity: entry.capacity,
                closed: entry.closed,
              },
            });
          }
        }
      }
    });

    return this.getConfig(tenantId);
  }

  /**
   * Deactivates a tenant. Sets active=false, which prevents new JobCards
   * or data modifications. Existing data is retained for historical access.
   */
  async deactivate(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) {
      throw ApiException.notFound('Tenant not found.');
    }

    if (!tenant.active) {
      throw ApiException.validation('Organization is already deactivated.');
    }

    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { active: false },
    });

    return { id: tenantId, active: false, message: 'Organization deactivated. Existing data is retained for historical access.' };
  }
}
