import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { JobCardStatus, Weekday } from '@prisma/client';
import { DateTime } from 'luxon';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantContext } from '../../common/providers/tenant-context.provider';
import { EventsService } from '../events/events.service';
import { EventTypes } from '../events/event-types';
import { ApiException } from '../../common/api-exception';
import type {
  BookAppointmentDto,
  DayAvailability,
  TimeSlot,
} from './dto';

/** Maps JS day-of-week (1=Mon..7=Sun in Luxon) to Prisma Weekday enum */
const LUXON_DAY_TO_WEEKDAY: Record<number, Weekday> = {
  1: Weekday.mon,
  2: Weekday.tue,
  3: Weekday.wed,
  4: Weekday.thu,
  5: Weekday.fri,
  6: Weekday.sat,
  7: Weekday.sun,
};

@Injectable()
export class AppointmentsService {
  private readonly logger = new Logger(AppointmentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
    private readonly eventsService: EventsService,
  ) {}

  // ─── Availability ────────────────────────────────────────────────

  /**
   * Returns available time slots for the next 14 days for a given tenant.
   * Each slot includes remaining capacity.
   */
  async getAvailability(tenantId: string): Promise<DayAvailability[]> {
    // Load tenant config
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      include: { workingHours: true },
    });

    if (!tenant) {
      throw ApiException.notFound('Tenant not found.');
    }

    if (!tenant.active) {
      throw ApiException.validation('Tenant is not active.');
    }

    const slotDurationMin = tenant.slotDurationMin;
    const slotCapacity = tenant.slotCapacity;
    const timezone = tenant.timezone || 'Asia/Kolkata';

    // Build working hours lookup by day
    const workingHoursByDay = new Map<Weekday, { open: string; close: string; closed: boolean }>();
    for (const wh of tenant.workingHours) {
      workingHoursByDay.set(wh.day, { open: wh.open, close: wh.close, closed: wh.closed });
    }

    // Get the 14-day window
    const now = DateTime.now().setZone(timezone);
    const startDate = now.startOf('day');
    const endDate = startDate.plus({ days: 14 });

    // Get all scheduled job cards in this window for the tenant
    const existingJobCards = await this.prisma.jobCard.findMany({
      where: {
        tenantId,
        scheduledAt: {
          gte: startDate.toJSDate(),
          lt: endDate.toJSDate(),
        },
        status: {
          notIn: [JobCardStatus.CANCELLED],
        },
      },
      select: { scheduledAt: true },
    });

    // Build a map of slot start times to count of bookings
    const bookingCounts = new Map<string, number>();
    for (const jc of existingJobCards) {
      if (jc.scheduledAt) {
        // Normalize to slot start time
        const scheduledDt = DateTime.fromJSDate(jc.scheduledAt).setZone(timezone);
        const slotStart = this.normalizeToSlotStart(scheduledDt, slotDurationMin);
        const key = slotStart.toISO()!;
        bookingCounts.set(key, (bookingCounts.get(key) || 0) + 1);
      }
    }

    // Generate availability for each day
    const result: DayAvailability[] = [];

    for (let dayOffset = 0; dayOffset < 14; dayOffset++) {
      const currentDay = startDate.plus({ days: dayOffset });
      const weekday = LUXON_DAY_TO_WEEKDAY[currentDay.weekday];
      const workingHour = workingHoursByDay.get(weekday);

      // Skip closed days or days without working hours configured
      if (!workingHour || workingHour.closed) {
        result.push({ date: currentDay.toISODate()!, slots: [] });
        continue;
      }

      const slots = this.generateTimeSlotsForDay(
        currentDay,
        workingHour.open,
        workingHour.close,
        slotDurationMin,
        slotCapacity,
        bookingCounts,
        now,
      );

      result.push({ date: currentDay.toISODate()!, slots });
    }

    return result;
  }

  /**
   * Generate time slots for a specific day based on working hours.
   * Filters out past slots and slots at full capacity.
   */
  private generateTimeSlotsForDay(
    day: DateTime,
    openTime: string,
    closeTime: string,
    slotDurationMin: number,
    slotCapacity: number,
    bookingCounts: Map<string, number>,
    now: DateTime,
  ): TimeSlot[] {
    const [openH, openM] = openTime.split(':').map(Number);
    const [closeH, closeM] = closeTime.split(':').map(Number);

    const dayStart = day.set({ hour: openH, minute: openM, second: 0, millisecond: 0 });
    const dayEnd = day.set({ hour: closeH, minute: closeM, second: 0, millisecond: 0 });

    const slots: TimeSlot[] = [];
    let slotStart = dayStart;

    while (slotStart < dayEnd) {
      const slotEnd = slotStart.plus({ minutes: slotDurationMin });
      if (slotEnd > dayEnd) break;

      // Skip past slots
      if (slotStart <= now) {
        slotStart = slotEnd;
        continue;
      }

      const key = slotStart.toISO()!;
      const booked = bookingCounts.get(key) || 0;
      const remaining = slotCapacity - booked;

      // Include all slots (even full ones) so UI can show them as unavailable
      slots.push({
        start: slotStart.toISO()!,
        end: slotEnd.toISO()!,
        remaining: Math.max(0, remaining),
      });

      slotStart = slotEnd;
    }

    return slots;
  }

  /**
   * Normalizes a DateTime to the start of the slot it falls into.
   */
  private normalizeToSlotStart(dt: DateTime, slotDurationMin: number): DateTime {
    const minutesFromMidnight = dt.hour * 60 + dt.minute;
    const slotIndex = Math.floor(minutesFromMidnight / slotDurationMin);
    const slotMinutes = slotIndex * slotDurationMin;
    return dt.startOf('day').plus({ minutes: slotMinutes });
  }

  // ─── Booking ─────────────────────────────────────────────────────

  /**
   * Book an appointment by creating a JobCard in CREATED state with scheduledAt.
   * Enforces slot capacity.
   */
  async book(customerId: string, dto: BookAppointmentDto) {
    const tenantId = dto.tenantId || this.tenantContext.tenantId;
    if (!tenantId) {
      throw ApiException.validation('Tenant context is required.');
    }

    // Validate services (1-20)
    if (!dto.services || dto.services.length === 0) {
      throw ApiException.validation('At least 1 service is required.');
    }
    if (dto.services.length > 20) {
      throw ApiException.validation('Maximum 20 services allowed per appointment.');
    }

    // Parse and validate scheduled time
    const scheduledAt = DateTime.fromISO(dto.scheduledAt);
    if (!scheduledAt.isValid) {
      throw ApiException.validation('Invalid scheduledAt datetime format.');
    }
    if (scheduledAt <= DateTime.now()) {
      throw ApiException.validation('scheduledAt must be in the future.');
    }

    // Load tenant config
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      include: { workingHours: true },
    });

    if (!tenant) {
      throw ApiException.notFound('Tenant not found.');
    }

    if (!tenant.active) {
      throw ApiException.validation('Tenant is not active.');
    }

    const timezone = tenant.timezone || 'Asia/Kolkata';
    const slotDurationMin = tenant.slotDurationMin;
    const slotCapacity = tenant.slotCapacity;

    // Validate it falls within working hours
    const scheduledInTz = scheduledAt.setZone(timezone);
    const weekday = LUXON_DAY_TO_WEEKDAY[scheduledInTz.weekday];
    const workingHour = tenant.workingHours.find((wh) => wh.day === weekday);

    if (!workingHour || workingHour.closed) {
      throw ApiException.validation('Selected day is not a working day for this tenant.');
    }

    const [openH, openM] = workingHour.open.split(':').map(Number);
    const [closeH, closeM] = workingHour.close.split(':').map(Number);
    const openMinutes = openH * 60 + openM;
    const closeMinutes = closeH * 60 + closeM;
    const scheduledMinutes = scheduledInTz.hour * 60 + scheduledInTz.minute;

    if (scheduledMinutes < openMinutes || scheduledMinutes + slotDurationMin > closeMinutes) {
      throw ApiException.validation('Scheduled time is outside working hours.');
    }

    // Normalize to slot start and check capacity
    const slotStart = this.normalizeToSlotStart(scheduledInTz, slotDurationMin);
    const slotEnd = slotStart.plus({ minutes: slotDurationMin });

    const existingCount = await this.prisma.jobCard.count({
      where: {
        tenantId,
        scheduledAt: {
          gte: slotStart.toJSDate(),
          lt: slotEnd.toJSDate(),
        },
        status: { notIn: [JobCardStatus.CANCELLED] },
      },
    });

    if (existingCount >= slotCapacity) {
      throw new ApiException(
        'SLOT_AT_CAPACITY',
        'Selected time slot is unavailable.',
        409 as any,
      );
    }

    // Validate vehicle record exists
    const vehicleRecord = await this.prisma.vehicleRecord.findUnique({
      where: { id: dto.vehicleRecordId },
    });
    if (!vehicleRecord) {
      throw ApiException.notFound('Vehicle record not found.');
    }

    // Validate all services belong to the tenant catalog
    const serviceIds = dto.services.map((s) => s.serviceId);
    const tenantServices = await this.prisma.tenantService.findMany({
      where: {
        id: { in: serviceIds },
        tenantId,
      },
    });
    if (tenantServices.length !== serviceIds.length) {
      throw ApiException.validation('One or more services not found in tenant catalog.');
    }

    // Create job card in CREATED state with scheduledAt
    const jobCard = await this.prisma.$transaction(async (tx) => {
      const card = await tx.jobCard.create({
        data: {
          tenantId,
          vehicleRecordId: dto.vehicleRecordId,
          customerId,
          status: JobCardStatus.CREATED,
          scheduledAt: scheduledAt.toJSDate(),
        },
      });

      // Create job card items from selected services
      await tx.jobCardItem.createMany({
        data: tenantServices.map((svc) => ({
          jobCardId: card.id,
          serviceId: svc.id,
          pricePaise: svc.pricePaise,
          durationMin: svc.durationMin,
        })),
      });

      return card;
    });

    // Return confirmation
    const confirmation = await this.prisma.jobCard.findUnique({
      where: { id: jobCard.id },
      include: { items: true, tenant: { select: { name: true } } },
    });

    return {
      id: confirmation!.id,
      scheduledAt: confirmation!.scheduledAt,
      tenantName: confirmation!.tenant.name,
      status: confirmation!.status,
      items: confirmation!.items,
    };
  }

  // ─── Cancellation ────────────────────────────────────────────────

  /**
   * Cancel an appointment. Applies 2-hour threshold logic:
   * - >= 2 hours before: cancel without penalty
   * - < 2 hours before: cancel but record late cancellation and notify Garage Owner
   */
  async cancel(appointmentId: string, reason?: string) {
    const jobCard = await this.prisma.jobCard.findUnique({
      where: { id: appointmentId },
      include: { tenant: { select: { id: true, name: true } } },
    });

    if (!jobCard) {
      throw ApiException.notFound('Appointment not found.');
    }

    if (jobCard.status !== JobCardStatus.CREATED) {
      throw ApiException.invalidTransition(
        'Only appointments in CREATED status can be cancelled through this endpoint.',
      );
    }

    if (!jobCard.scheduledAt) {
      throw ApiException.validation('This job card has no scheduled time.');
    }

    const now = DateTime.now();
    const scheduled = DateTime.fromJSDate(jobCard.scheduledAt);
    const hoursUntilAppointment = scheduled.diff(now, 'hours').hours;
    const isLateCancellation = hoursUntilAppointment < 2;

    // Cancel the job card
    const cancelled = await this.prisma.jobCard.update({
      where: { id: appointmentId },
      data: {
        status: JobCardStatus.CANCELLED,
        cancellationReason: reason || (isLateCancellation ? 'Late cancellation' : 'Customer cancelled'),
      },
    });

    // If late cancellation, notify the garage owner
    if (isLateCancellation) {
      await this.publishLateCancellationEvent(jobCard.id, jobCard.tenantId, jobCard.customerId, jobCard.scheduledAt);
    }

    return {
      id: cancelled.id,
      status: cancelled.status,
      isLateCancellation,
      cancellationReason: cancelled.cancellationReason,
    };
  }

  /**
   * Publishes a late cancellation event to notify the Garage Owner.
   */
  private async publishLateCancellationEvent(
    jobCardId: string,
    tenantId: string,
    customerId: string,
    scheduledAt: Date,
  ) {
    // Find the tenant managers
    const managers = await this.prisma.tenantMembership.findMany({
      where: { tenantId, role: 'MANAGER' },
      select: { userId: true },
    });

    for (const manager of managers) {
      await this.eventsService.publish({
        eventType: EventTypes.APPOINTMENT_REMINDER, // reusing for late cancel notification
        sourceEntity: 'JobCard',
        sourceId: jobCardId,
        payload: {
          userId: manager.userId,
          tenantId,
          customerId,
          scheduledTime: scheduledAt.toISOString(),
          type: 'late_cancellation',
          message: `A customer cancelled their appointment less than 2 hours before the scheduled time (${scheduledAt.toISOString()}).`,
        },
      });
    }
  }

  // ─── Queue ───────────────────────────────────────────────────────

  /**
   * Get today's appointment queue for the current tenant, sorted by scheduledAt.
   */
  async getQueue() {
    const tenantId = this.tenantContext.tenantId;
    if (!tenantId) {
      throw ApiException.validation('Tenant context is required.');
    }

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { timezone: true },
    });

    const timezone = tenant?.timezone || 'Asia/Kolkata';
    const now = DateTime.now().setZone(timezone);
    const todayStart = now.startOf('day').toJSDate();
    const todayEnd = now.endOf('day').toJSDate();

    const appointments = await this.prisma.jobCard.findMany({
      where: {
        tenantId,
        scheduledAt: {
          gte: todayStart,
          lte: todayEnd,
        },
      },
      include: {
        items: true,
        vehicleRecord: {
          select: {
            id: true,
            make: true,
            model: true,
            year: true,
            registrationPlate: true,
          },
        },
      },
      orderBy: { scheduledAt: 'asc' },
    });

    return appointments.map((a) => ({
      id: a.id,
      scheduledAt: a.scheduledAt,
      status: a.status,
      assignedTechId: a.assignedTechId,
      vehicleRecord: a.vehicleRecord,
      items: a.items,
      customerId: a.customerId,
    }));
  }

  // ─── Scheduled Tasks ─────────────────────────────────────────────

  /**
   * 24-hour reminder: runs every 10 minutes.
   * Finds JobCards where scheduledAt is 24h-25h from now and status is CREATED.
   * Publishes a reminder event for each.
   */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async sendReminders(): Promise<void> {
    const now = DateTime.now();
    const windowStart = now.plus({ hours: 24 });
    const windowEnd = now.plus({ hours: 25 });

    const upcomingAppointments = await this.prisma.jobCard.findMany({
      where: {
        scheduledAt: {
          gte: windowStart.toJSDate(),
          lt: windowEnd.toJSDate(),
        },
        status: JobCardStatus.CREATED,
      },
      include: { tenant: { select: { id: true, name: true } } },
    });

    for (const appointment of upcomingAppointments) {
      await this.eventsService.publish({
        eventType: EventTypes.APPOINTMENT_REMINDER,
        sourceEntity: 'JobCard',
        sourceId: appointment.id,
        payload: {
          userId: appointment.customerId,
          tenantId: appointment.tenantId,
          scheduledTime: appointment.scheduledAt?.toISOString(),
          tenantName: appointment.tenant.name,
        },
      });
    }

    if (upcomingAppointments.length > 0) {
      this.logger.log(`Sent ${upcomingAppointments.length} appointment reminder(s).`);
    }
  }

  /**
   * No-show detection: runs every 5 minutes.
   * Finds JobCards where scheduledAt < now - 30 min AND status is still CREATED.
   * Publishes a no-show event for each.
   */
  @Cron('*/5 * * * *')
  async detectNoShows(): Promise<void> {
    const threshold = DateTime.now().minus({ minutes: 30 });

    const noShows = await this.prisma.jobCard.findMany({
      where: {
        scheduledAt: {
          lt: threshold.toJSDate(),
        },
        status: JobCardStatus.CREATED,
        // Only look at recent appointments (last 24h) to avoid processing old data
        createdAt: {
          gte: DateTime.now().minus({ hours: 48 }).toJSDate(),
        },
      },
      include: { tenant: { select: { id: true, name: true } } },
    });

    for (const appointment of noShows) {
      // Mark as cancelled with no-show reason
      await this.prisma.jobCard.update({
        where: { id: appointment.id },
        data: {
          status: JobCardStatus.CANCELLED,
          cancellationReason: 'No-show: customer did not arrive within 30 minutes of scheduled time.',
        },
      });

      // Publish no-show event
      await this.eventsService.publish({
        eventType: EventTypes.APPOINTMENT_NO_SHOW,
        sourceEntity: 'JobCard',
        sourceId: appointment.id,
        payload: {
          jobCardId: appointment.id,
          tenantId: appointment.tenantId,
          customerId: appointment.customerId,
          scheduledAt: appointment.scheduledAt?.toISOString(),
        },
      });
    }

    if (noShows.length > 0) {
      this.logger.log(`Detected ${noShows.length} no-show appointment(s).`);
    }
  }
}
