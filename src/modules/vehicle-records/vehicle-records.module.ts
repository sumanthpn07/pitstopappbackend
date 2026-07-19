import { Module } from '@nestjs/common';
import { VehicleRecordsService } from './vehicle-records.service';
import { OwnershipService } from './ownership.service';
import { ServiceHistoryService } from './service-history.service';
import { VehicleRecordsController } from './vehicle-records.controller';

@Module({
  controllers: [VehicleRecordsController],
  providers: [VehicleRecordsService, OwnershipService, ServiceHistoryService],
  exports: [VehicleRecordsService, OwnershipService, ServiceHistoryService],
})
export class VehicleRecordsModule {}
