import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { CurrentUser, Roles } from '../../common/decorators';
import type { AuthContext } from '../../common/auth.types';
import { ManageService } from './manage.service';
import {
  AssignStaffDto,
  CreateServiceDto,
  SetWorkingHoursDto,
  UpdateServiceDto,
} from './dto';

@Controller('manage')
@Roles(Role.MANAGER)
export class ManageController {
  constructor(private readonly manage: ManageService) {}

  @Get('bookings')
  bookings(@CurrentUser() auth: AuthContext) {
    return this.manage.allBookings(auth);
  }

  @Get('services')
  services(@CurrentUser() auth: AuthContext) {
    return this.manage.allServices(auth);
  }

  @Get('staff')
  staff(@CurrentUser() auth: AuthContext) {
    return this.manage.staff(auth);
  }

  @Post('bookings/:bookingId/assign')
  @HttpCode(HttpStatus.OK)
  assign(
    @CurrentUser() auth: AuthContext,
    @Param('bookingId') bookingId: string,
    @Body() dto: AssignStaffDto,
  ) {
    return this.manage.assign(auth, bookingId, dto);
  }

  @Post('services')
  createService(@CurrentUser() auth: AuthContext, @Body() dto: CreateServiceDto) {
    return this.manage.createService(auth, dto);
  }

  @Patch('services/:id')
  updateService(
    @CurrentUser() auth: AuthContext,
    @Param('id') id: string,
    @Body() dto: UpdateServiceDto,
  ) {
    return this.manage.updateService(auth, id, dto);
  }

  @Get('working-hours')
  getWorkingHours(@CurrentUser() auth: AuthContext) {
    return this.manage.getWorkingHours(auth);
  }

  @Put('working-hours')
  setWorkingHours(@CurrentUser() auth: AuthContext, @Body() dto: SetWorkingHoursDto) {
    return this.manage.setWorkingHours(auth, dto);
  }
}
