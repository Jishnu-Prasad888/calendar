import { useEffect, useState } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import {
  BookOpen,
  Check,
  Cloud,
  ExternalLink,
  KeyRound,
  Laptop,
  Moon,
  Palette,
  Plus,
  RotateCw,
  ShieldCheck,
  Sun,
  Trash2,
  X,
} from 'lucide-react';
import type {
  Account,
  CalendarView,
  OAuthConfiguration,
  PreferenceInput,
  Preferences,
  SyncState,
  ThemeMode,
} from '../domain';

type SettingsPageProps = {
  preferences: Preferences;
  accounts: readonly Account[];
  syncState: SyncState;
  oauthConfiguration: OAuthConfiguration;
  busy: boolean;
  onUpdate: (input: PreferenceInput) => void;
  onUpdateOAuth: (clientId: string, clientSecret?: string) => void;
  onConnect: () => void;
  onRemove: (accountId: string) => void;
  onSync: () => void;
};

const themes: readonly { value: ThemeMode; label: string; icon: typeof Sun }[] =
  [
    { value: 'light', label: 'Light', icon: Sun },
    { value: 'dark', label: 'Dark', icon: Moon },
    { value: 'system', label: 'System', icon: Laptop },
  ];

const cloudLinks = {
  project: 'https://console.cloud.google.com/projectcreate',
  calendarApi:
    'https://console.cloud.google.com/apis/library/calendar-json.googleapis.com',
  tasksApi:
    'https://console.cloud.google.com/apis/library/tasks.googleapis.com',
  auth: 'https://console.cloud.google.com/auth/overview',
  clients: 'https://console.cloud.google.com/auth/clients',
} as const;

function CloudLink({ href, children }: { href: string; children: string }) {
  return (
    <button
      type="button"
      className="guide-link"
      onClick={() => void openUrl(href)}
    >
      {children} <ExternalLink size={13} />
    </button>
  );
}

