import { useEffect } from 'react';
import type { Preferences, ThemeMode } from '../domain';
import { LOCAL_BACKGROUND_PREFIX } from '../lib/ipc';

export const APPEARANCE_STORAGE_KEY = 'clay-calendar-appearance';

export function resolveTheme(
  mode: ThemeMode,
  systemPrefersDark: boolean,
): 'light' | 'dark' {
  return mode === 'system' ? (systemPrefersDark ? 'dark' : 'light') : mode;
}

export const MAX_SURFACE_TRANSPARENCY = 80;
export const MAX_SURFACE_BLUR = 40;

export function applySurfaceEffects(transparency: number, blur: number): void {
  const style = document.documentElement.style;
  style.setProperty('--surface-opacity', `${String(100 - transparency)}%`);
  style.setProperty('--surface-blur', `${String(blur)}px`);
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
      applySurfaceEffects(
        preferences.surfaceTransparency,
        preferences.surfaceBlur,
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

/** CSS `url()` value for an image address, quoted so any URL is safe. */
export function cssImageUrl(url: string): string {
  return `url(${JSON.stringify(url)})`;
}

function applyBackgroundImage(url: string | undefined): void {
  const root = document.documentElement;
  if (url) {
    root.style.setProperty('--app-background-image', cssImageUrl(url));
    root.dataset.backgroundImage = 'true';
  } else {
    root.style.removeProperty('--app-background-image');
    delete root.dataset.backgroundImage;
  }
}

/**
 * Shows the background image preference behind the app. Imported files are
 * loaded through `load`; URLs are used directly.
 */
export function useBackgroundImage(
  value: string | undefined,
  load: (value: string) => Promise<Blob>,
): void {
  useEffect(() => {
    if (!value) {
      applyBackgroundImage(undefined);
      return;
    }
    if (!value.startsWith(LOCAL_BACKGROUND_PREFIX)) {
      applyBackgroundImage(value);
      return;
    }
    let objectUrl: string | undefined;
    let cancelled = false;
    load(value)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        applyBackgroundImage(objectUrl);
      })
      .catch((reason: unknown) => {
        console.error('Could not load background image.', reason);
        if (!cancelled) applyBackgroundImage(undefined);
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [value, load]);
}
