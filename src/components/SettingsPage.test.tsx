import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Preferences } from '../domain';
import { SettingsPage } from './SettingsPage';

const preferences: Preferences = {
  googleClientId: '',
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
  runInBackground: true,
  surfaceTransparency: 0,
  surfaceBlur: 8,
  backgroundImage: '',
};

describe('SettingsPage', () => {
  it('saves a Google OAuth client ID before account connection', () => {
    const onUpdateOAuth = vi.fn();
    render(
      <SettingsPage
        preferences={preferences}
        accounts={[]}
        syncState={{ status: 'idle' }}
        oauthConfiguration={{
          clientId: '',
          clientSecretConfigured: false,
        }}
        busy={false}
        onUpdate={vi.fn()}
        onImportBackground={vi.fn()}
        onUpdateOAuth={onUpdateOAuth}
        onConnect={vi.fn()}
        onRemove={vi.fn()}
        onSync={vi.fn()}
      />,
    );

    expect(
      screen.getByRole('button', { name: /Connect another Google account/ }),
    ).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Google OAuth client ID'), {
      target: { value: '  client.apps.googleusercontent.com  ' },
    });
    fireEvent.change(screen.getByLabelText('Google OAuth client secret'), {
      target: { value: '  client-secret  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save configuration' }));

    expect(onUpdateOAuth).toHaveBeenCalledWith(
      'client.apps.googleusercontent.com',
      'client-secret',
    );
    expect(screen.getByLabelText('Google OAuth client secret')).toHaveValue('');
  });

  it('opens and closes the complete Google setup guide', () => {
    render(
      <SettingsPage
        preferences={preferences}
        accounts={[]}
        syncState={{ status: 'idle' }}
        oauthConfiguration={{
          clientId: '',
          clientSecretConfigured: false,
        }}
        busy={false}
        onUpdate={vi.fn()}
        onImportBackground={vi.fn()}
        onUpdateOAuth={vi.fn()}
        onConnect={vi.fn()}
        onRemove={vi.fn()}
        onSync={vi.fn()}
      />,
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Open complete setup guide' }),
    );
    expect(
      screen.getByRole('dialog', { name: 'Complete setup guide' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Enable the required Google APIs')).toBeVisible();
    expect(screen.getByText('Secret stored securely')).toBeVisible();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('updates the polling interval in minutes', () => {
    const onUpdate = vi.fn();
    render(
      <SettingsPage
        preferences={preferences}
        accounts={[]}
        syncState={{ status: 'idle' }}
        oauthConfiguration={{
          clientId: '',
          clientSecretConfigured: false,
        }}
        busy={false}
        onUpdate={onUpdate}
        onImportBackground={vi.fn()}
        onUpdateOAuth={vi.fn()}
        onConnect={vi.fn()}
        onRemove={vi.fn()}
        onSync={vi.fn()}
      />,
    );

    const input = screen.getByLabelText('Polling interval in minutes');
    fireEvent.change(input, { target: { value: '5' } });
    fireEvent.blur(input);

    expect(onUpdate).toHaveBeenCalledWith({ syncIntervalMinutes: 5 });
  });

  it('sets a background image from a URL or a picked file', () => {
    const onUpdate = vi.fn();
    const onImportBackground = vi.fn();
    render(
      <SettingsPage
        preferences={preferences}
        accounts={[]}
        syncState={{ status: 'idle' }}
        oauthConfiguration={{
          clientId: '',
          clientSecretConfigured: false,
        }}
        busy={false}
        onUpdate={onUpdate}
        onImportBackground={onImportBackground}
        onUpdateOAuth={vi.fn()}
        onConnect={vi.fn()}
        onRemove={vi.fn()}
        onSync={vi.fn()}
      />,
    );

    const useUrl = screen.getByRole('button', { name: 'Use URL' });
    const urlInput = screen.getByLabelText('Background image URL');
    fireEvent.change(urlInput, { target: { value: 'not a url' } });
    expect(useUrl).toBeDisabled();
    fireEvent.change(urlInput, {
      target: { value: ' https://example.com/sky.jpg ' },
    });
    fireEvent.click(useUrl);
    expect(onUpdate).toHaveBeenCalledWith({
      backgroundImage: 'https://example.com/sky.jpg',
    });

    const file = new File(['image'], 'sky.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('Background image file'), {
      target: { files: [file] },
    });
    expect(onImportBackground).toHaveBeenCalledWith(file);
  });

  it('removes the current background image', () => {
    const onUpdate = vi.fn();
    render(
      <SettingsPage
        preferences={{ ...preferences, backgroundImage: 'local:sky.png' }}
        accounts={[]}
        syncState={{ status: 'idle' }}
        oauthConfiguration={{
          clientId: '',
          clientSecretConfigured: false,
        }}
        busy={false}
        onUpdate={onUpdate}
        onImportBackground={vi.fn()}
        onUpdateOAuth={vi.fn()}
        onConnect={vi.fn()}
        onRemove={vi.fn()}
        onSync={vi.fn()}
      />,
    );

    expect(screen.getByLabelText('Background image URL')).toHaveValue('');
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(onUpdate).toHaveBeenCalledWith({ backgroundImage: '' });
  });
});
