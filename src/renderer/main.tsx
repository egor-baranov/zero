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

const formatFatalError = (value: unknown): string => {
  if (value instanceof Error) {
    return value.stack || value.message;
  }

  if (typeof value === 'string') {
    return value;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const renderFatalError = (title: string, error: unknown): void => {
  console.error(title, error);

  container.innerHTML = `
    <main style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:32px 24px;background:#f5f5f4;color:#292524;font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
      <div style="width:100%;max-width:920px;border:1px solid rgba(41,37,36,0.12);border-radius:28px;background:white;padding:24px;box-shadow:0 24px 80px -48px rgba(28,25,23,0.35);">
        <p style="margin:0;font-size:12px;font-weight:600;letter-spacing:0.24em;text-transform:uppercase;color:#78716c;">Renderer Error</p>
        <h1 style="margin:12px 0 0;font-size:28px;line-height:1.1;font-weight:600;color:#1c1917;">${title}</h1>
        <p style="margin:12px 0 0;font-size:14px;line-height:1.7;color:#57534e;">The renderer crashed before it could recover. Copy the error details below.</p>
        <pre style="margin:20px 0 0;padding:16px;border-radius:20px;border:1px solid rgba(41,37,36,0.1);background:#fafaf9;white-space:pre-wrap;word-break:break-word;font-size:12px;line-height:1.6;color:#57534e;">${formatFatalError(error)
          .replaceAll('&', '&amp;')
          .replaceAll('<', '&lt;')
          .replaceAll('>', '&gt;')}</pre>
      </div>
    </main>
  `;
};

const REACT_RECOVERABLE_CONCURRENT_MESSAGE =
  'There was an error during concurrent rendering but React was able to recover by instead synchronously rendering the entire root.';

const isReactRecoverableConcurrentError = (value: unknown): boolean => {
  if (value instanceof Error) {
    return value.message === REACT_RECOVERABLE_CONCURRENT_MESSAGE;
  }

  return value === REACT_RECOVERABLE_CONCURRENT_MESSAGE;
};

window.addEventListener('error', (event) => {
  if (isReactRecoverableConcurrentError(event.error ?? event.message)) {
    console.warn('Recoverable renderer error', event.error ?? event.message);
    return;
  }

  renderFatalError('Uncaught renderer error', event.error ?? event.message);
});

window.addEventListener('unhandledrejection', (event) => {
  if (isReactRecoverableConcurrentError(event.reason)) {
    console.warn('Recoverable renderer rejection', event.reason);
    return;
  }

  renderFatalError('Unhandled promise rejection', event.reason);
});

createRoot(container, {
  onRecoverableError: (error, errorInfo) => {
    console.warn('Recoverable renderer error', error, errorInfo);
  },
}).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
