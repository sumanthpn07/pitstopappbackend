import { JobCardStatus } from '@prisma/client';

// ─── Create Job Card ───────────────────────────────────────────

export interface CreateJobCardServiceItem {
  serviceId: string;
}

export interface CreateJobCardDto {
  vehicleRecordId: string;
  customerId: string;
  services: CreateJobCardServiceItem[];
  scheduledAt?: string; // ISO 8601
  notes?: string;
}

// ─── Transition ────────────────────────────────────────────────

export interface TransitionJobCardDto {
  targetStatus: JobCardStatus;
  assignedTechId?: string;
  estimatedCompletion?: string; // ISO 8601 future datetime
  reworkReason?: string;
  cancellationReason?: string;
}

// ─── Log Parts ─────────────────────────────────────────────────

export interface LogPartsDto {
  inventoryItemId: string;
  quantity: number;
}

// ─── Add Note ──────────────────────────────────────────────────

export interface AddNoteDto {
  content: string;
}

// ─── Cancel ────────────────────────────────────────────────────

export interface CancelJobCardDto {
  reason?: string;
}
