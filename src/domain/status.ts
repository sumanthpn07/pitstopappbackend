import { BookingStatus } from '@prisma/client';

export const TERMINAL_STATUSES: BookingStatus[] = [
  BookingStatus.COMPLETED,
  BookingStatus.CANCELLED,
  BookingStatus.NO_SHOW,
];

/** Statuses from which a customer may still cancel. */
export const CANCELLABLE_STATUSES: BookingStatus[] = [
  BookingStatus.BOOKED,
  BookingStatus.ASSIGNED,
  BookingStatus.CONDITION_PENDING,
];

export function isActive(status: BookingStatus): boolean {
  return !TERMINAL_STATUSES.includes(status);
}

export function isCancellable(status: BookingStatus): boolean {
  return CANCELLABLE_STATUSES.includes(status);
}
