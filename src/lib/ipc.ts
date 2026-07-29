/* eslint-disable @typescript-eslint/require-await -- Demo commands deliberately mirror async IPC. */
import { invoke } from '@tauri-apps/api/core';
import type {
  Account,
  AppSnapshot,
  AttendeeResponse,
  CalendarEvent,
  EventInput,
  EventPatch,
  IpcClient,
  OAuthConfiguration,
  Preferences,
  SyncState,
  TaskList,
} from '../domain';
import { addDays, dateKey, rangesOverlap } from './date';

type DemoStore = {
  snapshot: AppSnapshot;
  events: CalendarEvent[];
  taskLists: readonly TaskList[];
  nextId: number;
};

function atTime(date: Date, hour: number, minute = 0): string {
  const value = new Date(date);
  value.setHours(hour, minute, 0, 0);
  return value.toISOString();
}

function allDayRange(date: Date, days = 1): { start: string; end: string } {
  return { start: dateKey(date), end: dateKey(addDays(date, days)) };
}

export function createDemoStore(today = new Date()): DemoStore {
  const designReview = addDays(today, 1);
  const conference = addDays(today, 5);
  const planning = addDays(today, -2);

  return {
    snapshot: {
      accounts: [
        {
          id: 'account-primary',
          email: 'alex.morgan@example.com',
          displayName: 'Alex Morgan',
          connected: true,
        },
      ],
      calendars: [
        {
          id: 'primary',
          accountId: 'account-primary',
          name: 'Alex Morgan',
          color: '#1a73e8',
          primary: true,
          readOnly: false,
          visible: true,
        },
        {
          id: 'team',
          accountId: 'account-primary',
          name: 'Product & Design',
          color: '#7b61c9',
          primary: false,
          readOnly: false,
          visible: true,
        },
        {
          id: 'holidays',
          accountId: 'account-primary',
          name: 'Holidays',
          color: '#0b8043',
          primary: false,
          readOnly: true,
          visible: true,
        },
      ],
      preferences: {
        googleClientId: 'demo.apps.googleusercontent.com',
        theme: 'system',
        surfaceColor: '#eef2f8',
        accentColor: '#1a73e8',
        weekStartsOn: 1,
        defaultView: 'month',
        autostart: false,
        selectedCalendarIds: [],
        showTasks: true,
        syncIntervalMinutes: 15,
        notificationsEnabled: true,
      },
      oauthConfiguration: {
        clientId: 'demo.apps.googleusercontent.com',
        clientSecretConfigured: true,
      },
      syncState: {
        status: 'idle',
        lastSyncedAt: new Date(today.getTime() - 8 * 60_000).toISOString(),
      },
    },
    events: [
      {
        id: 'event-focus',
        calendarId: 'primary',
        title: 'Focus time',
        start: atTime(today, 9),
        end: atTime(today, 10, 30),
        allDay: false,
        color: '#1a73e8',
        status: 'confirmed',
        readOnly: false,
        attendees: [],
        reminders: [{ method: 'popup', minutes: 10 }],
        privacy: 'default',
        availability: 'busy',
        etag: 'demo-1',
      },
      {
        id: 'event-review',
        calendarId: 'team',
        title: 'Design review',
        description: 'Final pass on the desktop calendar experience.',
        location: 'Meet · Studio room',
        start: atTime(designReview, 13),
        end: atTime(designReview, 14),
        allDay: false,
        color: '#7b61c9',
        status: 'confirmed',
        readOnly: false,
        attendees: [
          {
            email: 'alex.morgan@example.com',
            displayName: 'Alex Morgan',
            responseStatus: 'accepted',
            self: true,
          },
          {
            email: 'sam@example.com',
            displayName: 'Sam Rivera',
            responseStatus: 'tentative',
          },
        ],
        reminders: [{ method: 'popup', minutes: 10 }],
        recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=TH'],
        privacy: 'default',
        availability: 'busy',
        etag: 'demo-2',
      },
      {
        id: 'event-planning',
        calendarId: 'team',
        title: 'Quarterly planning',
        start: atTime(planning, 11),
        end: atTime(planning, 12, 30),
        allDay: false,
        color: '#7b61c9',
        status: 'confirmed',
        readOnly: false,
        attendees: [],
        reminders: [{ method: 'popup', minutes: 30 }],
        etag: 'demo-3',
      },
      {
        id: 'event-conference',
        calendarId: 'primary',
        title: 'Product conference',
        ...allDayRange(conference, 2),
        allDay: true,
        color: '#1a73e8',
        status: 'confirmed',
        readOnly: false,
        attendees: [],
        reminders: [{ method: 'popup', minutes: 1440 }],
        etag: 'demo-4',
      },
      {
        id: 'event-holiday',
        calendarId: 'holidays',
        title: 'Regional holiday',
        ...allDayRange(addDays(today, 8)),
        allDay: true,
        color: '#0b8043',
        status: 'confirmed',
        readOnly: true,
        attendees: [],
        reminders: [],
        availability: 'free',
        etag: 'demo-5',
      },
    ],
    taskLists: [
      {
        id: 'tasks-work',
        title: 'Work',
        tasks: [
          {
            id: 'task-1',
            title: 'Prepare launch notes',
            notes: 'Include desktop keyboard shortcuts.',
            due: dateKey(addDays(today, 1)),
            completed: false,
            updatedAt: today.toISOString(),
          },
          {
            id: 'task-2',
            title: 'Review accessibility audit',
            due: dateKey(addDays(today, 3)),
            completed: false,
            updatedAt: today.toISOString(),
          },
        ],
      },
      {
        id: 'tasks-personal',
        title: 'Personal',
        tasks: [
          {
            id: 'task-3',
            title: 'Book train tickets',
            completed: true,
            updatedAt: addDays(today, -1).toISOString(),
          },
        ],
      },
    ],
    nextId: 100,
  };
}

