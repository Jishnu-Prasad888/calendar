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
};

describe('SettingsPage', () => {
  it('saves a Google OAuth client ID before account connection', () => {
    const onUpdate = vi.fn();
    render(
      <SettingsPage
        preferences={preferences}
        accounts={[]}
        syncState={{ status: 'idle' }}
        busy={false}
        onUpdate={onUpdate}
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
    fireEvent.click(screen.getByRole('button', { name: 'Save configuration' }));

    expect(onUpdate).toHaveBeenCalledWith({
      googleClientId: 'client.apps.googleusercontent.com',
    });
  });
});
