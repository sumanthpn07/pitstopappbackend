import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { EventsService } from '../events/events.service';
import {
  EventTypes,
  type OutboxEventPayload,
  type ServiceEventCreatedPayload,
} from '../events/event-types';

/** Sub-score weights (must sum to 1.0) */
const WEIGHTS = {
  maintenanceCompliance: 0.25,
  timeSinceService: 0.25,
  vehicleAge: 0.15,
  serviceCount: 0.15,
  unresolvedIssues: 0.2,
} as const;

/** Default sub-score for vehicles with no service history */
const DEFAULT_SUB_SCORE = 50;

/** Threshold below which a health score alert is triggered */
const ALERT_THRESHOLD = 50;

/** Retry delay in ms for failed recalculations */
const RETRY_DELAY_MS = 5 * 60 * 1000; // 5 minutes

@Injectable()
export class HealthScoreService {
  private readonly logger = new Logger(HealthScoreService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventsService: EventsService,
  ) {}

  // ─── Public API ──────────────────────────────────────────────────

  /**
   * Get the health score with breakdown for a vehicle.
   * Returns null if no score has been computed yet.
   */
  async getHealthScore(vehicleRecordId: string) {
    const healthScore = await this.prisma.healthScore.findUnique({
      where: { vehicleRecordId },
    });

    if (!healthScore) {
      return null;
    }

    return {
      score: healthScore.score,
      breakdown: {
        maintenanceCompliance: {
          subScore: healthScore.maintenanceCompliance,
          weight: WEIGHTS.maintenanceCompliance,
          contribution: Math.round(healthScore.maintenanceCompliance * WEIGHTS.maintenanceCompliance),
        },
        timeSinceService: {
          subScore: healthScore.timeSinceService,
          weight: WEIGHTS.timeSinceService,
          contribution: Math.round(healthScore.timeSinceService * WEIGHTS.timeSinceService),
        },
        vehicleAge: {
          subScore: healthScore.vehicleAge,
          weight: WEIGHTS.vehicleAge,
          contribution: Math.round(healthScore.vehicleAge * WEIGHTS.vehicleAge),
        },
        serviceCount: {
          subScore: healthScore.serviceCount,
          weight: WEIGHTS.serviceCount,
          contribution: Math.round(healthScore.serviceCount * WEIGHTS.serviceCount),
        },
        unresolvedIssues: {
          subScore: healthScore.unresolvedIssues,
          weight: WEIGHTS.unresolvedIssues,
          contribution: Math.round(healthScore.unresolvedIssues * WEIGHTS.unresolvedIssues),
        },
      },
      calculatedAt: healthScore.calculatedAt,
    };
  }

  /**
   * Recalculate and persist the health score for a vehicle.
   * On failure, retains previous score and schedules retry.
   */
  async recalculate(vehicleRecordId: string): Promise<void> {
    try {
      const vehicle = await this.prisma.vehicleRecord.findUnique({
        where: { id: vehicleRecordId },
      });

      if (!vehicle) {
        this.logger.warn(`Vehicle record ${vehicleRecordId} not found, skipping health score calculation`);
        return;
      }

      const serviceEvents = await this.prisma.serviceEvent.findMany({
        where: { vehicleRecordId },
        orderBy: { completedAt: 'desc' },
      });

      const subScores = this.computeSubScores(vehicle, serviceEvents);
      const score = this.computeFinalScore(subScores);

      // Get previous score for threshold comparison
      const previousScore = await this.prisma.healthScore.findUnique({
        where: { vehicleRecordId },
      });

      const now = new Date();

      // Upsert the health score
      await this.prisma.healthScore.upsert({
        where: { vehicleRecordId },
        create: {
          vehicleRecordId,
          score,
          maintenanceCompliance: subScores.maintenanceCompliance,
          timeSinceService: subScores.timeSinceService,
          vehicleAge: subScores.vehicleAge,
          serviceCount: subScores.serviceCount,
          unresolvedIssues: subScores.unresolvedIssues,
          calculatedAt: now,
        },
        update: {
          score,
          maintenanceCompliance: subScores.maintenanceCompliance,
          timeSinceService: subScores.timeSinceService,
          vehicleAge: subScores.vehicleAge,
          serviceCount: subScores.serviceCount,
          unresolvedIssues: subScores.unresolvedIssues,
          calculatedAt: now,
        },
      });

      // Check if score crossed below threshold (was >= 50, now < 50)
      const prevScoreValue = previousScore?.score ?? 100;
      if (prevScoreValue >= ALERT_THRESHOLD && score < ALERT_THRESHOLD) {
        await this.publishHealthScoreAlert(vehicleRecordId, prevScoreValue, score);
      }

      this.logger.debug(
        `Health score recalculated for vehicle ${vehicleRecordId}: ${score}`,
      );
    } catch (error) {
      this.logger.error(
        `Health score recalculation failed for vehicle ${vehicleRecordId}: ${error}`,
      );
      // Retain previous score, schedule retry in 5 minutes
      this.scheduleRetry(vehicleRecordId);
    }
  }

