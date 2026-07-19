export { EventsModule } from './events.module';
export { EventsService, type PublishOptions } from './events.service';
export { EventConsumerLogService } from './event-consumer-log.service';
export { EventTypes, type EventType, type OutboxEventPayload } from './event-types';
export type {
  JobCardCompletedPayload,
  JobCardCancelledPayload,
  ServiceEventCreatedPayload,
  InvoiceGeneratedPayload,
  InvoicePaidPayload,
  HealthScoreAlertPayload,
  InventoryLowStockPayload,
  DeadLetterPayload,
} from './event-types';
