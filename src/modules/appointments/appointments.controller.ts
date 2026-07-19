import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators';
import type { AuthContext } from '../../common/auth.types';
import { AppointmentsService } from './appointments.service';
import type { BookAppointmentDto, CancelAppointmentDto } from './dto';

@Controller('appointments')
export class AppointmentsController {
  constructor(private readonly appointmentsService: AppointmentsService) {}

  /**
   * GET /appointments/availability?tenantId=X
   * Returns 14-day availability with remaining slots per time slot.
   */
  @Get('availability')
  getAvailability(@Query('tenantId') tenantId: string) {
    if (!tenantId) {
      return { statusCode: 400, message: 'tenantId query parameter is required.' };
    }
    return this.appointmentsService.getAvailability(tenantId);
  }

  /**
   * POST /appointments
   * Book an appointment. Creates JobCard with CREATED status and scheduledAt.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  book(@CurrentUser() auth: AuthContext, @Body() dto: BookAppointmentDto) {
    return this.appointmentsService.book(auth.userId, dto);
  }

  /**
   * PATCH /appointments/:id/cancel
   * Cancel an appointment. Applies 2-hour threshold logic.
   */
  @Patch(':id/cancel')
  cancel(@Param('id') id: string, @Body() dto: CancelAppointmentDto) {
    return this.appointmentsService.cancel(id, dto.reason);
  }

  /**
   * GET /appointments/queue
   * Today's queue for the current tenant, sorted by scheduledAt.
   */
  @Get('queue')
  getQueue() {
    return this.appointmentsService.getQueue();
  }
}
