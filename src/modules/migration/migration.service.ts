import { Injectable, Logger } from '@nestjs/common';
import {
  BookingStatus,
  JobCardStatus,
  Prisma,
  ServiceCategory,
  ServiceEventSource,
  TransferStatus,
  TransferType,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * A single discrepancy entry in the migration report.
 */
export interface MigrationDiscrepancy {
  entityType: 'Vehicle' | 'Booking' | 'Membership';
  sourceId: string;
  reason: string;
}

/**
 * Summary report produced after a migration run.
 */
export interface MigrationReport {
  vehicles: { source: number; migrated: number; skipped: number };
  serviceEvents: { source: number; migrated: number; skipped: number };
  ownershipRecords: { source: number; migrated: number; skipped: number };
  jobCards: { source: number; migrated: number; skipped: number };
  discrepancies: MigrationDiscrepancy[];
}

/** Status mapping from legacy BookingStatus to new JobCardStatus */
const BOOKING_TO_JOBCARD_STATUS: Partial<Record<BookingStatus, JobCardStatus>> = {
  [BookingStatus.BOOKED]: JobCardStatus.CREATED,
  [BookingStatus.ASSIGNED]: JobCardStatus.ASSIGNED,
  [BookingStatus.IN_PROGRESS]: JobCardStatus.IN_PROGRESS,
};

@Injectable()
export class MigrationService {
  private readonly logger = new Logger(MigrationService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Run the full migration pipeline:
   * 1. Migrate Vehicles → VehicleRecords
   * 2. Migrate completed Bookings → ServiceEvents
   * 3. Migrate active Bookings → JobCards
   * 4. Migrate Membership vehicle ownership → OwnershipRecords
   */
  async runFullMigration(): Promise<MigrationReport> {
    const report: MigrationReport = {
      vehicles: { source: 0, migrated: 0, skipped: 0 },
      serviceEvents: { source: 0, migrated: 0, skipped: 0 },
      ownershipRecords: { source: 0, migrated: 0, skipped: 0 },
      jobCards: { source: 0, migrated: 0, skipped: 0 },
      discrepancies: [],
    };

    await this.migrateVehicles(report);
    await this.migrateCompletedBookings(report);
    await this.migrateActiveBookings(report);
    await this.migrateOwnerships(report);

    this.logger.log(
      `Migration complete. Vehicles: ${report.vehicles.migrated}/${report.vehicles.source}, ` +
        `ServiceEvents: ${report.serviceEvents.migrated}/${report.serviceEvents.source}, ` +
        `JobCards: ${report.jobCards.migrated}/${report.jobCards.source}, ` +
        `Ownerships: ${report.ownershipRecords.migrated}/${report.ownershipRecords.source}, ` +
        `Discrepancies: ${report.discrepancies.length}`,
    );

    return report;
  }

  /**
   * Migrate existing Vehicle entities → VehicleRecord.
   *
   * - plate → registrationPlate (identifier)
   * - makeModel → split into make + model (first space or keep as make with model='Unknown')
   * - color, type → color, (type unused in VehicleRecord, stored as photoUrl context)
   * - Vehicles without plate get TEMP-{vehicleId} prefix and are flagged
   * - Idempotent: skip if legacyVehicleId already exists
   */
  async migrateVehicles(report: MigrationReport): Promise<void> {
    const vehicles = await this.prisma.vehicle.findMany({
      include: { membership: true },
    });

    report.vehicles.source = vehicles.length;

    for (const vehicle of vehicles) {
      // Idempotency check: skip if already migrated
      const existing = await this.prisma.vehicleRecord.findFirst({
        where: { legacyVehicleId: vehicle.id },
      });

      if (existing) {
        report.vehicles.skipped++;
        continue;
      }

      // Parse makeModel into make + model
      const { make, model } = this.parseMakeModel(vehicle.makeModel);

      // Handle missing plate (Req 16.6)
      let registrationPlate: string;
      let hasDiscrepancy = false;

      if (vehicle.plate && vehicle.plate.trim().length > 0) {
        registrationPlate = vehicle.plate.trim();
      } else {
        registrationPlate = `TEMP-${vehicle.id}`;
        hasDiscrepancy = true;
      }

      await this.prisma.vehicleRecord.create({
        data: {
          registrationPlate,
          make,
          model,
          year: new Date(vehicle.createdAt).getFullYear(),
          color: vehicle.color || null,
          photoUrl: null,
          legacyVehicleId: vehicle.id,
        },
      });

      report.vehicles.migrated++;

      if (hasDiscrepancy) {
        report.discrepancies.push({
          entityType: 'Vehicle',
          sourceId: vehicle.id,
          reason: 'No plate or identifying information; assigned TEMP- prefix for manual review',
        });
      }
    }
  }

  /**
   * Migrate completed Bookings → ServiceEvent.
   *
   * Mapping (per Req 16.2):
   * - service.name → serviceType
   * - service.description → description
   * - pricePaise → totalCostPaise
   * - employee name → technicianName (via serviceMembership → user)
   * - shop.name → tenantName
   * - scheduledAt → completedAt
   * - Unmappable fields (odometerKm, partsCost, laborCost, partsUsed) → null
   *
   * Req 16.3: Skip bookings with null vehicleId and log discrepancy.
   * Req 16.7: Idempotent via jobCardId field storing booking.id.
   */
  async migrateCompletedBookings(report: MigrationReport): Promise<void> {
    const completedBookings = await this.prisma.booking.findMany({
      where: { status: BookingStatus.COMPLETED },
      include: {
        service: true,
        shop: true,
        serviceEmployee: { include: { user: true } },
      },
    });

    report.serviceEvents.source = completedBookings.length;

    for (const booking of completedBookings) {
      // Req 16.3: Skip null vehicle reference
      if (!booking.vehicleId) {
        report.serviceEvents.skipped++;
        report.discrepancies.push({
          entityType: 'Booking',
          sourceId: booking.id,
          reason: 'Null vehicle reference on completed booking; skipped ServiceEvent creation',
        });
        continue;
      }

      // Idempotency: check if ServiceEvent already exists for this booking
      const existingEvent = await this.prisma.serviceEvent.findFirst({
        where: {
          jobCardId: booking.id,
          source: ServiceEventSource.MIGRATION,
        },
      });

      if (existingEvent) {
        report.serviceEvents.skipped++;
        continue;
      }

      // Find the VehicleRecord that was migrated from this vehicle
      const vehicleRecord = await this.prisma.vehicleRecord.findFirst({
        where: { legacyVehicleId: booking.vehicleId },
      });

      if (!vehicleRecord) {
        report.serviceEvents.skipped++;
        report.discrepancies.push({
          entityType: 'Booking',
          sourceId: booking.id,
          reason: `Vehicle ${booking.vehicleId} has no corresponding VehicleRecord`,
        });
        continue;
      }

      // Resolve technician name from the service employee membership
      let technicianName: string | null = null;
      if (booking.serviceEmployee?.user?.name) {
        technicianName = booking.serviceEmployee.user.name;
      }

      await this.prisma.serviceEvent.create({
        data: {
          vehicleRecordId: vehicleRecord.id,
          tenantId: null,
          tenantName: booking.shop.name,
          serviceType: booking.service.name,
          category: ServiceCategory.ROUTINE_MAINTENANCE,
          description: booking.service.description || null,
          partsUsed: Prisma.JsonNull,
          laborCostPaise: null,
          partsCostPaise: null,
          totalCostPaise: booking.pricePaise,
          odometerKm: null,
          technicianName,
          source: ServiceEventSource.MIGRATION,
          jobCardId: booking.id,
          completedAt: booking.scheduledAt,
        },
      });

      report.serviceEvents.migrated++;
    }
  }

  /**
   * Migrate active Bookings (BOOKED/ASSIGNED/IN_PROGRESS) → JobCard.
   *
   * Req 16.8: Map status BOOKED→CREATED, ASSIGNED→ASSIGNED, IN_PROGRESS→IN_PROGRESS.
   * Requires a Tenant to exist for the shop. Uses legacyShopId on Tenant.
   * Idempotent: uses the booking.id as a check in notes field.
   */
  async migrateActiveBookings(report: MigrationReport): Promise<void> {
    const activeStatuses: BookingStatus[] = [
      BookingStatus.BOOKED,
      BookingStatus.ASSIGNED,
      BookingStatus.IN_PROGRESS,
    ];

    const activeBookings = await this.prisma.booking.findMany({
      where: { status: { in: activeStatuses } },
      include: {
        shop: true,
        customer: { include: { user: true } },
      },
    });

    report.jobCards.source = activeBookings.length;

    for (const booking of activeBookings) {
      // Skip null vehicle reference
      if (!booking.vehicleId) {
        report.jobCards.skipped++;
        report.discrepancies.push({
          entityType: 'Booking',
          sourceId: booking.id,
          reason: 'Null vehicle reference on active booking; skipped JobCard creation',
        });
        continue;
      }

      // Idempotency: check if JobCard already exists for this booking
      const existingJobCard = await this.prisma.jobCard.findFirst({
        where: { notes: `legacy-booking:${booking.id}` },
      });

      if (existingJobCard) {
        report.jobCards.skipped++;
        continue;
      }

      // Find the VehicleRecord
      const vehicleRecord = await this.prisma.vehicleRecord.findFirst({
        where: { legacyVehicleId: booking.vehicleId },
      });

      if (!vehicleRecord) {
        report.jobCards.skipped++;
        report.discrepancies.push({
          entityType: 'Booking',
          sourceId: booking.id,
          reason: `Vehicle ${booking.vehicleId} has no corresponding VehicleRecord`,
        });
        continue;
      }

      // Find or resolve tenant
      const tenant = await this.prisma.tenant.findFirst({
        where: { legacyShopId: booking.shopId },
      });

      if (!tenant) {
        report.jobCards.skipped++;
        report.discrepancies.push({
          entityType: 'Booking',
          sourceId: booking.id,
          reason: `Shop ${booking.shopId} has no corresponding Tenant`,
        });
        continue;
      }

      const targetStatus = BOOKING_TO_JOBCARD_STATUS[booking.status];
      if (!targetStatus) {
        report.jobCards.skipped++;
        continue;
      }

      await this.prisma.jobCard.create({
        data: {
          tenantId: tenant.id,
          vehicleRecordId: vehicleRecord.id,
          customerId: booking.customer.userId,
          status: targetStatus,
          scheduledAt: booking.scheduledAt,
          notes: `legacy-booking:${booking.id}`,
        },
      });

      report.jobCards.migrated++;
    }
  }

  /**
   * Migrate Membership vehicle associations → OwnershipRecord.
   *
   * Req 16.4: Use membership's createdAt as start date, transfer_type: LEGACY_MIGRATION.
   * Req 16.7: Idempotent by checking existing OwnershipRecord with same user + vehicle + transferType.
   */
  async migrateOwnerships(report: MigrationReport): Promise<void> {
    // Find all vehicles with their memberships (each vehicle belongs to a membership which belongs to a user)
    const vehicles = await this.prisma.vehicle.findMany({
      include: {
        membership: {
          include: { user: true },
        },
      },
    });

    report.ownershipRecords.source = vehicles.length;

    for (const vehicle of vehicles) {
      const vehicleRecord = await this.prisma.vehicleRecord.findFirst({
        where: { legacyVehicleId: vehicle.id },
      });

      if (!vehicleRecord) {
        report.ownershipRecords.skipped++;
        report.discrepancies.push({
          entityType: 'Membership',
          sourceId: vehicle.membershipId,
          reason: `Vehicle ${vehicle.id} has no corresponding VehicleRecord for ownership migration`,
        });
        continue;
      }

      // Idempotency: check if OwnershipRecord already exists for this user+vehicle+LEGACY_MIGRATION
      const existingOwnership = await this.prisma.ownershipRecord.findFirst({
        where: {
          vehicleRecordId: vehicleRecord.id,
          userId: vehicle.membership.userId,
          transferType: TransferType.LEGACY_MIGRATION,
        },
      });

      if (existingOwnership) {
        report.ownershipRecords.skipped++;
        continue;
      }

      await this.prisma.ownershipRecord.create({
        data: {
          vehicleRecordId: vehicleRecord.id,
          userId: vehicle.membership.userId,
          transferType: TransferType.LEGACY_MIGRATION,
          transferStatus: TransferStatus.CONFIRMED,
          startDate: vehicle.membership.createdAt,
          confirmedAt: new Date(),
        },
      });

      report.ownershipRecords.migrated++;
    }
  }

  /**
   * Parse a combined makeModel string into separate make and model fields.
   * Strategy: split on first space. If no space, use entire string as make with model='Unknown'.
   */
  parseMakeModel(makeModel: string): { make: string; model: string } {
    const trimmed = makeModel.trim();
    const spaceIndex = trimmed.indexOf(' ');

    if (spaceIndex === -1) {
      return { make: trimmed, model: 'Unknown' };
    }

    return {
      make: trimmed.substring(0, spaceIndex),
      model: trimmed.substring(spaceIndex + 1).trim(),
    };
  }
}
