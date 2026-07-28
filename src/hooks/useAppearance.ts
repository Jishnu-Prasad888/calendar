import { useEffect } from 'react';
import type { Preferences, ThemeMode } from '../domain';

export const APPEARANCE_STORAGE_KEY = 'clay-calendar-appearance';

export function resolveTheme(
  mode: ThemeMode,
  systemPrefersDark: boolean,
): 'light' | 'dark' {
  return mode === 'system' ? (systemPrefersDark ? 'dark' : 'light') : mode;
}

export function useAppearance(preferences: Preferences | undefined): void {
  useEffect(() => {
    if (!preferences) return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      document.documentElement.dataset.theme = resolveTheme(
        preferences.theme,
        media.matches,
      );
      document.documentElement.style.setProperty(
        '--app-surface',
        preferences.surfaceColor,
      );
      document.documentElement.style.setProperty(
        '--accent',
        preferences.accentColor,
      );
    };

    apply();
    localStorage.setItem(
      APPEARANCE_STORAGE_KEY,
      JSON.stringify({
        theme: preferences.theme,
        surfaceColor: preferences.surfaceColor,
        accentColor: preferences.accentColor,
      }),
    );
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [preferences]);
}
