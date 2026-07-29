import { render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Preferences } from '../domain';
import {
  APPEARANCE_STORAGE_KEY,
  resolveTheme,
  useAppearance,
} from './useAppearance';

const preferences: Preferences = {
  googleClientId: '',
  theme: 'dark',
  surfaceColor: '#223344',
  accentColor: '#cc5500',
  weekStartsOn: 1,
  defaultView: 'month',
  autostart: false,
  selectedCalendarIds: [],
  showTasks: true,
  syncIntervalMinutes: 15,
  notificationsEnabled: true,
};

function AppearanceHarness({ value }: { value: Preferences }) {
  useAppearance(value);
  return null;
}

describe('appearance', () => {
  afterEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.removeAttribute('style');
  });

  it('resolves system mode and persists local appearance settings', async () => {
    expect(resolveTheme('system', true)).toBe('dark');
    render(<AppearanceHarness value={preferences} />);

    await waitFor(() =>
      expect(document.documentElement.dataset.theme).toBe('dark'),
    );
    expect(document.documentElement.style.getPropertyValue('--accent')).toBe(
      '#cc5500',
    );
    expect(
      JSON.parse(localStorage.getItem(APPEARANCE_STORAGE_KEY) ?? '{}'),
    ).toMatchObject({
      theme: 'dark',
      surfaceColor: '#223344',
      accentColor: '#cc5500',
    });
  });
});
