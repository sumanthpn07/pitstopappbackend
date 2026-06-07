import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { CurrentUser, Roles } from '../../common/decorators';
import type { AuthContext } from '../../common/auth.types';
import { ManageService } from './manage.service';
import {
  AssignStaffDto,
  CreateEmployeeDto,
  CreateExpenseDto,
  CreateOfferDto,
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

  @Post('staff')
  createEmployee(@CurrentUser() auth: AuthContext, @Body() dto: CreateEmployeeDto) {
    return this.manage.createEmployee(auth, dto);
  }

  @Delete('staff/:membershipId')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeEmployee(@CurrentUser() auth: AuthContext, @Param('membershipId') membershipId: string) {
    return this.manage.removeEmployee(auth, membershipId);
  }

  @Get('vehicles')
  searchVehicles(@CurrentUser() auth: AuthContext, @Query('q') q: string) {
    return this.manage.searchVehicles(auth, q ?? '');
  }

  @Post('offers')
  createOffer(@CurrentUser() auth: AuthContext, @Body() dto: CreateOfferDto) {
    return this.manage.createOffer(auth, dto);
  }

  @Delete('offers/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteOffer(@CurrentUser() auth: AuthContext, @Param('id') id: string) {
    return this.manage.deleteOffer(auth, id);
  }

  @Get('finance')
  finance(@CurrentUser() auth: AuthContext) {
    return this.manage.getFinance(auth);
  }

  @Post('finance/expenses')
  createExpense(@CurrentUser() auth: AuthContext, @Body() dto: CreateExpenseDto) {
    return this.manage.createExpense(auth, dto);
  }

  @Delete('finance/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteTransaction(@CurrentUser() auth: AuthContext, @Param('id') id: string) {
    return this.manage.deleteTransaction(auth, id);
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
