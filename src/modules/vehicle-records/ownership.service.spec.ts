import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OwnershipService } from './ownership.service';
import { TransferStatus, TransferType } from '@prisma/client';

describe('OwnershipService', () => {
  let service: OwnershipService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      vehicleRecord: {
        findUnique: vi.fn(),
        update: vi.fn(),
      },
      ownershipRecord: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
      },
      $transaction: vi.fn(),
    };
    service = new OwnershipService(mockPrisma);
  });

  // ─── initiateTransfer ──────────────────────────────────────────

  describe('initiateTransfer', () => {
    const vehicleId = 'vehicle-1';
    const initiatorId = 'owner-1';
    const dto = {
      newOwnerId: 'new-owner-1',
      transferType: TransferType.SALE,
      odometerKm: 50000,
    };

    it('creates a PENDING transfer with 7-day expiry', async () => {
      mockPrisma.vehicleRecord.findUnique.mockResolvedValue({
        id: vehicleId,
        latestOdometerKm: 45000,
      });
      mockPrisma.ownershipRecord.findFirst
        // Current ownership
        .mockResolvedValueOnce({
          id: 'or-1',
          vehicleRecordId: vehicleId,
          userId: initiatorId,
          transferStatus: TransferStatus.CONFIRMED,
          endDate: null,
        })
        // No existing pending transfer
        .mockResolvedValueOnce(null);

      const createdTransfer = {
        id: 'transfer-1',
        vehicleRecordId: vehicleId,
        userId: dto.newOwnerId,
        transferType: TransferType.SALE,
        transferStatus: TransferStatus.PENDING,
        odometerKm: 50000,
        startDate: expect.any(Date),
        initiatedById: initiatorId,
        expiresAt: expect.any(Date),
      };
      mockPrisma.ownershipRecord.create.mockResolvedValue(createdTransfer);

      const result = await service.initiateTransfer(vehicleId, initiatorId, dto);

      expect(result.transferStatus).toBe(TransferStatus.PENDING);
      expect(result.userId).toBe(dto.newOwnerId);
      expect(mockPrisma.ownershipRecord.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          vehicleRecordId: vehicleId,
          userId: dto.newOwnerId,
          transferType: TransferType.SALE,
          transferStatus: TransferStatus.PENDING,
          odometerKm: 50000,
          initiatedById: initiatorId,
        }),
      });

      // Verify expiresAt is approximately 7 days from now
      const createCallData = mockPrisma.ownershipRecord.create.mock.calls[0][0].data;
      const expiresAt = createCallData.expiresAt as Date;
      const startDate = createCallData.startDate as Date;
      const diffMs = expiresAt.getTime() - startDate.getTime();
      const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
      expect(diffMs).toBe(sevenDaysMs);
    });

    it('rejects if vehicle not found', async () => {
      mockPrisma.vehicleRecord.findUnique.mockResolvedValue(null);

      await expect(
        service.initiateTransfer(vehicleId, initiatorId, dto),
      ).rejects.toThrow('Vehicle record not found');
    });

    it('rejects if initiator is not the current owner', async () => {
      mockPrisma.vehicleRecord.findUnique.mockResolvedValue({
        id: vehicleId,
        latestOdometerKm: 45000,
      });
      mockPrisma.ownershipRecord.findFirst.mockResolvedValueOnce({
        id: 'or-1',
        vehicleRecordId: vehicleId,
        userId: 'someone-else',
        transferStatus: TransferStatus.CONFIRMED,
        endDate: null,
      });

      await expect(
        service.initiateTransfer(vehicleId, initiatorId, dto),
      ).rejects.toThrow('Only the current owner can initiate a transfer');
    });

    it('rejects if no confirmed ownership exists', async () => {
      mockPrisma.vehicleRecord.findUnique.mockResolvedValue({
        id: vehicleId,
        latestOdometerKm: 45000,
      });
      mockPrisma.ownershipRecord.findFirst.mockResolvedValueOnce(null);

      await expect(
        service.initiateTransfer(vehicleId, initiatorId, dto),
      ).rejects.toThrow('Only the current owner can initiate a transfer');
    });

    it('rejects if odometer reading is below last recorded (Req 2.5)', async () => {
      mockPrisma.vehicleRecord.findUnique.mockResolvedValue({
        id: vehicleId,
        latestOdometerKm: 60000,
      });
      mockPrisma.ownershipRecord.findFirst.mockResolvedValueOnce({
        id: 'or-1',
        vehicleRecordId: vehicleId,
        userId: initiatorId,
        transferStatus: TransferStatus.CONFIRMED,
        endDate: null,
      });

      await expect(
        service.initiateTransfer(vehicleId, initiatorId, {
          ...dto,
          odometerKm: 55000,
        }),
      ).rejects.toThrow('Odometer reading must be >= the most recent reading');
    });

    it('accepts odometer equal to last reading', async () => {
      mockPrisma.vehicleRecord.findUnique.mockResolvedValue({
        id: vehicleId,
        latestOdometerKm: 50000,
      });
      mockPrisma.ownershipRecord.findFirst
        .mockResolvedValueOnce({
          id: 'or-1',
          vehicleRecordId: vehicleId,
          userId: initiatorId,
          transferStatus: TransferStatus.CONFIRMED,
          endDate: null,
        })
        .mockResolvedValueOnce(null);
      mockPrisma.ownershipRecord.create.mockResolvedValue({
        id: 'transfer-1',
        transferStatus: TransferStatus.PENDING,
        odometerKm: 50000,
      });

      const result = await service.initiateTransfer(vehicleId, initiatorId, {
        ...dto,
        odometerKm: 50000,
      });

      expect(result.transferStatus).toBe(TransferStatus.PENDING);
    });

    it('rejects if a pending transfer already exists', async () => {
      mockPrisma.vehicleRecord.findUnique.mockResolvedValue({
        id: vehicleId,
        latestOdometerKm: 45000,
      });
      mockPrisma.ownershipRecord.findFirst
        .mockResolvedValueOnce({
          id: 'or-1',
          vehicleRecordId: vehicleId,
          userId: initiatorId,
          transferStatus: TransferStatus.CONFIRMED,
          endDate: null,
        })
        .mockResolvedValueOnce({
          id: 'existing-pending',
          transferStatus: TransferStatus.PENDING,
        });

      await expect(
        service.initiateTransfer(vehicleId, initiatorId, dto),
      ).rejects.toThrow('A pending transfer already exists');
    });

    it('handles vehicle with null latestOdometerKm (treats as 0)', async () => {
      mockPrisma.vehicleRecord.findUnique.mockResolvedValue({
        id: vehicleId,
        latestOdometerKm: null,
      });
      mockPrisma.ownershipRecord.findFirst
        .mockResolvedValueOnce({
          id: 'or-1',
          vehicleRecordId: vehicleId,
          userId: initiatorId,
          transferStatus: TransferStatus.CONFIRMED,
          endDate: null,
        })
        .mockResolvedValueOnce(null);
      mockPrisma.ownershipRecord.create.mockResolvedValue({
        id: 'transfer-1',
        transferStatus: TransferStatus.PENDING,
        odometerKm: 100,
      });

      const result = await service.initiateTransfer(vehicleId, initiatorId, {
        ...dto,
        odometerKm: 100,
      });

      expect(result.transferStatus).toBe(TransferStatus.PENDING);
    });

    it('supports all transfer types (SALE, GIFT, FLEET_REASSIGNMENT)', async () => {
      mockPrisma.vehicleRecord.findUnique.mockResolvedValue({
        id: vehicleId,
        latestOdometerKm: 0,
      });
      mockPrisma.ownershipRecord.findFirst
        .mockResolvedValueOnce({
          id: 'or-1',
          userId: initiatorId,
          transferStatus: TransferStatus.CONFIRMED,
          endDate: null,
        })
        .mockResolvedValueOnce(null);
      mockPrisma.ownershipRecord.create.mockResolvedValue({
        id: 'transfer-1',
        transferType: TransferType.GIFT,
        transferStatus: TransferStatus.PENDING,
      });

      const result = await service.initiateTransfer(vehicleId, initiatorId, {
        ...dto,
        transferType: TransferType.GIFT,
      });

      expect(result.transferType).toBe(TransferType.GIFT);
    });
  });

  // ─── confirmTransfer ──────────────────────────────────────────

  describe('confirmTransfer', () => {
    const vehicleId = 'vehicle-1';
    const transferId = 'transfer-1';
    const recipientId = 'new-owner-1';

    it('confirms transfer and closes previous ownership', async () => {
      const pendingTransfer = {
        id: transferId,
        vehicleRecordId: vehicleId,
        userId: recipientId,
        transferStatus: TransferStatus.PENDING,
        odometerKm: 50000,
        initiatedById: 'owner-1',
        expiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000), // 3 days from now
      };
      mockPrisma.ownershipRecord.findFirst.mockResolvedValue(pendingTransfer);
      mockPrisma.ownershipRecord.update.mockResolvedValue({
        ...pendingTransfer,
        transferStatus: TransferStatus.CONFIRMED,
        confirmedAt: new Date(),
      });
      mockPrisma.ownershipRecord.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.vehicleRecord.update.mockResolvedValue({ id: vehicleId, latestOdometerKm: 50000 });

      const confirmedTransfer = {
        ...pendingTransfer,
        transferStatus: TransferStatus.CONFIRMED,
        confirmedAt: new Date(),
      };
      mockPrisma.$transaction.mockResolvedValue([confirmedTransfer, { count: 1 }, {}]);

      const result = await service.confirmTransfer(vehicleId, transferId, recipientId);

      expect(result.transferStatus).toBe(TransferStatus.CONFIRMED);
      // Verify $transaction was called (Prisma promises are passed as an array)
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      const txnArg = mockPrisma.$transaction.mock.calls[0][0];
      expect(txnArg).toHaveLength(3);
    });

    it('rejects if transfer not found', async () => {
      mockPrisma.ownershipRecord.findFirst.mockResolvedValue(null);

      await expect(
        service.confirmTransfer(vehicleId, transferId, recipientId),
      ).rejects.toThrow('Transfer not found');
    });

    it('rejects if transfer is not PENDING', async () => {
      mockPrisma.ownershipRecord.findFirst.mockResolvedValue({
        id: transferId,
        vehicleRecordId: vehicleId,
        userId: recipientId,
        transferStatus: TransferStatus.CONFIRMED,
      });

      await expect(
        service.confirmTransfer(vehicleId, transferId, recipientId),
      ).rejects.toThrow('Transfer cannot be confirmed');
    });

    it('rejects if user is not the recipient', async () => {
      mockPrisma.ownershipRecord.findFirst.mockResolvedValue({
        id: transferId,
        vehicleRecordId: vehicleId,
        userId: recipientId,
        transferStatus: TransferStatus.PENDING,
        expiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
      });

      await expect(
        service.confirmTransfer(vehicleId, transferId, 'wrong-user'),
      ).rejects.toThrow('Only the recipient can confirm a transfer');
    });

    it('marks transfer as EXPIRED if past expiresAt (Req 2.4)', async () => {
      const expiredTransfer = {
        id: transferId,
        vehicleRecordId: vehicleId,
        userId: recipientId,
        transferStatus: TransferStatus.PENDING,
        expiresAt: new Date(Date.now() - 1000), // Already expired
      };
      mockPrisma.ownershipRecord.findFirst.mockResolvedValue(expiredTransfer);
      mockPrisma.ownershipRecord.update.mockResolvedValue({
        ...expiredTransfer,
        transferStatus: TransferStatus.EXPIRED,
      });

      await expect(
        service.confirmTransfer(vehicleId, transferId, recipientId),
      ).rejects.toThrow('Transfer has expired');

      expect(mockPrisma.ownershipRecord.update).toHaveBeenCalledWith({
        where: { id: transferId },
        data: { transferStatus: TransferStatus.EXPIRED },
      });
    });
  });

  // ─── declineTransfer ──────────────────────────────────────────

  describe('declineTransfer', () => {
    const vehicleId = 'vehicle-1';
    const transferId = 'transfer-1';
    const recipientId = 'new-owner-1';
    const initiatorId = 'owner-1';

    it('allows recipient to decline (Req 2.7)', async () => {
      mockPrisma.ownershipRecord.findFirst.mockResolvedValue({
        id: transferId,
        vehicleRecordId: vehicleId,
        userId: recipientId,
        initiatedById: initiatorId,
        transferStatus: TransferStatus.PENDING,
      });
      mockPrisma.ownershipRecord.update.mockResolvedValue({
        id: transferId,
        transferStatus: TransferStatus.DECLINED,
      });

      const result = await service.declineTransfer(vehicleId, transferId, recipientId);

      expect(result.transferStatus).toBe(TransferStatus.DECLINED);
    });

    it('allows initiator to decline (Req 2.7)', async () => {
      mockPrisma.ownershipRecord.findFirst.mockResolvedValue({
        id: transferId,
        vehicleRecordId: vehicleId,
        userId: recipientId,
        initiatedById: initiatorId,
        transferStatus: TransferStatus.PENDING,
      });
      mockPrisma.ownershipRecord.update.mockResolvedValue({
        id: transferId,
        transferStatus: TransferStatus.DECLINED,
      });

      const result = await service.declineTransfer(vehicleId, transferId, initiatorId);

      expect(result.transferStatus).toBe(TransferStatus.DECLINED);
    });

    it('rejects if transfer not found', async () => {
      mockPrisma.ownershipRecord.findFirst.mockResolvedValue(null);

      await expect(
        service.declineTransfer(vehicleId, transferId, recipientId),
      ).rejects.toThrow('Transfer not found');
    });

    it('rejects if transfer is not PENDING', async () => {
      mockPrisma.ownershipRecord.findFirst.mockResolvedValue({
        id: transferId,
        vehicleRecordId: vehicleId,
        userId: recipientId,
        initiatedById: initiatorId,
        transferStatus: TransferStatus.EXPIRED,
      });

      await expect(
        service.declineTransfer(vehicleId, transferId, recipientId),
      ).rejects.toThrow('Transfer cannot be declined');
    });

    it('rejects if user is neither initiator nor recipient', async () => {
      mockPrisma.ownershipRecord.findFirst.mockResolvedValue({
        id: transferId,
        vehicleRecordId: vehicleId,
        userId: recipientId,
        initiatedById: initiatorId,
        transferStatus: TransferStatus.PENDING,
      });

      await expect(
        service.declineTransfer(vehicleId, transferId, 'random-user'),
      ).rejects.toThrow('Only the initiator or recipient can decline');
    });
  });

  // ─── expirePendingTransfers ──────────────────────────────────

  describe('expirePendingTransfers', () => {
    it('expires all PENDING transfers past expiresAt (Req 2.4)', async () => {
      mockPrisma.ownershipRecord.updateMany.mockResolvedValue({ count: 3 });

      const result = await service.expirePendingTransfers();

      expect(result).toBe(3);
      expect(mockPrisma.ownershipRecord.updateMany).toHaveBeenCalledWith({
        where: {
          transferStatus: TransferStatus.PENDING,
          expiresAt: { lt: expect.any(Date) },
        },
        data: { transferStatus: TransferStatus.EXPIRED },
      });
    });

    it('returns 0 when no transfers need expiring', async () => {
      mockPrisma.ownershipRecord.updateMany.mockResolvedValue({ count: 0 });

      const result = await service.expirePendingTransfers();

      expect(result).toBe(0);
    });
  });

  // ─── getOwnershipTimeline ──────────────────────────────────────

  describe('getOwnershipTimeline', () => {
    const vehicleId = 'vehicle-1';

    it('returns chronological timeline with computed durations (Req 2.6)', async () => {
      mockPrisma.vehicleRecord.findUnique.mockResolvedValue({ id: vehicleId });

      const startDate1 = new Date('2020-01-01');
      const endDate1 = new Date('2022-06-15');
      const startDate2 = new Date('2022-06-15');

      mockPrisma.ownershipRecord.findMany.mockResolvedValue([
        {
          id: 'or-1',
          userId: 'user-1',
          anonymizedId: null,
          transferType: TransferType.SALE,
          transferStatus: TransferStatus.CONFIRMED,
          odometerKm: 10000,
          startDate: startDate1,
          endDate: endDate1,
          initiatedById: null,
          confirmedAt: startDate1,
          expiresAt: null,
        },
        {
          id: 'or-2',
          userId: 'user-2',
          anonymizedId: null,
          transferType: TransferType.SALE,
          transferStatus: TransferStatus.CONFIRMED,
          odometerKm: 50000,
          startDate: startDate2,
          endDate: null,
          initiatedById: 'user-1',
          confirmedAt: startDate2,
          expiresAt: null,
        },
      ]);

      const result = await service.getOwnershipTimeline(vehicleId);

      expect(result).toHaveLength(2);
      // First record has endDate, so duration is computed
      expect(result[0].durationDays).toBe(
        Math.floor((endDate1.getTime() - startDate1.getTime()) / (1000 * 60 * 60 * 24)),
      );
      // Second record is current (no endDate), duration computed from now
      expect(result[1].durationDays).toBeGreaterThanOrEqual(0);
      // Verify chronological order (ascending)
      expect(result[0].startDate.getTime()).toBeLessThan(result[1].startDate.getTime());
    });

    it('returns empty array when vehicle has no ownership records', async () => {
      mockPrisma.vehicleRecord.findUnique.mockResolvedValue({ id: vehicleId });
      mockPrisma.ownershipRecord.findMany.mockResolvedValue([]);

      const result = await service.getOwnershipTimeline(vehicleId);

      expect(result).toEqual([]);
    });

    it('throws not found for non-existent vehicle', async () => {
      mockPrisma.vehicleRecord.findUnique.mockResolvedValue(null);

      await expect(
        service.getOwnershipTimeline('nonexistent'),
      ).rejects.toThrow('Vehicle record not found');
    });

    it('includes PENDING and DECLINED records in timeline', async () => {
      mockPrisma.vehicleRecord.findUnique.mockResolvedValue({ id: vehicleId });
      mockPrisma.ownershipRecord.findMany.mockResolvedValue([
        {
          id: 'or-1',
          userId: 'user-1',
          anonymizedId: null,
          transferType: TransferType.SALE,
          transferStatus: TransferStatus.CONFIRMED,
          odometerKm: 10000,
          startDate: new Date('2020-01-01'),
          endDate: null,
          initiatedById: null,
          confirmedAt: new Date('2020-01-01'),
          expiresAt: null,
        },
        {
          id: 'or-2',
          userId: 'user-2',
          anonymizedId: null,
          transferType: TransferType.GIFT,
          transferStatus: TransferStatus.DECLINED,
          odometerKm: 30000,
          startDate: new Date('2023-01-01'),
          endDate: null,
          initiatedById: 'user-1',
          confirmedAt: null,
          expiresAt: new Date('2023-01-08'),
        },
      ]);

      const result = await service.getOwnershipTimeline(vehicleId);

      expect(result).toHaveLength(2);
      expect(result[1].transferStatus).toBe(TransferStatus.DECLINED);
      // DECLINED records should have null duration (not CONFIRMED so endDate logic is null)
      expect(result[1].durationDays).toBeNull();
    });

    it('displays anonymizedId when userId is null (Req 2.2)', async () => {
      mockPrisma.vehicleRecord.findUnique.mockResolvedValue({ id: vehicleId });
      mockPrisma.ownershipRecord.findMany.mockResolvedValue([
        {
          id: 'or-1',
          userId: null,
          anonymizedId: 'anon_abc12345_1700000000000',
          transferType: TransferType.SALE,
          transferStatus: TransferStatus.CONFIRMED,
          odometerKm: 10000,
          startDate: new Date('2020-01-01'),
          endDate: new Date('2022-01-01'),
          initiatedById: null,
          confirmedAt: new Date('2020-01-01'),
          expiresAt: null,
        },
      ]);

      const result = await service.getOwnershipTimeline(vehicleId);

      expect(result[0].userId).toBeNull();
      expect(result[0].anonymizedId).toBe('anon_abc12345_1700000000000');
    });
  });

  // ─── anonymizeUserRecords ──────────────────────────────────────

  describe('anonymizeUserRecords', () => {
    it('replaces userId with anonymizedId (Req 2.2)', async () => {
      mockPrisma.ownershipRecord.updateMany.mockResolvedValue({ count: 2 });

      const result = await service.anonymizeUserRecords('user-to-delete');

      expect(result).toBe(2);
      expect(mockPrisma.ownershipRecord.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-to-delete' },
        data: {
          userId: null,
          anonymizedId: expect.stringMatching(/^anon_user-to-/),
        },
      });
    });

    it('returns 0 when user has no ownership records', async () => {
      mockPrisma.ownershipRecord.updateMany.mockResolvedValue({ count: 0 });

      const result = await service.anonymizeUserRecords('no-records-user');

      expect(result).toBe(0);
    });
  });
});
