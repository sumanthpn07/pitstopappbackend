import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { Role } from '@prisma/client';
import { CurrentUser, Roles } from '../../common/decorators';
import type { AuthContext } from '../../common/auth.types';
import { TasksService } from './tasks.service';
import { PickupTripLocationDto, SubmitConditionReportDto, ToggleChecklistDto } from './dto';

@Controller('tasks')
@Roles(Role.EMPLOYEE)
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Get()
  myTasks(@CurrentUser() auth: AuthContext) {
    return this.tasks.myTasks(auth);
  }

  @Post(':bookingId/condition-reports')
  submitReport(
    @CurrentUser() auth: AuthContext,
    @Param('bookingId') bookingId: string,
    @Body() dto: SubmitConditionReportDto,
  ) {
    return this.tasks.submitReport(auth, bookingId, dto);
  }

  @Patch(':bookingId/checklist/:itemId')
  toggleChecklist(
    @CurrentUser() auth: AuthContext,
    @Param('bookingId') bookingId: string,
    @Param('itemId') itemId: string,
    @Body() dto: ToggleChecklistDto,
  ) {
    return this.tasks.toggleChecklist(auth, bookingId, itemId, dto.done);
  }

  @Post(':bookingId/pickup-trip/start')
  startPickupTrip(
    @CurrentUser() auth: AuthContext,
    @Param('bookingId') bookingId: string,
    @Body() dto: PickupTripLocationDto,
  ) {
    return this.tasks.startPickupTrip(auth, bookingId, dto);
  }

  @Post(':bookingId/pickup-trip/location')
  pushPickupLocation(
    @CurrentUser() auth: AuthContext,
    @Param('bookingId') bookingId: string,
    @Body() dto: PickupTripLocationDto,
  ) {
    return this.tasks.pushPickupLocation(auth, bookingId, dto);
  }

  @Post(':bookingId/pickup-trip/arrive-garage')
  arriveGarage(
    @CurrentUser() auth: AuthContext,
    @Param('bookingId') bookingId: string,
    @Body() dto: PickupTripLocationDto,
  ) {
    return this.tasks.arriveGarage(auth, bookingId, dto);
  }
}