  // ─── Scoring Algorithm ───────────────────────────────────────────

  /**
   * Compute all sub-scores for a vehicle.
   * If the vehicle has no service events, default service-dependent scores to 50.
   */
  computeSubScores(
    vehicle: { year: number },
    serviceEvents: Array<{ completedAt: Date; category: string }>,
  ): SubScores {
    const vehicleAgeScore = this.computeVehicleAgeScore(vehicle.year);

    if (serviceEvents.length < 1) {
      // Default service-dependent sub-scores to 50
      return {
        maintenanceCompliance: DEFAULT_SUB_SCORE,
        timeSinceService: DEFAULT_SUB_SCORE,
        vehicleAge: vehicleAgeScore,
        serviceCount: DEFAULT_SUB_SCORE,
        unresolvedIssues: DEFAULT_SUB_SCORE,
      };
    }

    return {
      maintenanceCompliance: this.computeMaintenanceComplianceScore(serviceEvents),
      timeSinceService: this.computeTimeSinceServiceScore(serviceEvents),
      vehicleAge: vehicleAgeScore,
      serviceCount: this.computeServiceCountScore(serviceEvents.length),
      unresolvedIssues: this.computeUnresolvedIssuesScore(serviceEvents),
    };
  }

  /**
   * Compute the final score as a weighted average of sub-scores.
   * Result is clamped to [0, 100].
   */
  computeFinalScore(subScores: SubScores): number {
    const raw =
      subScores.maintenanceCompliance * WEIGHTS.maintenanceCompliance +
      subScores.timeSinceService * WEIGHTS.timeSinceService +
      subScores.vehicleAge * WEIGHTS.vehicleAge +
      subScores.serviceCount * WEIGHTS.serviceCount +
      subScores.unresolvedIssues * WEIGHTS.unresolvedIssues;

    return Math.round(Math.max(0, Math.min(100, raw)));
  }

  /**
   * Vehicle age sub-score: 0 years = 100, degrades linearly.
   * At 20+ years = 20 (never goes to 0).
   */
  computeVehicleAgeScore(year: number): number {
    const currentYear = new Date().getFullYear();
    const age = currentYear - year;

    if (age <= 0) return 100;
    if (age >= 20) return 20;

    // Linear degradation from 100 to 20 over 20 years
    // score = 100 - (age / 20) * 80
    return Math.round(100 - (age / 20) * 80);
  }

  /**
   * Time since last service sub-score: 0 days = 100, degrades linearly.
   * At 365+ days = 0.
   */
  computeTimeSinceServiceScore(serviceEvents: Array<{ completedAt: Date }>): number {
    if (serviceEvents.length === 0) return DEFAULT_SUB_SCORE;

    const mostRecent = serviceEvents[0]; // already sorted desc by completedAt
    const daysSince = Math.floor(
      (Date.now() - new Date(mostRecent.completedAt).getTime()) / (1000 * 60 * 60 * 24),
    );

    if (daysSince <= 0) return 100;
    if (daysSince >= 365) return 0;

    // Linear degradation: 100 at 0 days, 0 at 365 days
    return Math.round(100 - (daysSince / 365) * 100);
  }

  /**
   * Service count sub-score: 0 services = 0, 10+ services = 100.
   * Linear interpolation between.
   */
  computeServiceCountScore(count: number): number {
    if (count <= 0) return 0;
    if (count >= 10) return 100;

    return Math.round((count / 10) * 100);
  }

