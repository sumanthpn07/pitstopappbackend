import { describe, it, expect, beforeEach, vi } from 'vitest';
import { VehicleRecordsService } from './vehicle-records.service';
import { validateVin } from './vin.util';
import type { AuthContext } from '../../common/auth.types';

// ─── VIN Validation Unit Tests ────────────────────────────────────

describe('validateVin', () => {
  it('accepts a valid 17-character VIN', () => {
    const result = validateVin('1HGBH41JXMN109186');
    expect(result.valid).toBe(true);
    expect(result.normalized).toBe('1HGBH41JXMN109186');
  });

  it('normalizes lowercase VIN to uppercase', () => {
    const result = validateVin('1hgbh41jxmn109186');
    expect(result.valid).toBe(true);
    expect(result.normalized).toBe('1HGBH41JXMN109186');
  });

  it('rejects VIN shorter than 17 characters', () => {
    const result = validateVin('1HGBH41JXMN1091');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('exactly 17 characters');
  });

  it('rejects VIN longer than 17 characters', () => {
    const result = validateVin('1HGBH41JXMN1091861');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('exactly 17 characters');
  });

  it('rejects VIN containing letter I', () => {
    // Replace a character with I
    const result = validateVin('1HGBH41IXMN109186');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('must not contain the letters I, O, or Q');
  });

  it('rejects VIN containing letter O', () => {
    const result = validateVin('1HGBH41OXMN109186');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('must not contain the letters I, O, or Q');
  });

  it('rejects VIN containing letter Q', () => {
    const result = validateVin('1HGBH41QXMN109186');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('must not contain the letters I, O, or Q');
  });

  it('rejects VIN with special characters', () => {
    const result = validateVin('1HGBH41-XMN109186');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('alphanumeric');
  });

  it('rejects empty string', () => {
    const result = validateVin('');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('required');
  });

  it('accepts VIN with all valid characters', () => {
    // Uses all valid character groups: digits + A-H, J-N, P, R-Z
    const result = validateVin('ABCDEFGH12345JKLM');
    expect(result.valid).toBe(true);
  });
});

// ─── VehicleRecordsService Unit Tests ─────────────────────────────

