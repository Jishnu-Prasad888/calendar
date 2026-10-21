import type { CalendarEvent } from '../domain';

const DAY_MS = 86_400_000;

export function dateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${String(year)}-${month}-${day}`;
}

export function localDateTimeValue(value: string): string {
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export function toIsoFromLocal(value: string): string {
  return new Date(value).toISOString();
}

export function addDays(date: Date, amount: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + amount);
  return result;
}

export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function endOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
}

export function startOfWeek(date: Date, weekStartsOn: number): Date {
  const result = startOfDay(date);
  const distance = (result.getDay() - weekStartsOn + 7) % 7;
  result.setDate(result.getDate() - distance);
  return result;
}

export function datesInMonth(date: Date): Date[] {
  const first = new Date(date.getFullYear(), date.getMonth(), 1);
  const last = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  return Array.from({ length: last.getDate() }, (_, index) =>
    addDays(first, index),
  );
}

export function rangesOverlap(
  start: string,
  end: string,
  rangeStart: string,
  rangeEnd: string,
): boolean {
  return (
    new Date(start).getTime() < new Date(rangeEnd).getTime() &&
    new Date(end).getTime() > new Date(rangeStart).getTime()
  );
}

export function daysBetween(start: Date, end: Date): number {
  return Math.max(1, Math.round((end.getTime() - start.getTime()) / DAY_MS));
}

const SCROLL_LEAD_MINUTES = 30;

/**
 * Time-grid scroll position for today: a little before the first timed event,
 * or before the current time when today has none.
 */
export function scrollTimeFor(
  events: readonly CalendarEvent[],
  now: Date,
): string {
  const today = dateKey(now);
  let first: Date | undefined;
  for (const event of events) {
    if (event.allDay) continue;
    const start = new Date(event.start);
    if (dateKey(start) === today && (!first || start < first)) first = start;
  }
  const target = first ?? now;
  const minutes = Math.max(
    0,
    target.getHours() * 60 + target.getMinutes() - SCROLL_LEAD_MINUTES,
  );
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}:00`;
}
