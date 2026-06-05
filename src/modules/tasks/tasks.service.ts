import { Injectable } from '@nestjs/common';
import { BookingStatus, ConditionKind, Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ApiException } from '../../common/api-exception';
import { membershipForRole, type AuthContext, type AuthMembership } from '../../common/auth.types';
import { bookingInclude, serializeBooking } from '../../domain/serializers';
import type { BookingDTO } from '../../domain/contracts';
import type { SubmitConditionReportDto } from './dto';

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
}
