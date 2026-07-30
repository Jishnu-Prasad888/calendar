import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin, {
  type EventResizeDoneArg,
} from '@fullcalendar/interaction';
import listPlugin from '@fullcalendar/list';
import timeGridPlugin from '@fullcalendar/timegrid';
import type {
  DateSelectArg,
  DatesSetArg,
  EventClickArg,
  EventContentArg,
  EventDropArg,
} from '@fullcalendar/core';
import { LockKeyhole } from 'lucide-react';
import type { CalendarEvent, CalendarView, EventPatch } from '../domain';
import { eventTextColor } from '../lib/color';
import { addDays, dateKey, datesInMonth } from '../lib/date';

type Selection = {
  start: string;
  end: string;
  allDay: boolean;
};

type CalendarPageProps = {
  currentDate: Date;
  view: CalendarView;
  events: readonly CalendarEvent[];
  visibleCalendarIds: ReadonlySet<string>;
  weekStartsOn: number;
  loading: boolean;
  onDateChange: (date: Date) => void;
  onViewChange: (view: CalendarView) => void;
  onRangeChange: (start: Date, end: Date) => void;
  onCreate: (selection: Selection) => void;
  onOpenEvent: (event: CalendarEvent) => void;
  onMoveEvent: (event: CalendarEvent, patch: EventPatch) => Promise<boolean>;
};

const fullCalendarView: Record<Exclude<CalendarView, 'year'>, string> = {
  month: 'dayGridMonth',
  week: 'timeGridWeek',
  day: 'timeGridDay',
  schedule: 'listMonth',
  'multi-day': 'multiDay',
};

function eventPatchFromChange(event: EventDropArg['event']): EventPatch {
  return {
    start: event.allDay
      ? event.startStr
      : (event.start?.toISOString() ?? event.startStr),
    end: event.allDay
      ? event.endStr
      : (event.end?.toISOString() ??
        event.start?.toISOString() ??
        event.startStr),
    allDay: event.allDay,
  };
}

function YearView({
  date,
  events,
  weekStartsOn,
  onSelectMonth,
}: {
  date: Date;
  events: readonly CalendarEvent[];
  weekStartsOn: number;
  onSelectMonth: (date: Date) => void;
}) {
  const year = date.getFullYear();
  return (
    <div className="year-grid" aria-label={`${String(year)} calendar`}>
      {Array.from({ length: 12 }, (_, month) => {
        const monthDate = new Date(year, month, 1);
        const monthEvents = events.filter(
          (event) =>
            new Date(event.start).getMonth() === month &&
            new Date(event.start).getFullYear() === year,
        );
        const offset = (monthDate.getDay() - weekStartsOn + 7) % 7;
        return (
          <button
            key={month}
            className="year-month"
            onClick={() => onSelectMonth(monthDate)}
          >
            <strong>
              {monthDate.toLocaleDateString(undefined, { month: 'long' })}
            </strong>
            <span className="year-month__weekdays" aria-hidden="true">
              {Array.from({ length: 7 }, (_, day) => (
                <i key={day}>
                  {addDays(
                    new Date(2026, 5, 7 + weekStartsOn),
                    day,
                  ).toLocaleDateString(undefined, { weekday: 'narrow' })}
                </i>
              ))}
            </span>
            <span className="year-month__days">
              {Array.from({ length: offset }, (_, blank) => (
                <i key={`blank-${String(blank)}`} />
              ))}
              {datesInMonth(monthDate).map((day) => {
                const hasEvent = monthEvents.some(
                  (event) => event.start.slice(0, 10) === dateKey(day),
                );
                return (
                  <i
                    key={dateKey(day)}
                    data-event={hasEvent}
                    data-today={dateKey(day) === dateKey(new Date())}
                  >
                    {day.getDate()}
                  </i>
                );
              })}
            </span>
            {monthEvents.length > 0 && (
              <small>
                {monthEvents.length} event{monthEvents.length === 1 ? '' : 's'}
              </small>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function CalendarPage({
  currentDate,
  view,
  events,
  visibleCalendarIds,
  weekStartsOn,
  loading,
  onDateChange,
  onViewChange,
  onRangeChange,
  onCreate,
  onOpenEvent,
  onMoveEvent,
}: CalendarPageProps) {
  const visibleEvents = events.filter((event) =>
    visibleCalendarIds.has(event.calendarId),
  );

  if (view === 'year') {
    return (
      <main className="calendar-surface calendar-surface--year">
        {loading && (
          <div className="surface-loader" aria-label="Loading events" />
        )}
        <YearView
          date={currentDate}
          events={visibleEvents}
          weekStartsOn={weekStartsOn}
          onSelectMonth={(date) => {
            onDateChange(date);
            onViewChange('month');
          }}
        />
      </main>
    );
  }

  const handleDrop = (argument: EventDropArg) => {
    const source = events.find((event) => event.id === argument.event.id);
    if (!source) return;
    void onMoveEvent(source, eventPatchFromChange(argument.event)).then(
      (success) => {
        if (!success) argument.revert();
      },
    );
  };
  const handleResize = (argument: EventResizeDoneArg) => {
    const source = events.find((event) => event.id === argument.event.id);
    if (!source) return;
    void onMoveEvent(source, eventPatchFromChange(argument.event)).then(
      (success) => {
        if (!success) argument.revert();
      },
    );
  };
  const handleEventClick = (argument: EventClickArg) => {
    const source = events.find((event) => event.id === argument.event.id);
    if (source) onOpenEvent(source);
  };
  const handleSelect = (argument: DateSelectArg) => {
    onCreate({
      start: argument.startStr,
      end: argument.endStr,
      allDay: argument.allDay,
    });
  };
  const handleDates = (argument: DatesSetArg) => {
    onRangeChange(argument.start, argument.end);
  };
  const renderEvent = (argument: EventContentArg) => (
    <span
      className="calendar-event"
      data-pending={Boolean(argument.event.extendedProps.pending)}
    >
      <i aria-hidden="true" />
      <b>{argument.timeText}</b>
      <span>{argument.event.title}</span>
      {argument.event.extendedProps.readOnly === true && (
        <LockKeyhole size={11} aria-label="Read-only" />
      )}
    </span>
  );

  return (
    <main className="calendar-surface">
      {loading && (
        <div className="surface-loader" aria-label="Loading events" />
      )}
      <FullCalendar
        key={`${view}-${dateKey(currentDate)}`}
        plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]}
        initialView={fullCalendarView[view]}
        initialDate={currentDate}
        views={{ multiDay: { type: 'timeGrid', duration: { days: 4 } } }}
        headerToolbar={false}
        firstDay={weekStartsOn}
        height="100%"
        nowIndicator
        selectable
        selectMirror
        editable
        dayMaxEvents={4}
        slotMinTime="00:00:00"
        slotMaxTime="24:00:00"
        scrollTime="00:00:00"
        slotDuration="00:30:00"
        allDaySlot
        events={visibleEvents.map((event) => ({
          id: event.id,
          title: event.title,
          start: event.start,
          end: event.end,
          allDay: event.allDay,
          backgroundColor: event.color,
          borderColor: event.color,
          textColor: eventTextColor(event.color),
          editable: !event.readOnly,
          extendedProps: { readOnly: event.readOnly, pending: event.pending },
        }))}
        datesSet={handleDates}
        select={handleSelect}
        eventClick={handleEventClick}
        eventDrop={handleDrop}
        eventResize={handleResize}
        eventContent={renderEvent}
      />
    </main>
  );
}
