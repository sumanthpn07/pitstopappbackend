import { Injectable } from '@nestjs/common';
import { TransferStatus, TransferType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ApiException } from '../../common/api-exception';
import type { InitiateTransferDto } from './ownership.dto';

@Injectable()
export class OwnershipService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Initiate an ownership transfer. Creates a PENDING OwnershipRecord
   * that requires confirmation from the new owner within 7 days.
   *
   * Requirements: 2.1, 2.3, 2.5
   */
  async initiateTransfer(vehicleId: string, initiatorId: string, dto: InitiateTransferDto) {
    // Verify the vehicle exists
    const vehicle = await this.prisma.vehicleRecord.findUnique({
      where: { id: vehicleId },
    });
    if (!vehicle) {
      throw ApiException.notFound('Vehicle record not found.');
    }

    // Verify initiator is the current owner (has the most recent CONFIRMED ownership)
    const currentOwnership = await this.prisma.ownershipRecord.findFirst({
      where: {
        vehicleRecordId: vehicleId,
        transferStatus: TransferStatus.CONFIRMED,
        endDate: null,
      },
      orderBy: { startDate: 'desc' },
    });

    if (!currentOwnership || currentOwnership.userId !== initiatorId) {
      throw ApiException.forbidden('Only the current owner can initiate a transfer.');
    }

    // Validate odometer monotonicity (Req 2.5)
    const latestOdometer = vehicle.latestOdometerKm ?? 0;
    if (dto.odometerKm < latestOdometer) {
      throw ApiException.validation(
        `Odometer reading must be >= the most recent reading (${latestOdometer} km).`,
      );
    }

    // Ensure no pending transfer already exists for this vehicle
    const existingPending = await this.prisma.ownershipRecord.findFirst({
      where: {
        vehicleRecordId: vehicleId,
        transferStatus: TransferStatus.PENDING,
      },
    });
    if (existingPending) {
      throw ApiException.validation(
        'A pending transfer already exists for this vehicle. Cancel or wait for it to expire.',
      );
    }

    // Create PENDING transfer record with 7-day expiry (Req 2.3)
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const transfer = await this.prisma.ownershipRecord.create({
      data: {
        vehicleRecordId: vehicleId,
        userId: dto.newOwnerId,
        transferType: dto.transferType,
        transferStatus: TransferStatus.PENDING,
        odometerKm: dto.odometerKm,
        startDate: now,
        initiatedById: initiatorId,
        expiresAt,
      },
    });

    return transfer;
  }

  /**
   * Confirm a pending ownership transfer. The new owner confirms receipt.
   *
   * Requirements: 2.1, 2.3
   */
  async confirmTransfer(vehicleId: string, transferId: string, userId: string) {
    const transfer = await this.prisma.ownershipRecord.findFirst({
      where: { id: transferId, vehicleRecordId: vehicleId },
    });

    if (!transfer) {
      throw ApiException.notFound('Transfer not found.');
    }

    if (transfer.transferStatus !== TransferStatus.PENDING) {
      throw ApiException.invalidTransition(
        `Transfer cannot be confirmed — current status is ${transfer.transferStatus}.`,
      );
    }

    // Verify the user is the new owner (recipient)
    if (transfer.userId !== userId) {
      throw ApiException.forbidden('Only the recipient can confirm a transfer.');
    }

    // Check expiry (Req 2.4)
    if (transfer.expiresAt && new Date() > transfer.expiresAt) {
      // Mark as expired
      await this.prisma.ownershipRecord.update({
        where: { id: transferId },
        data: { transferStatus: TransferStatus.EXPIRED },
      });
      throw ApiException.invalidTransition('Transfer has expired.');
    }

    const now = new Date();

    // Execute confirmation in a transaction
    const [confirmedTransfer] = await this.prisma.$transaction([
      // Confirm the new ownership
      this.prisma.ownershipRecord.update({
        where: { id: transferId },
        data: {
          transferStatus: TransferStatus.CONFIRMED,
          confirmedAt: now,
        },
      }),
      // Close the previous owner's OwnershipRecord
      this.prisma.ownershipRecord.updateMany({
        where: {
          vehicleRecordId: vehicleId,
          transferStatus: TransferStatus.CONFIRMED,
          endDate: null,
          id: { not: transferId },
        },
        data: { endDate: now },
      }),
      // Update vehicle's latestOdometerKm
      this.prisma.vehicleRecord.update({
        where: { id: vehicleId },
        data: { latestOdometerKm: transfer.odometerKm },
      }),
    ]);

    return confirmedTransfer;
  }

  /**
   * Decline a pending ownership transfer.
   *
   * Requirements: 2.7
   */
  async declineTransfer(vehicleId: string, transferId: string, userId: string) {
    const transfer = await this.prisma.ownershipRecord.findFirst({
      where: { id: transferId, vehicleRecordId: vehicleId },
    });

    if (!transfer) {
      throw ApiException.notFound('Transfer not found.');
    }

    if (transfer.transferStatus !== TransferStatus.PENDING) {
      throw ApiException.invalidTransition(
        `Transfer cannot be declined — current status is ${transfer.transferStatus}.`,
      );
    }

    // Either party (initiator or recipient) can decline
    if (transfer.userId !== userId && transfer.initiatedById !== userId) {
      throw ApiException.forbidden('Only the initiator or recipient can decline a transfer.');
    }

    const declined = await this.prisma.ownershipRecord.update({
      where: { id: transferId },
      data: { transferStatus: TransferStatus.DECLINED },
    });

    return declined;
  }

  /**
   * Expire all pending transfers past their expiresAt date.
   * Called by a scheduled task.
   *
   * Requirements: 2.4
   */
  async expirePendingTransfers(): Promise<number> {
    const now = new Date();
    const result = await this.prisma.ownershipRecord.updateMany({
      where: {
        transferStatus: TransferStatus.PENDING,
        expiresAt: { lt: now },
      },
      data: { transferStatus: TransferStatus.EXPIRED },
    });
    return result.count;
  }

  /**
   * Get chronological ownership timeline for a vehicle.
   *
   * Requirements: 2.6
   */
  async getOwnershipTimeline(vehicleId: string) {
    const vehicle = await this.prisma.vehicleRecord.findUnique({
      where: { id: vehicleId },
    });
    if (!vehicle) {
      throw ApiException.notFound('Vehicle record not found.');
    }

    const records = await this.prisma.ownershipRecord.findMany({
      where: { vehicleRecordId: vehicleId },
      orderBy: { startDate: 'asc' },
    });

    // Compute duration for each entry
    const now = new Date();
    return records.map((record) => {
      const endDate = record.endDate ?? (record.transferStatus === TransferStatus.CONFIRMED ? now : null);
      const durationMs = endDate ? endDate.getTime() - record.startDate.getTime() : null;
      const durationDays = durationMs !== null ? Math.floor(durationMs / (1000 * 60 * 60 * 24)) : null;

      return {
        id: record.id,
        userId: record.userId,
        anonymizedId: record.anonymizedId,
        transferType: record.transferType,
        transferStatus: record.transferStatus,
        odometerKm: record.odometerKm,
        startDate: record.startDate,
        endDate: record.endDate,
        durationDays,
        initiatedById: record.initiatedById,
        confirmedAt: record.confirmedAt,
        expiresAt: record.expiresAt,
      };
    });
  }

  /**
   * Anonymize ownership records for a deleted user.
   * Replace userId with anonymizedId, preserving transfer data.
   *
   * Requirements: 2.2
   */
  async anonymizeUserRecords(userId: string): Promise<number> {
    const anonymizedId = `anon_${userId.slice(0, 8)}_${Date.now()}`;

    const result = await this.prisma.ownershipRecord.updateMany({
      where: { userId },
      data: {
        userId: null,
        anonymizedId,
      },
    });

    return result.count;
  }
}
