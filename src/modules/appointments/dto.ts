// ─── Book Appointment ──────────────────────────────────────────

export interface BookAppointmentServiceItem {
  serviceId: string;
}

export interface BookAppointmentDto {
  vehicleRecordId: string;
  services: BookAppointmentServiceItem[];
  scheduledAt: string; // ISO 8601
  tenantId?: string; // optional if resolved from context
}

// ─── Availability Query ────────────────────────────────────────

export interface AvailabilityQueryDto {
  tenantId: string;
}

// ─── Availability Response ─────────────────────────────────────

export interface TimeSlot {
  start: string; // ISO 8601
  end: string; // ISO 8601
  remaining: number;
}

export interface DayAvailability {
  date: string; // YYYY-MM-DD
  slots: TimeSlot[];
}

// ─── Cancel ────────────────────────────────────────────────────

export interface CancelAppointmentDto {
  reason?: string;
}
