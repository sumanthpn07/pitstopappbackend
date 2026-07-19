import { Injectable } from '@nestjs/common';
import { TransferStatus, TransferType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ApiException } from '../../common/api-exception';
import type { AuthContext } from '../../common/auth.types';
import { validateVin } from './vin.util';
import type { CreateVehicleRecordDto, UpdateVehicleRecordDto } from './dto';

@Injectable()
export class VehicleRecordsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Register a new vehicle or link an existing one.
   *
   * Deduplication logic:
   * 1. Normalize VIN to uppercase
   * 2. Check if VehicleRecord exists with same VIN, chassisNumber, or registrationPlate
   * 3. If found: create OwnershipRecord linking current user → return existing vehicle with linked flag
   * 4. If not found: create new VehicleRecord + OwnershipRecord
   */
  async register(auth: AuthContext, dto: CreateVehicleRecordDto) {
    // Validate at least one identifier is present
    if (!dto.vin && !dto.chassisNumber && !dto.registrationPlate) {
      throw ApiException.validation(
        'At least one vehicle identifier is required (VIN, chassis number, or registration plate).',
      );
    }

    // Validate year upper bound (current year + 1)
    const maxYear = new Date().getFullYear() + 1;
    if (dto.year > maxYear) {
      throw ApiException.validation(`Year must be between 1886 and ${maxYear}.`);
    }

    // Validate VIN format if provided
    let normalizedVin: string | undefined;
    if (dto.vin) {
      const vinResult = validateVin(dto.vin);
      if (!vinResult.valid) {
        throw ApiException.validation(vinResult.error!);
      }
      normalizedVin = vinResult.normalized;
    }

    // Normalize chassis number (uppercase, trimmed)
    const normalizedChassis = dto.chassisNumber?.toUpperCase().trim() || undefined;
    // Validate chassis number format if provided
    if (normalizedChassis && !/^[A-Z0-9]{1,25}$/.test(normalizedChassis)) {
      throw ApiException.validation(
        'Chassis number must be up to 25 alphanumeric characters.',
      );
    }

    const normalizedPlate = dto.registrationPlate?.trim() || undefined;

    // Check for existing vehicle (deduplication)
    const existingVehicle = await this.findExistingVehicle(
      normalizedVin,
      normalizedChassis,
      normalizedPlate,
    );

    if (existingVehicle) {
      // Link to existing vehicle by creating OwnershipRecord
      const ownership = await this.prisma.ownershipRecord.create({
        data: {
          vehicleRecordId: existingVehicle.id,
          userId: auth.userId,
          transferType: TransferType.SALE,
          transferStatus: TransferStatus.CONFIRMED,
          startDate: new Date(),
          confirmedAt: new Date(),
        },
      });

      return {
        vehicle: existingVehicle,
        ownership,
        linked: true,
      };
    }

    // Create new VehicleRecord + OwnershipRecord
    const vehicle = await this.prisma.vehicleRecord.create({
      data: {
        vin: normalizedVin || null,
        chassisNumber: normalizedChassis || null,
        registrationPlate: normalizedPlate || null,
        make: dto.make.trim(),
        model: dto.model.trim(),
        year: dto.year,
        color: dto.color?.trim() || null,
        fuelType: dto.fuelType || null,
        engineCapacityCc: dto.engineCapacityCc ?? null,
        transmission: dto.transmission || null,
      },
    });

    const ownership = await this.prisma.ownershipRecord.create({
      data: {
        vehicleRecordId: vehicle.id,
        userId: auth.userId,
        transferType: TransferType.SALE,
        transferStatus: TransferStatus.CONFIRMED,
        startDate: new Date(),
        confirmedAt: new Date(),
      },
    });

    return {
      vehicle,
      ownership,
      linked: false,
    };
  }

  /** Get all VehicleRecords owned by a user (via active OwnershipRecord). */
  async findAllForUser(userId: string) {
    const ownerships = await this.prisma.ownershipRecord.findMany({
      where: {
        userId,
        transferStatus: 'CONFIRMED',
        endDate: null,
      },
      select: { vehicleRecordId: true },
    });

    const vehicleIds = ownerships.map((o) => o.vehicleRecordId);
    if (vehicleIds.length === 0) return [];

    return this.prisma.vehicleRecord.findMany({
      where: { id: { in: vehicleIds } },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Get a single VehicleRecord by ID. */
  async findById(id: string) {
    const vehicle = await this.prisma.vehicleRecord.findUnique({
      where: { id },
      include: {
        ownershipRecords: { orderBy: { startDate: 'desc' } },
      },
    });

    if (!vehicle) {
      throw ApiException.notFound('Vehicle record not found.');
    }

    return vehicle;
  }

  /**
   * Update a VehicleRecord, creating audit entries for each changed field.
   */
  async update(auth: AuthContext, id: string, dto: UpdateVehicleRecordDto) {
    const existing = await this.prisma.vehicleRecord.findUnique({ where: { id } });
    if (!existing) {
      throw ApiException.notFound('Vehicle record not found.');
    }

    // Validate VIN if being updated
    let normalizedVin: string | undefined;
    if (dto.vin !== undefined) {
      if (dto.vin) {
        const vinResult = validateVin(dto.vin);
        if (!vinResult.valid) {
          throw ApiException.validation(vinResult.error!);
        }
        normalizedVin = vinResult.normalized;
      } else {
        normalizedVin = undefined;
      }
    }

    // Validate year upper bound if provided
    if (dto.year !== undefined) {
      const maxYear = new Date().getFullYear() + 1;
      if (dto.year > maxYear) {
        throw ApiException.validation(`Year must be between 1886 and ${maxYear}.`);
      }
    }

    // Normalize chassis
    const normalizedChassis =
      dto.chassisNumber !== undefined ? dto.chassisNumber?.toUpperCase().trim() || null : undefined;
    if (normalizedChassis && !/^[A-Z0-9]{1,25}$/.test(normalizedChassis)) {
      throw ApiException.validation(
        'Chassis number must be up to 25 alphanumeric characters.',
      );
    }

    const normalizedPlate =
      dto.registrationPlate !== undefined ? dto.registrationPlate?.trim() || null : undefined;

    // Build the update data and audit entries
    const updateData: Record<string, unknown> = {};
    const auditEntries: Array<{
      vehicleRecordId: string;
      userId: string;
      fieldChanged: string;
      previousValue: string | null;
      newValue: string | null;
    }> = [];

    const trackChange = (field: string, oldVal: unknown, newVal: unknown) => {
      if (newVal !== undefined && String(newVal ?? '') !== String(oldVal ?? '')) {
        updateData[field] = newVal;
        auditEntries.push({
          vehicleRecordId: id,
          userId: auth.userId,
          fieldChanged: field,
          previousValue: oldVal != null ? String(oldVal) : null,
          newValue: newVal != null ? String(newVal) : null,
        });
      }
    };

    trackChange('make', existing.make, dto.make?.trim());
    trackChange('model', existing.model, dto.model?.trim());
    trackChange('year', existing.year, dto.year);
    trackChange('color', existing.color, dto.color?.trim());
    trackChange('fuelType', existing.fuelType, dto.fuelType);
    trackChange('engineCapacityCc', existing.engineCapacityCc, dto.engineCapacityCc);
    trackChange('transmission', existing.transmission, dto.transmission);
    trackChange('vin', existing.vin, normalizedVin);
    trackChange('chassisNumber', existing.chassisNumber, normalizedChassis);
    trackChange('registrationPlate', existing.registrationPlate, normalizedPlate);

    if (Object.keys(updateData).length === 0) {
      return existing; // No changes
    }

    // Execute in transaction: create audit entries + update record
    const [updatedVehicle] = await this.prisma.$transaction([
      this.prisma.vehicleRecord.update({
        where: { id },
        data: updateData,
      }),
      ...auditEntries.map((entry) => this.prisma.vehicleAuditEntry.create({ data: entry })),
    ]);

    return updatedVehicle;
  }

  /**
   * Find an existing vehicle by VIN, chassis number, or registration plate.
   */
  private async findExistingVehicle(
    vin?: string,
    chassisNumber?: string,
    registrationPlate?: string,
  ) {
    const conditions: Array<Record<string, string>> = [];
    if (vin) conditions.push({ vin });
    if (chassisNumber) conditions.push({ chassisNumber });
    if (registrationPlate) conditions.push({ registrationPlate });

    if (conditions.length === 0) return null;

    return this.prisma.vehicleRecord.findFirst({
      where: { OR: conditions },
    });
  }
}
