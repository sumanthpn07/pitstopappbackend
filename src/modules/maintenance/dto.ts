// ─── Maintenance Template DTOs ─────────────────────────────────

export interface MaintenanceTemplateItemDto {
  serviceType: string;
  intervalKm?: number; // odometer-based trigger interval
  intervalMonths?: number; // time-based trigger interval
}

export interface CreateMaintenanceTemplateDto {
  make: string;
  model: string;
  items: MaintenanceTemplateItemDto[];
}

// ─── Maintenance Schedule Response ─────────────────────────────

export interface MaintenanceScheduleItemResponse {
  id: string;
  serviceType: string;
  dueDate: string | null;
  dueOdometerKm: number | null;
  estimatedCostPaise: number | null; // null means "unavailable"
  urgency: 'OVERDUE' | 'DUE_SOON' | 'UPCOMING';
  completed: boolean;
  completedAt: string | null;
}
