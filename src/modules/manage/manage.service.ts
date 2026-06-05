import { Injectable } from '@nestjs/common';
import { BookingStatus, Role, Weekday } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ApiException } from '../../common/api-exception';
import { membershipForRole, type AuthContext, type AuthMembership } from '../../common/auth.types';
import { TERMINAL_STATUSES } from '../../domain/status';
import {
  bookingInclude,
  serializeBooking,
  serializeService,
  serializeStaff,
  workingHoursToDto,
} from '../../domain/serializers';
import type {
  BookingDTO,
  ServiceDTO,
  StaffMemberDTO,
  WorkingHoursDTO,
} from '../../domain/contracts';
import type {
  AssignStaffDto,
  CreateServiceDto,
  DayHoursDto,
  SetWorkingHoursDto,
  UpdateServiceDto,
} from './dto';

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
}
