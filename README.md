# Clay Calendar

A claymorphic Google Calendar desktop client built with Tauri, Rust, React, and TypeScript. It targets Windows and Linux.

### Note : THIS PROJECT IS MADE FOR PERSONAL USE BY ME EVERYTHING HERE IS AI GENERATED USE WITH CAUTION

## Features

- Month, week, day, year, schedule, and four-day calendar views
- Standard event creation, editing, deletion, recurrence, attendees, RSVP, reminders, privacy, and availability
- Multiple Google accounts and calendars
- Incremental bidirectional Calendar synchronization with an offline mutation queue
- Read-only Google Tasks page
- Native popup reminders, system tray operation, and optional launch at startup
- Configurable local clay theme with light, dark, and system modes

Calendar creation/sharing, Meet creation, attachments, free/busy assistance, appointment schedules, Workspace room discovery, and Tasks mutations are intentionally outside this project's scope.

## Google Setup

1. Create or select a project in [Google Cloud Console](https://console.cloud.google.com/).
2. Enable **Google Calendar API** and **Google Tasks API**.
3. Configure the OAuth consent screen. Testing mode is sufficient for personal use, but every account must be added under **Test users**.
4. Add these scopes:
   - `openid`, `email`, and `profile`
   - `https://www.googleapis.com/auth/calendar`
   - `https://www.googleapis.com/auth/tasks.readonly`
5. Create an OAuth client with application type **Desktop app**.
6. Open **Settings > Google accounts**, paste the client ID into **Google OAuth client ID**, and save it before connecting an account.

For packaged or preconfigured builds, the client ID can optionally be supplied as a build-time default:

```bash
export GOOGLE_CLIENT_ID="your-client-id.apps.googleusercontent.com"
npm run tauri dev
```

The desktop client ID is public and is stored in the app's local preferences. Never add a client secret or API key; the Desktop OAuth PKCE flow does not use either. A value supplied through `GOOGLE_CLIENT_ID` is only the initial default and can be changed later in Settings without rebuilding. `.env.example` documents the optional variable; the app does not automatically load `.env` files.

OAuth runs in the system browser using S256 PKCE, CSRF state, and a temporary `127.0.0.1` callback. Refresh tokens are stored in Windows Credential Manager or Linux Secret Service. Access tokens remain in Rust memory and are never sent to React.

## Development

Prerequisites are Node.js, npm, Rust, and the [Tauri system dependencies](https://v2.tauri.app/start/prerequisites/) for the host platform. Linux also needs a running Secret Service provider such as GNOME Keyring or KeePassXC Secret Service integration.

```bash
npm install
npm run tauri dev
```

Run all source-level quality checks with:

```bash
npm run check
```

## Packaging Commands

```bash
npm run build:linux
npm run build:windows
```

`build:linux` produces AppImage and Debian bundles. `build:windows` cross-compiles an NSIS installer from Linux using `cargo-xwin`; it requires the additional LLVM, NSIS, Windows Rust target, and `cargo-xwin` prerequisites documented by Tauri. MSI creation requires a Windows host and is not included.

## Architecture

Rust owns OAuth, secrets, Google HTTP requests, synchronization, SQLite, offline mutations, reminders, and desktop lifecycle. React communicates through typed Tauri commands and never receives tokens. Outside Tauri, the frontend uses a deterministic in-memory demo adapter for interface development and tests.

SQLite is stored in the platform application-data directory. Google sync tokens are persisted per account and resource. Invalid tokens trigger a controlled full resynchronization; mutations use client-generated IDs and ETag preconditions to avoid duplicate writes and detect conflicts.

Closing the window hides the app to the tray. Explicitly choosing **Quit** ends background synchronization and reminders. Popup reminders use event overrides or Google calendar defaults and are deduplicated across restarts.