export function SettingsPage({
  preferences,
  accounts,
  syncState,
  oauthConfiguration,
  busy,
  onUpdate,
  onUpdateOAuth,
  onConnect,
  onRemove,
  onSync,
}: SettingsPageProps) {
  const [googleClientId, setGoogleClientId] = useState(
    oauthConfiguration.clientId,
  );
  const [googleClientSecret, setGoogleClientSecret] = useState('');
  const [guideOpen, setGuideOpen] = useState(false);
  const [syncInterval, setSyncInterval] = useState(
    String(preferences.syncIntervalMinutes),
  );
  const normalizedClientId = googleClientId.trim();

  const saveSyncInterval = () => {
    const minutes = Number(syncInterval);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) {
      setSyncInterval(String(preferences.syncIntervalMinutes));
      return;
    }
    setSyncInterval(String(minutes));
    if (minutes !== preferences.syncIntervalMinutes) {
      onUpdate({ syncIntervalMinutes: minutes });
    }
  };

  useEffect(() => {
    if (!guideOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setGuideOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [guideOpen]);

  return (
    <main className="page-surface settings-page">
      <header className="page-heading">
        <div>
          <span className="eyebrow">Preferences</span>
          <h1>Settings</h1>
          <p>
            Personalize this device without changing colors stored in Google
            Calendar.
          </p>
        </div>
      </header>

      <div className="settings-layout">
        <section className="settings-card">
          <header>
            <span className="settings-icon">
              <Palette size={19} />
            </span>
            <div>
              <h2>Appearance</h2>
              <p>Applied locally to the app chrome and surfaces.</p>
            </div>
          </header>
          <div className="setting-row setting-row--stack">
            <span>
              <strong>Theme</strong>
              <small>Follow the system or choose a mode.</small>
            </span>
            <div className="theme-options">
              {themes.map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  data-active={preferences.theme === value}
                  onClick={() => onUpdate({ theme: value })}
                >
                  <Icon size={18} /> {label}
                  {preferences.theme === value && <Check size={14} />}
                </button>
              ))}
            </div>
          </div>
          <div className="setting-row color-row">
            <span>
              <strong>App surface</strong>
              <small>Background tint for local clay surfaces.</small>
            </span>
            <label>
              <input
                aria-label="App surface color"
                type="color"
                value={preferences.surfaceColor}
                onChange={(event) =>
                  onUpdate({ surfaceColor: event.target.value })
                }
              />
              <code>{preferences.surfaceColor}</code>
            </label>
          </div>
          <div className="setting-row color-row">
            <span>
              <strong>App accent</strong>
              <small>
                Controls and focus states only. Event colors are preserved.
              </small>
            </span>
            <label>
              <input
                aria-label="App accent color"
                type="color"
                value={preferences.accentColor}
                onChange={(event) =>
                  onUpdate({ accentColor: event.target.value })
                }
              />
              <code>{preferences.accentColor}</code>
            </label>
          </div>
        </section>

        <section className="settings-card">
          <header>
            <span className="settings-icon">
              <Laptop size={19} />
            </span>
            <div>
              <h2>Calendar defaults</h2>
              <p>Choose how your calendar opens on this device.</p>
            </div>
          </header>
          <label className="setting-row">
            <span>
              <strong>Week starts on</strong>
              <small>Used in the mini calendar and all grid views.</small>
            </span>
            <select
              value={preferences.weekStartsOn}
              onChange={(event) =>
                onUpdate({
                  weekStartsOn: Number(event.target.value) as 0 | 1 | 6,
                })
              }
            >
              <option value="0">Sunday</option>
              <option value="1">Monday</option>
              <option value="6">Saturday</option>
            </select>
          </label>
          <label className="setting-row">
            <span>
              <strong>Default view</strong>
              <small>The first view shown at launch.</small>
            </span>
            <select
              value={preferences.defaultView}
              onChange={(event) =>
                onUpdate({ defaultView: event.target.value as CalendarView })
              }
            >
              <option value="month">Month</option>
              <option value="week">Week</option>
              <option value="day">Day</option>
              <option value="year">Year</option>
              <option value="schedule">Schedule</option>
              <option value="multi-day">4 days</option>
            </select>
          </label>
          <label className="setting-row">
            <span>
              <strong>Launch at startup</strong>
              <small>Start Clay Calendar quietly in the system tray.</small>
            </span>
            <input
              className="switch"
              type="checkbox"
              checked={preferences.autostart}
              onChange={(event) =>
                onUpdate({ autostart: event.target.checked })
              }
            />
          </label>
          <label className="setting-row">
            <span>
              <strong>Polling interval</strong>
              <small>
                Continuously check Google for updates every 1 to 1440 minutes.
              </small>
            </span>
            <span className="polling-interval-control">
              <input
                aria-label="Polling interval in minutes"
                type="number"
                min="1"
                max="1440"
                step="1"
                value={syncInterval}
                onChange={(event) => setSyncInterval(event.target.value)}
                onBlur={saveSyncInterval}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') event.currentTarget.blur();
                }}
              />
              <small>minutes</small>
            </span>
          </label>
        </section>

        <section className="settings-card settings-card--accounts">
          <header>
            <span className="settings-icon">
              <Cloud size={19} />
            </span>
            <div>
              <h2>Google accounts</h2>
              <p>Calendars and events sync through connected accounts.</p>
            </div>
            <button className="soft-button" onClick={onSync} disabled={busy}>
              <RotateCw size={15} />{' '}
              {syncState.status === 'syncing' ? 'Syncing…' : 'Sync now'}
            </button>
          </header>
          <form
            className="oauth-config"
            onSubmit={(event) => {
              event.preventDefault();
              setGoogleClientId(normalizedClientId);
              onUpdateOAuth(
                normalizedClientId,
                googleClientSecret.trim() || undefined,
              );
              setGoogleClientSecret('');
            }}
          >
            <div className="oauth-config-copy">
              <label htmlFor="google-client-id">
                <strong>Google OAuth client ID</strong>
                <small>
                  Enter the Desktop app client ID and secret from Google Cloud.
                  The secret is stored in your operating system credential
                  vault, not the app database.
                </small>
              </label>
              <button
                type="button"
                className="oauth-guide-link"
                onClick={() => setGuideOpen(true)}
              >
                <BookOpen size={13} /> Open complete setup guide
              </button>
            </div>
            <div className="oauth-config-fields">
              <input
                id="google-client-id"
                aria-label="Google OAuth client ID"
                value={googleClientId}
                onChange={(event) => setGoogleClientId(event.target.value)}
                placeholder="123456789.apps.googleusercontent.com"
                spellCheck={false}
                autoComplete="off"
              />
              <input
                aria-label="Google OAuth client secret"
                type="password"
                value={googleClientSecret}
                onChange={(event) => setGoogleClientSecret(event.target.value)}
                placeholder={
                  oauthConfiguration.clientSecretConfigured
                    ? 'Stored securely - enter to replace'
                    : 'Paste Google OAuth client secret'
                }
                spellCheck={false}
                autoComplete="new-password"
              />
            </div>
            <button
              type="submit"
              className="soft-button"
              disabled={
                busy ||
                !normalizedClientId ||
                (!googleClientSecret.trim() &&
                  normalizedClientId === oauthConfiguration.clientId)
              }
            >
              Save configuration
            </button>
          </form>
          {accounts.length === 0 && (
            <div className="account-empty">
              <p>No Google account is connected.</p>
            </div>
          )}
          {accounts.map((account) => (
            <article className="account-row" key={account.id}>
              <span className="account-avatar">
                {account.displayName
                  .split(' ')
                  .map((part) => part[0])
                  .join('')
                  .slice(0, 2)}
              </span>
              <span>
                <strong>{account.displayName}</strong>
                <small>{account.email}</small>
              </span>
              <span className="connected-pill">
                <i /> Connected
              </span>
              <button
                className="icon-button"
                aria-label={`Remove ${account.email}`}
                onClick={() => onRemove(account.id)}
                disabled={busy}
              >
                <Trash2 size={17} />
              </button>
            </article>
          ))}
          <button
            className="connect-button"
            onClick={onConnect}
            disabled={
              busy ||
              !oauthConfiguration.clientId ||
              !oauthConfiguration.clientSecretConfigured
            }
          >
            <Plus size={18} />
            <span>
              <strong>Connect another Google account</strong>
              <small>
                {oauthConfiguration.clientId &&
                oauthConfiguration.clientSecretConfigured
                  ? 'Authentication opens in your default browser'
                  : 'Save the OAuth client ID and secret above first'}{' '}
                {oauthConfiguration.clientId &&
                  oauthConfiguration.clientSecretConfigured && (
                    <ExternalLink size={11} />
                  )}
              </small>
            </span>
          </button>
        </section>
      </div>
      {guideOpen && (
        <div
          className="setup-guide-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setGuideOpen(false);
          }}
        >
          <section
            className="setup-guide-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="setup-guide-title"
          >
            <header>
              <span className="setup-guide-icon">
                <Cloud size={21} />
              </span>
              <div>
                <small>Google integration</small>
                <h2 id="setup-guide-title">Complete setup guide</h2>
              </div>
              <button
                autoFocus
                type="button"
                className="icon-button"
                aria-label="Close setup guide"
                onClick={() => setGuideOpen(false)}
              >
                <X size={19} />
              </button>
            </header>

            <div className="setup-guide-content">
              <aside className="setup-requirements">
                <ShieldCheck size={22} />
                <div>
                  <strong>What this app actually needs</strong>
                  <p>
                    One Google Cloud project, two enabled APIs, an OAuth consent
                    screen, and one Desktop app OAuth client credential.
                  </p>
                </div>
                <span>No API key</span>
                <span>Secret stored securely</span>
              </aside>

              <ol className="setup-steps">
                <li>
                  <article>
                    <h3>Create or select a Google Cloud project</h3>
                    <p>
                      Use a dedicated project so its OAuth consent screen and
                      API access are easy to manage. Keep that project selected
                      while completing every step below.
                    </p>
                    <CloudLink href={cloudLinks.project}>
                      Create a Cloud project
                    </CloudLink>
                  </article>
                </li>
                <li>
                  <article>
                    <h3>Enable the required Google APIs</h3>
                    <p>
                      Enable Calendar API for event and calendar sync. Enable
                      Tasks API for the app's read-only Tasks page. No other
                      Google API is required.
                    </p>
                    <div className="guide-link-row">
                      <CloudLink href={cloudLinks.calendarApi}>
                        Enable Calendar API
                      </CloudLink>
                      <CloudLink href={cloudLinks.tasksApi}>
                        Enable Tasks API
                      </CloudLink>
                    </div>
                  </article>
                </li>
                <li>
                  <article>
                    <h3>Configure Google Auth Platform</h3>
                    <p>
                      Add an app name and support email. For personal use,
                      choose External audience and Testing status, then add each
                      Google account you will connect as a test user.
                    </p>
                    <CloudLink href={cloudLinks.auth}>
                      Open Google Auth Platform
                    </CloudLink>
                  </article>
                </li>
                <li>
                  <article>
                    <h3>Add the OAuth scopes</h3>
                    <p>
                      Add these scopes under Data Access. Calendar is
                      read/write; Tasks remains read-only.
                    </p>
                    <div className="scope-list">
                      <code>openid</code>
                      <code>email</code>
                      <code>profile</code>
                      <code>https://www.googleapis.com/auth/calendar</code>
                      <code>
                        https://www.googleapis.com/auth/tasks.readonly
                      </code>
                    </div>
                  </article>
                </li>
                <li>
                  <article>
                    <h3>Create a Desktop app OAuth client</h3>
                    <p>
                      In Clients, create an OAuth client with application type
                      <strong> Desktop app</strong>. Do not choose Web
                      application. Google provides a client ID and client
                      secret; the temporary localhost callback is handled
                      automatically.
                    </p>
                    <CloudLink href={cloudLinks.clients}>
                      Create OAuth client
                    </CloudLink>
                  </article>
                </li>
                <li>
                  <article>
                    <h3>Save the client ID and secret in Clay Calendar</h3>
                    <p>
                      Copy the client ID ending in
                      <code> .apps.googleusercontent.com</code> and its client
                      secret. Close this guide, paste both values above, and
                      select Save configuration. You can then connect your
                      account.
                    </p>
                  </article>
                </li>
                <li>
                  <article>
                    <h3>Confirm local credential storage</h3>
                    <p>
                      Windows uses Credential Manager automatically. Linux needs
                      a running Secret Service provider such as GNOME Keyring or
                      KeePassXC with Secret Service enabled. The OAuth client
                      secret and refresh tokens are stored there, never in the
                      preferences database.
                    </p>
                  </article>
                </li>
              </ol>

              <section className="setup-troubleshooting">
                <KeyRound size={19} />
                <div>
                  <h3>If Google blocks sign-in</h3>
                  <p>
                    Confirm the account is listed as a test user, the OAuth
                    client type is Desktop app, both APIs belong to the same
                    selected project, and all five scopes are configured. A
                    Testing app may require reconnection after its refresh token
                    expires.
                  </p>
                </div>
              </section>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
