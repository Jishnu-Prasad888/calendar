import {
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react';
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
import { addDays, dateKey, datesInMonth, scrollTimeFor } from '../lib/date';
import type { DialogAnchor } from './EventDialog';

type Selection = {
  start: string;
  end: string;
  allDay: boolean;
};

type CalendarPageProps = {
  /** False while another page is shown; the calendar stays mounted. */
  active: boolean;
  currentDate: Date;
  view: CalendarView;
  events: readonly CalendarEvent[];
  visibleCalendarIds: ReadonlySet<string>;
  weekStartsOn: number;
  loading: boolean;
  onDateChange: (date: Date) => void;
  onViewChange: (view: CalendarView) => void;
  onRangeChange: (start: Date, end: Date) => void;
  onCreate: (selection: Selection, anchor?: DialogAnchor) => void;
  onOpenEvent: (event: CalendarEvent, anchor?: DialogAnchor) => void;
  onMoveEvent: (event: CalendarEvent, patch: EventPatch) => Promise<boolean>;
};

const fullCalendarView: Record<Exclude<CalendarView, 'year'>, string> = {
  month: 'dayGridMonth',
  week: 'timeGridWeek',
  day: 'timeGridDay',
  schedule: 'listMonth',
  'multi-day': 'multiDay',
};

// Stable option values: FullCalendar re-processes any option whose identity
// changes, so these live outside the component.
const plugins = [dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin];
const customViews = {
  multiDay: { type: 'timeGrid', duration: { days: 4 } },
};

function renderEvent(argument: EventContentArg) {
  const { start, end, allDay } = argument.event;
  // Events of 30 minutes or less are too short for a wrapped time/title
  // layout, so they render on a single clipped line instead.
  const compact =
    !allDay &&
    start !== null &&
    (end === null || end.getTime() - start.getTime() <= 30 * 60_000);
  return (
    <span
      className="calendar-event"
      data-pending={Boolean(argument.event.extendedProps.pending)}
      data-compact={compact}
    >
      <i aria-hidden="true" />
      <b>{argument.timeText}</b>
      <span>{argument.event.title}</span>
      {argument.event.extendedProps.readOnly === true && (
        <LockKeyhole size={11} aria-label="Read-only" />
      )}
    </span>
  );
}

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

function rectAnchor(rect: DOMRect): DialogAnchor {
  return {
    top: rect.top,
    left: rect.left,
    width: rect.width,
    height: rect.height,
  };
}

/** Anchors to the selected day column, at the height the pointer let go. */
function selectionAnchor(pointer: MouseEvent | null): DialogAnchor | undefined {
  if (!pointer) return undefined;
  const target = pointer.target instanceof Element ? pointer.target : null;
  const cell = target?.closest('.fc-timegrid-col, .fc-daygrid-day');
  if (!cell) {
    return { top: pointer.clientY, left: pointer.clientX, width: 0, height: 0 };
  }
  const rect = cell.getBoundingClientRect();
  return cell.classList.contains('fc-timegrid-col')
    ? {
        top: pointer.clientY - 20,
        left: rect.left,
        width: rect.width,
        height: 0,
      }
    : rectAnchor(rect);
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
  const today = dateKey(new Date());
  const eventCounts = new Array<number>(12).fill(0);
  const eventDays = new Set<string>();
  for (const event of events) {
    const start = new Date(event.start);
    if (start.getFullYear() !== year) continue;
    eventCounts[start.getMonth()] += 1;
    eventDays.add(event.start.slice(0, 10));
  }
  return (
    <div className="year-grid" aria-label={`${String(year)} calendar`}>
      {Array.from({ length: 12 }, (_, month) => {
        const monthDate = new Date(year, month, 1);
        const monthEventCount = eventCounts[month];
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
                const key = dateKey(day);
                return (
                  <i
                    key={key}
                    data-event={eventDays.has(key)}
                    data-today={key === today}
                  >
                    {day.getDate()}
                  </i>
                );
              })}
            </span>
            {monthEventCount > 0 && (
              <small>
                {monthEventCount} event{monthEventCount === 1 ? '' : 's'}
              </small>
            )}
          </button>
        );
      })}
    </div>
  );
}

type CalendarHandlers = Pick<
  CalendarPageProps,
  | 'onDateChange'
  | 'onViewChange'
  | 'onRangeChange'
  | 'onCreate'
  | 'onOpenEvent'
  | 'onMoveEvent'
> & { events: readonly CalendarEvent[] };

