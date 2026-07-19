import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { EventsService } from './events.service';
import { EventConsumerLogService } from './event-consumer-log.service';

@Module({
  imports: [
    EventEmitterModule.forRoot({
      // Use wildcard so we can listen on event.* patterns if needed
      wildcard: false,
      // Increase max listeners for multiple consumers per event
      maxListeners: 20,
    }),
    ScheduleModule.forRoot(),
  ],
  providers: [EventsService, EventConsumerLogService],
  exports: [EventsService, EventConsumerLogService],
})
export class EventsModule {}
