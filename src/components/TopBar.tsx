import {
  CalendarRange,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Menu,
  Search,
  Wifi,
} from 'lucide-react';
import type { Account, CalendarView, SyncState } from '../domain';

type TopBarProps = {
  title: string;
  view: CalendarView;
  account?: Account;
  syncState: SyncState;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onMenu: () => void;
  onToday: () => void;
  onNavigate: (direction: -1 | 1) => void;
  onViewChange: (view: CalendarView) => void;
};

const views: readonly { value: CalendarView; label: string }[] = [
  { value: 'month', label: 'Month' },
  { value: 'week', label: 'Week' },
  { value: 'day', label: 'Day' },
  { value: 'year', label: 'Year' },
  { value: 'schedule', label: 'Schedule' },
  { value: 'multi-day', label: '4 days' },
];

export function TopBar({
  title,
  view,
  account,
  syncState,
  searchQuery,
  onSearchChange,
  onMenu,
  onToday,
  onNavigate,
  onViewChange,
}: TopBarProps) {
  return (
    <header className="topbar">
      <div className="brand">
        <button
          className="icon-button"
          aria-label="Toggle sidebar"
          onClick={onMenu}
        >
          <Menu size={20} />
        </button>
        <span className="brand__mark">
          <CalendarRange size={23} />
        </span>
        <strong>Clay Calendar</strong>
      </div>

      <div className="date-controls">
        <button className="soft-button" onClick={onToday}>
          Today
        </button>
        <span className="button-pair">
          <button
            className="icon-button"
            aria-label="Previous period"
            onClick={() => onNavigate(-1)}
          >
            <ChevronLeft size={19} />
          </button>
          <button
            className="icon-button"
            aria-label="Next period"
            onClick={() => onNavigate(1)}
          >
            <ChevronRight size={19} />
          </button>
        </span>
        <h1>{title}</h1>
      </div>

      <div className="topbar__tools">
        <label className="search-box">
          <Search size={17} />
          <span className="sr-only">Search events</span>
          <input
            type="search"
            placeholder="Search"
            value={searchQuery}
            onChange={(event) => onSearchChange(event.target.value)}
          />
          <kbd>/</kbd>
        </label>
        <label className="view-select">
          <span className="sr-only">Calendar view</span>
          <select
            value={view}
            onChange={(event) =>
              onViewChange(event.target.value as CalendarView)
            }
          >
            {views.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
          <ChevronDown size={15} aria-hidden="true" />
        </label>
        <span
          className="connection-indicator"
          title={syncState.status === 'offline' ? 'Offline' : 'Online'}
        >
          <Wifi size={15} />
        </span>
        <button
          className="avatar"
          aria-label={
            account ? `Account: ${account.displayName}` : 'No account'
          }
        >
          {account?.displayName
            .split(' ')
            .map((part) => part[0])
            .join('')
            .slice(0, 2) ?? '?'}
        </button>
      </div>
    </header>
  );
}
