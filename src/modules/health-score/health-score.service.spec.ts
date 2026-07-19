import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HealthScoreService, type SubScores } from './health-score.service';
import { EventTypes } from '../events/event-types';

describe('HealthScoreService', () => {
  let service: HealthScoreService;
  let mockPrisma: any;
  let mockEventsService: any;

  beforeEach(() => {
    mockPrisma = {
      vehicleRecord: {
        findUnique: vi.fn(),
      },
      serviceEvent: {
        findMany: vi.fn(),
      },
      healthScore: {
        findUnique: vi.fn(),
        findMany: vi.fn(),
        upsert: vi.fn(),
      },
      ownershipRecord: {
        findFirst: vi.fn(),
      },
    };

    mockEventsService = {
      publish: vi.fn().mockResolvedValue('event-1'),
      processWithIdempotency: vi.fn().mockImplementation(
        async (_eventId: string, _consumer: string, handler: () => Promise<void>) => {
          await handler();
          return true;
        },
      ),
    };

    service = new HealthScoreService(mockPrisma, mockEventsService);
  });

  // ─── Scoring Algorithm: Vehicle Age ──────────────────────────────

  describe('computeVehicleAgeScore', () => {
    it('returns 100 for a brand new vehicle (current year)', () => {
      const currentYear = new Date().getFullYear();
      expect(service.computeVehicleAgeScore(currentYear)).toBe(100);
    });

    it('returns 100 for a vehicle from next year', () => {
      const nextYear = new Date().getFullYear() + 1;
      expect(service.computeVehicleAgeScore(nextYear)).toBe(100);
    });

    it('returns 20 for a vehicle 20+ years old', () => {
      const currentYear = new Date().getFullYear();
      expect(service.computeVehicleAgeScore(currentYear - 20)).toBe(20);
      expect(service.computeVehicleAgeScore(currentYear - 30)).toBe(20);
    });

    it('degrades linearly for vehicles between 0 and 20 years', () => {
      const currentYear = new Date().getFullYear();
      // 10 years: 100 - (10/20) * 80 = 100 - 40 = 60
      expect(service.computeVehicleAgeScore(currentYear - 10)).toBe(60);
      // 5 years: 100 - (5/20) * 80 = 100 - 20 = 80
      expect(service.computeVehicleAgeScore(currentYear - 5)).toBe(80);
    });
  });

  // ─── Scoring Algorithm: Time Since Service ───────────────────────

  describe('computeTimeSinceServiceScore', () => {
    it('returns 100 when service was today', () => {
      const events = [{ completedAt: new Date() }];
      expect(service.computeTimeSinceServiceScore(events)).toBe(100);
    });

    it('returns 0 when service was 365+ days ago', () => {
      const longAgo = new Date();
      longAgo.setDate(longAgo.getDate() - 400);
      const events = [{ completedAt: longAgo }];
      expect(service.computeTimeSinceServiceScore(events)).toBe(0);
    });

    it('returns DEFAULT_SUB_SCORE (50) when no service events', () => {
      expect(service.computeTimeSinceServiceScore([])).toBe(50);
    });

    it('degrades linearly between 0 and 365 days', () => {
      // ~182 days => 100 - (182/365)*100 ≈ 50
      const halfYear = new Date();
      halfYear.setDate(halfYear.getDate() - 182);
      const events = [{ completedAt: halfYear }];
      const score = service.computeTimeSinceServiceScore(events);
      expect(score).toBeGreaterThanOrEqual(48);
      expect(score).toBeLessThanOrEqual(52);
    });
  });

  // ─── Scoring Algorithm: Service Count ────────────────────────────

  describe('computeServiceCountScore', () => {
    it('returns 0 for 0 services', () => {
      expect(service.computeServiceCountScore(0)).toBe(0);
    });

    it('returns 100 for 10+ services', () => {
      expect(service.computeServiceCountScore(10)).toBe(100);
      expect(service.computeServiceCountScore(20)).toBe(100);
    });

    it('returns 50 for 5 services', () => {
      expect(service.computeServiceCountScore(5)).toBe(50);
    });

    it('returns linear interpolation for values between 0 and 10', () => {
      expect(service.computeServiceCountScore(3)).toBe(30);
      expect(service.computeServiceCountScore(7)).toBe(70);
    });
  });

  // ─── Scoring Algorithm: Maintenance Compliance ───────────────────

  describe('computeMaintenanceComplianceScore', () => {
    it('returns 100 when all services are routine maintenance', () => {
      const events = [
        { category: 'ROUTINE_MAINTENANCE' },
        { category: 'ROUTINE_MAINTENANCE' },
        { category: 'ROUTINE_MAINTENANCE' },
      ];
      expect(service.computeMaintenanceComplianceScore(events)).toBe(100);
    });

    it('returns 0 when no services are routine maintenance', () => {
      const events = [
        { category: 'REPAIR' },
        { category: 'ACCIDENT_REPAIR' },
      ];
      expect(service.computeMaintenanceComplianceScore(events)).toBe(0);
    });

    it('returns 50 when half are routine maintenance', () => {
      const events = [
        { category: 'ROUTINE_MAINTENANCE' },
        { category: 'REPAIR' },
      ];
      expect(service.computeMaintenanceComplianceScore(events)).toBe(50);
    });

    it('returns DEFAULT_SUB_SCORE (50) when no events', () => {
      expect(service.computeMaintenanceComplianceScore([])).toBe(50);
    });
  });

  // ─── Scoring Algorithm: Unresolved Issues ────────────────────────

  describe('computeUnresolvedIssuesScore', () => {
    it('returns 100 when no issues (all routine/inspection/modification)', () => {
      const events = [
        { category: 'ROUTINE_MAINTENANCE' },
        { category: 'INSPECTION' },
        { category: 'MODIFICATION' },
      ];
      expect(service.computeUnresolvedIssuesScore(events)).toBe(100);
    });

    it('subtracts 20 per repair/accident event', () => {
      const events = [
        { category: 'REPAIR' },
        { category: 'ROUTINE_MAINTENANCE' },
      ];
      // 1 issue: 100 - 20 = 80
      expect(service.computeUnresolvedIssuesScore(events)).toBe(80);
    });

    it('returns 0 when 5+ issues exist', () => {
      const events = [
        { category: 'REPAIR' },
        { category: 'REPAIR' },
        { category: 'REPAIR' },
        { category: 'ACCIDENT_REPAIR' },
        { category: 'ACCIDENT_REPAIR' },
      ];
      // 5 issues: 100 - 100 = 0
      expect(service.computeUnresolvedIssuesScore(events)).toBe(0);
    });

    it('never goes below 0', () => {
      const events = Array.from({ length: 10 }, () => ({ category: 'REPAIR' }));
      // 10 issues: 100 - 200 clamped to 0
      expect(service.computeUnresolvedIssuesScore(events)).toBe(0);
    });
  });

  // ─── Final Score Computation ─────────────────────────────────────

  describe('computeFinalScore', () => {
    it('returns weighted average of sub-scores', () => {
      const subScores: SubScores = {
        maintenanceCompliance: 80, // 80 * 0.25 = 20
        timeSinceService: 60,      // 60 * 0.25 = 15
        vehicleAge: 100,           // 100 * 0.15 = 15
        serviceCount: 40,          // 40 * 0.15 = 6
        unresolvedIssues: 100,     // 100 * 0.20 = 20
      };
      // Total = 20 + 15 + 15 + 6 + 20 = 76
      expect(service.computeFinalScore(subScores)).toBe(76);
    });

    it('returns 100 when all sub-scores are 100', () => {
      const subScores: SubScores = {
        maintenanceCompliance: 100,
        timeSinceService: 100,
        vehicleAge: 100,
        serviceCount: 100,
        unresolvedIssues: 100,
      };
      expect(service.computeFinalScore(subScores)).toBe(100);
    });

    it('returns 0 when all sub-scores are 0', () => {
      const subScores: SubScores = {
        maintenanceCompliance: 0,
        timeSinceService: 0,
        vehicleAge: 0,
        serviceCount: 0,
        unresolvedIssues: 0,
      };
      expect(service.computeFinalScore(subScores)).toBe(0);
    });

    it('clamps result to maximum 100', () => {
      // Shouldn't happen with normal sub-scores, but test the clamp
      const subScores: SubScores = {
        maintenanceCompliance: 150,
        timeSinceService: 150,
        vehicleAge: 150,
        serviceCount: 150,
        unresolvedIssues: 150,
      };
      expect(service.computeFinalScore(subScores)).toBe(100);
    });

    it('clamps result to minimum 0', () => {
      const subScores: SubScores = {
        maintenanceCompliance: -50,
        timeSinceService: -50,
        vehicleAge: -50,
        serviceCount: -50,
        unresolvedIssues: -50,
      };
      expect(service.computeFinalScore(subScores)).toBe(0);
    });
  });

  // ─── Sub-Scores with No Service Events ───────────────────────────

  describe('computeSubScores', () => {
    it('defaults service-dependent sub-scores to 50 when no service events', () => {
      const currentYear = new Date().getFullYear();
      const vehicle = { year: currentYear - 5 };
      const result = service.computeSubScores(vehicle, []);

      expect(result.maintenanceCompliance).toBe(50);
      expect(result.timeSinceService).toBe(50);
      expect(result.serviceCount).toBe(50);
      expect(result.unresolvedIssues).toBe(50);
      // Vehicle age is still calculated normally
      expect(result.vehicleAge).toBe(80); // 100 - (5/20)*80 = 80
    });

    it('computes all sub-scores when service events exist', () => {
      const currentYear = new Date().getFullYear();
      const vehicle = { year: currentYear - 2 };
      const serviceEvents = [
        { completedAt: new Date(), category: 'ROUTINE_MAINTENANCE' },
        { completedAt: new Date(), category: 'REPAIR' },
      ];

      const result = service.computeSubScores(vehicle, serviceEvents);

      // Has real values, not defaults
      expect(result.maintenanceCompliance).toBe(50); // 1/2 routine
      expect(result.timeSinceService).toBe(100); // today
      expect(result.vehicleAge).toBe(92); // 100 - (2/20)*80 = 92
      expect(result.serviceCount).toBe(20); // 2/10 * 100 = 20
      expect(result.unresolvedIssues).toBe(80); // 1 repair: 100 - 20 = 80
    });
  });

  // ─── Recalculation ───────────────────────────────────────────────

  describe('recalculate', () => {
    it('computes and persists health score', async () => {
      const currentYear = new Date().getFullYear();
      mockPrisma.vehicleRecord.findUnique.mockResolvedValue({
        id: 'vr-1',
        year: currentYear - 3,
      });
      mockPrisma.serviceEvent.findMany.mockResolvedValue([
        { completedAt: new Date(), category: 'ROUTINE_MAINTENANCE' },
      ]);
      mockPrisma.healthScore.findUnique.mockResolvedValue(null);
      mockPrisma.healthScore.upsert.mockResolvedValue({});

      await service.recalculate('vr-1');

      expect(mockPrisma.healthScore.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { vehicleRecordId: 'vr-1' },
        }),
      );
    });

    it('skips recalculation for non-existent vehicle', async () => {
      mockPrisma.vehicleRecord.findUnique.mockResolvedValue(null);

      await service.recalculate('non-existent');

      expect(mockPrisma.healthScore.upsert).not.toHaveBeenCalled();
    });

    it('publishes alert when score crosses below 50', async () => {
      const currentYear = new Date().getFullYear();
      mockPrisma.vehicleRecord.findUnique.mockResolvedValue({
        id: 'vr-1',
        year: currentYear - 18,
      });
      // Many repair events, old service — will produce a low score
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 350);
      mockPrisma.serviceEvent.findMany.mockResolvedValue([
        { completedAt: oldDate, category: 'REPAIR' },
        { completedAt: oldDate, category: 'REPAIR' },
        { completedAt: oldDate, category: 'REPAIR' },
        { completedAt: oldDate, category: 'ACCIDENT_REPAIR' },
        { completedAt: oldDate, category: 'ACCIDENT_REPAIR' },
      ]);
      // Previous score was above 50
      mockPrisma.healthScore.findUnique.mockResolvedValue({
        vehicleRecordId: 'vr-1',
        score: 65,
      });
      mockPrisma.healthScore.upsert.mockResolvedValue({});
      mockPrisma.ownershipRecord.findFirst.mockResolvedValue({
        userId: 'user-1',
      });

      await service.recalculate('vr-1');

      expect(mockEventsService.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: EventTypes.HEALTH_SCORE_ALERT,
          sourceEntity: 'HealthScore',
          sourceId: 'vr-1',
          payload: expect.objectContaining({
            vehicleRecordId: 'vr-1',
            userId: 'user-1',
          }),
        }),
      );
    });

    it('does not publish alert when score stays below 50 (no new crossing)', async () => {
      const currentYear = new Date().getFullYear();
      mockPrisma.vehicleRecord.findUnique.mockResolvedValue({
        id: 'vr-1',
        year: currentYear - 18,
      });
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 350);
      mockPrisma.serviceEvent.findMany.mockResolvedValue([
        { completedAt: oldDate, category: 'REPAIR' },
        { completedAt: oldDate, category: 'REPAIR' },
        { completedAt: oldDate, category: 'REPAIR' },
      ]);
      // Previous score was already below 50
      mockPrisma.healthScore.findUnique.mockResolvedValue({
        vehicleRecordId: 'vr-1',
        score: 30,
      });
      mockPrisma.healthScore.upsert.mockResolvedValue({});

      await service.recalculate('vr-1');

      expect(mockEventsService.publish).not.toHaveBeenCalled();
    });

    it('does not publish alert when score stays above 50', async () => {
      const currentYear = new Date().getFullYear();
      mockPrisma.vehicleRecord.findUnique.mockResolvedValue({
        id: 'vr-1',
        year: currentYear - 2,
      });
      mockPrisma.serviceEvent.findMany.mockResolvedValue([
        { completedAt: new Date(), category: 'ROUTINE_MAINTENANCE' },
        { completedAt: new Date(), category: 'ROUTINE_MAINTENANCE' },
      ]);
      // Previous score was above 50
      mockPrisma.healthScore.findUnique.mockResolvedValue({
        vehicleRecordId: 'vr-1',
        score: 75,
      });
      mockPrisma.healthScore.upsert.mockResolvedValue({});

      await service.recalculate('vr-1');

      expect(mockEventsService.publish).not.toHaveBeenCalled();
    });
  });

  // ─── Event Handler ───────────────────────────────────────────────

  describe('handleServiceEventCreated', () => {
    it('recalculates health score on service event', async () => {
      const currentYear = new Date().getFullYear();
      mockPrisma.vehicleRecord.findUnique.mockResolvedValue({
        id: 'vr-1',
        year: currentYear,
      });
      mockPrisma.serviceEvent.findMany.mockResolvedValue([
        { completedAt: new Date(), category: 'ROUTINE_MAINTENANCE' },
      ]);
      mockPrisma.healthScore.findUnique.mockResolvedValue(null);
      mockPrisma.healthScore.upsert.mockResolvedValue({});

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
          serviceType: 'Oil Change',
          odometerKm: 50000,
          completedAt: new Date().toISOString(),
        },
      };

      await service.handleServiceEventCreated(event);

      expect(mockPrisma.healthScore.upsert).toHaveBeenCalled();
    });
  });

  // ─── Get Health Score ────────────────────────────────────────────

  describe('getHealthScore', () => {
    it('returns null when no score exists', async () => {
      mockPrisma.healthScore.findUnique.mockResolvedValue(null);

      const result = await service.getHealthScore('vr-1');
      expect(result).toBeNull();
    });

    it('returns score with breakdown when score exists', async () => {
      const calculatedAt = new Date();
      mockPrisma.healthScore.findUnique.mockResolvedValue({
        vehicleRecordId: 'vr-1',
        score: 76,
        maintenanceCompliance: 80,
        timeSinceService: 60,
        vehicleAge: 100,
        serviceCount: 40,
        unresolvedIssues: 100,
        calculatedAt,
      });

      const result = await service.getHealthScore('vr-1');

      expect(result).not.toBeNull();
      expect(result!.score).toBe(76);
      expect(result!.breakdown.maintenanceCompliance.subScore).toBe(80);
      expect(result!.breakdown.timeSinceService.subScore).toBe(60);
      expect(result!.breakdown.vehicleAge.subScore).toBe(100);
      expect(result!.breakdown.serviceCount.subScore).toBe(40);
      expect(result!.breakdown.unresolvedIssues.subScore).toBe(100);
      expect(result!.calculatedAt).toBe(calculatedAt);
    });
  });

  // ─── Daily Recalculation ─────────────────────────────────────────

  describe('handleDailyRecalculation', () => {
    it('recalculates all existing health scores', async () => {
      mockPrisma.healthScore.findMany.mockResolvedValue([
        { vehicleRecordId: 'vr-1' },
        { vehicleRecordId: 'vr-2' },
      ]);

      const currentYear = new Date().getFullYear();
      mockPrisma.vehicleRecord.findUnique.mockResolvedValue({
        id: 'vr-1',
        year: currentYear,
      });
      mockPrisma.serviceEvent.findMany.mockResolvedValue([]);
      mockPrisma.healthScore.findUnique.mockResolvedValue(null);
      mockPrisma.healthScore.upsert.mockResolvedValue({});

      await service.handleDailyRecalculation();

      // Called twice for two vehicles
      expect(mockPrisma.vehicleRecord.findUnique).toHaveBeenCalledTimes(2);
    });
  });
});
