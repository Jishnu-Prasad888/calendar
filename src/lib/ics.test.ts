import { describe, expect, it } from 'vitest';
import { isIcsFile, parseIcs } from './ics';

const calendar = (body: string) =>
  ['BEGIN:VCALENDAR', 'VERSION:2.0', body, 'END:VCALENDAR'].join('\r\n');

describe('parseIcs', () => {
  it('reads a timed event with folded text and alarms', () => {
    const [event] = parseIcs(
      calendar(
        [
          'BEGIN:VEVENT',
          'UID:1',
          'SUMMARY:Design review\\, round 2',
          'DESCRIPTION:Bring the\\nmockups and a long line that is',
          '  folded',
          'LOCATION:Room 4',
          'DTSTART:20261020T090000Z',
          'DTEND:20261020T100000Z',
          'ATTENDEE:mailto:someone@example.com',
          'BEGIN:VALARM',
          'ACTION:DISPLAY',
          'TRIGGER:-PT15M',
          'END:VALARM',
          'BEGIN:VALARM',
          'ACTION:EMAIL',
          'TRIGGER:-P1D',
          'END:VALARM',
          'END:VEVENT',
        ].join('\r\n'),
      ),
    );

    expect(event).toEqual({
      title: 'Design review, round 2',
      description: 'Bring the\nmockups and a long line that is folded',
      location: 'Room 4',
      start: '2026-10-20T09:00:00.000Z',
      end: '2026-10-20T10:00:00.000Z',
      allDay: false,
      reminders: [
        { method: 'popup', minutes: 15 },
        { method: 'email', minutes: 1440 },
      ],
      recurrence: undefined,
      privacy: 'default',
      availability: 'busy',
    });
  });

  it('converts zoned times and keeps recurrence rules', () => {
    const [event] = parseIcs(
      calendar(
        [
          'BEGIN:VEVENT',
          'SUMMARY:Standup',
          'DTSTART;TZID=America/New_York:20260715T093000',
          'DURATION:PT15M',
          'RRULE:FREQ=WEEKLY;BYDAY=MO,WE',
          'END:VEVENT',
        ].join('\n'),
      ),
    );

    expect(event.start).toBe('2026-07-15T13:30:00.000Z');
    expect(event.end).toBe('2026-07-15T13:45:00.000Z');
    expect(event.recurrence).toEqual(['RRULE:FREQ=WEEKLY;BYDAY=MO,WE']);
  });

  it('reads all-day events and defaults a missing end to one day', () => {
    const events = parseIcs(
      calendar(
        [
          'BEGIN:VEVENT',
          'SUMMARY:Offsite',
          'DTSTART;VALUE=DATE:20261101',
          'DTEND;VALUE=DATE:20261103',
          'END:VEVENT',
          'BEGIN:VEVENT',
          'SUMMARY:Holiday',
          'DTSTART;VALUE=DATE:20261225',
          'END:VEVENT',
        ].join('\n'),
      ),
    );

    expect(
      events.map(({ start, end, allDay }) => [start, end, allDay]),
    ).toEqual([
      ['2026-11-01', '2026-11-03', true],
      ['2026-12-25', '2026-12-26', true],
    ]);
  });

  it('skips cancelled events and overrides of included series', () => {
    const events = parseIcs(
      calendar(
        [
          'BEGIN:VEVENT',
          'UID:series',
          'SUMMARY:Weekly',
          'DTSTART:20261020T090000Z',
          'RRULE:FREQ=WEEKLY',
          'END:VEVENT',
          'BEGIN:VEVENT',
          'UID:series',
          'RECURRENCE-ID:20261027T090000Z',
          'SUMMARY:Weekly (moved)',
          'DTSTART:20261027T100000Z',
          'END:VEVENT',
          'BEGIN:VEVENT',
          'SUMMARY:Gone',
          'STATUS:CANCELLED',
          'DTSTART:20261020T090000Z',
          'END:VEVENT',
        ].join('\n'),
      ),
    );

    expect(events.map((event) => event.title)).toEqual(['Weekly']);
  });

  it('recognizes calendar files', () => {
    expect(isIcsFile(new File([''], 'invite.ics'))).toBe(true);
    expect(isIcsFile(new File([''], 'x', { type: 'text/calendar' }))).toBe(
      true,
    );
    expect(isIcsFile(new File([''], 'notes.txt'))).toBe(false);
  });
});
