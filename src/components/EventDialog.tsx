import { useLayoutEffect, useRef, useState } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import {
  AlignLeft,
  Bell,
  CalendarDays,
  Clock3,
  LockKeyhole,
  MapPin,
  Plus,
  Repeat2,
  Trash2,
  UserRoundPlus,
  Video,
  X,
} from 'lucide-react';
import type {
  AttendeeResponse,
  CalendarEvent,
  CalendarSource,
  EventAvailability,
  EventInput,
  EventPrivacy,
  EventReminder,
} from '../domain';
import {
  addDays,
  dateKey,
  localDateTimeValue,
  toIsoFromLocal,
} from '../lib/date';
import { errorMessage } from '../lib/error';
import { DateTimePicker } from './DateTimePicker';

export type EventDraft = {
  start: string;
  end: string;
  allDay: boolean;
};

/** Viewport rectangle of whatever was clicked to open the dialog. */
export type DialogAnchor = {
  top: number;
  left: number;
  width: number;
  height: number;
};

type EventDialogProps = {
  event?: CalendarEvent;
  draft: EventDraft;
  anchor?: DialogAnchor;
  calendars: readonly CalendarSource[];
  busy: boolean;
  onClose: () => void;
  onSave: (input: EventInput) => Promise<void>;
  onDelete: (event: CalendarEvent) => Promise<void>;
  onRespond: (
    event: CalendarEvent,
    response: AttendeeResponse,
  ) => Promise<void>;
};

function allDayInputEnd(end: string): string {
  const parsed = new Date(`${end.slice(0, 10)}T12:00:00`);
  return dateKey(addDays(parsed, -1));
}

const recurrenceOptions = [
  ['', 'Does not repeat'],
  ['RRULE:FREQ=DAILY', 'Daily'],
  ['RRULE:FREQ=WEEKLY', 'Weekly'],
  ['RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', 'Every weekday'],
  ['RRULE:FREQ=MONTHLY', 'Monthly'],
  ['RRULE:FREQ=YEARLY', 'Yearly'],
] as const;

// Google Calendar accepts at most five reminder overrides per event.
const MAX_REMINDERS = 5;

const reminderPresets = [0, 5, 10, 15, 30, 60, 120, 1440, 2880, 10080];

function reminderLabel(minutes: number): string {
  if (minutes === 0) return 'At start time';
  const units = [
    [10080, 'week'],
    [1440, 'day'],
    [60, 'hour'],
    [1, 'minute'],
  ] as const;
  const [size, unit] =
    units.find(([unitSize]) => minutes % unitSize === 0) ?? units[3];
  const count = minutes / size;
  return `${String(count)} ${unit}${count === 1 ? '' : 's'} before`;
}

const ANCHOR_GAP = 12;
const VIEWPORT_MARGIN = 16;

/** Places the dialog beside the anchor, on whichever side has room. */
function anchoredPosition(
  anchor: DialogAnchor,
  width: number,
  height: number,
): { top: number; left: number } {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const rightSpace =
    viewportWidth - (anchor.left + anchor.width) - ANCHOR_GAP - VIEWPORT_MARGIN;
  const leftSpace = anchor.left - ANCHOR_GAP - VIEWPORT_MARGIN;
  let left: number;
  if (rightSpace >= width) left = anchor.left + anchor.width + ANCHOR_GAP;
  else if (leftSpace >= width) left = anchor.left - ANCHOR_GAP - width;
  else left = anchor.left + anchor.width / 2 - width / 2;
  const maxLeft = viewportWidth - VIEWPORT_MARGIN - width;
  left = Math.max(VIEWPORT_MARGIN, Math.min(left, maxLeft));
  const maxTop = viewportHeight - VIEWPORT_MARGIN - height;
  const top = Math.max(VIEWPORT_MARGIN, Math.min(anchor.top, maxTop));
  return { top, left };
}

