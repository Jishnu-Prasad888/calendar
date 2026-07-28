import { useState } from 'react';
import {
  AlignLeft,
  CalendarDays,
  Clock3,
  LockKeyhole,
  MapPin,
  Repeat2,
  Trash2,
  UserRoundPlus,
  X,
} from 'lucide-react';
import type {
  AttendeeResponse,
  CalendarEvent,
  CalendarSource,
  EventAvailability,
  EventInput,
  EventPrivacy,
} from '../domain';
import {
  addDays,
  dateKey,
  localDateTimeValue,
  toIsoFromLocal,
} from '../lib/date';

export type EventDraft = {
  start: string;
  end: string;
  allDay: boolean;
};

type EventDialogProps = {
  event?: CalendarEvent;
  draft: EventDraft;
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

export function EventDialog({
  event,
  draft,
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
  const [reminder, setReminder] = useState(
    String(event?.reminders[0]?.minutes ?? 10),
  );
  const [recurrence, setRecurrence] = useState(event?.recurrence?.[0] ?? '');
  const [privacy, setPrivacy] = useState<EventPrivacy>(
    event?.privacy ?? 'default',
  );
  const [availability, setAvailability] = useState<EventAvailability>(
    event?.availability ?? 'busy',
  );
  const [error, setError] = useState<string>();
  const readOnly = event?.readOnly === true;
  const selfAttendee = event?.attendees.find((attendee) => attendee.self);

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
      reminders:
        reminder === '0'
          ? []
          : [{ method: 'popup', minutes: Number(reminder) }],
      recurrence: recurrence ? [recurrence] : undefined,
      privacy,
      availability,
    };
    void onSave(input).catch((reason: unknown) => {
      setError(
        reason instanceof Error ? reason.message : 'Could not save the event.',
      );
    });
  };

  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onMouseDown={(click) => {
        if (click.target === click.currentTarget) onClose();
      }}
    >
      <section
        className="event-dialog"
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
            <label>
              Start
              <input
                aria-label="Start"
                type={allDay ? 'date' : 'datetime-local'}
                value={start}
                onChange={(change) => setStart(change.target.value)}
                disabled={readOnly}
              />
            </label>
            <label>
              End
              <input
                aria-label="End"
                type={allDay ? 'date' : 'datetime-local'}
                value={end}
                onChange={(change) => setEnd(change.target.value)}
                disabled={readOnly}
              />
            </label>
          </div>

          <label className="field-row">
            <CalendarDays size={18} />
            <span className="sr-only">Calendar</span>
            <select
              value={calendarId}
              onChange={(change) => setCalendarId(change.target.value)}
              disabled={Boolean(event) || readOnly}
            >
              {(event ? calendars : editableCalendars).map((calendar) => (
                <option value={calendar.id} key={calendar.id}>
                  {calendar.name}
                </option>
              ))}
            </select>
          </label>
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

          <div className="dialog-options">
            <label>
              Reminder
              <select
                value={reminder}
                onChange={(change) => setReminder(change.target.value)}
                disabled={readOnly}
              >
                <option value="0">None</option>
                <option value="10">10 minutes before</option>
                <option value="30">30 minutes before</option>
                <option value="60">1 hour before</option>
                <option value="1440">1 day before</option>
              </select>
            </label>
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
