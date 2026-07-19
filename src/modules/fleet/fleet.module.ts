import { Module } from '@nestjs/common';
import { FleetController } from './fleet.controller';
import { FleetService } from './fleet.service';
import { EventsModule } from '../events/events.module';

@Module({
  imports: [EventsModule],
  controllers: [FleetController],
  providers: [FleetService],
  exports: [FleetService],
})
export class FleetModule {}
