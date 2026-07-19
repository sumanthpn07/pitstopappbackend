import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import { Role } from '@prisma/client';
import { CurrentUser, Roles } from '../../common/decorators';
import type { AuthContext } from '../../common/auth.types';
import { TenantsService } from './tenants.service';
import { CreateTenantDto, UpdateTenantConfigDto } from './dto';

@Controller('tenants')
export class TenantsController {
  constructor(private readonly tenants: TenantsService) {}

  /**
   * POST /tenants
   * Creates a new tenant with default provisioning and assigns the creating
   * user as MANAGER. Any authenticated user can create a tenant.
   */
  @Post()
  create(@CurrentUser() auth: AuthContext, @Body() dto: CreateTenantDto) {
    return this.tenants.createTenant(auth.userId, dto);
  }

  /**
   * GET /tenants/:id/config
   * Returns tenant configuration (gstRate, slotDurationMin, slotCapacity,
   * working hours, notification prefs). Requires MANAGER role.
   */
  @Get(':id/config')
  @Roles(Role.MANAGER)
  getConfig(@Param('id') id: string) {
    return this.tenants.getConfig(id);
  }

  /**
   * PATCH /tenants/:id/config
   * Partially updates tenant configuration. Requires MANAGER role.
   */
  @Patch(':id/config')
  @Roles(Role.MANAGER)
  updateConfig(@Param('id') id: string, @Body() dto: UpdateTenantConfigDto) {
    return this.tenants.updateConfig(id, dto);
  }

  /**
   * POST /tenants/:id/deactivate
   * Deactivates a tenant. Retains data for historical continuity but prevents
   * new job cards or data modifications. Requires MANAGER role.
   */
  @Post(':id/deactivate')
  @Roles(Role.MANAGER)
  @HttpCode(HttpStatus.OK)
  deactivate(@Param('id') id: string) {
    return this.tenants.deactivate(id);
  }
}
