import { Injectable } from '@nestjs/common';
import { AuthProvider, BookingStatus, Role, TxnType, Weekday } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ApiException } from '../../common/api-exception';
import { membershipForRole, type AuthContext, type AuthMembership } from '../../common/auth.types';
import { TERMINAL_STATUSES } from '../../domain/status';
import {
  bookingInclude,
  serializeBooking,
  serializeFinanceTxn,
  serializeOffer,
  serializeService,
  serializeStaff,
  workingHoursToDto,
} from '../../domain/serializers';
import type {
  BookingDTO,
  FinanceTxnDTO,
  OfferDTO,
  ServiceDTO,
  StaffMemberDTO,
  WorkingHoursDTO,
} from '../../domain/contracts';
import type {
  AssignStaffDto,
  CreateEmployeeDto,
  CreateExpenseDto,
  CreateOfferDto,
  CreateServiceDto,
  DayHoursDto,
  SetWorkingHoursDto,
  UpdateServiceDto,
} from './dto';

/** Strip whitespace + lowercase so plate lookups ignore spacing/case. */
function normalizePlate(value: string): string {
  return value.replace(/\s+/g, '').toLowerCase();
}

@Injectable()
export class ManageService {
  constructor(private readonly prisma: PrismaService) {}

  private manager(auth: AuthContext): AuthMembership {
    const m = membershipForRole(auth, Role.MANAGER);
    if (!m) throw ApiException.forbidden('Manager access required.');
    return m;
  }

  private async loadBooking(id: string): Promise<BookingDTO> {
    const booking = await this.prisma.booking.findUnique({ where: { id }, include: bookingInclude });
    if (!booking) throw ApiException.notFound('Booking not found.');
    return serializeBooking(booking);
  }

  async allBookings(auth: AuthContext): Promise<BookingDTO[]> {
    const m = this.manager(auth);
    const rows = await this.prisma.booking.findMany({
      where: { shopId: m.shopId },
      include: bookingInclude,
      orderBy: { scheduledAt: 'desc' },
    });
    return rows.map(serializeBooking);
  }