export function EventDialog({
  event,
  draft,
  anchor,
  calendars,
  busy,
  onClose,
  onSave,
  onDelete,
  onRespond,
}: EventDialogProps) {
  const editableCalendars = calendars.filter((calendar) => !calendar.readOnly);
  const [title, setTitle] = useState(event?.title ?? '');
  const [calendarId, setCalendarId] = useState(
    event?.calendarId ?? editableCalendars.at(0)?.id ?? '',
  );
  const [allDay, setAllDay] = useState(event?.allDay ?? draft.allDay);
  const initialStart = event?.start ?? draft.start;
  const initialEnd = event?.end ?? draft.end;
  const [start, setStart] = useState(
    allDay ? initialStart.slice(0, 10) : localDateTimeValue(initialStart),
  );
  const [end, setEnd] = useState(
    allDay ? allDayInputEnd(initialEnd) : localDateTimeValue(initialEnd),
  );
  const [description, setDescription] = useState(event?.description ?? '');
  const [location, setLocation] = useState(event?.location ?? '');
  const [attendees, setAttendees] = useState(
    event?.attendees.map((item) => item.email).join(', ') ?? '',
  );
  const [reminders, setReminders] = useState<EventReminder[]>(() =>
    event
      ? event.reminders.map((reminder) => ({ ...reminder }))
      : [{ method: 'popup', minutes: 10 }],
  );
  const [recurrence, setRecurrence] = useState(event?.recurrence?.[0] ?? '');
  const [privacy, setPrivacy] = useState<EventPrivacy>(
    event?.privacy ?? 'default',
  );
  const [availability, setAvailability] = useState<EventAvailability>(
    event?.availability ?? 'busy',
  );
  const [googleMeet, setGoogleMeet] = useState(event?.googleMeet ?? false);
  const [openDatePicker, setOpenDatePicker] = useState<'start' | 'end'>();
  const [error, setError] = useState<string>();
  const dialogRef = useRef<HTMLElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number }>();
  const readOnly = event?.readOnly === true;
  const selfAttendee = event?.attendees.find((attendee) => attendee.self);

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!anchor || !dialog) return;
    const place = () => {
      const { offsetWidth, offsetHeight } = dialog;
      setPosition(anchoredPosition(anchor, offsetWidth, offsetHeight));
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(dialog);
    window.addEventListener('resize', place);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', place);
    };
  }, [anchor]);

  const updateReminder = (index: number, change: Partial<EventReminder>) => {
    setReminders((current) =>
      current.map((reminder, position) =>
        position === index ? { ...reminder, ...change } : reminder,
      ),
    );
  };

  const handleAllDayChange = (checked: boolean) => {
    if (checked && !allDay) {
      setStart(start.slice(0, 10));
      setEnd(end.slice(0, 10));
    } else if (!checked && allDay) {
      setStart(`${start}T09:00`);
      setEnd(`${end}T10:00`);
    }
    setAllDay(checked);
  };

  const handleSubmit = (formEvent: React.SyntheticEvent<HTMLFormElement>) => {
    formEvent.preventDefault();
    if (!title.trim()) {
      setError('Add a title before saving.');
      return;
    }
    if (!calendarId) {
      setError(
        'Connect a Google account with an editable calendar before saving.',
      );
      return;
    }
    const normalizedStart = allDay ? start : toIsoFromLocal(start);
    const normalizedEnd = allDay
      ? dateKey(addDays(new Date(`${end}T12:00:00`), 1))
      : toIsoFromLocal(end);
    if (
      new Date(normalizedEnd).getTime() <= new Date(normalizedStart).getTime()
    ) {
      setError('The end must be after the start.');
      return;
    }
    const input: EventInput = {
      calendarId,
      title: title.trim(),
      description: description.trim() || undefined,
      location: location.trim() || undefined,
      start: normalizedStart,
      end: normalizedEnd,
      allDay,
      attendees: attendees
        .split(',')
        .map((email) => email.trim())
        .filter(Boolean),
      reminders: reminders.filter(
        (reminder, index) =>
          reminders.findIndex(
            (other) =>
              other.method === reminder.method &&
              other.minutes === reminder.minutes,
          ) === index,
      ),
      recurrence: recurrence ? [recurrence] : undefined,
      privacy,
      availability,
      googleMeet,
    };
    void onSave(input).catch((reason: unknown) => {
      setError(errorMessage(reason, 'Could not save the event.'));
    });
  };

  return (
    <div
      className="dialog-backdrop"
      data-anchored={Boolean(anchor)}
      role="presentation"
      onMouseDown={(click) => {
        if (click.target === click.currentTarget) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className="event-dialog"
        data-anchored={Boolean(anchor)}
        data-placed={!anchor || Boolean(position)}
        style={position}
        role="dialog"
        aria-modal="true"
        aria-labelledby="event-dialog-title"
      >
        <header>
          <span className="dialog-icon">
            <CalendarDays size={19} />
          </span>
          <div>
            <small>{event ? 'Event details' : 'New event'}</small>
            <h2 id="event-dialog-title">
              {event ? event.title : 'Create event'}
            </h2>
          </div>
          {readOnly && (
            <span className="readonly-pill">
              <LockKeyhole size={12} /> Read-only
            </span>
          )}
          <button className="icon-button" aria-label="Close" onClick={onClose}>
            <X size={19} />
          </button>
        </header>

        <form onSubmit={handleSubmit}>
          <label className="title-field">
            <span className="sr-only">Event title</span>
            <input
              autoFocus={!event}
              value={title}
              onChange={(change) => setTitle(change.target.value)}
              placeholder="Add title"
              disabled={readOnly}
            />
          </label>

          <div className="field-row field-row--toggle">
            <Clock3 size={18} />
            <label className="check-control">
              <input
                type="checkbox"
                checked={allDay}
                onChange={(change) => handleAllDayChange(change.target.checked)}
                disabled={readOnly}
              />
              <span /> All-day
            </label>
          </div>

          <div className="field-row date-field-row">
            <span />
            <div className="date-time-field">
              <span>Start</span>
              <DateTimePicker
                label="Start"
                value={start}
                allDay={allDay}
                open={openDatePicker === 'start'}
                disabled={readOnly}
                onChange={setStart}
                onToggle={() =>
                  setOpenDatePicker((current) =>
                    current === 'start' ? undefined : 'start',
                  )
                }
                onClose={() => setOpenDatePicker(undefined)}
              />
            </div>
            <div className="date-time-field">
              <span>End</span>
              <DateTimePicker
                label="End"
                value={end}
                allDay={allDay}
                open={openDatePicker === 'end'}
                align="end"
                disabled={readOnly}
                onChange={setEnd}
                onToggle={() =>
                  setOpenDatePicker((current) =>
                    current === 'end' ? undefined : 'end',
                  )
                }
                onClose={() => setOpenDatePicker(undefined)}
              />
            </div>
          </div>

          <label className="field-row">
            <CalendarDays size={18} />
            <span className="sr-only">Calendar</span>
            <select
              value={calendarId}
              onChange={(change) => setCalendarId(change.target.value)}
              disabled={Boolean(event) || readOnly}
            >
              {!event && editableCalendars.length === 0 && (
                <option value="">No editable calendars</option>
              )}
              {(event ? calendars : editableCalendars).map((calendar) => (
                <option value={calendar.id} key={calendar.id}>
                  {calendar.name}
                </option>
              ))}
            </select>
          </label>
          {(googleMeet || !readOnly) && (
            <div className="field-row meet-row">
              <Video size={18} />
              {!googleMeet ? (
                <button
                  type="button"
                  className="meet-row__add"
                  onClick={() => setGoogleMeet(true)}
                >
                  Add Google Meet video conferencing
                </button>
              ) : (
                <div className="meet-row__details">
                  {event?.meetLink ? (
                    <>
                      <button
                        type="button"
                        className="primary-button meet-row__join"
                        onClick={() => {
                          if (event.meetLink) void openUrl(event.meetLink);
                        }}
                      >
                        Join with Google Meet
                      </button>
                      <small>{event.meetLink.replace('https://', '')}</small>
                    </>
                  ) : (
                    <small>
                      {event?.googleMeet
                        ? 'Google is creating the Meet link…'
                        : 'A Google Meet link is created when you save.'}
                    </small>
                  )}
                  {!readOnly && (
                    <button
                      type="button"
                      className="icon-button"
                      aria-label="Remove Google Meet"
                      title="Remove Google Meet"
                      onClick={() => setGoogleMeet(false)}
                    >
                      <X size={15} />
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
          <label className="field-row">
            <MapPin size={18} />
            <span className="sr-only">Location</span>
            <input
              value={location}
              onChange={(change) => setLocation(change.target.value)}
              placeholder="Add location or meeting link"
              disabled={readOnly}
            />
          </label>
          <label className="field-row field-row--textarea">
            <AlignLeft size={18} />
            <span className="sr-only">Description</span>
            <textarea
              value={description}
              onChange={(change) => setDescription(change.target.value)}
              placeholder="Add description"
              rows={3}
              disabled={readOnly}
            />
          </label>
          <label className="field-row">
            <UserRoundPlus size={18} />
            <span className="sr-only">Attendees</span>
            <input
              value={attendees}
              onChange={(change) => setAttendees(change.target.value)}
              placeholder="Guests, separated by commas"
              disabled={readOnly}
            />
          </label>
          <label className="field-row">
            <Repeat2 size={18} />
            <span className="sr-only">Recurrence</span>
            <select
              value={recurrence}
              onChange={(change) => setRecurrence(change.target.value)}
              disabled={readOnly}
            >
              {recurrenceOptions.map(([value, label]) => (
                <option value={value} key={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>

          <div className="field-row reminder-list">
            <Bell size={18} />
            <div>
              {reminders.length === 0 && (
                <span className="reminder-list__empty">No reminders</span>
              )}
              {reminders.map((reminder, index) => {
                const presets = reminderPresets.includes(reminder.minutes)
                  ? reminderPresets
                  : [...reminderPresets, reminder.minutes].sort(
                      (first, second) => first - second,
                    );
                return (
                  <div className="reminder-list__item" key={index}>
                    <select
                      aria-label={`Reminder ${String(index + 1)} time`}
                      value={reminder.minutes}
                      onChange={(change) =>
                        updateReminder(index, {
                          minutes: Number(change.target.value),
                        })
                      }
                      disabled={readOnly}
                    >
                      {presets.map((minutes) => (
                        <option value={minutes} key={minutes}>
                          {reminderLabel(minutes)}
                        </option>
                      ))}
                    </select>
                    <select
                      aria-label={`Reminder ${String(index + 1)} type`}
                      value={reminder.method}
                      onChange={(change) =>
                        updateReminder(index, {
                          method: change.target
                            .value as EventReminder['method'],
                        })
                      }
                      disabled={readOnly}
                    >
                      <option value="popup">Notification</option>
                      <option value="email">Email</option>
                    </select>
                    {!readOnly && (
                      <button
                        type="button"
                        className="icon-button"
                        aria-label={`Remove reminder ${String(index + 1)}`}
                        onClick={() =>
                          setReminders((current) =>
                            current.filter((_, position) => position !== index),
                          )
                        }
                      >
                        <X size={15} />
                      </button>
                    )}
                  </div>
                );
              })}
              {!readOnly && reminders.length < MAX_REMINDERS && (
                <button
                  type="button"
                  className="reminder-list__add"
                  onClick={() =>
                    setReminders((current) => [
                      ...current,
                      {
                        method: 'popup',
                        minutes: current.length === 0 ? 10 : 30,
                      },
                    ])
                  }
                >
                  <Plus size={14} /> Add reminder
                </button>
              )}
            </div>
          </div>

          <div className="dialog-options">
            <label>
              Visibility
              <select
                value={privacy}
                onChange={(change) =>
                  setPrivacy(change.target.value as EventPrivacy)
                }
                disabled={readOnly}
              >
                <option value="default">Calendar default</option>
                <option value="public">Public</option>
                <option value="private">Private</option>
              </select>
            </label>
            <label>
              Show me as
              <select
                value={availability}
                onChange={(change) =>
                  setAvailability(change.target.value as EventAvailability)
                }
                disabled={readOnly}
              >
                <option value="busy">Busy</option>
                <option value="free">Free</option>
              </select>
            </label>
          </div>

          {selfAttendee && event && (
            <fieldset className="rsvp-group">
              <legend>Going?</legend>
              {(['accepted', 'tentative', 'declined'] as const).map(
                (response) => (
                  <button
                    key={response}
                    type="button"
                    data-active={selfAttendee.responseStatus === response}
                    onClick={() => void onRespond(event, response)}
                    disabled={busy}
                  >
                    {response === 'accepted'
                      ? 'Yes'
                      : response === 'tentative'
                        ? 'Maybe'
                        : 'No'}
                  </button>
                ),
              )}
            </fieldset>
          )}

          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <footer>
            {event && !readOnly && (
              <button
                type="button"
                className="danger-button"
                onClick={() => void onDelete(event)}
                disabled={busy}
              >
                <Trash2 size={16} /> Delete
              </button>
            )}
            <span />
            <button type="button" className="soft-button" onClick={onClose}>
              Cancel
            </button>
            {!readOnly && (
              <button type="submit" className="primary-button" disabled={busy}>
                {busy ? 'Saving…' : 'Save'}
              </button>
            )}
          </footer>
        </form>
      </section>
    </div>
  );
}
