import { Injectable } from '@nestjs/common';
import { BookingStatus, ConditionKind, PickupTripStatus, Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ApiException } from '../../common/api-exception';
import { membershipForRole, type AuthContext, type AuthMembership } from '../../common/auth.types';
import { bookingInclude, serializeBooking } from '../../domain/serializers';
import type { BookingDTO } from '../../domain/contracts';
import type { PickupTripLocationDto, SubmitConditionReportDto } from './dto';

@Injectable()
export class TasksService {
  constructor(private readonly prisma: PrismaService) {}

  private employee(auth: AuthContext): AuthMembership {
    const m = membershipForRole(auth, Role.EMPLOYEE);
    if (!m) throw ApiException.forbidden('Staff access required.');
    return m;
  }

  private async loadBooking(id: string): Promise<BookingDTO> {
    const booking = await this.prisma.booking.findUnique({ where: { id }, include: bookingInclude });
    if (!booking) throw ApiException.notFound('Booking not found.');
    return serializeBooking(booking);
  }

  private async pickupOwnedBooking(auth: AuthContext, bookingId: string) {
    const m = this.employee(auth);
    const booking = await this.prisma.booking.findUnique({ where: { id: bookingId } });
    if (!booking) throw ApiException.notFound('Booking not found.');
    if (booking.pickupMembershipId !== m.id) {
      throw ApiException.forbidden('Only the assigned pickup staff can update trip tracking.');
    }
    return { booking, membershipId: m.id };
  }

  private async upsertTripPoint(
    bookingId: string,
    membershipId: string,
    dto: PickupTripLocationDto,
    status: PickupTripStatus,
    extras?: { startedAt?: Date; reachedGarageAt?: Date },
  ) {
    const trip = await this.prisma.pickupTrip.upsert({
      where: { bookingId },
      create: {
        bookingId,
        employeeMembershipId: membershipId,
        status,
        startedAt: extras?.startedAt ?? null,
        reachedGarageAt: extras?.reachedGarageAt ?? null,
        lastEtaMin: dto.etaMin ?? null,
      },
      update: {
        employeeMembershipId: membershipId,
        status,
        startedAt: extras?.startedAt,
        reachedGarageAt: extras?.reachedGarageAt,
        lastEtaMin: dto.etaMin ?? undefined,
      },
    });

    await this.prisma.pickupTripPoint.create({
      data: {
        tripId: trip.id,
        lat: dto.lat,
        lng: dto.lng,
        accuracy: dto.accuracy ?? null,
        speed: dto.speed ?? null,
        heading: dto.heading ?? null,
      },
    });
  }

  async myTasks(auth: AuthContext): Promise<BookingDTO[]> {
    const m = this.employee(auth);
    const rows = await this.prisma.booking.findMany({
      where: { OR: [{ pickupMembershipId: m.id }, { serviceMembershipId: m.id }] },
      include: bookingInclude,
      orderBy: { scheduledAt: 'asc' },
    });
    return rows.map(serializeBooking);
  }

  async submitReport(
    auth: AuthContext,
    bookingId: string,
    dto: SubmitConditionReportDto,
  ): Promise<BookingDTO> {
    const m = this.employee(auth);
    const booking = await this.prisma.booking.findUnique({ where: { id: bookingId } });
    if (!booking) throw ApiException.notFound('Booking not found.');

    const assigned = booking.pickupMembershipId === m.id || booking.serviceMembershipId === m.id;
    if (!assigned) throw ApiException.forbidden('This task isn’t assigned to you.');
    if (!dto.photos.length) throw ApiException.validation('Add at least one photo.');

    // Transition gates — kept strictly server-side.
    if (dto.kind === ConditionKind.PICKUP && booking.status !== BookingStatus.ASSIGNED) {
      throw ApiException.invalidTransition('Pickup photos can only be sent for an assigned booking.');
    }
    if (dto.kind === ConditionKind.DELIVERY && booking.status !== BookingStatus.IN_PROGRESS) {
      throw ApiException.invalidTransition('Delivery photos can only be sent once the service is in progress.');
    }
    const nextStatus =
      dto.kind === ConditionKind.PICKUP
        ? BookingStatus.CONDITION_PENDING
        : BookingStatus.DONE_PENDING;

    await this.prisma.$transaction(async (tx) => {
      await tx.conditionReport.create({
        data: {
          bookingId,
          kind: dto.kind,
          photos: {
            create: dto.photos.map((p) => ({ url: p.url, caption: p.caption?.trim() || null })),
          },
        },
      });
      await tx.booking.update({ where: { id: bookingId }, data: { status: nextStatus } });
    });

    return this.loadBooking(bookingId);
  }

  async toggleChecklist(
    auth: AuthContext,
    bookingId: string,
    itemId: string,
    done: boolean,
  ): Promise<BookingDTO> {
    const m = this.employee(auth);
    const booking = await this.prisma.booking.findUnique({ where: { id: bookingId } });
    if (!booking) throw ApiException.notFound('Booking not found.');
    if (booking.serviceMembershipId !== m.id) {
      throw ApiException.forbidden('Only the assigned specialist can update the checklist.');
    }
    const item = await this.prisma.checklistItem.findFirst({ where: { id: itemId, bookingId } });
    if (!item) throw ApiException.notFound('Checklist item not found.');

    await this.prisma.checklistItem.update({
      where: { id: itemId },
      data: { done, doneAt: done ? new Date() : null },
    });
    return this.loadBooking(bookingId);
  }

  async startPickupTrip(
    auth: AuthContext,
    bookingId: string,
    dto: PickupTripLocationDto,
  ): Promise<BookingDTO> {
    const { booking, membershipId } = await this.pickupOwnedBooking(auth, bookingId);
    if (booking.status === BookingStatus.CANCELLED || booking.status === BookingStatus.NO_SHOW) {
      throw ApiException.invalidTransition('Cannot track a cancelled booking.');
    }
    await this.upsertTripPoint(bookingId, membershipId, dto, PickupTripStatus.PICKED_UP, {
      startedAt: new Date(),
    });
    return this.loadBooking(bookingId);
  }

  async pushPickupLocation(
    auth: AuthContext,
    bookingId: string,
    dto: PickupTripLocationDto,
  ): Promise<BookingDTO> {
    const { booking, membershipId } = await this.pickupOwnedBooking(auth, bookingId);
    if (booking.status === BookingStatus.CANCELLED || booking.status === BookingStatus.NO_SHOW) {
      throw ApiException.invalidTransition('Cannot track a cancelled booking.');
    }

    const existing = await this.prisma.pickupTrip.findUnique({ where: { bookingId } });
    if (!existing || existing.status === PickupTripStatus.NOT_STARTED) {
      throw ApiException.invalidTransition('Start pickup tracking before posting locations.');
    }
    if (existing.status === PickupTripStatus.ARRIVED_GARAGE) {
      throw ApiException.invalidTransition('Trip is already marked as arrived at garage.');
    }

    await this.upsertTripPoint(
      bookingId,
      membershipId,
      dto,
      PickupTripStatus.IN_TRANSIT_TO_GARAGE,
    );
    return this.loadBooking(bookingId);
  }

  async arriveGarage(
    auth: AuthContext,
    bookingId: string,
    dto: PickupTripLocationDto,
  ): Promise<BookingDTO> {
    const { membershipId } = await this.pickupOwnedBooking(auth, bookingId);
    await this.upsertTripPoint(bookingId, membershipId, dto, PickupTripStatus.ARRIVED_GARAGE, {
      reachedGarageAt: new Date(),
    });
    return this.loadBooking(bookingId);
  }
}
