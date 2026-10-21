import { describe, expect, it } from 'vitest';
import type { CalendarEvent } from '../domain';
import { scrollTimeFor } from './date';

function event(start: Date, allDay = false): CalendarEvent {
  return {
    id: start.toISOString(),
    calendarId: 'primary',
    title: 'Event',
    start: start.toISOString(),
    end: new Date(start.getTime() + 3_600_000).toISOString(),
    allDay,
    color: '#1a73e8',
    status: 'confirmed',
    readOnly: false,
    attendees: [],
    reminders: [],
    privacy: 'default',
    availability: 'busy',
  };
}

describe('scrollTimeFor', () => {
  const now = new Date(2026, 9, 21, 15, 10);

  it('scrolls to just before the first timed event today', () => {
    const events = [
      event(new Date(2026, 9, 21, 11, 0)),
      event(new Date(2026, 9, 21, 9, 15)),
      event(new Date(2026, 9, 21, 0, 0), true),
      event(new Date(2026, 9, 20, 7, 0)),
    ];
    expect(scrollTimeFor(events, now)).toBe('08:45:00');
  });

  it('falls back to the current time and never goes before midnight', () => {
    expect(scrollTimeFor([], now)).toBe('14:40:00');
    expect(scrollTimeFor([event(new Date(2026, 9, 21, 0, 10))], now)).toBe(
      '00:00:00',
    );
  });
});
