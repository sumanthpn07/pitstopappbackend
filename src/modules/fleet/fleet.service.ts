import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { EventsService } from '../events/events.service';
import {
  EventTypes,
  type OutboxEventPayload,
  type HealthScoreAlertPayload,
} from '../events/event-types';
import { ApiException } from '../../common/api-exception';
import type { CreateFleetDto, AddVehicleToFleetDto } from './dto';
import { TransferType, TransferStatus } from '@prisma/client';

/** Max once per 24h per vehicle for fleet health alerts */
const ALERT_COOLDOWN_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class FleetService {
  private readonly logger = new Logger(FleetService.name);

  /** In-memory cooldown tracker: vehicleRecordId -> last alert timestamp */
  private readonly alertCooldowns = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventsService: EventsService,
  ) {}

  // ─── Create Fleet ────────────────────────────────────────────────

  /**
   * Create a fleet with name, org details, and optional drivers.
   * Req 17.1: Fleet with name (max 100), org name, org registration number, drivers (name + contact)
   */
  async createFleet(ownerId: string, dto: CreateFleetDto) {
    // Validate name
    if (!dto.name || dto.name.trim().length === 0) {
      throw ApiException.validation('Fleet name is required.');
    }
    if (dto.name.length > 100) {
      throw ApiException.validation('Fleet name must be at most 100 characters.');
    }
    if (!dto.organizationName || dto.organizationName.trim().length === 0) {
      throw ApiException.validation('Organization name is required.');
    }

    const fleet = await this.prisma.fleet.create({
      data: {
        ownerId,
        name: dto.name.trim(),
        organizationName: dto.organizationName.trim(),
        organizationRegNumber: dto.organizationRegNumber?.trim() || null,
        drivers: dto.drivers?.length
          ? {
              create: dto.drivers.map((d) => ({
                name: d.name,
                contactPhone: d.contactPhone,
              })),
            }
          : undefined,
      },
      include: {
        drivers: true,
        vehicles: true,
      },
    });

    return fleet;
  }

  // ─── Add Vehicle to Fleet ────────────────────────────────────────

  /**
   * Add a vehicle to the fleet.
   * Req 17.5: Create OwnershipRecord with transfer_type FLEET_ASSIGNMENT
   * Req 17.6: Reject if vehicle already assigned to another fleet
   */
  async addVehicle(fleetId: string, ownerId: string, dto: AddVehicleToFleetDto) {
    // Verify the fleet belongs to this owner
    const fleet = await this.prisma.fleet.findFirst({
      where: { id: fleetId, ownerId },
    });
    if (!fleet) {
      throw ApiException.notFound('Fleet not found.');
    }

    // Verify the vehicle record exists
    const vehicleRecord = await this.prisma.vehicleRecord.findUnique({
      where: { id: dto.vehicleRecordId },
    });
    if (!vehicleRecord) {
      throw ApiException.notFound('Vehicle record not found.');
    }

    // Check if vehicle is already assigned to another fleet (active assignment)
    const existingAssignment = await this.prisma.fleetVehicle.findUnique({
      where: { vehicleRecordId: dto.vehicleRecordId },
    });

    if (existingAssignment && existingAssignment.removedAt === null) {
      if (existingAssignment.fleetId === fleetId) {
        throw ApiException.validation('Vehicle is already assigned to this fleet.');
      }
      throw ApiException.validation(
        'Vehicle is currently assigned to a different fleet.',
      );
    }

    // If assignedDriverId is provided, verify the driver belongs to this fleet
    if (dto.assignedDriverId) {
      const driver = await this.prisma.fleetDriver.findFirst({
        where: { id: dto.assignedDriverId, fleetId },
      });
      if (!driver) {
        throw ApiException.validation('Assigned driver does not belong to this fleet.');
      }
    }

    // Create FleetVehicle and OwnershipRecord in a transaction
    const [fleetVehicle] = await this.prisma.$transaction([
      this.prisma.fleetVehicle.create({
        data: {
          fleetId,
          vehicleRecordId: dto.vehicleRecordId,
          assignedDriverId: dto.assignedDriverId || null,
        },
      }),
      this.prisma.ownershipRecord.create({
        data: {
          vehicleRecordId: dto.vehicleRecordId,
          userId: ownerId,
          transferType: TransferType.FLEET_ASSIGNMENT,
          transferStatus: TransferStatus.CONFIRMED,
          startDate: new Date(),
          confirmedAt: new Date(),
        },
      }),
    ]);

    return fleetVehicle;
  }

  // ─── Remove Vehicle from Fleet ──────────────────────────────────

  /**
   * Remove a vehicle from the fleet.
   * Req 17.7: Close OwnershipRecord (set endDate), disassociate from fleet, retain history
   */
  async removeVehicle(fleetId: string, vehicleId: string, ownerId: string) {
    // Verify the fleet belongs to this owner
    const fleet = await this.prisma.fleet.findFirst({
      where: { id: fleetId, ownerId },
    });
    if (!fleet) {
      throw ApiException.notFound('Fleet not found.');
    }

    // Find the active fleet vehicle assignment
    const fleetVehicle = await this.prisma.fleetVehicle.findFirst({
      where: {
        fleetId,
        vehicleRecordId: vehicleId,
        removedAt: null,
      },
    });
    if (!fleetVehicle) {
      throw ApiException.notFound('Vehicle is not currently assigned to this fleet.');
    }

    const now = new Date();

    // Close the assignment and the OwnershipRecord
    await this.prisma.$transaction([
      // Mark the fleet vehicle as removed
      this.prisma.fleetVehicle.update({
        where: { id: fleetVehicle.id },
        data: { removedAt: now },
      }),
      // Close the FLEET_ASSIGNMENT OwnershipRecord for this vehicle
      this.prisma.ownershipRecord.updateMany({
        where: {
          vehicleRecordId: vehicleId,
          userId: ownerId,
          transferType: TransferType.FLEET_ASSIGNMENT,
          endDate: null,
        },
        data: { endDate: now },
      }),
    ]);

    return { success: true, removedAt: now };
  }

  // ─── Fleet Dashboard ─────────────────────────────────────────────

  /**
   * Get fleet dashboard data.
   * Req 17.2: Each vehicle's HealthScore, last service date, next maintenance, assigned driver
   */
  async getFleetDashboard(fleetId: string, ownerId: string) {
    const fleet = await this.prisma.fleet.findFirst({
      where: { id: fleetId, ownerId },
      include: {
        drivers: true,
        vehicles: {
          where: { removedAt: null },
          include: {
            vehicleRecord: {
              include: {
                healthScore: true,
                serviceEvents: {
                  orderBy: { completedAt: 'desc' },
                  take: 1,
                },
                maintenanceSchedule: {
                  where: { completed: false },
                  orderBy: { dueDate: 'asc' },
                  take: 1,
                },
              },
            },
          },
        },
      },
    });

    if (!fleet) {
      throw ApiException.notFound('Fleet not found.');
    }

    const vehicles = fleet.vehicles.map((fv) => {
      const vr = fv.vehicleRecord;
      const lastService = vr.serviceEvents[0] ?? null;
      const nextMaintenance = vr.maintenanceSchedule[0] ?? null;

      // Find assigned driver
      const driver = fv.assignedDriverId
        ? fleet.drivers.find((d) => d.id === fv.assignedDriverId) ?? null
        : null;

      return {
        vehicleRecordId: vr.id,
        make: vr.make,
        model: vr.model,
        year: vr.year,
        registrationPlate: vr.registrationPlate,
        healthScore: vr.healthScore?.score ?? null,
        healthScoreCalculatedAt: vr.healthScore?.calculatedAt ?? null,
        lastServiceDate: lastService?.completedAt ?? null,
        lastServiceType: lastService?.serviceType ?? null,
        nextMaintenanceDueDate: nextMaintenance?.dueDate ?? null,
        nextMaintenanceServiceType: nextMaintenance?.serviceType ?? null,
        assignedDriver: driver
          ? { id: driver.id, name: driver.name, contactPhone: driver.contactPhone }
          : null,
      };
    });

    return {
      id: fleet.id,
      name: fleet.name,
      organizationName: fleet.organizationName,
      organizationRegNumber: fleet.organizationRegNumber,
      drivers: fleet.drivers,
      vehicleCount: vehicles.length,
      vehicles,
    };
  }

  // ─── Fleet Analytics ─────────────────────────────────────────────

  /**
   * Get fleet cost analytics.
   * Req 17.4: Total spend by month, spend per vehicle, spend by category, cost trend 12 months
   */
  async getFleetAnalytics(fleetId: string, ownerId: string) {
    const fleet = await this.prisma.fleet.findFirst({
      where: { id: fleetId, ownerId },
      include: {
        vehicles: {
          where: { removedAt: null },
          select: { vehicleRecordId: true },
        },
      },
    });

    if (!fleet) {
      throw ApiException.notFound('Fleet not found.');
    }

    const vehicleRecordIds = fleet.vehicles.map((v) => v.vehicleRecordId);

    if (vehicleRecordIds.length === 0) {
      return {
        totalSpendByMonth: [],
        spendPerVehicle: [],
        spendByCategory: [],
        costTrend12Months: [],
      };
    }

    // Get all service events for fleet vehicles in the last 12 months
    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);

    const serviceEvents = await this.prisma.serviceEvent.findMany({
      where: {
        vehicleRecordId: { in: vehicleRecordIds },
        completedAt: { gte: twelveMonthsAgo },
      },
      select: {
        vehicleRecordId: true,
        totalCostPaise: true,
        category: true,
        completedAt: true,
      },
    });

    // Total spend by month
    const monthlySpend = new Map<string, number>();
    for (const se of serviceEvents) {
      const monthKey = `${se.completedAt.getFullYear()}-${String(se.completedAt.getMonth() + 1).padStart(2, '0')}`;
      monthlySpend.set(monthKey, (monthlySpend.get(monthKey) ?? 0) + se.totalCostPaise);
    }
    const totalSpendByMonth = Array.from(monthlySpend.entries())
      .map(([month, totalPaise]) => ({ month, totalPaise }))
      .sort((a, b) => a.month.localeCompare(b.month));

    // Spend per vehicle
    const vehicleSpend = new Map<string, number>();
    for (const se of serviceEvents) {
      vehicleSpend.set(
        se.vehicleRecordId,
        (vehicleSpend.get(se.vehicleRecordId) ?? 0) + se.totalCostPaise,
      );
    }
    const spendPerVehicle = Array.from(vehicleSpend.entries()).map(
      ([vehicleRecordId, totalPaise]) => ({ vehicleRecordId, totalPaise }),
    );

    // Spend by category
    const categorySpend = new Map<string, number>();
    for (const se of serviceEvents) {
      categorySpend.set(
        se.category,
        (categorySpend.get(se.category) ?? 0) + se.totalCostPaise,
      );
    }
    const spendByCategory = Array.from(categorySpend.entries()).map(
      ([category, totalPaise]) => ({ category, totalPaise }),
    );

    // Cost trend: 12 months (same as totalSpendByMonth, fill gaps with 0)
    const costTrend12Months: Array<{ month: string; totalPaise: number }> = [];
    const now = new Date();
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      costTrend12Months.push({
        month: key,
        totalPaise: monthlySpend.get(key) ?? 0,
      });
    }

    return {
      totalSpendByMonth,
      spendPerVehicle,
      spendByCategory,
      costTrend12Months,
    };
  }

  // ─── Health Score Alert Handler ──────────────────────────────────

  /**
   * When any vehicle's health score drops below 50, notify the Fleet_Owner.
   * Max once per 24h per vehicle.
   * Req 17.3: Alert when any vehicle health score < 50 (max once per 24h per vehicle)
   */
  @OnEvent(EventTypes.HEALTH_SCORE_ALERT)
  async handleHealthScoreAlert(
    event: OutboxEventPayload<HealthScoreAlertPayload> & { eventId: string },
  ) {
    await this.eventsService.processWithIdempotency(
      event.eventId,
      'fleet.health-score-alert',
      async () => {
        const { vehicleRecordId, newScore } = event.data;

        if (newScore >= 50) return;

        // Check if the vehicle belongs to any fleet
        const fleetVehicle = await this.prisma.fleetVehicle.findUnique({
          where: { vehicleRecordId },
          include: {
            fleet: { select: { ownerId: true, name: true } },
          },
        });

        if (!fleetVehicle || fleetVehicle.removedAt !== null) return;

        // Check 24h cooldown
        const lastAlertTime = this.alertCooldowns.get(vehicleRecordId);
        if (lastAlertTime && Date.now() - lastAlertTime < ALERT_COOLDOWN_MS) {
          this.logger.debug(
            `Fleet health alert cooldown active for vehicle ${vehicleRecordId}, skipping`,
          );
          return;
        }

        // Record the alert time
        this.alertCooldowns.set(vehicleRecordId, Date.now());

        // Publish notification event for the fleet owner
        await this.eventsService.publish({
          eventType: EventTypes.HEALTH_SCORE_ALERT,
          sourceEntity: 'FleetVehicle',
          sourceId: fleetVehicle.id,
          payload: {
            vehicleRecordId,
            userId: fleetVehicle.fleet.ownerId,
            fleetName: fleetVehicle.fleet.name,
            previousScore: event.data.previousScore,
            newScore,
          },
        });

        this.logger.log(
          `Fleet health alert sent to owner for vehicle ${vehicleRecordId} (score: ${newScore})`,
        );
      },
    );
  }
}
