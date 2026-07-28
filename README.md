# Clay Calendar

A claymorphic Tauri desktop client for Google Calendar on Linux and Windows.

## Google OAuth setup

1. In Google Cloud Console, enable Google Calendar API and Google Tasks API.
2. Configure the OAuth consent screen and add the Calendar and read-only Tasks scopes.
3. Create an OAuth 2.0 client ID with application type **Desktop app**. Do not create or ship a client secret.
4. Set `GOOGLE_CLIENT_ID` in the environment before compiling or running Tauri, for example `GOOGLE_CLIENT_ID=... npm run tauri dev`.

The identifier is embedded at Rust compile time. The app fails during startup with a configuration error if it is absent. `.env.example` documents the value but Tauri does not automatically load `.env`; use your shell or CI secret/configuration mechanism.

OAuth uses the system browser, S256 PKCE, CSRF state, and a random `127.0.0.1` callback port. Refresh tokens are stored in Windows Credential Manager or Linux Secret Service. Access tokens exist only in memory and are never returned through Tauri commands.

## Backend

The Tauri backend owns an embedded-migration SQLite cache under the platform app-data directory. It incrementally synchronizes calendar lists and events, caches Tasks read-only, and retries offline event mutations with ETag preconditions. A sync-token HTTP 410 causes one controlled full resync of that resource.

On Linux, a running Secret Service provider (for example GNOME Keyring or KeePassXC Secret Service integration) is required to add an account.
