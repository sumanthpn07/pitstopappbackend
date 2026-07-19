import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { MaintenanceUrgency } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantContext } from '../../common/providers/tenant-context.provider';
import { EventsService } from '../events/events.service';
import {
  EventTypes,
  type OutboxEventPayload,
  type ServiceEventCreatedPayload,
} from '../events/event-types';
import { ApiException } from '../../common/api-exception';
import type {
  CreateMaintenanceTemplateDto,
  MaintenanceScheduleItemResponse,
} from './dto';

/** Due-soon thresholds */
const DUE_SOON_DAYS = 7;
const DUE_SOON_KM = 500;

@Injectable()
export class MaintenanceService {
  private readonly logger = new Logger(MaintenanceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
    private readonly eventsService: EventsService,
  ) {}

  // ─── Templates ───────────────────────────────────────────────────

  /**
   * Create or update a maintenance template for a make/model.
   * Max 50 items per template (Req 9.4).
   */
  async createOrUpdateTemplate(dto: CreateMaintenanceTemplateDto) {
    const tenantId = this.requireTenant();

    if (!dto.make || !dto.model) {
      throw ApiException.validation('Make and model are required.');
    }

    if (!dto.items || dto.items.length === 0) {
      throw ApiException.validation('At least one maintenance item is required.');
    }

    if (dto.items.length > 50) {
      throw ApiException.validation('A maintenance template cannot exceed 50 items.');
    }

    // Validate each item has at least one interval
    for (const item of dto.items) {
      if (!item.serviceType) {
        throw ApiException.validation('Each maintenance item must have a serviceType.');
      }
      if (!item.intervalKm && !item.intervalMonths) {
        throw ApiException.validation(
          `Item "${item.serviceType}" must specify at least one interval (intervalKm or intervalMonths).`,
        );
      }
    }

    const template = await this.prisma.maintenanceTemplate.upsert({
      where: {
        tenantId_make_model: { tenantId, make: dto.make, model: dto.model },
      },
      create: {
        tenantId,
        make: dto.make,
        model: dto.model,
        items: dto.items as any,
      },
      update: {
        items: dto.items as any,
      },
    });

    return template;
  }

  /**
   * List all maintenance templates for the current tenant.
   */
  async listTemplates() {
    const tenantId = this.requireTenant();
    return this.prisma.maintenanceTemplate.findMany({
      where: { tenantId },
      orderBy: [{ make: 'asc' }, { model: 'asc' }],
    });
  }

  // ─── Schedule Computation ────────────────────────────────────────

  /**
   * Compute the maintenance schedule for a vehicle.
   * Combines template-based intervals, odometer triggers, time triggers,
   * and historical patterns.
   * (Req 9.1, 9.5, 9.6)
   */
  async getSchedule(vehicleId: string): Promise<MaintenanceScheduleItemResponse[]> {
    const vehicle = await this.prisma.vehicleRecord.findUnique({
      where: { id: vehicleId },
      select: {
        id: true,
        make: true,
        model: true,
        latestOdometerKm: true,
      },
    });

    if (!vehicle) {
      throw ApiException.notFound('Vehicle not found.');
    }

    // Find applicable templates (any tenant)
    const templates = await this.prisma.maintenanceTemplate.findMany({
      where: {
        make: vehicle.make,
        model: vehicle.model,
      },
    });

    // Get service history for the vehicle
    const serviceEvents = await this.prisma.serviceEvent.findMany({
      where: { vehicleRecordId: vehicleId },
      orderBy: { completedAt: 'desc' },
    });

    // Get existing schedule entries (not completed)
    const existingEntries = await this.prisma.maintenanceScheduleEntry.findMany({
      where: { vehicleRecordId: vehicleId, completed: false },
    });

    // Merge template items from all templates
    const templateItems = this.mergeTemplateItems(templates);

    // Compute schedule entries for each template item
    const scheduleItems: MaintenanceScheduleItemResponse[] = [];

    for (const item of templateItems) {
      const entry = this.computeScheduleEntry(
        vehicleId,
        item,
        serviceEvents,
        vehicle.latestOdometerKm,
        existingEntries,
      );
      scheduleItems.push(entry);
    }

    // Also include any existing non-completed entries that aren't covered by templates
    for (const existing of existingEntries) {
      const alreadyCovered = scheduleItems.some(
        (s) => s.serviceType === existing.serviceType,
      );
      if (!alreadyCovered) {
        scheduleItems.push({
          id: existing.id,
          serviceType: existing.serviceType,
          dueDate: existing.dueDate?.toISOString() ?? null,
          dueOdometerKm: existing.dueOdometerKm,
          estimatedCostPaise: existing.estimatedCostPaise,
          urgency: existing.urgency,
          completed: existing.completed,
          completedAt: existing.completedAt?.toISOString() ?? null,
        });
      }
    }

    return scheduleItems;
  }