  /**
   * Maintenance compliance sub-score: percentage of routine maintenance services
   * performed. Higher ratio of routine maintenance = better compliance.
   * 100% = 100, 0% = 0.
   */
  computeMaintenanceComplianceScore(serviceEvents: Array<{ category: string }>): number {
    if (serviceEvents.length === 0) return DEFAULT_SUB_SCORE;

    const routineCount = serviceEvents.filter(
      (e) => e.category === 'ROUTINE_MAINTENANCE',
    ).length;

    // Compliance ratio: routine maintenance events as proportion of total
    // More routine maintenance relative to total = better compliance
    const ratio = routineCount / serviceEvents.length;
    return Math.round(ratio * 100);
  }

  /**
   * Unresolved issues sub-score: 0 issues = 100, each issue subtracts 20.
   * Minimum is 0.
   *
   * "Unresolved issues" are service events in the REPAIR or ACCIDENT_REPAIR
   * categories that were the most recent service (indicating the vehicle
   * may still have issues). For simplification, we count non-routine-maintenance
   * events in recent history as potential unresolved issues.
   *
   * Design specification: 0 issues = 100, each issue subtracts 20, minimum 0.
   */
  computeUnresolvedIssuesScore(serviceEvents: Array<{ category: string }>): number {
    // Count repair-category events as potential unresolved issues
    const issueCount = serviceEvents.filter(
      (e) => e.category === 'REPAIR' || e.category === 'ACCIDENT_REPAIR',
    ).length;

    const score = 100 - issueCount * 20;
    return Math.max(0, score);
  }

  // ─── Event Handlers ──────────────────────────────────────────────

  /**
   * Recalculate health score when a new service event is created.
   * Must complete within 60 seconds of event publication.
   */
  @OnEvent(EventTypes.SERVICE_EVENT_CREATED)
  async handleServiceEventCreated(
    event: OutboxEventPayload<ServiceEventCreatedPayload> & { eventId: string },
  ) {
    await this.eventsService.processWithIdempotency(
      event.eventId,
      'health-score.service-event-created',
      async () => {
        const { vehicleRecordId } = event.data;
        await this.recalculate(vehicleRecordId);
        this.logger.log(
          `Health score recalculated for vehicle ${vehicleRecordId} after service event`,
        );
      },
    );
  }

  /**
   * Daily scheduled recalculation at 3 AM for time-based degradation.
   * Recalculates all vehicles that have a health score.
   */
  @Cron('0 3 * * *')
  async handleDailyRecalculation(): Promise<void> {
    this.logger.log('Starting daily health score recalculation');

    const healthScores = await this.prisma.healthScore.findMany({
      select: { vehicleRecordId: true },
    });

    let processed = 0;
    let failed = 0;

    for (const hs of healthScores) {
      try {
        await this.recalculate(hs.vehicleRecordId);
        processed++;
      } catch {
        failed++;
      }
    }

    this.logger.log(
      `Daily health score recalculation complete: ${processed} processed, ${failed} failed`,
    );
  }

  // ─── Helpers ─────────────────────────────────────────────────────

  /**
   * Publish a health score alert event when score crosses below threshold.
   */
  private async publishHealthScoreAlert(
    vehicleRecordId: string,
    previousScore: number,
    newScore: number,
  ): Promise<void> {
    // Find the vehicle owner to notify
    const ownership = await this.prisma.ownershipRecord.findFirst({
      where: {
        vehicleRecordId,
        endDate: null,
        userId: { not: null },
      },
      orderBy: { startDate: 'desc' },
    });

    if (!ownership?.userId) {
      this.logger.warn(
        `No active owner found for vehicle ${vehicleRecordId}, skipping health score alert`,
      );
      return;
    }

    await this.eventsService.publish({
      eventType: EventTypes.HEALTH_SCORE_ALERT,
      sourceEntity: 'HealthScore',
      sourceId: vehicleRecordId,
      payload: {
        vehicleRecordId,
        userId: ownership.userId,
        previousScore,
        newScore,
      },
    });

    this.logger.log(
      `Health score alert published for vehicle ${vehicleRecordId}: ${previousScore} → ${newScore}`,
    );
  }

  /**
   * Schedule a retry of health score calculation in 5 minutes.
   */
  private scheduleRetry(vehicleRecordId: string): void {
    setTimeout(() => {
      void this.recalculate(vehicleRecordId);
    }, RETRY_DELAY_MS);
  }
}

// ─── Types ─────────────────────────────────────────────────────────

export interface SubScores {
  maintenanceCompliance: number;
  timeSinceService: number;
  vehicleAge: number;
  serviceCount: number;
  unresolvedIssues: number;
}
