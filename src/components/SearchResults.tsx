import { CalendarSearch, Clock3, MapPin, X } from 'lucide-react';
import type { CalendarEvent } from '../domain';

type SearchResultsProps = {
  query: string;
  events: readonly CalendarEvent[];
  onClose: () => void;
  onOpen: (event: CalendarEvent) => void;
};

export function SearchResults({
  query,
  events,
  onClose,
  onOpen,
}: SearchResultsProps) {
  const normalized = query.trim().toLocaleLowerCase();
  const results = normalized
    ? events.filter((event) =>
        [
          event.title,
          event.description,
          event.location,
          ...event.attendees.map((item) => item.email),
        ]
          .filter(Boolean)
          .some((value) => value?.toLocaleLowerCase().includes(normalized)),
      )
    : [];

  return (
    <section className="search-results" aria-label="Event search results">
      <header>
        <span>
          <CalendarSearch size={18} />
          <strong>Search results</strong>
        </span>
        <button
          className="icon-button icon-button--small"
          onClick={onClose}
          aria-label="Close search"
        >
          <X size={16} />
        </button>
      </header>
      {results.length === 0 ? (
        <div className="search-empty">
          <CalendarSearch size={28} />
          <p>No events match “{query}”.</p>
        </div>
      ) : (
        <div className="search-results__list">
          {results.slice(0, 12).map((event) => (
            <button key={event.id} onClick={() => onOpen(event)}>
              <i style={{ background: event.color }} />
              <span>
                <strong>{event.title}</strong>
                <small>
                  <Clock3 size={12} />{' '}
                  {event.allDay
                    ? new Date(
                        `${event.start.slice(0, 10)}T12:00:00`,
                      ).toLocaleDateString()
                    : new Date(event.start).toLocaleString([], {
                        month: 'short',
                        day: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                </small>
                {event.location && (
                  <small>
                    <MapPin size={12} /> {event.location}
                  </small>
                )}
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