  /**
   * Merge template items across all matching templates, deduplicating by serviceType.
   */
  private mergeTemplateItems(
    templates: Array<{ items: unknown }>,
  ): Array<{ serviceType: string; intervalKm?: number; intervalMonths?: number }> {
    const merged = new Map<string, { serviceType: string; intervalKm?: number; intervalMonths?: number }>();

    for (const template of templates) {
      const items = template.items as Array<{
        serviceType: string;
        intervalKm?: number;
        intervalMonths?: number;
      }>;
      for (const item of items) {
        // First template item wins for duplicates
        if (!merged.has(item.serviceType)) {
          merged.set(item.serviceType, item);
        }
      }
    }

    return Array.from(merged.values());
  }

  /**
   * Compute a single schedule entry for a service type.
   */
  private computeScheduleEntry(
    vehicleId: string,
    item: { serviceType: string; intervalKm?: number; intervalMonths?: number },
    serviceEvents: Array<{
      id: string;
      serviceType: string;
      completedAt: Date;
      odometerKm: number | null;
      totalCostPaise: number;
    }>,
    latestOdometerKm: number | null,
    existingEntries: Array<{
      id: string;
      serviceType: string;
      dueDate: Date | null;
      dueOdometerKm: number | null;
      estimatedCostPaise: number | null;
      urgency: MaintenanceUrgency;
      completed: boolean;
      completedAt: Date | null;
    }>,
  ): MaintenanceScheduleItemResponse {
    // Find the most recent service event of this type
    const lastService = serviceEvents.find((e) => e.serviceType === item.serviceType);

    // Find existing schedule entry for this service type
    const existingEntry = existingEntries.find((e) => e.serviceType === item.serviceType);

    // Calculate due date from time trigger
    let dueDate: Date | null = null;
    if (item.intervalMonths) {
      if (lastService) {
        dueDate = new Date(lastService.completedAt);
        dueDate.setMonth(dueDate.getMonth() + item.intervalMonths);
      } else {
        // Also consider historical patterns — use existing entry's dueDate if available
        dueDate = existingEntry?.dueDate ?? null;
      }
    }

    // Calculate due odometer from odometer trigger
    let dueOdometerKm: number | null = null;
    if (item.intervalKm) {
      if (lastService?.odometerKm != null) {
        dueOdometerKm = lastService.odometerKm + item.intervalKm;
      } else if (latestOdometerKm != null) {
        // If no service event with odometer but vehicle has a reading, use that
        dueOdometerKm = latestOdometerKm + item.intervalKm;
      } else {
        dueOdometerKm = existingEntry?.dueOdometerKm ?? null;
      }
    }

    // Estimated cost from most recent service event of same type (Req 9.5, 9.6)
    const estimatedCostPaise = lastService ? lastService.totalCostPaise : null;

    // Classify urgency (Req 9.5)
    const urgency = this.classifyUrgency(dueDate, dueOdometerKm, latestOdometerKm);

    const id = existingEntry?.id ?? '';

    return {
      id,
      serviceType: item.serviceType,
      dueDate: dueDate?.toISOString() ?? null,
      dueOdometerKm,
      estimatedCostPaise,
      urgency,
      completed: false,
      completedAt: null,
    };
  }

