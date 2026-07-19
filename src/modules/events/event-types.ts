/**
 * Event type constants and payload interfaces for the Vehicle Lifecycle Platform Event Bus.
 *
 * All events follow a common envelope shape (OutboxEventPayload) and carry
 * domain-specific data in `data`.
 */

// ─── Event Type Constants ──────────────────────────────────────

export const EventTypes = {
  JOB_CARD_COMPLETED: 'job-card.completed',
  JOB_CARD_CANCELLED: 'job-card.cancelled',
  SERVICE_EVENT_CREATED: 'service-event.created',
  INVOICE_GENERATED: 'invoice.generated',
  INVOICE_PAID: 'invoice.paid',
  HEALTH_SCORE_UPDATED: 'health-score.updated',
  HEALTH_SCORE_ALERT: 'health-score.alert',
  INVENTORY_LOW_STOCK: 'inventory.low-stock',
  MAINTENANCE_OVERDUE: 'maintenance.overdue',
  MAINTENANCE_DUE_SOON: 'maintenance.due-soon',
  OWNERSHIP_TRANSFER_INITIATED: 'ownership.transfer-initiated',
  OWNERSHIP_TRANSFER_CONFIRMED: 'ownership.transfer-confirmed',
  OWNERSHIP_TRANSFER_EXPIRED: 'ownership.transfer-expired',
  APPOINTMENT_REMINDER: 'appointment.reminder',
  APPOINTMENT_NO_SHOW: 'appointment.no-show',
  DOCUMENT_EXPIRY_REMINDER: 'document.expiry-reminder',
  DEAD_LETTER: 'event.dead-lettered',
} as const;

export type EventType = (typeof EventTypes)[keyof typeof EventTypes];

// ─── Common Envelope ───────────────────────────────────────────

export interface OutboxEventPayload<T = unknown> {
  eventType: EventType;
  sourceEntity: string;
  sourceId: string;
  data: T;
  occurredAt: string; // ISO 8601
}

// ─── Domain-Specific Payloads ──────────────────────────────────

export interface JobCardCompletedPayload {
  jobCardId: string;
  tenantId: string;
  vehicleRecordId: string;
  customerId: string;
  services: Array<{ serviceId: string; name: string; pricePaise: number }>;
  partsConsumed: Array<{
    inventoryItemId: string;
    quantity: number;
    unitCostPaise: number;
  }>;
  assignedTechId: string | null;
  completedAt: string;
}

export interface JobCardCancelledPayload {
  jobCardId: string;
  tenantId: string;
  vehicleRecordId: string;
  partsToReverse: Array<{
    inventoryItemId: string;
    quantity: number;
  }>;
  cancellationReason: string;
}

export interface ServiceEventCreatedPayload {
  serviceEventId: string;
  vehicleRecordId: string;
  tenantId: string | null;
  category: string;
  serviceType: string;
  odometerKm: number | null;
  completedAt: string;
}

export interface InvoiceGeneratedPayload {
  invoiceId: string;
  tenantId: string;
  jobCardId: string;
  customerId: string;
  totalPaise: number;
}

export interface InvoicePaidPayload {
  invoiceId: string;
  tenantId: string;
  customerId: string;
  totalPaise: number;
}

export interface HealthScoreAlertPayload {
  vehicleRecordId: string;
  userId: string;
  previousScore: number;
  newScore: number;
}

export interface InventoryLowStockPayload {
  inventoryItemId: string;
  tenantId: string;
  name: string;
  currentQuantity: number;
  reorderThreshold: number;
}

export interface DeadLetterPayload {
  originalEventId: string;
  originalEventType: string;
  failureReason: string;
  retryCount: number;
  tenantId?: string;
}
