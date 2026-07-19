import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { MaintenanceService } from './maintenance.service';
import type { CreateMaintenanceTemplateDto } from './dto';

@Controller('maintenance')
export class MaintenanceController {
  constructor(private readonly maintenanceService: MaintenanceService) {}

  /** Create or update a maintenance template (per make/model). */
  @Post('templates')
  @HttpCode(HttpStatus.CREATED)
  createTemplate(@Body() dto: CreateMaintenanceTemplateDto) {
    return this.maintenanceService.createOrUpdateTemplate(dto);
  }

  /** List all maintenance templates for the current tenant. */
  @Get('templates')
  listTemplates() {
    return this.maintenanceService.listTemplates();
  }

  /** Get the computed maintenance schedule for a vehicle. */
  @Get('schedule/:vehicleId')
  getSchedule(@Param('vehicleId') vehicleId: string) {
    return this.maintenanceService.getSchedule(vehicleId);
  }
}