function copyEvent(event: CalendarEvent): CalendarEvent {
  return {
    ...event,
    attendees: event.attendees.map((attendee) => ({ ...attendee })),
    reminders: event.reminders.map((reminder) => ({ ...reminder })),
    recurrence: event.recurrence ? [...event.recurrence] : undefined,
  };
}

function findWritableEvent(
  store: DemoStore,
  eventId: string,
  calendarId: string,
): CalendarEvent {
  const event = store.events.find(
    (item) => item.id === eventId && item.calendarId === calendarId,
  );
  if (!event) throw new Error('Event was not found.');
  if (event.readOnly) throw new Error('This event is read-only.');
  return event;
}

export function createDemoClient(store = createDemoStore()): IpcClient {
  return {
    bootstrap: async () => structuredClone(store.snapshot),
    getEvents: async (rangeStart, rangeEnd) =>
      store.events
        .filter((event) =>
          rangesOverlap(event.start, event.end, rangeStart, rangeEnd),
        )
        .map(copyEvent),
    getTaskLists: async () => structuredClone(store.taskLists),
    startGoogleAuth: async () => {
      const account: Account = {
        id: `account-${String(store.nextId++)}`,
        email: 'new.account@example.com',
        displayName: 'New account',
        connected: true,
      };
      store.snapshot = {
        ...store.snapshot,
        accounts: [...store.snapshot.accounts, account],
      };
      return { ...account };
    },
    removeAccount: async (accountId) => {
      store.snapshot = {
        ...store.snapshot,
        accounts: store.snapshot.accounts.filter(
          (account) => account.id !== accountId,
        ),
        calendars: store.snapshot.calendars.filter(
          (calendar) => calendar.accountId !== accountId,
        ),
      };
    },
    syncNow: async () => {
      const syncState: SyncState = {
        status: 'idle',
        lastSyncedAt: new Date().toISOString(),
      };
      store.snapshot = { ...store.snapshot, syncState };
      return { ...syncState };
    },
    createEvent: async (input) => {
      const calendar = store.snapshot.calendars.find(
        (item) => item.id === input.calendarId,
      );
      if (!calendar || calendar.readOnly) {
        throw new Error('Choose a calendar you can edit.');
      }
      const event: CalendarEvent = {
        ...input,
        id: `event-${String(store.nextId++)}`,
        color: calendar.color,
        status: 'confirmed',
        readOnly: false,
        attendees: (input.attendees ?? []).map((email) => ({
          email,
          responseStatus: 'needsAction',
        })),
        reminders: input.reminders ?? [],
        pending: false,
        etag: `demo-${String(store.nextId)}`,
      };
      store.events.push(event);
      return copyEvent(event);
    },
    updateEvent: async (eventId, calendarId, patch) => {
      const event = findWritableEvent(store, eventId, calendarId);
      const { description, location, ...changes } = patch;
      const attendees = patch.attendees?.map((email) => ({
        email,
        responseStatus:
          event.attendees.find((attendee) => attendee.email === email)
            ?.responseStatus ?? ('needsAction' as const),
      }));
      Object.assign(event, changes, {
        attendees: attendees ?? event.attendees,
        etag: `demo-${String(store.nextId++)}`,
      });
      if (description === null) delete event.description;
      else if (description !== undefined) event.description = description;
      if (location === null) delete event.location;
      else if (location !== undefined) event.location = location;
      return copyEvent(event);
    },
    deleteEvent: async (eventId, calendarId) => {
      findWritableEvent(store, eventId, calendarId);
      store.events = store.events.filter((event) => event.id !== eventId);
    },
    respondToEvent: async (eventId, calendarId, response) => {
      const event = findWritableEvent(store, eventId, calendarId);
      event.attendees = event.attendees.map((attendee) =>
        attendee.self ? { ...attendee, responseStatus: response } : attendee,
      );
      return copyEvent(event);
    },
    updatePreferences: async (input) => {
      store.snapshot = { ...store.snapshot, preferences: { ...input } };
      return { ...input };
    },
    updateGoogleOAuthConfiguration: async (clientId, clientSecret) => {
      const configuration: OAuthConfiguration = {
        clientId,
        clientSecretConfigured:
          Boolean(clientSecret) ||
          store.snapshot.oauthConfiguration.clientSecretConfigured,
      };
      store.snapshot = {
        ...store.snapshot,
        preferences: {
          ...store.snapshot.preferences,
          googleClientId: clientId,
        },
        oauthConfiguration: configuration,
      };
      return configuration;
    },
  };
}

