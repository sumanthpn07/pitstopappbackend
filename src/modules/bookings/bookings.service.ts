import { Injectable } from '@nestjs/common';
import { BookingStatus, ConditionKind, PaymentStatus, Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ApiException } from '../../common/api-exception';
import { membershipForRole, type AuthContext, type AuthMembership } from '../../common/auth.types';
import { checklistFor } from '../../domain/checklist-templates';
import { isCancellable } from '../../domain/status';
import { bookingInclude, serializeBooking, serializePickupTrip, serializeReport } from '../../domain/serializers';
import type { BookingDTO, ConditionReportDTO, PickupTripDTO } from '../../domain/contracts';
import type { CreateBookingDto } from './dto';

@Injectable()
export class BookingsService {
  constructor(private readonly prisma: PrismaService) {}

  private customerMembership(auth: AuthContext): AuthMembership {
    const m = membershipForRole(auth, Role.CUSTOMER);
    if (!m) throw ApiException.forbidden('No customer access.');
    return m;
  }

  private async loadBooking(id: string): Promise<BookingDTO> {
    const booking = await this.prisma.booking.findUnique({ where: { id }, include: bookingInclude });
    if (!booking) throw ApiException.notFound('Booking not found.');
    return serializeBooking(booking);
  }

  private canView(auth: AuthContext, booking: { shopId: string; customerMembershipId: string }): boolean {
    const isStaff = auth.memberships.some(
      (m) => (m.role === Role.MANAGER || m.role === Role.EMPLOYEE) && m.shopId === booking.shopId,
    );
    const isOwner = auth.memberships.some((m) => m.id === booking.customerMembershipId);
    return isStaff || isOwner;
  }

  async listForCustomer(auth: AuthContext): Promise<BookingDTO[]> {
    const m = this.customerMembership(auth);
    const rows = await this.prisma.booking.findMany({
      where: { customerMembershipId: m.id },
      include: bookingInclude,
      orderBy: { scheduledAt: 'desc' },
    });
    return rows.map(serializeBooking);
  }

  /** A booking is visible to its owning customer or to staff in the same shop. */
  async getOne(auth: AuthContext, id: string): Promise<BookingDTO> {
    const booking = await this.prisma.booking.findUnique({ where: { id }, include: bookingInclude });
    if (!booking) throw ApiException.notFound('Booking not found.');

    if (!this.canView(auth, booking)) throw ApiException.forbidden('You can’t view this booking.');

    return serializeBooking(booking);
  }

  async getTracking(auth: AuthContext, id: string): Promise<PickupTripDTO | null> {
    const booking = await this.prisma.booking.findUnique({ where: { id } });
    if (!booking) throw ApiException.notFound('Booking not found.');
    if (!this.canView(auth, booking)) throw ApiException.forbidden('You can’t view this booking.');

    const trip = await this.prisma.pickupTrip.findUnique({
      where: { bookingId: id },
      include: { points: { orderBy: { recordedAt: 'asc' } } },
    });
    if (!trip) return null;
    return serializePickupTrip(trip);
  }

  async create(auth: AuthContext, dto: CreateBookingDto): Promise<BookingDTO> {
    const m = this.customerMembership(auth);

    const service = await this.prisma.service.findFirst({
      where: { id: dto.serviceId, active: true },
    });
    if (!service) throw ApiException.notFound('Service not found.');

    let vehicleId: string | null = null;
    if (dto.vehicleId) {
      const vehicle = await this.prisma.vehicle.findFirst({
        where: { id: dto.vehicleId, membershipId: m.id },
      });
      if (!vehicle) throw ApiException.notFound('Vehicle not found.');
      vehicleId = vehicle.id;
    }

    const scheduledAt = new Date(dto.scheduledAt);
    if (Number.isNaN(scheduledAt.getTime())) {
      throw ApiException.validation('Invalid scheduled time.');
    }

    const labels = checklistFor(service.id);
    const booking = await this.prisma.booking.create({
      data: {
        shopId: service.shopId,
        customerMembershipId: m.id,
        serviceId: service.id,
        vehicleId,
        status: BookingStatus.BOOKED,
        scheduledAt,
        durationMin: service.durationMin,
        pricePaise: service.pricePaise,
        notes: dto.notes?.trim() || null,
        pickupAddress: dto.pickupAddress?.fullAddress?.trim() || null,
        pickupLandmark: dto.pickupAddress?.landmark?.trim() || null,
        pickupCity: dto.pickupAddress?.city?.trim() || null,
        pickupLat: dto.pickupAddress?.lat ?? null,
        pickupLng: dto.pickupAddress?.lng ?? null,
        pickupContactName: dto.pickupAddress?.contactName?.trim() || null,
        pickupContactPhone: dto.pickupAddress?.contactPhone?.trim() || null,
        pickupNotes: dto.pickupAddress?.notes?.trim() || null,
        checklist: { create: labels.map((label, position) => ({ label, position })) },
        // Payment is simulated as already captured for the demo.
        payment: {
          create: {
            amountPaise: service.pricePaise,
            gateway: 'razorpay',
            status: PaymentStatus.CAPTURED,
          },
        },
      },
      include: bookingInclude,
    });
    return serializeBooking(booking);
  }

  async cancel(auth: AuthContext, id: string): Promise<BookingDTO> {
    const m = this.customerMembership(auth);
    const booking = await this.prisma.booking.findUnique({ where: { id } });
    if (!booking || booking.customerMembershipId !== m.id) {
      throw ApiException.notFound('Booking not found.');
    }
    if (!isCancellable(booking.status)) {
      throw ApiException.invalidTransition('This booking can no longer be cancelled.');
    }
    await this.prisma.booking.update({ where: { id }, data: { status: BookingStatus.CANCELLED } });
    return this.loadBooking(id);
  }

  /** Customer approves a pickup/delivery report, unlocking the next status. */
  async verifyConditionReport(auth: AuthContext, reportId: string): Promise<ConditionReportDTO> {
    const m = this.customerMembership(auth);
    const report = await this.prisma.conditionReport.findUnique({
      where: { id: reportId },
      include: { booking: true },
    });
    if (!report) throw ApiException.notFound('Report not found.');
    if (report.booking.customerMembershipId !== m.id) {
      throw ApiException.forbidden('You can’t approve this report.');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.conditionReport.update({
        where: { id: reportId },
        data: { customerVerifiedAt: new Date() },
      });
      if (report.kind === ConditionKind.PICKUP && report.booking.status === BookingStatus.CONDITION_PENDING) {
        await tx.booking.update({ where: { id: report.bookingId }, data: { status: BookingStatus.IN_PROGRESS } });
      } else if (report.kind === ConditionKind.DELIVERY && report.booking.status === BookingStatus.DONE_PENDING) {
        await tx.booking.update({ where: { id: report.bookingId }, data: { status: BookingStatus.COMPLETED } });
      }
    });

    const updated = await this.prisma.conditionReport.findUnique({
      where: { id: reportId },
      include: { photos: { orderBy: { createdAt: 'asc' } } },
    });
    if (!updated) throw ApiException.notFound('Report not found.');
    return serializeReport(updated);
  }
}
