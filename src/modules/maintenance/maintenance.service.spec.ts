import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MaintenanceService } from './maintenance.service';
import { EventTypes } from '../events/event-types';

describe('MaintenanceService', () => {
  let service: MaintenanceService;
  let mockPrisma: any;
  let mockTenantContext: any;
  let mockEventsService: any;

  beforeEach(() => {
    mockPrisma = {
      maintenanceTemplate: {
        findMany: vi.fn(),
        upsert: vi.fn(),
      },
      maintenanceScheduleEntry: {
        findMany: vi.fn(),
        update: vi.fn(),
        create: vi.fn(),
      },
      vehicleRecord: {
        findUnique: vi.fn(),
      },
      serviceEvent: {
        findMany: vi.fn(),
      },
    };

    mockTenantContext = { tenantId: 'tenant-1' };
    mockEventsService = {
      publish: vi.fn().mockResolvedValue('event-1'),
      processWithIdempotency: vi.fn().mockImplementation(
        async (_eventId: string, _consumer: string, handler: () => Promise<void>) => {
          await handler();
          return true;
        },
      ),
    };

    service = new MaintenanceService(mockPrisma, mockTenantContext, mockEventsService);
  });

  // ─── Urgency Classification ──────────────────────────────────────

  describe('classifyUrgency', () => {
    it('returns OVERDUE when due date is in the past', () => {
      const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000); // 1 day ago
      const result = service.classifyUrgency(pastDate, null, null);
      expect(result).toBe('OVERDUE');
    });

    it('returns OVERDUE when current odometer exceeds due odometer', () => {
      const futureDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days out
      const result = service.classifyUrgency(futureDate, 50000, 51000);
      expect(result).toBe('OVERDUE');
    });

    it('returns OVERDUE when current odometer equals due odometer', () => {
      const futureDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      const result = service.classifyUrgency(futureDate, 50000, 50000);
      expect(result).toBe('OVERDUE');
    });

    it('returns DUE_SOON when due date is within 7 days', () => {
      const in5Days = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
      const result = service.classifyUrgency(in5Days, null, null);
      expect(result).toBe('DUE_SOON');
    });

    it('returns DUE_SOON when within 500km of odometer trigger', () => {
      const futureDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      const result = service.classifyUrgency(futureDate, 50000, 49600); // 400km remaining
      expect(result).toBe('DUE_SOON');
    });

    it('returns DUE_SOON when exactly 500km from odometer trigger', () => {
      const futureDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      const result = service.classifyUrgency(futureDate, 50000, 49500); // exactly 500km
      expect(result).toBe('DUE_SOON');
    });

    it('returns UPCOMING when due date is more than 7 days away and odometer is far', () => {
      const in30Days = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      const result = service.classifyUrgency(in30Days, 50000, 48000); // 2000km remaining
      expect(result).toBe('UPCOMING');
    });

    it('returns UPCOMING when no due date and no odometer trigger', () => {
      const result = service.classifyUrgency(null, null, null);
      expect(result).toBe('UPCOMING');
    });

    it('returns UPCOMING when due date far and no odometer data', () => {
      const in60Days = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);
      const result = service.classifyUrgency(in60Days, null, null);
      expect(result).toBe('UPCOMING');
    });

    it('returns DUE_SOON when due date is exactly 7 days', () => {
      const in7Days = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      const result = service.classifyUrgency(in7Days, null, null);
      expect(result).toBe('DUE_SOON');
    });

    it('returns OVERDUE based on odometer even with no due date', () => {
      const result = service.classifyUrgency(null, 50000, 50500);
      expect(result).toBe('OVERDUE');
    });

    it('returns DUE_SOON based on odometer even with no due date', () => {
      const result = service.classifyUrgency(null, 50000, 49700);
      expect(result).toBe('DUE_SOON');
    });
  });

  // ─── Template Creation/Validation ────────────────────────────────

  describe('createOrUpdateTemplate', () => {
    it('creates a template with valid data', async () => {
      const dto = {
        make: 'Toyota',
        model: 'Camry',
        items: [
          { serviceType: 'oil-change', intervalKm: 10000, intervalMonths: 6 },
          { serviceType: 'brake-inspection', intervalMonths: 12 },
        ],
      };
      mockPrisma.maintenanceTemplate.upsert.mockResolvedValue({
        id: 'tmpl-1',
        tenantId: 'tenant-1',
        ...dto,
      });

      const result = await service.createOrUpdateTemplate(dto);
      expect(result.make).toBe('Toyota');
      expect(result.model).toBe('Camry');
    });

    it('rejects template with empty items', async () => {
      await expect(
        service.createOrUpdateTemplate({ make: 'Toyota', model: 'Camry', items: [] }),
      ).rejects.toThrow('At least one maintenance item');
    });

    it('rejects template with more than 50 items', async () => {
      const items = Array.from({ length: 51 }, (_, i) => ({
        serviceType: `service-${i}`,
        intervalKm: 5000,
      }));
      await expect(
        service.createOrUpdateTemplate({ make: 'Toyota', model: 'Camry', items }),
      ).rejects.toThrow('cannot exceed 50 items');
    });

    it('rejects template item without serviceType', async () => {
      await expect(
        service.createOrUpdateTemplate({
          make: 'Toyota',
          model: 'Camry',
          items: [{ serviceType: '', intervalKm: 10000 }],
        }),
      ).rejects.toThrow('must have a serviceType');
    });

    it('rejects template item without any interval', async () => {
      await expect(
        service.createOrUpdateTemplate({
          make: 'Toyota',
          model: 'Camry',
          items: [{ serviceType: 'oil-change' }],
        }),
      ).rejects.toThrow('must specify at least one interval');
    });

    it('rejects when make is missing', async () => {
      await expect(
        service.createOrUpdateTemplate({
          make: '',
          model: 'Camry',
          items: [{ serviceType: 'oil-change', intervalKm: 10000 }],
        }),
      ).rejects.toThrow('Make and model are required');
    });

    it('rejects when model is missing', async () => {
      await expect(
        service.createOrUpdateTemplate({
          make: 'Toyota',
          model: '',
          items: [{ serviceType: 'oil-change', intervalKm: 10000 }],
        }),
      ).rejects.toThrow('Make and model are required');
    });
  });

  // ─── Schedule Computation ────────────────────────────────────────

  describe('getSchedule', () => {
    it('returns schedule from template-based intervals', async () => {
      mockPrisma.vehicleRecord.findUnique.mockResolvedValue({
        id: 'vr-1',
        make: 'Honda',
        model: 'Civic',
        latestOdometerKm: 45000,
      });

      mockPrisma.maintenanceTemplate.findMany.mockResolvedValue([
        {
          id: 'tmpl-1',
          tenantId: 'tenant-1',
          make: 'Honda',
          model: 'Civic',
          items: [
            { serviceType: 'oil-change', intervalKm: 10000, intervalMonths: 6 },
            { serviceType: 'brake-inspection', intervalMonths: 12 },
          ],
        },
      ]);

      const lastOilChange = new Date();
      lastOilChange.setMonth(lastOilChange.getMonth() - 4); // 4 months ago

      mockPrisma.serviceEvent.findMany.mockResolvedValue([
        {
          id: 'se-1',
          serviceType: 'oil-change',
          completedAt: lastOilChange,
          odometerKm: 40000,
          totalCostPaise: 250000,
        },
      ]);

      mockPrisma.maintenanceScheduleEntry.findMany.mockResolvedValue([]);

      const schedule = await service.getSchedule('vr-1');

      expect(schedule).toHaveLength(2);

      // Oil change: due at 50000km (40000 + 10000), 2 months from now
      const oilChange = schedule.find((s) => s.serviceType === 'oil-change');
      expect(oilChange).toBeDefined();
      expect(oilChange!.dueOdometerKm).toBe(50000);
      expect(oilChange!.estimatedCostPaise).toBe(250000);
      expect(oilChange!.urgency).toBe('UPCOMING'); // 5000km away (45000 → 50000), not within 500km threshold

      // Brake inspection: no history, so estimated cost is null
      const brakeInspection = schedule.find((s) => s.serviceType === 'brake-inspection');
      expect(brakeInspection).toBeDefined();
      expect(brakeInspection!.estimatedCostPaise).toBeNull();
    });

    it('returns estimated cost as null when no prior service event exists (Req 9.6)', async () => {
      mockPrisma.vehicleRecord.findUnique.mockResolvedValue({
        id: 'vr-1',
        make: 'Honda',
        model: 'Civic',
        latestOdometerKm: 10000,
      });

      mockPrisma.maintenanceTemplate.findMany.mockResolvedValue([
        {
          id: 'tmpl-1',
          tenantId: 'tenant-1',
          make: 'Honda',
          model: 'Civic',
          items: [{ serviceType: 'timing-belt', intervalKm: 100000 }],
        },
      ]);

      mockPrisma.serviceEvent.findMany.mockResolvedValue([]);
      mockPrisma.maintenanceScheduleEntry.findMany.mockResolvedValue([]);

      const schedule = await service.getSchedule('vr-1');

      expect(schedule).toHaveLength(1);
      expect(schedule[0].serviceType).toBe('timing-belt');
      expect(schedule[0].estimatedCostPaise).toBeNull(); // "unavailable"
    });

    it('throws when vehicle not found', async () => {
      mockPrisma.vehicleRecord.findUnique.mockResolvedValue(null);

      await expect(service.getSchedule('vr-nonexistent')).rejects.toThrow('Vehicle not found');
    });

    it('returns OVERDUE urgency for entries past due date', async () => {
      mockPrisma.vehicleRecord.findUnique.mockResolvedValue({
        id: 'vr-1',
        make: 'Honda',
        model: 'Civic',
        latestOdometerKm: 80000,
      });

      const twoMonthsAgo = new Date();
      twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2);

      mockPrisma.maintenanceTemplate.findMany.mockResolvedValue([
        {
          id: 'tmpl-1',
          items: [{ serviceType: 'oil-change', intervalKm: 10000, intervalMonths: 6 }],
        },
      ]);

      // Last service was 8 months ago, so due was 2 months ago
      const eightMonthsAgo = new Date();
      eightMonthsAgo.setMonth(eightMonthsAgo.getMonth() - 8);

      mockPrisma.serviceEvent.findMany.mockResolvedValue([
        {
          id: 'se-1',
          serviceType: 'oil-change',
          completedAt: eightMonthsAgo,
          odometerKm: 70000,
          totalCostPaise: 300000,
        },
      ]);

      mockPrisma.maintenanceScheduleEntry.findMany.mockResolvedValue([]);

      const schedule = await service.getSchedule('vr-1');
      const oilChange = schedule.find((s) => s.serviceType === 'oil-change');

      expect(oilChange!.urgency).toBe('OVERDUE');
    });
  });

  // ─── Event Handler: Service Event Created ────────────────────────

  describe('handleServiceEventCreated', () => {
    it('marks matching schedule entry as completed and creates next entry', async () => {
      const event = {
        eventId: 'evt-1',
        eventType: 'service-event.created' as const,
        sourceEntity: 'ServiceEvent',
        sourceId: 'se-1',
        occurredAt: new Date().toISOString(),
        data: {
          serviceEventId: 'se-1',
          vehicleRecordId: 'vr-1',
          tenantId: 'tenant-1',
          category: 'ROUTINE_MAINTENANCE',
          serviceType: 'oil-change',
          odometerKm: 50000,
          completedAt: new Date().toISOString(),
        },
      };

      mockPrisma.maintenanceScheduleEntry.findMany.mockResolvedValue([
        {
          id: 'mse-1',
          vehicleRecordId: 'vr-1',
          serviceType: 'oil-change',
          dueDate: new Date(),
          dueOdometerKm: 50000,
          completed: false,
        },
      ]);

      mockPrisma.maintenanceScheduleEntry.update.mockResolvedValue({});

      mockPrisma.vehicleRecord.findUnique.mockResolvedValue({
        make: 'Honda',
        model: 'Civic',
      });

      mockPrisma.maintenanceTemplate.findMany.mockResolvedValue([
        {
          id: 'tmpl-1',
          items: [{ serviceType: 'oil-change', intervalKm: 10000, intervalMonths: 6 }],
        },
      ]);

      mockPrisma.maintenanceScheduleEntry.create.mockResolvedValue({});

      await service.handleServiceEventCreated(event);

      // Verify the existing entry was marked complete
      expect(mockPrisma.maintenanceScheduleEntry.update).toHaveBeenCalledWith({
        where: { id: 'mse-1' },
        data: {
          completed: true,
          completedAt: expect.any(Date),
        },
      });

      // Verify a new entry was created
      expect(mockPrisma.maintenanceScheduleEntry.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          vehicleRecordId: 'vr-1',
          serviceType: 'oil-change',
          dueOdometerKm: 60000, // 50000 + 10000
          urgency: 'UPCOMING',
          completed: false,
        }),
      });
    });

    it('does nothing when no matching schedule entry exists', async () => {
      const event = {
        eventId: 'evt-2',
        eventType: 'service-event.created' as const,
        sourceEntity: 'ServiceEvent',
        sourceId: 'se-2',
        occurredAt: new Date().toISOString(),
        data: {
          serviceEventId: 'se-2',
          vehicleRecordId: 'vr-1',
          tenantId: 'tenant-1',
          category: 'REPAIR',
          serviceType: 'windshield-repair',
          odometerKm: 50000,
          completedAt: new Date().toISOString(),
        },
      };

      mockPrisma.maintenanceScheduleEntry.findMany.mockResolvedValue([]);

      await service.handleServiceEventCreated(event);

      expect(mockPrisma.maintenanceScheduleEntry.update).not.toHaveBeenCalled();
      expect(mockPrisma.maintenanceScheduleEntry.create).not.toHaveBeenCalled();
    });
  });

  // ─── Reminders ───────────────────────────────────────────────────

  describe('checkAndSendReminders', () => {
    it('publishes DUE_SOON event for entries due within 7 days', async () => {
      const in3Days = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);

      mockPrisma.maintenanceScheduleEntry.findMany
        .mockResolvedValueOnce([
          // due soon (time-based query)
          {
            id: 'mse-1',
            vehicleRecordId: 'vr-1',
            serviceType: 'oil-change',
            dueDate: in3Days,
            dueOdometerKm: null,
            vehicleRecord: { id: 'vr-1', make: 'Honda', model: 'Civic', latestOdometerKm: 45000 },
          },
        ])
        .mockResolvedValueOnce([]) // overdue (time-based)
        .mockResolvedValueOnce([]); // distance-based

      await service.checkAndSendReminders();

      expect(mockEventsService.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: EventTypes.MAINTENANCE_DUE_SOON,
          sourceEntity: 'MaintenanceScheduleEntry',
          sourceId: 'mse-1',
        }),
      );
    });

    it('publishes OVERDUE event for entries past due date', async () => {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);

      mockPrisma.maintenanceScheduleEntry.findMany
        .mockResolvedValueOnce([]) // due soon
        .mockResolvedValueOnce([
          // overdue
          {
            id: 'mse-2',
            vehicleRecordId: 'vr-1',
            serviceType: 'brake-check',
            dueDate: yesterday,
            dueOdometerKm: null,
            vehicleRecord: { id: 'vr-1', make: 'Honda', model: 'Civic', latestOdometerKm: 45000 },
          },
        ])
        .mockResolvedValueOnce([]); // distance-based

      await service.checkAndSendReminders();

      expect(mockEventsService.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: EventTypes.MAINTENANCE_OVERDUE,
          sourceId: 'mse-2',
        }),
      );
    });

    it('publishes DUE_SOON event for entries within 500km of odometer trigger', async () => {
      mockPrisma.maintenanceScheduleEntry.findMany
        .mockResolvedValueOnce([]) // due soon time
        .mockResolvedValueOnce([]) // overdue time
        .mockResolvedValueOnce([
          // distance-based
          {
            id: 'mse-3',
            vehicleRecordId: 'vr-1',
            serviceType: 'transmission-fluid',
            dueDate: null,
            dueOdometerKm: 50000,
            vehicleRecord: { id: 'vr-1', latestOdometerKm: 49700 }, // 300km remaining
          },
        ]);

      await service.checkAndSendReminders();

      expect(mockEventsService.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: EventTypes.MAINTENANCE_DUE_SOON,
          sourceId: 'mse-3',
          payload: expect.objectContaining({
            kmRemaining: 300,
          }),
        }),
      );
    });

    it('publishes OVERDUE event for entries where odometer exceeds trigger', async () => {
      mockPrisma.maintenanceScheduleEntry.findMany
        .mockResolvedValueOnce([]) // due soon time
        .mockResolvedValueOnce([]) // overdue time
        .mockResolvedValueOnce([
          // distance-based
          {
            id: 'mse-4',
            vehicleRecordId: 'vr-1',
            serviceType: 'spark-plugs',
            dueDate: null,
            dueOdometerKm: 50000,
            vehicleRecord: { id: 'vr-1', latestOdometerKm: 51000 }, // 1000km past
          },
        ]);

      await service.checkAndSendReminders();

      expect(mockEventsService.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: EventTypes.MAINTENANCE_OVERDUE,
          sourceId: 'mse-4',
        }),
      );
    });
  });

  // ─── Template Listing ────────────────────────────────────────────

  describe('listTemplates', () => {
    it('lists templates for current tenant', async () => {
      mockPrisma.maintenanceTemplate.findMany.mockResolvedValue([
        { id: 'tmpl-1', tenantId: 'tenant-1', make: 'Honda', model: 'Civic', items: [] },
        { id: 'tmpl-2', tenantId: 'tenant-1', make: 'Toyota', model: 'Camry', items: [] },
      ]);

      const result = await service.listTemplates();
      expect(result).toHaveLength(2);
      expect(mockPrisma.maintenanceTemplate.findMany).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-1' },
        orderBy: [{ make: 'asc' }, { model: 'asc' }],
      });
    });

    it('throws when no tenant context', async () => {
      mockTenantContext.tenantId = null;
      service = new MaintenanceService(mockPrisma, mockTenantContext, mockEventsService);

      await expect(service.listTemplates()).rejects.toThrow('Tenant context is required');
    });
  });
});
