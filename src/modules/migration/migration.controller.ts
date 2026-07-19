import { Controller, Post, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { Roles } from '../../common/decorators';
import { MigrationService } from './migration.service';
import type { MigrationReport } from './migration.service';

@Controller('migration')
export class MigrationController {
  constructor(private readonly migrationService: MigrationService) {}

  /**
   * POST /migration/run
   * Trigger the full data migration. Secured to MANAGER role only.
   */
  @Post('run')
  @Roles('MANAGER' as any)
  @HttpCode(HttpStatus.OK)
  async runMigration(): Promise<MigrationReport> {
    return this.migrationService.runFullMigration();
  }

  /**
   * GET /migration/report
   * Get the latest migration report (re-computes counts from current state).
   */
  @Get('report')
  @Roles('MANAGER' as any)
  @HttpCode(HttpStatus.OK)
  async getReport(): Promise<{
    vehicleRecords: number;
    serviceEvents: number;
    ownershipRecords: number;
    jobCards: number;
  }> {
    const [vehicleRecords, serviceEvents, ownershipRecords, jobCards] = await Promise.all([
      this.migrationService['prisma'].vehicleRecord.count({
        where: { legacyVehicleId: { not: null } },
      }),
      this.migrationService['prisma'].serviceEvent.count({
        where: { source: 'MIGRATION' },
      }),
      this.migrationService['prisma'].ownershipRecord.count({
        where: { transferType: 'LEGACY_MIGRATION' },
      }),
      this.migrationService['prisma'].jobCard.count({
        where: { notes: { startsWith: 'legacy-booking:' } },
      }),
    ]);

    return { vehicleRecords, serviceEvents, ownershipRecords, jobCards };
  }
}