  /**
   * Classify urgency of a maintenance entry.
   * - OVERDUE: past due date OR past due odometer
   * - DUE_SOON: within 7 days OR within 500km of trigger
   * - UPCOMING: otherwise
   * (Req 9.5)
   */
  classifyUrgency(
    dueDate: Date | null,
    dueOdometerKm: number | null,
    currentOdometerKm: number | null,
  ): 'OVERDUE' | 'DUE_SOON' | 'UPCOMING' {
    const now = new Date();

    // Check overdue
    if (dueDate && dueDate <= now) {
      return 'OVERDUE';
    }
    if (dueOdometerKm != null && currentOdometerKm != null && currentOdometerKm >= dueOdometerKm) {
      return 'OVERDUE';
    }

    // Check due-soon (within 7 days or 500km)
    if (dueDate) {
      const diffMs = dueDate.getTime() - now.getTime();
      const diffDays = diffMs / (1000 * 60 * 60 * 24);
      if (diffDays <= DUE_SOON_DAYS) {
        return 'DUE_SOON';
      }
    }
    if (dueOdometerKm != null && currentOdometerKm != null) {
      const kmRemaining = dueOdometerKm - currentOdometerKm;
      if (kmRemaining <= DUE_SOON_KM) {
        return 'DUE_SOON';
      }
    }

    return 'UPCOMING';
  }

  // ─── Event Handler: Service Event Created ────────────────────────

  /**
   * When a ServiceEvent is created, check if it matches a scheduled maintenance entry.
   * If so, mark it complete and compute the next due date.
   * (Req 9.3)
   */
  @OnEvent(EventTypes.SERVICE_EVENT_CREATED)
  async handleServiceEventCreated(
    event: OutboxEventPayload<ServiceEventCreatedPayload> & { eventId: string },
  ) {
    await this.eventsService.processWithIdempotency(
      event.eventId,
      'maintenance.service-event-created',
      async () => {
        const { vehicleRecordId, serviceType, completedAt, odometerKm } = event.data;

        // Find matching uncompleted schedule entries
        const entries = await this.prisma.maintenanceScheduleEntry.findMany({
          where: {
            vehicleRecordId,
            serviceType,
            completed: false,
          },
        });

        if (entries.length === 0) {
          this.logger.debug(
            `No matching schedule entry for ${serviceType} on vehicle ${vehicleRecordId}`,
          );
          return;
        }

        // Mark the first matching entry as completed
        const entry = entries[0];
        await this.prisma.maintenanceScheduleEntry.update({
          where: { id: entry.id },
          data: {
            completed: true,
            completedAt: new Date(completedAt),
          },
        });

        // Find templates to compute next due date
        const vehicle = await this.prisma.vehicleRecord.findUnique({
          where: { id: vehicleRecordId },
          select: { make: true, model: true },
        });

        if (!vehicle) return;

        const templates = await this.prisma.maintenanceTemplate.findMany({
          where: { make: vehicle.make, model: vehicle.model },
        });

        // Find the template item for this service type
        let templateItem: { intervalKm?: number; intervalMonths?: number } | null = null;
        for (const template of templates) {
          const items = template.items as Array<{
            serviceType: string;
            intervalKm?: number;
            intervalMonths?: number;
          }>;
          const match = items.find((i) => i.serviceType === serviceType);
          if (match) {
            templateItem = match;
            break;
          }
        }

        if (templateItem) {
          // Compute next due date
          let nextDueDate: Date | null = null;
          let nextDueOdometerKm: number | null = null;

          if (templateItem.intervalMonths) {
            nextDueDate = new Date(completedAt);
            nextDueDate.setMonth(nextDueDate.getMonth() + templateItem.intervalMonths);
          }

          if (templateItem.intervalKm && odometerKm != null) {
            nextDueOdometerKm = odometerKm + templateItem.intervalKm;
          }

          // Create next schedule entry
          await this.prisma.maintenanceScheduleEntry.create({
            data: {
              vehicleRecordId,
              serviceType,
              dueDate: nextDueDate,
              dueOdometerKm: nextDueOdometerKm,
              urgency: MaintenanceUrgency.UPCOMING,
              completed: false,
            },
          });

          this.logger.log(
            `Created next schedule entry for ${serviceType} on vehicle ${vehicleRecordId}`,
          );
        }
      },
    );
  }

  // ─── Reminders ───────────────────────────────────────────────────

