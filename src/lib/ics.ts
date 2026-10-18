import type { EventInput, EventReminder } from '../domain';
import { addDays, dateKey } from './date';

/** An event read from an iCalendar file, ready to be placed on a calendar. */
export type ImportedEvent = Omit<EventInput, 'calendarId'>;

type Property = {
  name: string;
  params: Record<string, string>;
  value: string;
};

// Google Calendar accepts at most five reminder overrides per event.
const MAX_REMINDERS = 5;

/** Joins folded lines (RFC 5545 §3.1) and splits them into properties. */
function parseProperties(text: string): Property[] {
  const lines = text
    .replace(/\r\n?/g, '\n')
    .replace(/\n[ \t]/g, '')
    .split('\n');
  const properties: Property[] = [];
  for (const line of lines) {
    const separator = valueSeparator(line);
    if (separator < 0) continue;
    const [name = '', ...rawParams] = line.slice(0, separator).split(';');
    const params: Record<string, string> = {};
    for (const rawParam of rawParams) {
      const equals = rawParam.indexOf('=');
      if (equals < 0) continue;
      params[rawParam.slice(0, equals).toUpperCase()] = rawParam
        .slice(equals + 1)
        .replace(/^"|"$/g, '');
    }
    properties.push({
      name: name.toUpperCase(),
      params,
      value: line.slice(separator + 1),
    });
  }
  return properties;
}

/** Finds the colon that ends the property name and parameters. */
function valueSeparator(line: string): number {
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') quoted = !quoted;
    else if (character === ':' && !quoted) return index;
  }
  return -1;
}

function unescapeText(value: string): string {
  return value.replace(/\\([nN,;\\])/g, (_, character: string) =>
    character === 'n' || character === 'N' ? '\n' : character,
  );
}

/** Minutes between UTC and the wall clock of `timeZone` at `instant`. */
function zoneOffsetMinutes(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  const part = (type: string) =>
    Number(parts.find((item) => item.type === type)?.value);
  const wallClock = Date.UTC(
    part('year'),
    part('month') - 1,
    part('day'),
    part('hour'),
    part('minute'),
    part('second'),
  );
  return (wallClock - instant.getTime()) / 60_000;
}

function wallClockInZone(
  fields: readonly [number, number, number, number, number, number],
  timeZone: string,
): Date | undefined {
  const [year, month, day, hour, minute, second] = fields;
  const asUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  try {
    // Two passes settle on the right offset across daylight-saving changes.
    let instant = asUtc - zoneOffsetMinutes(new Date(asUtc), timeZone) * 60_000;
    instant = asUtc - zoneOffsetMinutes(new Date(instant), timeZone) * 60_000;
    return new Date(instant);
  } catch {
    // Unknown zone names (such as Windows zone IDs) fall back to local time.
    return undefined;
  }
}

type ParsedTime = { allDay: true; date: string } | { allDay: false; at: Date };