describe('VehicleRecordsService', () => {
  let service: VehicleRecordsService;
  let mockPrisma: any;
  const mockAuth: AuthContext = {
    userId: 'user-123',
    phone: '+1234567890',
    name: 'Test User',
    memberships: [],
    tenantMemberships: [],
  };

  beforeEach(() => {
    mockPrisma = {
      vehicleRecord: {
        findFirst: vi.fn(),
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      ownershipRecord: {
        create: vi.fn(),
      },
      vehicleAuditEntry: {
        create: vi.fn(),
      },
      $transaction: vi.fn(),
    };
    service = new VehicleRecordsService(mockPrisma);
  });

  describe('register', () => {
    it('rejects registration with no identifier', async () => {
      await expect(
        service.register(mockAuth, {
          make: 'Toyota',
          model: 'Camry',
          year: 2020,
        }),
      ).rejects.toThrow('At least one vehicle identifier is required');
    });

    it('rejects registration with invalid VIN', async () => {
      await expect(
        service.register(mockAuth, {
          vin: 'SHORT',
          make: 'Toyota',
          model: 'Camry',
          year: 2020,
        }),
      ).rejects.toThrow('exactly 17 characters');
    });

    it('rejects registration with year too high', async () => {
      const futureYear = new Date().getFullYear() + 2;
      await expect(
        service.register(mockAuth, {
          vin: '1HGBH41JXMN109186',
          make: 'Toyota',
          model: 'Camry',
          year: futureYear,
        }),
      ).rejects.toThrow('Year must be between 1886');
    });

    it('creates new vehicle when no duplicate exists', async () => {
      mockPrisma.vehicleRecord.findFirst.mockResolvedValue(null);
      mockPrisma.vehicleRecord.create.mockResolvedValue({
        id: 'vr-1',
        vin: '1HGBH41JXMN109186',
        chassisNumber: null,
        registrationPlate: null,
        make: 'Toyota',
        model: 'Camry',
        year: 2020,
        color: null,
        fuelType: null,
        engineCapacityCc: null,
        transmission: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      mockPrisma.ownershipRecord.create.mockResolvedValue({
        id: 'or-1',
        vehicleRecordId: 'vr-1',
        userId: 'user-123',
        transferType: 'SALE',
        transferStatus: 'CONFIRMED',
      });

      const result = await service.register(mockAuth, {
        vin: '1HGBH41JXMN109186',
        make: 'Toyota',
        model: 'Camry',
        year: 2020,
      });

      expect(result.linked).toBe(false);
      expect(result.vehicle.vin).toBe('1HGBH41JXMN109186');
      expect(mockPrisma.vehicleRecord.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          vin: '1HGBH41JXMN109186',
          make: 'Toyota',
          model: 'Camry',
          year: 2020,
        }),
      });
    });

    it('links to existing vehicle when VIN matches', async () => {
      const existingVehicle = {
        id: 'vr-existing',
        vin: '1HGBH41JXMN109186',
        make: 'Toyota',
        model: 'Camry',
        year: 2020,
      };
      mockPrisma.vehicleRecord.findFirst.mockResolvedValue(existingVehicle);
      mockPrisma.ownershipRecord.create.mockResolvedValue({
        id: 'or-2',
        vehicleRecordId: 'vr-existing',
        userId: 'user-123',
        transferType: 'SALE',
        transferStatus: 'CONFIRMED',
      });

      const result = await service.register(mockAuth, {
        vin: '1hgbh41jxmn109186', // lowercase input
        make: 'Toyota',
        model: 'Camry',
        year: 2020,
      });

      expect(result.linked).toBe(true);
      expect(result.vehicle.id).toBe('vr-existing');
      expect(mockPrisma.vehicleRecord.create).not.toHaveBeenCalled();
    });

    it('links to existing vehicle when registration plate matches', async () => {
      const existingVehicle = {
        id: 'vr-existing',
        vin: null,
        registrationPlate: 'ABC-1234',
        make: 'Honda',
        model: 'Civic',
        year: 2019,
      };
      mockPrisma.vehicleRecord.findFirst.mockResolvedValue(existingVehicle);
      mockPrisma.ownershipRecord.create.mockResolvedValue({
        id: 'or-3',
        vehicleRecordId: 'vr-existing',
        userId: 'user-123',
      });

      const result = await service.register(mockAuth, {
        registrationPlate: 'ABC-1234',
        make: 'Honda',
        model: 'Civic',
        year: 2019,
      });

      expect(result.linked).toBe(true);
      expect(result.vehicle.id).toBe('vr-existing');
    });

    it('normalizes VIN to uppercase before storing', async () => {
      mockPrisma.vehicleRecord.findFirst.mockResolvedValue(null);
      mockPrisma.vehicleRecord.create.mockResolvedValue({
        id: 'vr-new',
        vin: '1HGBH41JXMN109186',
        make: 'Toyota',
        model: 'Camry',
        year: 2020,
      });
      mockPrisma.ownershipRecord.create.mockResolvedValue({ id: 'or-new' });

      await service.register(mockAuth, {
        vin: '1hgbh41jxmn109186',
        make: 'Toyota',
        model: 'Camry',
        year: 2020,
      });

      expect(mockPrisma.vehicleRecord.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ vin: '1HGBH41JXMN109186' }),
      });
    });

    it('accepts registration with chassis number only (no VIN)', async () => {
      mockPrisma.vehicleRecord.findFirst.mockResolvedValue(null);
      mockPrisma.vehicleRecord.create.mockResolvedValue({
        id: 'vr-chassis',
        vin: null,
        chassisNumber: 'ABCDE12345FGHIJ67890',
        make: 'Ford',
        model: 'F150',
        year: 2021,
      });
      mockPrisma.ownershipRecord.create.mockResolvedValue({ id: 'or-chassis' });

      const result = await service.register(mockAuth, {
        chassisNumber: 'abcde12345fghij67890',
        make: 'Ford',
        model: 'F150',
        year: 2021,
      });

      expect(result.linked).toBe(false);
      expect(mockPrisma.vehicleRecord.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ chassisNumber: 'ABCDE12345FGHIJ67890' }),
      });
    });

    it('rejects invalid chassis number format', async () => {
      await expect(
        service.register(mockAuth, {
          chassisNumber: 'ABC-123!@#',
          make: 'Toyota',
          model: 'Camry',
          year: 2020,
        }),
      ).rejects.toThrow('alphanumeric');
    });
  });

  describe('findById', () => {
    it('returns vehicle when found', async () => {
      const vehicle = {
        id: 'vr-1',
        vin: '1HGBH41JXMN109186',
        make: 'Toyota',
        model: 'Camry',
        year: 2020,
        ownershipRecords: [],
      };
      mockPrisma.vehicleRecord.findUnique.mockResolvedValue(vehicle);

      const result = await service.findById('vr-1');
      expect(result).toEqual(vehicle);
    });

    it('throws not found when vehicle does not exist', async () => {
      mockPrisma.vehicleRecord.findUnique.mockResolvedValue(null);

      await expect(service.findById('nonexistent')).rejects.toThrow('not found');
    });
  });

  describe('update', () => {
    it('creates audit entries for each changed field', async () => {
      const existing = {
        id: 'vr-1',
        vin: '1HGBH41JXMN109186',
        chassisNumber: null,
        registrationPlate: null,
        make: 'Toyota',
        model: 'Camry',
        year: 2020,
        color: 'Red',
        fuelType: null,
        engineCapacityCc: null,
        transmission: null,
      };
      mockPrisma.vehicleRecord.findUnique.mockResolvedValue(existing);

      const updatedVehicle = { ...existing, color: 'Blue', year: 2021 };
      mockPrisma.$transaction.mockResolvedValue([updatedVehicle]);

      const result = await service.update(mockAuth, 'vr-1', {
        color: 'Blue',
        year: 2021,
      });

      expect(result.color).toBe('Blue');
      // Verify $transaction was called with update + audit entries
      const txnArgs = mockPrisma.$transaction.mock.calls[0][0];
      // First item is the vehicle update, rest are audit entries
      expect(txnArgs.length).toBe(3); // update + 2 audit entries
    });

    it('returns existing record when no fields changed', async () => {
      const existing = {
        id: 'vr-1',
        vin: '1HGBH41JXMN109186',
        chassisNumber: null,
        registrationPlate: null,
        make: 'Toyota',
        model: 'Camry',
        year: 2020,
        color: 'Red',
        fuelType: null,
        engineCapacityCc: null,
        transmission: null,
      };
      mockPrisma.vehicleRecord.findUnique.mockResolvedValue(existing);

      const result = await service.update(mockAuth, 'vr-1', {
        color: 'Red', // same value
      });

      expect(result).toEqual(existing);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects update with invalid VIN', async () => {
      const existing = { id: 'vr-1', vin: null };
      mockPrisma.vehicleRecord.findUnique.mockResolvedValue(existing);

      await expect(
        service.update(mockAuth, 'vr-1', { vin: 'INVALID' }),
      ).rejects.toThrow('exactly 17 characters');
    });

    it('throws not found for non-existent vehicle', async () => {
      mockPrisma.vehicleRecord.findUnique.mockResolvedValue(null);

      await expect(
        service.update(mockAuth, 'nonexistent', { color: 'Blue' }),
      ).rejects.toThrow('not found');
    });
  });
});
