import { Module } from '@nestjs/common';
import { JobCardsController } from './job-cards.controller';
import { JobCardsService } from './job-cards.service';
import { EventsModule } from '../events/events.module';

@Module({
  imports: [EventsModule],
  controllers: [JobCardsController],
  providers: [JobCardsService],
  exports: [JobCardsService],
})
export class JobCardsModule {}