function parseTime(property: Property): ParsedTime | undefined {
  const value = property.value.trim();
  const dateOnly = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  if (dateOnly || property.params.VALUE === 'DATE') {
    const match = dateOnly ?? /^(\d{4})(\d{2})(\d{2})/.exec(value);
    if (!match) return undefined;
    return { allDay: true, date: `${match[1]}-${match[2]}-${match[3]}` };
  }
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(value);
  if (!match) return undefined;
  const fields = match.slice(1, 7).map(Number) as unknown as readonly [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const [year, month, day, hour, minute, second] = fields;
  if (match[7] === 'Z') {
    return {
      allDay: false,
      at: new Date(Date.UTC(year, month - 1, day, hour, minute, second)),
    };
  }
  const zone = property.params.TZID;
  const zoned = zone ? wallClockInZone(fields, zone) : undefined;
  return {
    allDay: false,
    at: zoned ?? new Date(year, month - 1, day, hour, minute, second),
  };
}

/** Parses an RFC 5545 duration such as `-PT15M` or `P1DT2H` into minutes. */
function durationMinutes(value: string): number | undefined {
  const match =
    /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(
      value.trim(),
    );
  if (!match) return undefined;
  // Unmatched optional groups are undefined at runtime.
  const groups: readonly (string | undefined)[] = match;
  const [, sign, weeks, days, hours, minutes, seconds] = groups;
  const count = (value: string | undefined) => (value ? Number(value) : 0);
  const total =
    count(weeks) * 10080 +
    count(days) * 1440 +
    count(hours) * 60 +
    count(minutes) +
    Math.round(count(seconds) / 60);
  return sign === '-' ? -total : total;
}

function reminderFromAlarm(
  alarm: readonly Property[],
): EventReminder | undefined {
  const trigger = alarm.find((property) => property.name === 'TRIGGER');
  if (!trigger || trigger.params.VALUE === 'DATE-TIME') return undefined;
  if (trigger.params.RELATED === 'END') return undefined;
  const offset = durationMinutes(trigger.value);
  // Google only supports reminders before the start, up to four weeks.
  if (offset === undefined || offset > 0 || -offset > 40320) return undefined;
  const action = alarm.find((property) => property.name === 'ACTION');
  return {
    method: action?.value.toUpperCase() === 'EMAIL' ? 'email' : 'popup',
    minutes: -offset,
  };
}

function eventFromProperties(
  properties: readonly Property[],
  alarms: readonly (readonly Property[])[],
): ImportedEvent | undefined {
  const find = (name: string) =>
    properties.find((property) => property.name === name);
  const status = find('STATUS')?.value.toUpperCase();
  if (status === 'CANCELLED') return undefined;
  const startProperty = find('DTSTART');
  const start = startProperty && parseTime(startProperty);
  if (!start) return undefined;
  const endProperty = find('DTEND');
  const parsedEnd = endProperty && parseTime(endProperty);
  const duration = durationMinutes(find('DURATION')?.value ?? '');

  const title = unescapeText(find('SUMMARY')?.value ?? '').trim();
  const description = unescapeText(find('DESCRIPTION')?.value ?? '').trim();
  const location = unescapeText(find('LOCATION')?.value ?? '').trim();
  const recurrence = properties
    .filter((property) => ['RRULE', 'EXDATE', 'RDATE'].includes(property.name))
    .map((property) => {
      const params = Object.entries(property.params)
        .map(([key, value]) => `;${key}=${value}`)
        .join('');
      return `${property.name}${params}:${property.value}`;
    });
  const reminders = alarms
    .map(reminderFromAlarm)
    .filter((reminder) => reminder !== undefined)
    .slice(0, MAX_REMINDERS);
  const transparent = find('TRANSP')?.value.toUpperCase() === 'TRANSPARENT';
  const classification = find('CLASS')?.value.toUpperCase();

  let startValue: string;
  let endValue: string;
  if (start.allDay) {
    startValue = start.date;
    const days =
      duration !== undefined ? Math.max(1, Math.ceil(duration / 1440)) : 1;
    const fallback = dateKey(addDays(new Date(`${start.date}T12:00:00`), days));
    endValue =
      parsedEnd?.allDay && parsedEnd.date > start.date
        ? parsedEnd.date
        : fallback;
  } else {
    startValue = start.at.toISOString();
    const end =
      parsedEnd && !parsedEnd.allDay
        ? parsedEnd.at
        : new Date(start.at.getTime() + (duration ?? 60) * 60_000);
    // Google rejects empty ranges, so zero-length events last a minute.
    const safeEnd =
      end.getTime() > start.at.getTime()
        ? end
        : new Date(start.at.getTime() + 60_000);
    endValue = safeEnd.toISOString();
  }

  return {
    title: title || '(No title)',
    description: description || undefined,
    location: location || undefined,
    start: startValue,
    end: endValue,
    allDay: start.allDay,
    reminders,
    recurrence: recurrence.length > 0 ? recurrence : undefined,
    privacy:
      classification === 'PRIVATE' || classification === 'CONFIDENTIAL'
        ? 'private'
        : classification === 'PUBLIC'
          ? 'public'
          : 'default',
    availability: transparent ? 'free' : 'busy',
  };
}

/**
 * Reads every VEVENT in an iCalendar document. Attendees are deliberately
 * dropped so importing a file never sends invitations on the user's behalf.
 */
export function parseIcs(text: string): ImportedEvent[] {
  const events: {
    uid?: string;
    override: boolean;
    event: ImportedEvent;
  }[] = [];
  const stack: string[] = [];
  let eventProperties: Property[] = [];
  let alarms: Property[][] = [];
  let alarm: Property[] = [];
  for (const property of parseProperties(text)) {
    if (property.name === 'BEGIN') {
      const component = property.value.toUpperCase();
      stack.push(component);
      if (component === 'VEVENT') {
        eventProperties = [];
        alarms = [];
      } else if (component === 'VALARM') {
        alarm = [];
      }
      continue;
    }
    if (property.name === 'END') {
      const component = stack.pop();
      if (component === 'VALARM' && stack.at(-1) === 'VEVENT') {
        alarms.push(alarm);
      } else if (component === 'VEVENT') {
        const event = eventFromProperties(eventProperties, alarms);
        const uid = eventProperties.find((item) => item.name === 'UID');
        if (event) {
          events.push({
            uid: uid?.value,
            override: eventProperties.some(
              (item) => item.name === 'RECURRENCE-ID',
            ),
            event,
          });
        }
      }
      continue;
    }
    const current = stack.at(-1);
    if (current === 'VEVENT') eventProperties.push(property);
    else if (current === 'VALARM') alarm.push(property);
  }
  // A changed occurrence of a series that is also in the file would duplicate
  // the occurrence the series already creates, so only the series is kept.
  const seriesIds = new Set(
    events.filter((item) => !item.override).map((item) => item.uid),
  );
  return events
    .filter((item) => !item.override || !item.uid || !seriesIds.has(item.uid))
    .map((item) => item.event);
}

/** True when a dropped file looks like an iCalendar file. */
export function isIcsFile(file: File): boolean {
  return (
    file.type === 'text/calendar' ||
    /\.(ics|ical|ifb|icalendar)$/i.test(file.name)
  );
}
