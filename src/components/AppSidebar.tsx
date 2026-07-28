import {
  CalendarDays,
  CheckSquare2,
  ChevronDown,
  CirclePlus,
  CloudOff,
  RotateCw,
  Settings,
} from 'lucide-react';
import type { CalendarSource, SyncState } from '../domain';
import { MiniCalendar } from './MiniCalendar';

export type AppPage = 'calendar' | 'tasks' | 'settings';

type AppSidebarProps = {
  page: AppPage;
  selectedDate: Date;
  weekStartsOn: number;
  calendars: readonly CalendarSource[];
  visibleCalendarIds: ReadonlySet<string>;
  eventDates: ReadonlySet<string>;
  syncState: SyncState;
  onPageChange: (page: AppPage) => void;
  onDateChange: (date: Date) => void;
  onCalendarToggle: (calendarId: string) => void;
  onCreate: () => void;
  onSync: () => void;
};

export function AppSidebar({
  page,
  selectedDate,
  weekStartsOn,
  calendars,
  visibleCalendarIds,
  eventDates,
  syncState,
  onPageChange,
  onDateChange,
  onCalendarToggle,
  onCreate,
  onSync,
}: AppSidebarProps) {
  return (
    <aside className="sidebar">
      <button className="create-button" onClick={onCreate}>
        <CirclePlus size={20} />
        Create
      </button>

      <nav className="primary-nav" aria-label="Primary navigation">
        <button
          data-active={page === 'calendar'}
          onClick={() => onPageChange('calendar')}
        >
          <CalendarDays size={18} /> Calendar
        </button>
        <button
          data-active={page === 'tasks'}
          onClick={() => onPageChange('tasks')}
        >
          <CheckSquare2 size={18} /> Tasks
          <span className="nav-readonly">View</span>
        </button>
        <button
          data-active={page === 'settings'}
          onClick={() => onPageChange('settings')}
        >
          <Settings size={18} /> Settings
        </button>
      </nav>

      <MiniCalendar
        selectedDate={selectedDate}
        weekStartsOn={weekStartsOn}
        eventDates={eventDates}
        onSelect={onDateChange}
        onMonthChange={onDateChange}
      />

      <section className="calendar-list" aria-labelledby="calendar-list-title">
        <header>
          <h2 id="calendar-list-title">My calendars</h2>
          <ChevronDown size={15} />
        </header>
        {calendars.map((calendar) => (
          <label key={calendar.id}>
            <input
              type="checkbox"
              checked={visibleCalendarIds.has(calendar.id)}
              onChange={() => onCalendarToggle(calendar.id)}
            />
            <span
              className="calendar-check"
              style={
                { '--calendar-color': calendar.color } as React.CSSProperties
              }
            />
            <span title={calendar.name}>{calendar.name}</span>
          </label>
        ))}
      </section>

      <button
        className="sync-card"
        onClick={onSync}
        disabled={syncState.status === 'syncing'}
      >
        {syncState.status === 'offline' ? (
          <CloudOff size={17} />
        ) : (
          <RotateCw size={17} />
        )}
        <span>
          <strong>
            {syncState.status === 'offline'
              ? 'Working offline'
              : syncState.status === 'syncing'
                ? 'Syncing…'
                : 'Calendar synced'}
          </strong>
          <small>
            {syncState.lastSyncedAt
              ? `Updated ${new Date(syncState.lastSyncedAt).toLocaleTimeString(
                  [],
                  {
                    hour: 'numeric',
                    minute: '2-digit',
                  },
                )}`
              : 'Select to sync now'}
          </small>
        </span>
      </button>
    </aside>
  );
}
