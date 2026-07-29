import { useState } from 'react';
import {
  Check,
  Cloud,
  ExternalLink,
  Laptop,
  Moon,
  Palette,
  Plus,
  RotateCw,
  Sun,
  Trash2,
} from 'lucide-react';
import type {
  Account,
  CalendarView,
  PreferenceInput,
  Preferences,
  SyncState,
  ThemeMode,
} from '../domain';

type SettingsPageProps = {
  preferences: Preferences;
  accounts: readonly Account[];
  syncState: SyncState;
  busy: boolean;
  onUpdate: (input: PreferenceInput) => void;
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

export function SettingsPage({
  preferences,
  accounts,
  syncState,
  busy,
  onUpdate,
  onConnect,
  onRemove,
  onSync,
}: SettingsPageProps) {
  const [googleClientId, setGoogleClientId] = useState(
    preferences.googleClientId,
  );
  const normalizedClientId = googleClientId.trim();

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
              onUpdate({ googleClientId: normalizedClientId });
            }}
          >
            <label htmlFor="google-client-id">
              <strong>Google OAuth client ID</strong>
              <small>
                Use a Desktop app client ID from Google Cloud. This identifier
                is public; no client secret or API key is required.
              </small>
            </label>
            <input
              id="google-client-id"
              aria-label="Google OAuth client ID"
              value={googleClientId}
              onChange={(event) => setGoogleClientId(event.target.value)}
              placeholder="123456789.apps.googleusercontent.com"
              spellCheck={false}
              autoComplete="off"
            />
            <button
              type="submit"
              className="soft-button"
              disabled={
                busy || normalizedClientId === preferences.googleClientId
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
            disabled={busy || !preferences.googleClientId}
          >
            <Plus size={18} />
            <span>
              <strong>Connect another Google account</strong>
              <small>
                {preferences.googleClientId
                  ? 'Authentication opens in your default browser'
                  : 'Save an OAuth client ID above first'}{' '}
                {preferences.googleClientId && <ExternalLink size={11} />}
              </small>
            </span>
          </button>
        </section>
      </div>
    </main>
  );
}