  /**
   * Check schedule entries and send reminders.
   * Called by a scheduled task (e.g., daily cron).
   * - 7-day reminder (Req 9.2)
   * - Overdue alert within 24h (Req 9.7)
   * - Distance-based reminder within 500km (Req 9.8)
   */
  async checkAndSendReminders(): Promise<void> {
    const now = new Date();
    const sevenDaysFromNow = new Date(now.getTime() + DUE_SOON_DAYS * 24 * 60 * 60 * 1000);

    // Find entries that are due within 7 days (not completed)
    const dueSoonEntries = await this.prisma.maintenanceScheduleEntry.findMany({
      where: {
        completed: false,
        dueDate: {
          gte: now,
          lte: sevenDaysFromNow,
        },
      },
      include: {
        vehicleRecord: {
          select: { id: true, make: true, model: true, latestOdometerKm: true },
        },
      },
    });

    for (const entry of dueSoonEntries) {
      await this.eventsService.publish({
        eventType: EventTypes.MAINTENANCE_DUE_SOON,
        sourceEntity: 'MaintenanceScheduleEntry',
        sourceId: entry.id,
        payload: {
          vehicleRecordId: entry.vehicleRecordId,
          serviceType: entry.serviceType,
          dueDate: entry.dueDate?.toISOString(),
          dueOdometerKm: entry.dueOdometerKm,
        },
      });
    }

    // Find overdue entries (past due date)
    const overdueEntries = await this.prisma.maintenanceScheduleEntry.findMany({
      where: {
        completed: false,
        dueDate: { lt: now },
      },
      include: {
        vehicleRecord: {
          select: { id: true, make: true, model: true, latestOdometerKm: true },
        },
      },
    });

    for (const entry of overdueEntries) {
      await this.eventsService.publish({
        eventType: EventTypes.MAINTENANCE_OVERDUE,
        sourceEntity: 'MaintenanceScheduleEntry',
        sourceId: entry.id,
        payload: {
          vehicleRecordId: entry.vehicleRecordId,
          serviceType: entry.serviceType,
          dueDate: entry.dueDate?.toISOString(),
          dueOdometerKm: entry.dueOdometerKm,
        },
      });
    }

    // Distance-based reminders: find entries where vehicle odometer is within 500km of trigger
    const distanceEntries = await this.prisma.maintenanceScheduleEntry.findMany({
      where: {
        completed: false,
        dueOdometerKm: { not: null },
      },
      include: {
        vehicleRecord: {
          select: { id: true, latestOdometerKm: true },
        },
      },
    });

    for (const entry of distanceEntries) {
      const currentOdo = entry.vehicleRecord.latestOdometerKm;
      if (currentOdo == null || entry.dueOdometerKm == null) continue;

      const kmRemaining = entry.dueOdometerKm - currentOdo;
      if (kmRemaining <= DUE_SOON_KM && kmRemaining > 0) {
        await this.eventsService.publish({
          eventType: EventTypes.MAINTENANCE_DUE_SOON,
          sourceEntity: 'MaintenanceScheduleEntry',
          sourceId: entry.id,
          payload: {
            vehicleRecordId: entry.vehicleRecordId,
            serviceType: entry.serviceType,
            dueDate: entry.dueDate?.toISOString() ?? null,
            dueOdometerKm: entry.dueOdometerKm,
            kmRemaining,
          },
        });
      } else if (kmRemaining <= 0) {
        // Overdue by distance
        await this.eventsService.publish({
          eventType: EventTypes.MAINTENANCE_OVERDUE,
          sourceEntity: 'MaintenanceScheduleEntry',
          sourceId: entry.id,
          payload: {
            vehicleRecordId: entry.vehicleRecordId,
            serviceType: entry.serviceType,
            dueDate: entry.dueDate?.toISOString() ?? null,
            dueOdometerKm: entry.dueOdometerKm,
            currentOdometerKm: currentOdo,
          },
        });
      }
    }
  }

  // ─── Helpers ─────────────────────────────────────────────────────

  private requireTenant(): string {
    const tenantId = this.tenantContext.tenantId;
    if (!tenantId) {
      throw ApiException.validation('Tenant context is required.');
    }
    return tenantId;
  }
}