export function createTauriClient(): IpcClient {
  return {
    bootstrap: () => invoke<AppSnapshot>('bootstrap'),
    getEvents: (rangeStart, rangeEnd) =>
      invoke<CalendarEvent[]>('get_events', { rangeStart, rangeEnd }),
    getTaskLists: () => invoke<readonly TaskList[]>('get_task_lists'),
    startGoogleAuth: () => invoke<Account>('start_google_auth'),
    removeAccount: (accountId) =>
      invoke('remove_account', { accountId }).then(() => undefined),
    syncNow: () => invoke<SyncState>('sync_now'),
    createEvent: (input: EventInput) =>
      invoke<CalendarEvent>('create_event', { input }),
    updateEvent: (eventId, calendarId, patch: EventPatch) =>
      invoke<CalendarEvent>('update_event', { eventId, calendarId, patch }),
    deleteEvent: (eventId, calendarId) =>
      invoke('delete_event', { eventId, calendarId }).then(() => undefined),
    respondToEvent: (eventId, calendarId, response: AttendeeResponse) =>
      invoke<CalendarEvent>('respond_to_event', {
        eventId,
        calendarId,
        response,
      }),
    updatePreferences: (input: Preferences) =>
      invoke<Preferences>('update_preferences', { input }),
    updateGoogleOAuthConfiguration: (clientId, clientSecret) =>
      invoke<OAuthConfiguration>('update_google_oauth_configuration', {
        clientId,
        clientSecret,
      }),
  };
}

const isTauri = '__TAURI_INTERNALS__' in window;
export const ipc = isTauri ? createTauriClient() : createDemoClient();
