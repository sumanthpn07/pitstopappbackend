import { Module } from '@nestjs/common';
import { InvoicingController } from './invoicing.controller';
import { InvoicingService } from './invoicing.service';
import { EventsModule } from '../events/events.module';

@Module({
  imports: [EventsModule],
  controllers: [InvoicingController],
  providers: [InvoicingService],
  exports: [InvoicingService],
})
export class InvoicingModule {}