  async allServices(auth: AuthContext): Promise<ServiceDTO[]> {
    const m = this.manager(auth);
    const rows = await this.prisma.service.findMany({
      where: { shopId: m.shopId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(serializeService);
  }

  async staff(auth: AuthContext): Promise<StaffMemberDTO[]> {
    const m = this.manager(auth);
    const employees = await this.prisma.membership.findMany({
      where: { shopId: m.shopId, role: Role.EMPLOYEE },
      include: { user: true },
      orderBy: { createdAt: 'asc' },
    });
    const out: StaffMemberDTO[] = [];
    for (const emp of employees) {
      const activeTasks = await this.prisma.booking.count({
        where: {
          shopId: m.shopId,
          status: { notIn: TERMINAL_STATUSES },
          OR: [{ pickupMembershipId: emp.id }, { serviceMembershipId: emp.id }],
        },
      });
      out.push(serializeStaff(emp, activeTasks));
    }
    return out;
  }

  private async validateEmployee(shopId: string, membershipId: string): Promise<string> {
    const emp = await this.prisma.membership.findFirst({
      where: { id: membershipId, shopId, role: Role.EMPLOYEE },
    });
    if (!emp) throw ApiException.validation('That staff member can’t be assigned.');
    return emp.id;
  }

  async assign(auth: AuthContext, bookingId: string, dto: AssignStaffDto): Promise<BookingDTO> {
    const m = this.manager(auth);
    const booking = await this.prisma.booking.findFirst({
      where: { id: bookingId, shopId: m.shopId },
    });
    if (!booking) throw ApiException.notFound('Booking not found.');

    const data: { pickupMembershipId?: string | null; serviceMembershipId?: string | null } = {};
    if (dto.pickupMembershipId !== undefined) {
      data.pickupMembershipId = dto.pickupMembershipId
        ? await this.validateEmployee(m.shopId, dto.pickupMembershipId)
        : null;
    }
    if (dto.serviceMembershipId !== undefined) {
      data.serviceMembershipId = dto.serviceMembershipId
        ? await this.validateEmployee(m.shopId, dto.serviceMembershipId)
        : null;
    }
    await this.prisma.booking.update({ where: { id: bookingId }, data });

    // Assigning a specialist to a fresh booking advances it to ASSIGNED.
    const after = await this.prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
    if (after.serviceMembershipId && after.status === BookingStatus.BOOKED) {
      await this.prisma.booking.update({
        where: { id: bookingId },
        data: { status: BookingStatus.ASSIGNED },
      });
    }
    return this.loadBooking(bookingId);
  }

  async createService(auth: AuthContext, dto: CreateServiceDto): Promise<ServiceDTO> {
    const m = this.manager(auth);
    const service = await this.prisma.service.create({
      data: {
        shopId: m.shopId,
        name: dto.name.trim(),
        description: dto.description?.trim() || null,
        pricePaise: dto.pricePaise,
        durationMin: dto.durationMin,
        photoUrl: dto.photoUrl?.trim() || null,
        icon: dto.icon?.trim() || 'sparkles',
        category: dto.category?.trim() || null,
        active: true,
      },
    });
    return serializeService(service);
  }

  async updateService(auth: AuthContext, id: string, dto: UpdateServiceDto): Promise<ServiceDTO> {
    const m = this.manager(auth);
    const existing = await this.prisma.service.findFirst({ where: { id, shopId: m.shopId } });
    if (!existing) throw ApiException.notFound('Service not found.');

    const service = await this.prisma.service.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.description !== undefined ? { description: dto.description?.trim() || null } : {}),
        ...(dto.pricePaise !== undefined ? { pricePaise: dto.pricePaise } : {}),
        ...(dto.durationMin !== undefined ? { durationMin: dto.durationMin } : {}),
        ...(dto.photoUrl !== undefined ? { photoUrl: dto.photoUrl?.trim() || null } : {}),
        ...(dto.icon !== undefined ? { icon: dto.icon?.trim() || null } : {}),
        ...(dto.active !== undefined ? { active: dto.active } : {}),
      },
    });
    return serializeService(service);
  }

  async getWorkingHours(auth: AuthContext): Promise<WorkingHoursDTO> {
    const m = this.manager(auth);
    const rows = await this.prisma.workingHour.findMany({ where: { shopId: m.shopId } });
    return workingHoursToDto(rows);
  }

  async setWorkingHours(auth: AuthContext, dto: SetWorkingHoursDto): Promise<WorkingHoursDTO> {
    const m = this.manager(auth);
    const pairs: [Weekday, DayHoursDto][] = [
      [Weekday.mon, dto.mon],
      [Weekday.tue, dto.tue],
      [Weekday.wed, dto.wed],
      [Weekday.thu, dto.thu],
      [Weekday.fri, dto.fri],
      [Weekday.sat, dto.sat],
      [Weekday.sun, dto.sun],
    ];
    await this.prisma.$transaction(
      pairs.map(([day, hours]) =>
        this.prisma.workingHour.upsert({
          where: { shopId_day: { shopId: m.shopId, day } },
          create: {
            shopId: m.shopId,
            day,
            open: hours.open,
            close: hours.close,
            capacity: hours.capacity,
            closed: hours.closed,
          },
          update: {
            open: hours.open,
            close: hours.close,
            capacity: hours.capacity,
            closed: hours.closed,
          },
        }),
      ),
    );
    const rows = await this.prisma.workingHour.findMany({ where: { shopId: m.shopId } });
    return workingHoursToDto(rows);
  }

  // ---- Staff management ----

  async createEmployee(auth: AuthContext, dto: CreateEmployeeDto): Promise<StaffMemberDTO> {
    const m = this.manager(auth);
    const phone = dto.phone.trim();
    const existing = await this.prisma.authIdentity.findUnique({
      where: { provider_subject: { provider: AuthProvider.PHONE, subject: phone } },
    });
    if (existing) throw ApiException.validation('That phone number is already in use.');

    const user = await this.prisma.user.create({
      data: {
        phone,
        name: dto.name.trim(),
        memberships: { create: { shopId: m.shopId, role: Role.EMPLOYEE } },
        // PHONE identity so the new employee can sign in via phone OTP.
        identities: { create: { provider: AuthProvider.PHONE, subject: phone, phoneSnapshot: phone } },
      },
    });
    const membership = await this.prisma.membership.findFirstOrThrow({
      where: { userId: user.id, shopId: m.shopId, role: Role.EMPLOYEE },
      include: { user: true },
    });
    return serializeStaff(membership, 0);
  }

  async removeEmployee(auth: AuthContext, membershipId: string): Promise<void> {
    const m = this.manager(auth);
    const emp = await this.prisma.membership.findFirst({
      where: { id: membershipId, shopId: m.shopId, role: Role.EMPLOYEE },
    });
    if (!emp) return;

    // Unassign from every booking, then remove the membership and revoke login.
    await this.prisma.$transaction([
      this.prisma.booking.updateMany({ where: { pickupMembershipId: membershipId }, data: { pickupMembershipId: null } }),
      this.prisma.booking.updateMany({ where: { serviceMembershipId: membershipId }, data: { serviceMembershipId: null } }),
      this.prisma.membership.delete({ where: { id: membershipId } }),
    ]);

    const remaining = await this.prisma.membership.count({ where: { userId: emp.userId } });
    if (remaining === 0) await this.prisma.user.delete({ where: { id: emp.userId } });
  }

  // ---- Vehicle search (by plate) ----

  async searchVehicles(auth: AuthContext, query: string): Promise<BookingDTO[]> {
    const m = this.manager(auth);
    const q = normalizePlate(query ?? '');
    if (q.length < 2) return [];
    const rows = await this.prisma.booking.findMany({
      where: { shopId: m.shopId, vehicleId: { not: null } },
      include: bookingInclude,
      orderBy: { scheduledAt: 'desc' },
    });
    return rows
      .filter((b) => b.vehicle?.plate && normalizePlate(b.vehicle.plate).includes(q))
      .map(serializeBooking);
  }

  // ---- Offers ----

  async createOffer(auth: AuthContext, dto: CreateOfferDto): Promise<OfferDTO> {
    const m = this.manager(auth);
    const offer = await this.prisma.offer.create({
      data: {
        shopId: m.shopId,
        title: dto.title.trim(),
        subtitle: dto.subtitle.trim(),
        badge: dto.badge.trim(),
        photoUrl: dto.photoUrl?.trim() || null,
      },
    });
    return serializeOffer(offer);
  }

  async deleteOffer(auth: AuthContext, id: string): Promise<void> {
    const m = this.manager(auth);
    await this.prisma.offer.deleteMany({ where: { id, shopId: m.shopId } });
  }

  // ---- Finance ----

  async getFinance(auth: AuthContext): Promise<FinanceTxnDTO[]> {
    const m = this.manager(auth);
    const rows = await this.prisma.financeTxn.findMany({
      where: { shopId: m.shopId },
      orderBy: { date: 'desc' },
    });
    return rows.map(serializeFinanceTxn);
  }

  async createExpense(auth: AuthContext, dto: CreateExpenseDto): Promise<FinanceTxnDTO> {
    const m = this.manager(auth);
    const tx = await this.prisma.financeTxn.create({
      data: {
        shopId: m.shopId,
        type: (dto.type ?? 'expense') as TxnType,
        category: dto.category.trim(),
        note: dto.note?.trim() || null,
        amountPaise: dto.amountPaise,
        date: dto.date ? new Date(dto.date) : new Date(),
      },
    });
    return serializeFinanceTxn(tx);
  }

  async deleteTransaction(auth: AuthContext, id: string): Promise<void> {
    const m = this.manager(auth);
    await this.prisma.financeTxn.deleteMany({ where: { id, shopId: m.shopId } });
  }
}