function calendarHandlers(latest: RefObject<CalendarHandlers>) {
  const source = (id: string) =>
    latest.current.events.find((event) => event.id === id);
  return {
    change: (argument: EventDropArg | EventResizeDoneArg) => {
      const event = source(argument.event.id);
      if (!event) return;
      void latest.current
        .onMoveEvent(event, eventPatchFromChange(argument.event))
        .then((success) => {
          if (!success) argument.revert();
        });
    },
    eventClick: (argument: EventClickArg) => {
      const event = source(argument.event.id);
      if (event) {
        latest.current.onOpenEvent(
          event,
          rectAnchor(argument.el.getBoundingClientRect()),
        );
      }
    },
    select: (argument: DateSelectArg) => {
      latest.current.onCreate(
        {
          start: argument.startStr,
          end: argument.endStr,
          allDay: argument.allDay,
        },
        selectionAnchor(argument.jsEvent),
      );
    },
    dates: (argument: DatesSetArg) => {
      latest.current.onRangeChange(argument.start, argument.end);
    },
  };
}

/**
 * Keeps the latest callbacks in a ref so the memoized surface, and the
 * FullCalendar options it passes, only change when calendar data changes.
 */
export function CalendarPage({
  active,
  currentDate,
  view,
  events,
  visibleCalendarIds,
  weekStartsOn,
  loading,
  ...callbacks
}: CalendarPageProps) {
  const handlers = useRef<CalendarHandlers>({ ...callbacks, events });
  useLayoutEffect(() => {
    handlers.current = { ...callbacks, events };
  });
  return (
    <CalendarSurface
      active={active}
      currentDate={currentDate}
      view={view}
      events={events}
      visibleCalendarIds={visibleCalendarIds}
      weekStartsOn={weekStartsOn}
      loading={loading}
      handlers={handlers}
    />
  );
}

const CalendarSurface = memo(function CalendarSurface({
  active,
  currentDate,
  view,
  events,
  visibleCalendarIds,
  weekStartsOn,
  loading,
  handlers: latest,
}: Pick<
  CalendarPageProps,
  | 'active'
  | 'currentDate'
  | 'view'
  | 'events'
  | 'visibleCalendarIds'
  | 'weekStartsOn'
  | 'loading'
> & { handlers: RefObject<CalendarHandlers> }) {
  const calendarRef = useRef<FullCalendar>(null);

  const visibleEvents = useMemo(
    () => events.filter((event) => visibleCalendarIds.has(event.calendarId)),
    [events, visibleCalendarIds],
  );
  const calendarEvents = useMemo(
    () =>
      visibleEvents.map((event) => ({
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
      })),
    [visibleEvents],
  );

  const fullView = view === 'year' ? undefined : fullCalendarView[view];
  // Navigate the mounted calendar instead of rebuilding it on every change.
  // FullCalendar re-renders synchronously, so it runs after React's commit.
  useEffect(() => {
    if (!fullView) return;
    let cancelled = false;
    queueMicrotask(() => {
      const api = calendarRef.current?.getApi();
      if (cancelled || !api) return;
      if (api.view.type !== fullView) api.changeView(fullView, currentDate);
      else if (api.getDate().getTime() !== currentDate.getTime()) {
        api.gotoDate(currentDate);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [fullView, currentDate]);

  // A hidden calendar can't measure itself, so re-measure when it is shown.
  useEffect(() => {
    if (!active) return;
    queueMicrotask(() => calendarRef.current?.getApi().updateSize());
  }, [active]);

  // Time grids open just before today's first event. FullCalendar applies
  // scrollTime on navigation; the first event load needs an explicit scroll
  // because it arrives after the grid has already been laid out.
  const scrollTime = useMemo(
    () => scrollTimeFor(visibleEvents, new Date()),
    [visibleEvents],
  );
  const initialScroll = useRef<'waiting' | 'loading' | 'done'>('waiting');
  useEffect(() => {
    if (initialScroll.current === 'done') return;
    if (loading) {
      initialScroll.current = 'loading';
      return;
    }
    if (initialScroll.current !== 'loading') return;
    initialScroll.current = 'done';
    queueMicrotask(() =>
      calendarRef.current?.getApi().scrollToTime(scrollTime),
    );
  }, [loading, scrollTime]);

  // Created once; each handler reads the latest callbacks when it runs.
  const [handle] = useState(() => calendarHandlers(latest));

  if (!fullView) {
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
            latest.current.onDateChange(date);
            latest.current.onViewChange('month');
          }}
        />
      </main>
    );
  }

  return (
    <main className="calendar-surface">
      {loading && (
        <div className="surface-loader" aria-label="Loading events" />
      )}
      <FullCalendar
        ref={calendarRef}
        plugins={plugins}
        initialView={fullView}
        initialDate={currentDate}
        views={customViews}
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
        scrollTime={scrollTime}
        slotDuration="00:30:00"
        slotEventOverlap={false}
        eventMinHeight={20}
        allDaySlot
        events={calendarEvents}
        datesSet={handle.dates}
        select={handle.select}
        eventClick={handle.eventClick}
        eventDrop={handle.change}
        eventResize={handle.change}
        eventContent={renderEvent}
      />
    </main>
  );
});
