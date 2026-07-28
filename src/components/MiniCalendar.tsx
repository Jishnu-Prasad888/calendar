import { ChevronLeft, ChevronRight } from 'lucide-react';
import { addDays, dateKey, startOfWeek } from '../lib/date';

type MiniCalendarProps = {
  selectedDate: Date;
  weekStartsOn: number;
  eventDates: ReadonlySet<string>;
  onSelect: (date: Date) => void;
  onMonthChange: (date: Date) => void;
};

const dayFormatter = new Intl.DateTimeFormat(undefined, { weekday: 'narrow' });

export function MiniCalendar({
  selectedDate,
  weekStartsOn,
  eventDates,
  onSelect,
  onMonthChange,
}: MiniCalendarProps) {
  const monthStart = new Date(
    selectedDate.getFullYear(),
    selectedDate.getMonth(),
    1,
  );
  const gridStart = startOfWeek(monthStart, weekStartsOn);
  const days = Array.from({ length: 42 }, (_, index) =>
    addDays(gridStart, index),
  );
  const today = dateKey(new Date());

  return (
    <section className="mini-calendar" aria-label="Mini calendar">
      <header>
        <strong>
          {monthStart.toLocaleDateString(undefined, {
            month: 'long',
            year: 'numeric',
          })}
        </strong>
        <span className="mini-calendar__actions">
          <button
            className="icon-button icon-button--small"
            aria-label="Previous month"
            onClick={() =>
              onMonthChange(
                new Date(
                  selectedDate.getFullYear(),
                  selectedDate.getMonth() - 1,
                  1,
                ),
              )
            }
          >
            <ChevronLeft size={15} />
          </button>
          <button
            className="icon-button icon-button--small"
            aria-label="Next month"
            onClick={() =>
              onMonthChange(
                new Date(
                  selectedDate.getFullYear(),
                  selectedDate.getMonth() + 1,
                  1,
                ),
              )
            }
          >
            <ChevronRight size={15} />
          </button>
        </span>
      </header>
      <div
        className="mini-calendar__grid mini-calendar__weekdays"
        aria-hidden="true"
      >
        {Array.from({ length: 7 }, (_, index) => (
          <span key={index}>
            {dayFormatter.format(addDays(gridStart, index))}
          </span>
        ))}
      </div>
      <div className="mini-calendar__grid">
        {days.map((day) => {
          const key = dateKey(day);
          const isSelected = key === dateKey(selectedDate);
          return (
            <button
              key={key}
              className="mini-calendar__day"
              data-outside={day.getMonth() !== monthStart.getMonth()}
              data-today={key === today}
              data-selected={isSelected}
              aria-pressed={isSelected}
              aria-label={day.toLocaleDateString(undefined, {
                weekday: 'long',
                month: 'long',
                day: 'numeric',
              })}
              onClick={() => onSelect(day)}
            >
              {day.getDate()}
              {eventDates.has(key) && <i aria-hidden="true" />}
            </button>
          );
        })}
      </div>
    </section>
  );
}
