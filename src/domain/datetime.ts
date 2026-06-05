import { DateTime } from 'luxon';
import { Weekday } from '@prisma/client';

const LUXON_TO_WEEKDAY: Record<number, Weekday> = {
  1: Weekday.mon,
  2: Weekday.tue,
  3: Weekday.wed,
  4: Weekday.thu,
  5: Weekday.fri,
  6: Weekday.sat,
  7: Weekday.sun,
};

/** Weekday (in the shop's timezone) for a "YYYY-MM-DD" calendar date. */
export function weekdayOf(dateKey: string, zone: string): Weekday {
  const dt = DateTime.fromISO(dateKey, { zone });
  return LUXON_TO_WEEKDAY[dt.weekday];
}

/** A wall-clock time on a date, interpreted in the shop's timezone. */
export function localDateTime(dateKey: string, hhmm: string, zone: string): DateTime {
  return DateTime.fromISO(`${dateKey}T${hhmm}`, { zone });
}

export function startOfDayUtc(dateKey: string, zone: string): Date {
  return DateTime.fromISO(dateKey, { zone }).startOf('day').toUTC().toJSDate();
}

export function endOfDayUtc(dateKey: string, zone: string): Date {
  return DateTime.fromISO(dateKey, { zone }).endOf('day').toUTC().toJSDate();
}

/** True for a well-formed "YYYY-MM-DD" string. */
export function isValidDateKey(dateKey: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(dateKey) && DateTime.fromISO(dateKey).isValid;
}
