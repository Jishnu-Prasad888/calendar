import { useEffect, useRef, useState } from 'react';
import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
} from 'lucide-react';
import { addDays, dateKey, startOfWeek } from '../lib/date';

type DateTimePickerProps = {
  label: string;
  value: string;
  allDay: boolean;
  open: boolean;
  align?: 'start' | 'end';
  disabled?: boolean;
  onChange: (value: string) => void;
  onToggle: () => void;
  onClose: () => void;
};

const weekdayFormatter = new Intl.DateTimeFormat(undefined, {
  weekday: 'narrow',
});
const dateFormatter = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});
const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

const timeSlots = Array.from({ length: 96 }, (_, index) => {
  const hour = Math.floor(index / 4);
  const minute = (index % 4) * 15;
  return {
    value: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
    label: new Date(2000, 0, 1, hour, minute).toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    }),
  };
});

function valueParts(value: string): { date: string; time: string } {
  return {
    date: value.slice(0, 10),
    time: value.slice(11, 16) || '00:00',
  };
}

function localDate(value: string): Date {
  return new Date(`${value.slice(0, 10)}T12:00:00`);
}

export function DateTimePicker({
  label,
  value,
  allDay,
  open,
  align = 'start',
  disabled,
  onChange,
  onToggle,
  onClose,
}: DateTimePickerProps) {
  const root = useRef<HTMLDivElement>(null);
  const parts = valueParts(value);
  const selectedDate = localDate(parts.date);
  const [visibleMonth, setVisibleMonth] = useState(
    () => new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1),
  );
  const monthStart = new Date(
    visibleMonth.getFullYear(),
    visibleMonth.getMonth(),
    1,
  );
  const gridStart = startOfWeek(monthStart, 0);
  const days = Array.from({ length: 42 }, (_, index) =>
    addDays(gridStart, index),
  );
  const displayValue = allDay
    ? dateFormatter.format(selectedDate)
    : dateTimeFormatter.format(new Date(value));

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) onClose();
    };
    document.addEventListener('mousedown', closeOutside);
    return () => document.removeEventListener('mousedown', closeOutside);
  }, [onClose, open]);

  const selectDate = (date: Date) => {
    const nextDate = dateKey(date);
    setVisibleMonth(new Date(date.getFullYear(), date.getMonth(), 1));
    onChange(allDay ? nextDate : `${nextDate}T${parts.time}`);
  };

  const changeMonth = (amount: number) => {
    setVisibleMonth(
      new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + amount, 1),
    );
  };

  return (
    <div
      ref={root}
      className="date-time-picker"
      data-align={align}
      data-all-day={allDay}
    >
      <button
        type="button"
        className="date-time-picker__trigger"
        aria-label={`${label}: ${displayValue}`}
        aria-expanded={open}
        onClick={onToggle}
        disabled={disabled}
      >
        <CalendarDays size={14} />
        <span>{displayValue}</span>
      </button>

      {open && (
        <section
          className="date-time-picker__popover"
          role="dialog"
          aria-label={`${label} date${allDay ? '' : ' and time'} picker`}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.stopPropagation();
              onClose();
            }
          }}
        >
          <div className="date-time-picker__calendar">
            <header>
              <strong>
                {monthStart.toLocaleDateString(undefined, {
                  month: 'long',
                  year: 'numeric',
                })}
              </strong>
              <span>
                <button
                  type="button"
                  aria-label={`${label} previous month`}
                  onClick={() => changeMonth(-1)}
                >
                  <ChevronLeft size={15} />
                </button>
                <button
                  type="button"
                  aria-label={`${label} next month`}
                  onClick={() => changeMonth(1)}
                >
                  <ChevronRight size={15} />
                </button>
              </span>
            </header>
            <div className="date-time-picker__weekdays" aria-hidden="true">
              {Array.from({ length: 7 }, (_, index) => (
                <span key={index}>
                  {weekdayFormatter.format(addDays(gridStart, index))}
                </span>
              ))}
            </div>
            <div className="date-time-picker__days">
              {days.map((day) => {
                const key = dateKey(day);
                const selected = key === parts.date;
                return (
                  <button
                    type="button"
                    key={key}
                    data-outside={day.getMonth() !== monthStart.getMonth()}
                    data-selected={selected}
                    aria-pressed={selected}
                    aria-label={day.toLocaleDateString(undefined, {
                      weekday: 'long',
                      month: 'long',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                    onClick={() => selectDate(day)}
                  >
                    {day.getDate()}
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              className="date-time-picker__today"
              onClick={() => selectDate(new Date())}
            >
              Today
            </button>
          </div>

          {!allDay && (
            <div className="date-time-picker__times">
              <header>
                <Clock3 size={14} />
                <strong>Time</strong>
              </header>
              <div role="listbox" aria-label={`${label} time`}>
                {timeSlots.map((slot) => (
                  <button
                    type="button"
                    role="option"
                    aria-selected={slot.value === parts.time}
                    aria-label={`Select ${slot.label}`}
                    key={slot.value}
                    data-selected={slot.value === parts.time}
                    ref={(node) => {
                      if (node && slot.value === parts.time) {
                        if (node.parentElement) {
                          node.parentElement.scrollTop = Math.max(
                            0,
                            node.offsetTop - 90,
                          );
                        }
                      }
                    }}
                    onClick={() => onChange(`${parts.date}T${slot.value}`)}
                  >
                    <span>{slot.label}</span>
                    {slot.value === parts.time && <Check size={13} />}
                  </button>
                ))}
              </div>
            </div>
          )}

          <footer>
            <button type="button" className="soft-button" onClick={onClose}>
              Done
            </button>
          </footer>
        </section>
      )}
    </div>
  );
}
