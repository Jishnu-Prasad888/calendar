export type ThemeMode = 'light' | 'dark' | 'system';
export type CalendarView =
  'month' | 'week' | 'day' | 'year' | 'schedule' | 'multi-day';

export type Account = {
  id: string;
  email: string;
  displayName: string;
  avatarUrl?: string;
  connected: boolean;
};

export type CalendarSource = {
  id: string;
  accountId: string;
  name: string;
  color: string;
  backgroundColor?: string;
  primary: boolean;
  readOnly: boolean;
  visible: boolean;
};

export type Preferences = {
  theme: ThemeMode;
  surfaceColor: string;
  accentColor: string;
  weekStartsOn: 0 | 1 | 6;
  defaultView: CalendarView;
  autostart: boolean;
  selectedCalendarIds: readonly string[];
  showTasks: boolean;
  syncIntervalMinutes: number;
  notificationsEnabled: boolean;
};

export type SyncState = {
  status: 'idle' | 'syncing' | 'offline' | 'error';
  lastSyncedAt?: string;
  message?: string;
};

export type AppSnapshot = {
  accounts: readonly Account[];
  calendars: readonly CalendarSource[];
  preferences: Preferences;
  syncState: SyncState;
};

export type AttendeeResponse =
  'needsAction' | 'accepted' | 'declined' | 'tentative';

export type EventAttendee = {
  email: string;
  displayName?: string;
  responseStatus: AttendeeResponse;
  self?: boolean;
  organizer?: boolean;
};

export type EventReminder = {
  method: 'popup' | 'email';
  minutes: number;
};

export type EventStatus = 'confirmed' | 'tentative' | 'cancelled';
export type EventPrivacy = 'default' | 'public' | 'private';
export type EventAvailability = 'busy' | 'free';

export type CalendarEvent = {
  id: string;
  calendarId: string;
  title: string;
  description?: string;
  location?: string;
  start: string;
  end: string;
  allDay: boolean;
  color?: string;
  status: EventStatus;
  readOnly: boolean;
  attendees: readonly EventAttendee[];
  reminders: readonly EventReminder[];
  recurrence?: readonly string[];
  privacy?: EventPrivacy;
  availability?: EventAvailability;
  etag?: string;
  pending?: boolean;
};

export type EventInput = {
  calendarId: string;
  title: string;
  description?: string;
  location?: string;
  start: string;
  end: string;
  allDay: boolean;
  attendees?: readonly string[];
  reminders?: readonly EventReminder[];
  recurrence?: readonly string[];
  privacy?: EventPrivacy;
  availability?: EventAvailability;
};

export type EventPatch = Partial<
  Omit<EventInput, 'calendarId' | 'description' | 'location'>
> & {
  description?: string | null;
  location?: string | null;
};

export type Task = {
  id: string;
  title: string;
  notes?: string;
  due?: string;
  completed: boolean;
  updatedAt: string;
};

export type TaskList = {
  id: string;
  title: string;
  tasks: readonly Task[];
};

export type PreferenceInput = Partial<Preferences>;

export type IpcClient = {
  bootstrap: () => Promise<AppSnapshot>;
  getEvents: (rangeStart: string, rangeEnd: string) => Promise<CalendarEvent[]>;
  getTaskLists: () => Promise<readonly TaskList[]>;
  startGoogleAuth: () => Promise<Account>;
  removeAccount: (accountId: string) => Promise<void>;
  syncNow: () => Promise<SyncState>;
  createEvent: (input: EventInput) => Promise<CalendarEvent>;
  updateEvent: (
    eventId: string,
    calendarId: string,
    patch: EventPatch,
  ) => Promise<CalendarEvent>;
  deleteEvent: (eventId: string, calendarId: string) => Promise<void>;
  respondToEvent: (
    eventId: string,
    calendarId: string,
    response: AttendeeResponse,
  ) => Promise<CalendarEvent>;
  updatePreferences: (input: Preferences) => Promise<Preferences>;
};
