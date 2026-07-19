import { Injectable } from '@nestjs/common';
import { Prisma, ServiceEventSource } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ApiException } from '../../common/api-exception';
import type { AuthContext } from '../../common/auth.types';
import type { CreateOwnerServiceEventDto } from './service-history.dto';

const PAGE_SIZE = 20;

@Injectable()
export class ServiceHistoryService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Get paginated service history in reverse-chronological order.
   * Returns all fields (internal view for tenant members).
   *
   * Requirements: 3.3
   */
  async getHistory(vehicleId: string, page: number) {
    const vehicle = await this.prisma.vehicleRecord.findUnique({
      where: { id: vehicleId },
    });
    if (!vehicle) {
      throw ApiException.notFound('Vehicle record not found.');
    }

    const skip = (page - 1) * PAGE_SIZE;

    const [events, total] = await Promise.all([
      this.prisma.serviceEvent.findMany({
        where: { vehicleRecordId: vehicleId },
        orderBy: { completedAt: 'desc' },
        skip,
        take: PAGE_SIZE,
      }),
      this.prisma.serviceEvent.count({
        where: { vehicleRecordId: vehicleId },
      }),
    ]);

    return {
      data: events,
      pagination: {
        page,
        pageSize: PAGE_SIZE,
        total,
        totalPages: Math.ceil(total / PAGE_SIZE),
      },
    };
  }

  /**
   * Get paginated service history for external view (non-tenant users).
   * Strips internal pricing fields: laborCostPaise, partsCostPaise,
   * technicianName, and detailed partsUsed.
   *
   * Requirements: 5.6
   */
  async getHistoryForExternalView(vehicleId: string, page: number) {
    const vehicle = await this.prisma.vehicleRecord.findUnique({
      where: { id: vehicleId },
    });
    if (!vehicle) {
      throw ApiException.notFound('Vehicle record not found.');
    }

    const skip = (page - 1) * PAGE_SIZE;

    const [events, total] = await Promise.all([
      this.prisma.serviceEvent.findMany({
        where: { vehicleRecordId: vehicleId },
        orderBy: { completedAt: 'desc' },
        skip,
        take: PAGE_SIZE,
      }),
      this.prisma.serviceEvent.count({
        where: { vehicleRecordId: vehicleId },
      }),
    ]);

    // Strip internal data for external view (Req 5.6)
    const filtered = events.map((event) => ({
      id: event.id,
      vehicleRecordId: event.vehicleRecordId,
      tenantName: event.tenantName,
      serviceType: event.serviceType,
      category: event.category,
      description: event.description,
      totalCostPaise: event.totalCostPaise,
      currency: event.currency,
      odometerKm: event.odometerKm,
      source: event.source,
      completedAt: event.completedAt,
      createdAt: event.createdAt,
    }));

    return {
      data: filtered,
      pagination: {
        page,
        pageSize: PAGE_SIZE,
        total,
        totalPages: Math.ceil(total / PAGE_SIZE),
      },
    };
  }

  /**
   * Add an owner-reported service event.
   * Validates odometer monotonicity and updates VehicleRecord.latestOdometerKm.
   *
   * Requirements: 3.6, 3.5
   */
  async addOwnerReported(auth: AuthContext, vehicleId: string, dto: CreateOwnerServiceEventDto) {
    const vehicle = await this.prisma.vehicleRecord.findUnique({
      where: { id: vehicleId },
    });
    if (!vehicle) {
      throw ApiException.notFound('Vehicle record not found.');
    }

    // Validate odometer monotonicity (Req 3.5)
    if (dto.odometerKm !== undefined && dto.odometerKm !== null) {
      const latestOdometer = vehicle.latestOdometerKm ?? 0;
      if (dto.odometerKm < latestOdometer) {
        throw ApiException.validation(
          `Odometer reading must be >= the most recent reading (${latestOdometer} km).`,
        );
      }
    }

    // Create ServiceEvent with source = OWNER_REPORTED
    const serviceEvent = await this.prisma.$transaction(async (tx) => {
      const event = await tx.serviceEvent.create({
        data: {
          vehicleRecordId: vehicleId,
          tenantName: dto.tenantName,
          serviceType: dto.serviceType,
          category: dto.category,
          description: dto.description || null,
          totalCostPaise: dto.totalCostPaise,
          odometerKm: dto.odometerKm ?? null,
          partsUsed: dto.partsUsed ? (dto.partsUsed as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
          source: ServiceEventSource.OWNER_REPORTED,
          completedAt: new Date(dto.completedAt),
        },
      });

      // Update latestOdometerKm on VehicleRecord if odometer provided
      if (dto.odometerKm !== undefined && dto.odometerKm !== null) {
        await tx.vehicleRecord.update({
          where: { id: vehicleId },
          data: { latestOdometerKm: dto.odometerKm },
        });
      }

      return event;
    });

    return serviceEvent;
  }

  /**
   * Determine if user is a member of a given tenant.
   * Used by the controller to decide full vs external view.
   */
  isUserTenantMember(auth: AuthContext, tenantId: string | null): boolean {
    if (!tenantId) return false;
    return auth.tenantMemberships.some((m) => m.tenantId === tenantId);
  }
}
