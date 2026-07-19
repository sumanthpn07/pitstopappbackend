import { Module } from '@nestjs/common';
import { MigrationService } from './migration.service';
import { MigrationController } from './migration.controller';

@Module({
  controllers: [MigrationController],
  providers: [MigrationService],
  exports: [MigrationService],
})
export class MigrationModule {}
