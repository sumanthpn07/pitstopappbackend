import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { Role } from '@prisma/client';
import { CurrentUser, Roles } from '../../common/decorators';
import type { AuthContext } from '../../common/auth.types';
import { BookingsService } from './bookings.service';
import { CreateBookingDto } from './dto';

@Controller()
export class BookingsController {
  constructor(private readonly bookings: BookingsService) {}

  @Roles(Role.CUSTOMER)
  @Get('bookings')
  list(@CurrentUser() auth: AuthContext) {
    return this.bookings.listForCustomer(auth);
  }

  // Visible to the owning customer or staff in the same shop (checked in service).
  @Get('bookings/:id')
  getOne(@CurrentUser() auth: AuthContext, @Param('id') id: string) {
    return this.bookings.getOne(auth, id);
  }

  @Get('bookings/:id/tracking')
  tracking(@CurrentUser() auth: AuthContext, @Param('id') id: string) {
    return this.bookings.getTracking(auth, id);
  }

  @Roles(Role.CUSTOMER)
  @Post('bookings')
  create(@CurrentUser() auth: AuthContext, @Body() dto: CreateBookingDto) {
    return this.bookings.create(auth, dto);
  }

  @Roles(Role.CUSTOMER)
  @Post('bookings/:id/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(@CurrentUser() auth: AuthContext, @Param('id') id: string) {
    return this.bookings.cancel(auth, id);
  }

  @Roles(Role.CUSTOMER)
  @Post('condition-reports/:reportId/verify')
  @HttpCode(HttpStatus.OK)
  verify(@CurrentUser() auth: AuthContext, @Param('reportId') reportId: string) {
    return this.bookings.verifyConditionReport(auth, reportId);
  }
}
