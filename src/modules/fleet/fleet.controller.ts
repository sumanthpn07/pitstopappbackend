import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators';
import type { AuthContext } from '../../common/auth.types';
import { FleetService } from './fleet.service';
import type { CreateFleetDto, AddVehicleToFleetDto } from './dto';

@Controller('fleets')
export class FleetController {
  constructor(private readonly fleetService: FleetService) {}

  /** Create a new fleet. */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  createFleet(@CurrentUser() auth: AuthContext, @Body() dto: CreateFleetDto) {
    return this.fleetService.createFleet(auth.userId, dto);
  }

  /** Get fleet dashboard data. */
  @Get(':id')
  getFleetDashboard(@CurrentUser() auth: AuthContext, @Param('id') id: string) {
    return this.fleetService.getFleetDashboard(id, auth.userId);
  }

  /** Add a vehicle to a fleet. */
  @Post(':id/vehicles')
  @HttpCode(HttpStatus.CREATED)
  addVehicle(
    @CurrentUser() auth: AuthContext,
    @Param('id') id: string,
    @Body() dto: AddVehicleToFleetDto,
  ) {
    return this.fleetService.addVehicle(id, auth.userId, dto);
  }

  /** Remove a vehicle from a fleet. */
  @Delete(':id/vehicles/:vehicleId')
  removeVehicle(
    @CurrentUser() auth: AuthContext,
    @Param('id') id: string,
    @Param('vehicleId') vehicleId: string,
  ) {
    return this.fleetService.removeVehicle(id, vehicleId, auth.userId);
  }

  /** Get fleet cost analytics. */
  @Get(':id/analytics')
  getFleetAnalytics(@CurrentUser() auth: AuthContext, @Param('id') id: string) {
    return this.fleetService.getFleetAnalytics(id, auth.userId);
  }
}
