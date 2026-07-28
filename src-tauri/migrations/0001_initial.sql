PRAGMA foreign_keys = ON;

CREATE TABLE accounts (
    id TEXT PRIMARY KEY NOT NULL,
    email TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    picture_url TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE calendars (
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    color TEXT,
    background_color TEXT,
    foreground_color TEXT,
    access_role TEXT NOT NULL DEFAULT 'reader',
    primary_calendar INTEGER NOT NULL DEFAULT 0,
    selected INTEGER NOT NULL DEFAULT 1,
    deleted INTEGER NOT NULL DEFAULT 0,
    etag TEXT,
    raw_json TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (account_id, id)
);

CREATE TABLE events (
    account_id TEXT NOT NULL,
    calendar_id TEXT NOT NULL,
    id TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    description TEXT,
    location TEXT,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    all_day INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'confirmed',
    etag TEXT,
    updated_google TEXT,
    raw_json TEXT NOT NULL,
    pending INTEGER NOT NULL DEFAULT 0,
    deleted INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (account_id, calendar_id, id),
    FOREIGN KEY (account_id, calendar_id) REFERENCES calendars(account_id, id) ON DELETE CASCADE
);
CREATE INDEX events_range_idx ON events(start_time, end_time, deleted);

CREATE TABLE task_lists (
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    title TEXT NOT NULL,
    updated_google TEXT,
    raw_json TEXT NOT NULL,
    PRIMARY KEY (account_id, id)
);

CREATE TABLE tasks (
    account_id TEXT NOT NULL,
    task_list_id TEXT NOT NULL,
    id TEXT NOT NULL,
    title TEXT NOT NULL,
    notes TEXT,
    status TEXT NOT NULL,
    due TEXT,
    completed TEXT,
    position TEXT,
    raw_json TEXT NOT NULL,
    PRIMARY KEY (account_id, task_list_id, id),
    FOREIGN KEY (account_id, task_list_id) REFERENCES task_lists(account_id, id) ON DELETE CASCADE
);

CREATE TABLE sync_state (
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    resource_type TEXT NOT NULL,
    resource_id TEXT NOT NULL DEFAULT '',
    sync_token TEXT,
    last_sync_at TEXT,
    status TEXT NOT NULL DEFAULT 'idle',
    error TEXT,
    PRIMARY KEY (account_id, resource_type, resource_id)
);

CREATE TABLE pending_mutations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    calendar_id TEXT NOT NULL,
    event_id TEXT NOT NULL,
    operation TEXT NOT NULL,
    payload_json TEXT,
    base_etag TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TEXT NOT NULL,
    last_error TEXT,
    created_at TEXT NOT NULL
);
CREATE INDEX pending_mutations_due_idx ON pending_mutations(next_attempt_at, id);

CREATE TABLE preferences (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    json TEXT NOT NULL
);

CREATE TABLE delivered_reminders (
    account_id TEXT NOT NULL,
    calendar_id TEXT NOT NULL,
    event_id TEXT NOT NULL,
    reminder_time TEXT NOT NULL,
    delivered_at TEXT NOT NULL,
    PRIMARY KEY (account_id, calendar_id, event_id, reminder_time)
);
