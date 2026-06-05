import { Body, Controller, Get, Post } from '@nestjs/common';
import { Role } from '@prisma/client';
import { CurrentUser, Roles } from '../../common/decorators';
import type { AuthContext } from '../../common/auth.types';
import { VehiclesService } from './vehicles.service';
import { CreateVehicleDto } from './dto';

@Controller('vehicles')
@Roles(Role.CUSTOMER)
export class VehiclesController {
  constructor(private readonly vehicles: VehiclesService) {}

  @Get()
  list(@CurrentUser() auth: AuthContext) {
    return this.vehicles.list(auth);
  }

  @Post()
  create(@CurrentUser() auth: AuthContext, @Body() dto: CreateVehicleDto) {
    return this.vehicles.create(auth, dto);
  }
}
