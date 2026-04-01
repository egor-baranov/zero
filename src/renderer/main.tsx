import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '@renderer/app/app';
import { applyUiPreferences, readUiPreferences } from '@renderer/store/ui-preferences';
import '@renderer/styles/globals.css';

const THEME_PREFERENCE_KEY = 'zeroade.ui.theme.v1';
const ACCENT_COLOR_KEY = 'zeroade.ui.accent-color.v1';
const MONOCHROME_LANGUAGE_ICONS_KEY = 'zeroade.ui.monochrome-language-icons.v1';
const EDITOR_THEMES_KEY = 'zeroade.ui.editor-themes.v1';
const EDITOR_FONT_SIZE_KEY = 'zeroade.ui.editor-font-size.v1';

const applyCurrentUiPreferences = (): void => {
  applyUiPreferences(readUiPreferences());
};

document.documentElement.dataset.zeroadePlatform = window.desktop?.platform ?? 'unknown';

// Apply theme/accent before mounting React so all components start with the correct mode.
applyCurrentUiPreferences();

const systemThemeMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
const handleSystemThemeChange = (): void => {
  const preferences = readUiPreferences();
  if (preferences.theme !== 'system') {
    return;
  }

  applyUiPreferences(preferences);
};
systemThemeMediaQuery.addEventListener('change', handleSystemThemeChange);

window.addEventListener('storage', (event) => {
  if (
    event.key === THEME_PREFERENCE_KEY ||
    event.key === ACCENT_COLOR_KEY ||
    event.key === MONOCHROME_LANGUAGE_ICONS_KEY ||
    event.key === EDITOR_THEMES_KEY ||
    event.key === EDITOR_FONT_SIZE_KEY
  ) {
    applyCurrentUiPreferences();
  }
});

const container = document.getElementById('root');

if (!container) {
  throw new Error('Root container was not found');
}

createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
