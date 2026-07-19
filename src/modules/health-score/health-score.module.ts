import { Module } from '@nestjs/common';
import { HealthScoreController } from './health-score.controller';
import { HealthScoreService } from './health-score.service';
import { EventsModule } from '../events/events.module';

@Module({
  imports: [EventsModule],
  controllers: [HealthScoreController],
  providers: [HealthScoreService],
  exports: [HealthScoreService],
})
export class HealthScoreModule {}
