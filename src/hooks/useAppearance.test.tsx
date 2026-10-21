import { render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Preferences } from '../domain';
import {
  APPEARANCE_STORAGE_KEY,
  resolveTheme,
  useAppearance,
  useBackgroundImage,
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
  runInBackground: true,
  surfaceTransparency: 30,
  surfaceBlur: 12,
  backgroundImage: '',
};

function AppearanceHarness({ value }: { value: Preferences }) {
  useAppearance(value);
  return null;
}

function BackgroundHarness({
  value,
  load,
}: {
  value: string;
  load: (value: string) => Promise<Blob>;
}) {
  useBackgroundImage(value, load);
  return null;
}

describe('appearance', () => {
  afterEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.removeAttribute('style');
    document.documentElement.removeAttribute('data-background-image');
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
      document.documentElement.style.getPropertyValue('--surface-opacity'),
    ).toBe('70%');
    expect(
      document.documentElement.style.getPropertyValue('--surface-blur'),
    ).toBe('12px');
    expect(
      JSON.parse(localStorage.getItem(APPEARANCE_STORAGE_KEY) ?? '{}'),
    ).toMatchObject({
      theme: 'dark',
      surfaceColor: '#223344',
      accentColor: '#cc5500',
    });
  });

  it('applies URL and imported background images', async () => {
    const root = document.documentElement;
    const load = vi.fn(() => Promise.resolve(new Blob(['image'])));
    const createObjectURL = vi.fn(() => 'blob:background');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal(
      'URL',
      Object.assign(URL, { createObjectURL, revokeObjectURL }),
    );

    const { rerender } = render(
      <BackgroundHarness value="https://example.com/a b.jpg" load={load} />,
    );
    expect(root.style.getPropertyValue('--app-background-image')).toBe(
      'url("https://example.com/a b.jpg")',
    );
    expect(root.dataset.backgroundImage).toBe('true');
    expect(load).not.toHaveBeenCalled();

    rerender(<BackgroundHarness value="local:sky.png" load={load} />);
    await waitFor(() =>
      expect(root.style.getPropertyValue('--app-background-image')).toBe(
        'url("blob:background")',
      ),
    );
    expect(load).toHaveBeenCalledWith('local:sky.png');

    rerender(<BackgroundHarness value="" load={load} />);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:background');
    expect(root.style.getPropertyValue('--app-background-image')).toBe('');
    expect(root.dataset.backgroundImage).toBeUndefined();
    vi.unstubAllGlobals();
  });
});
