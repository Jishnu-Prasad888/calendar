// Applies the last-used theme before first paint so startup never flashes the
// default colors. Kept in sync with useAppearance (APPEARANCE_STORAGE_KEY).
(function () {
  try {
    var saved = JSON.parse(
      localStorage.getItem('clay-calendar-appearance') || '{}',
    );
    var root = document.documentElement;
    var dark =
      saved.theme === 'dark' ||
      (saved.theme !== 'light' &&
        window.matchMedia('(prefers-color-scheme: dark)').matches);
    root.dataset.theme = dark ? 'dark' : 'light';
    if (saved.surfaceColor)
      root.style.setProperty('--app-surface', saved.surfaceColor);
    if (saved.accentColor)
      root.style.setProperty('--accent', saved.accentColor);
  } catch (error) {
    // No saved appearance yet; the app applies preferences once loaded.
  }
})();
