import { localDateTime } from './datetime';
import type { AvailabilitySlotDTO } from './contracts';

export interface BookingWindow {
  startMs: number;
  endMs: number;
}

export interface SlotComputation {
  dateKey: string;
  zone: string;
  open: string; // HH:MM
  close: string; // HH:MM
  capacity: number;
  durationMin: number;
  now: Date;
  bookings: BookingWindow[];
  stepMin?: number;
}

/**
 * Generate bookable start times for a day: fixed-step slots between opening and
 * the latest start that still fits before close, dropping past slots and any
 * slot where concurrent bookings already fill the shop's capacity.
 *
 * Mirrors the client's mock availability logic so behaviour is identical.
 */
export function computeSlots(input: SlotComputation): AvailabilitySlotDTO[] {
  const stepMs = (input.stepMin ?? 30) * 60_000;
  const durationMs = input.durationMin * 60_000;
  const openMs = localDateTime(input.dateKey, input.open, input.zone).toMillis();
  const closeMs = localDateTime(input.dateKey, input.close, input.zone).toMillis();
  const lastStart = closeMs - durationMs;
  const nowMs = input.now.getTime();

  const slots: AvailabilitySlotDTO[] = [];
  for (let t = openMs; t <= lastStart; t += stepMs) {
    if (t < nowMs) continue; // no slots in the past
    const start = t;
    const end = t + durationMs;
    const overlapping = input.bookings.filter((b) => b.startMs < end && b.endMs > start).length;
    const remaining = input.capacity - overlapping;
    if (remaining > 0) {
      slots.push({ startAt: new Date(start).toISOString(), remaining });
    }
  }
  return slots;
}
