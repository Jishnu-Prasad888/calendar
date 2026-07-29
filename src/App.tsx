import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { AlertCircle, CalendarRange, RefreshCw, X } from 'lucide-react';
import type {
  AppSnapshot,
  AttendeeResponse,
  CalendarEvent,
  CalendarView,
  EventInput,
  EventPatch,
  PreferenceInput,
  SyncState,
  TaskList,
} from './domain';
import { AppSidebar, type AppPage } from './components/AppSidebar';
import { CalendarPage } from './components/CalendarPage';
import { EventDialog, type EventDraft } from './components/EventDialog';
import { SearchResults } from './components/SearchResults';
import { SettingsPage } from './components/SettingsPage';
import { TasksPage } from './components/TasksPage';
import { TopBar } from './components/TopBar';
import { useAppearance } from './hooks/useAppearance';
import { addDays, dateKey } from './lib/date';
import { errorMessage } from './lib/error';
import { ipc } from './lib/ipc';

type OpenDialog = {
  key: string;
  event?: CalendarEvent;
  draft: EventDraft;
};

function titleForDate(date: Date, view: CalendarView): string {
  if (view === 'day') {
    return date.toLocaleDateString(undefined, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
  }
  if (view === 'year') return String(date.getFullYear());
  if (view === 'week' || view === 'multi-day') {
    const last = addDays(date, view === 'week' ? 6 : 3);
    if (date.getMonth() === last.getMonth()) {
      return `${date.toLocaleDateString(undefined, { month: 'long' })} ${String(date.getDate())}–${String(last.getDate())}, ${String(date.getFullYear())}`;
    }
    return `${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${last.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
  }
  return date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

function shiftedDate(date: Date, view: CalendarView, direction: -1 | 1): Date {
  if (view === 'day') return addDays(date, direction);
  if (view === 'week') return addDays(date, direction * 7);
  if (view === 'multi-day') return addDays(date, direction * 4);
  if (view === 'year')
    return new Date(date.getFullYear() + direction, date.getMonth(), 1);
  return new Date(date.getFullYear(), date.getMonth() + direction, 1);
}

function newEventDraft(date: Date): EventDraft {
  const start = new Date(date);
  start.setSeconds(0, 0);
  if (dateKey(date) === dateKey(new Date())) {
    start.setMinutes(start.getMinutes() < 30 ? 30 : 0);
    if (start.getMinutes() === 0) start.setHours(start.getHours() + 1);
  } else {
    start.setHours(9, 0, 0, 0);
  }
  return {
    start: start.toISOString(),
    end: new Date(start.getTime() + 60 * 60_000).toISOString(),
    allDay: false,
  };
}

export function App() {
  const [snapshot, setSnapshot] = useState<AppSnapshot>();
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [taskLists, setTaskLists] = useState<readonly TaskList[]>([]);
  const [page, setPage] = useState<AppPage>('calendar');
  const [view, setView] = useState<CalendarView>('month');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [visibleCalendarIds, setVisibleCalendarIds] = useState<
    ReadonlySet<string>
  >(new Set());
  const [dialog, setDialog] = useState<OpenDialog>();
  const [busy, setBusy] = useState(false);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [tasksLoading, setTasksLoading] = useState(true);
  const [tasksError, setTasksError] = useState<string>();
  const [fatalError, setFatalError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [searchQuery, setSearchQuery] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const eventRange = useRef<{ start: string; end: string } | undefined>(
    undefined,
  );

  useAppearance(snapshot?.preferences);

  const handleSyncState = useEffectEvent(async (syncState: SyncState) => {
    setSnapshot((current) => (current ? { ...current, syncState } : current));
    if (syncState.status === 'syncing') return;

    try {
      const previousCalendarIds = new Set(
        snapshot?.calendars.map((calendar) => calendar.id) ?? [],
      );
      const value = await ipc.bootstrap();
      setSnapshot(value);
      setVisibleCalendarIds(
        (current) =>
          new Set(
            value.calendars
              .filter(
                (calendar) =>
                  current.has(calendar.id) ||
                  (!previousCalendarIds.has(calendar.id) && calendar.visible),
              )
              .map((calendar) => calendar.id),
          ),
      );
      if (eventRange.current) {
        setEventsLoading(true);
        setEvents(
          await ipc.getEvents(eventRange.current.start, eventRange.current.end),
        );
      }
      if (page === 'tasks') setTaskLists(await ipc.getTaskLists());
      if (value.syncState.status === 'error') {
        setNotice(value.syncState.message ?? 'Google synchronization failed.');
      }
    } catch (reason) {
      setNotice(errorMessage(reason, 'Could not refresh synchronized data.'));
    } finally {
      setEventsLoading(false);
    }
  });

  useEffect(() => {
    if (!('__TAURI_INTERNALS__' in window)) return;
    let active = true;
    let stopListening: (() => void) | undefined;
    void listen<SyncState>('sync-state-changed', (event) => {
      void handleSyncState(event.payload);
    }).then((unlisten) => {
      if (active) stopListening = unlisten;
      else unlisten();
    });
    return () => {
      active = false;
      stopListening?.();
    };
  }, []);

  useEffect(() => {
    let active = true;
    void ipc
      .bootstrap()
      .then((value) => {
        if (!active) return;
        setSnapshot(value);
        setView(value.preferences.defaultView);
        setVisibleCalendarIds(
          new Set(
            value.calendars
              .filter((calendar) => calendar.visible)
              .map((calendar) => calendar.id),
          ),
        );
      })
      .catch((reason: unknown) => {
        if (active)
          setFatalError(errorMessage(reason, 'Could not open Calendar.'));
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!snapshot || view !== 'year') return;
    const start = new Date(currentDate.getFullYear(), 0, 1);
    const end = new Date(currentDate.getFullYear() + 1, 0, 1);
    eventRange.current = {
      start: start.toISOString(),
      end: end.toISOString(),
    };
    void ipc
      .getEvents(eventRange.current.start, eventRange.current.end)
      .then(setEvents)
      .catch((reason: unknown) =>
        setNotice(errorMessage(reason, 'Could not load events.')),
      )
      .finally(() => setEventsLoading(false));
  }, [currentDate, snapshot, view]);

  useEffect(() => {
    if (page !== 'tasks' || taskLists.length > 0) return;
    void ipc
      .getTaskLists()
      .then(setTaskLists)
      .catch((reason: unknown) =>
        setTasksError(errorMessage(reason, 'Could not load tasks.')),
      )
      .finally(() => setTasksLoading(false));
  }, [page, taskLists.length]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      const isTyping =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement;
      if (event.key === 'Escape') {
        setDialog(undefined);
        setSearchQuery('');
        return;
      }
      if (isTyping) return;
      if (event.key === '/') {
        event.preventDefault();
        document.querySelector<HTMLInputElement>('.search-box input')?.focus();
      } else if (event.key.toLocaleLowerCase() === 'c') {
        setDialog({
          key: `new-${String(Date.now())}`,
          draft: newEventDraft(currentDate),
        });
      } else if (event.key.toLocaleLowerCase() === 't') {
        setCurrentDate(new Date());
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentDate]);

  const loadEvents = (start: Date, end: Date) => {
    eventRange.current = {
      start: start.toISOString(),
      end: end.toISOString(),
    };
    setEventsLoading(true);
    void ipc
      .getEvents(eventRange.current.start, eventRange.current.end)
      .then(setEvents)
      .catch((reason: unknown) =>
        setNotice(errorMessage(reason, 'Could not load events.')),
      )
      .finally(() => setEventsLoading(false));
  };

  const openCreate = (draft = newEventDraft(currentDate)) => {
    setPage('calendar');
    setDialog({ key: `new-${String(Date.now())}`, draft });
  };

  const openEvent = (event: CalendarEvent) => {
    setDialog({
      key: event.id,
      event,
      draft: { start: event.start, end: event.end, allDay: event.allDay },
    });
  };

  const saveEvent = async (input: EventInput) => {
    setBusy(true);
    try {
      if (dialog?.event) {
        const patch: EventPatch = {
          title: input.title,
          description: input.description ?? null,
          location: input.location ?? null,
          start: input.start,
          end: input.end,
          allDay: input.allDay,
          attendees: input.attendees,
          reminders: input.reminders,
          recurrence: input.recurrence,
          privacy: input.privacy,
          availability: input.availability,
        };
        const updated = await ipc.updateEvent(
          dialog.event.id,
          dialog.event.calendarId,
          patch,
        );
        setEvents((current) =>
          current.map((event) => (event.id === updated.id ? updated : event)),
        );
      } else {
        const created = await ipc.createEvent(input);
        setEvents((current) => [...current, created]);
      }
      setDialog(undefined);
    } finally {
      setBusy(false);
    }
  };

  const deleteEvent = async (event: CalendarEvent) => {
    setBusy(true);
    try {
      await ipc.deleteEvent(event.id, event.calendarId);
      setEvents((current) => current.filter((item) => item.id !== event.id));
      setDialog(undefined);
      setNotice('Event deleted.');
    } catch (reason) {
      setNotice(errorMessage(reason, 'Could not delete event.'));
    } finally {
      setBusy(false);
    }
  };

  const respondToEvent = async (
    event: CalendarEvent,
    response: AttendeeResponse,
  ) => {
    setBusy(true);
    try {
      const updated = await ipc.respondToEvent(
        event.id,
        event.calendarId,
        response,
      );
      setEvents((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
      setDialog((current) =>
        current ? { ...current, event: updated } : current,
      );
    } catch (reason) {
      setNotice(errorMessage(reason, 'Could not update your response.'));
    } finally {
      setBusy(false);
    }
  };

  const moveEvent = async (
    event: CalendarEvent,
    patch: EventPatch,
  ): Promise<boolean> => {
    const original = event;
    setEvents((current) =>
      current.map((item) =>
        item.id === event.id
          ? {
              ...item,
              start: patch.start ?? item.start,
              end: patch.end ?? item.end,
              allDay: patch.allDay ?? item.allDay,
              pending: true,
            }
          : item,
      ),
    );
    try {
      const updated = await ipc.updateEvent(event.id, event.calendarId, patch);
      setEvents((current) =>
        current.map((item) => (item.id === event.id ? updated : item)),
      );
      return true;
    } catch (reason) {
      setEvents((current) =>
        current.map((item) => (item.id === event.id ? original : item)),
      );
      setNotice(errorMessage(reason, 'The event could not be moved.'));
      return false;
    }
  };

  const syncNow = () => {
    if (!snapshot) return;
    setSnapshot({
      ...snapshot,
      syncState: { ...snapshot.syncState, status: 'syncing' },
    });
    const previousCalendarIds = new Set(
      snapshot.calendars.map((calendar) => calendar.id),
    );
    void (async () => {
      try {
        await ipc.syncNow();
        const value = await ipc.bootstrap();
        setSnapshot(value);
        setVisibleCalendarIds(
          (current) =>
            new Set(
              value.calendars
                .filter(
                  (calendar) =>
                    current.has(calendar.id) ||
                    (!previousCalendarIds.has(calendar.id) && calendar.visible),
                )
                .map((calendar) => calendar.id),
            ),
        );
        if (eventRange.current) {
          setEventsLoading(true);
          setEvents(
            await ipc.getEvents(
              eventRange.current.start,
              eventRange.current.end,
            ),
          );
        }
        if (value.syncState.status === 'error') {
          setNotice(
            value.syncState.message ?? 'Google synchronization failed.',
          );
        }
      } catch (reason) {
        setSnapshot((current) =>
          current
            ? {
                ...current,
                syncState: { status: 'error', message: 'Sync failed' },
              }
            : current,
        );
        setNotice(errorMessage(reason, 'Sync failed.'));
      } finally {
        setEventsLoading(false);
      }
    })();
  };

  const updatePreferences = (input: PreferenceInput) => {
    if (!snapshot) return;
    const previous = snapshot.preferences;
    const next = { ...previous, ...input };
    setSnapshot({ ...snapshot, preferences: next });
    void ipc
      .updatePreferences(next)
      .then((preferences) => {
        setSnapshot((current) =>
          current ? { ...current, preferences } : current,
        );
      })
      .catch((reason: unknown) => {
        setSnapshot((current) =>
          current ? { ...current, preferences: previous } : current,
        );
        setNotice(errorMessage(reason, 'Could not save settings.'));
      });
  };

  const updateGoogleOAuthConfiguration = (
    clientId: string,
    clientSecret?: string,
  ) => {
    setBusy(true);
    void ipc
      .updateGoogleOAuthConfiguration(clientId, clientSecret)
      .then((oauthConfiguration) => {
        setSnapshot((current) =>
          current
            ? {
                ...current,
                preferences: {
                  ...current.preferences,
                  googleClientId: oauthConfiguration.clientId,
                },
                oauthConfiguration,
              }
            : current,
        );
        setNotice('Google OAuth configuration saved securely.');
      })
      .catch((reason: unknown) =>
        setNotice(errorMessage(reason, 'Could not save OAuth configuration.')),
      )
      .finally(() => setBusy(false));
  };

  const connectAccount = () => {
    setBusy(true);
    void ipc
      .startGoogleAuth()
      .then(() => ipc.bootstrap())
      .then(async (value) => {
        setSnapshot(value);
        setVisibleCalendarIds(
          new Set(
            value.calendars
              .filter((calendar) => calendar.visible)
              .map((calendar) => calendar.id),
          ),
        );
        if (eventRange.current) {
          setEventsLoading(true);
          setEvents(
            await ipc.getEvents(
              eventRange.current.start,
              eventRange.current.end,
            ),
          );
        }
        if (value.syncState.status === 'error') {
          setNotice(
            value.syncState.message ?? 'Google synchronization failed.',
          );
        }
      })
      .catch((reason: unknown) =>
        setNotice(errorMessage(reason, 'Could not connect account.')),
      )
      .finally(() => {
        setBusy(false);
        setEventsLoading(false);
      });
  };

  const removeAccount = (accountId: string) => {
    setBusy(true);
    void ipc
      .removeAccount(accountId)
      .then(() => {
        setSnapshot((current) =>
          current
            ? {
                ...current,
                accounts: current.accounts.filter(
                  (account) => account.id !== accountId,
                ),
                calendars: current.calendars.filter(
                  (calendar) => calendar.accountId !== accountId,
                ),
              }
            : current,
        );
      })
      .catch((reason: unknown) =>
        setNotice(errorMessage(reason, 'Could not remove account.')),
      )
      .finally(() => setBusy(false));
  };

  if (fatalError) {
    return (
      <main className="boot-state">
        <span className="boot-logo">
          <AlertCircle size={28} />
        </span>
        <h1>Calendar could not start</h1>
        <p>{fatalError}</p>
        <button
          className="primary-button"
          onClick={() => window.location.reload()}
        >
          <RefreshCw size={16} /> Try again
        </button>
      </main>
    );
  }
  if (!snapshot) {
    return (
      <main className="boot-state">
        <span className="boot-logo">
          <CalendarRange size={28} />
        </span>
        <div className="large-spinner" />
        <h1>Opening Clay Calendar</h1>
        <p>Preparing your calendars and preferences…</p>
      </main>
    );
  }

  const eventDates = new Set(events.map((event) => event.start.slice(0, 10)));
  return (
    <div className="app-shell" data-sidebar={sidebarOpen ? 'open' : 'closed'}>
      <TopBar
        title={
          page === 'calendar'
            ? titleForDate(currentDate, view)
            : page === 'tasks'
              ? 'Tasks'
              : 'Settings'
        }
        view={view}
        account={snapshot.accounts.at(0)}
        syncState={snapshot.syncState}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onMenu={() => setSidebarOpen((open) => !open)}
        onToday={() => {
          setCurrentDate(new Date());
          setPage('calendar');
        }}
        onNavigate={(direction) => {
          setCurrentDate((date) => shiftedDate(date, view, direction));
          setPage('calendar');
        }}
        onViewChange={(nextView) => {
          setView(nextView);
          setPage('calendar');
        }}
      />
      <AppSidebar
        page={page}
        selectedDate={currentDate}
        weekStartsOn={snapshot.preferences.weekStartsOn}
        calendars={snapshot.calendars}
        visibleCalendarIds={visibleCalendarIds}
        eventDates={eventDates}
        syncState={snapshot.syncState}
        onPageChange={setPage}
        onDateChange={(date) => {
          setCurrentDate(date);
          setPage('calendar');
        }}
        onCalendarToggle={(calendarId) =>
          setVisibleCalendarIds((current) => {
            const next = new Set(current);
            if (next.has(calendarId)) next.delete(calendarId);
            else next.add(calendarId);
            return next;
          })
        }
        onCreate={() => openCreate()}
        onSync={syncNow}
      />
      <div className="content-area">
        {page === 'calendar' && (
          <CalendarPage
            currentDate={currentDate}
            view={view}
            events={events}
            visibleCalendarIds={visibleCalendarIds}
            weekStartsOn={snapshot.preferences.weekStartsOn}
            loading={eventsLoading}
            onDateChange={setCurrentDate}
            onViewChange={setView}
            onRangeChange={loadEvents}
            onCreate={openCreate}
            onOpenEvent={openEvent}
            onMoveEvent={moveEvent}
          />
        )}
        {page === 'tasks' && (
          <TasksPage
            taskLists={taskLists}
            loading={tasksLoading}
            error={tasksError}
          />
        )}
        {page === 'settings' && (
          <SettingsPage
            preferences={snapshot.preferences}
            accounts={snapshot.accounts}
            syncState={snapshot.syncState}
            oauthConfiguration={snapshot.oauthConfiguration}
            busy={busy}
            onUpdate={updatePreferences}
            onUpdateOAuth={updateGoogleOAuthConfiguration}
            onConnect={connectAccount}
            onRemove={removeAccount}
            onSync={syncNow}
          />
        )}
      </div>
      {searchQuery.trim() && (
        <SearchResults
          query={searchQuery}
          events={events}
          onClose={() => setSearchQuery('')}
          onOpen={(event) => {
            openEvent(event);
            setSearchQuery('');
          }}
        />
      )}
      {dialog && (
        <EventDialog
          key={dialog.key}
          event={dialog.event}
          draft={dialog.draft}
          calendars={snapshot.calendars}
          busy={busy}
          onClose={() => setDialog(undefined)}
          onSave={saveEvent}
          onDelete={deleteEvent}
          onRespond={respondToEvent}
        />
      )}
      {notice && (
        <div className="toast" role="status">
          <AlertCircle size={16} />
          <span>{notice}</span>
          <button aria-label="Dismiss" onClick={() => setNotice(undefined)}>
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
