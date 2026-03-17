export type ThemePreference = 'light' | 'dark' | 'system';
export type AccentColorPreference =
  | 'default'
  | 'orange'
  | 'yellow'
  | 'green'
  | 'blue'
  | 'pink'
  | 'purple'
  | 'black';

export interface UiPreferences {
  theme: ThemePreference;
  accentColor: AccentColorPreference;
}

const THEME_PREFERENCE_KEY = 'zeroade.ui.theme.v1';
const ACCENT_COLOR_KEY = 'zeroade.ui.accent-color.v1';
const LEGACY_ACCENT_ENABLED_KEY = 'zeroade.ui.accent-enabled.v1';

const DEFAULT_PREFERENCES: UiPreferences = {
  theme: 'system',
  accentColor: 'default',
};

const parseThemePreference = (value: string | null): ThemePreference => {
  if (value === 'light' || value === 'dark' || value === 'system') {
    return value;
  }

  return DEFAULT_PREFERENCES.theme;
};

const parseAccentColorPreference = (value: string | null): AccentColorPreference | null => {
  if (
    value === 'default' ||
    value === 'orange' ||
    value === 'yellow' ||
    value === 'green' ||
    value === 'blue' ||
    value === 'pink' ||
    value === 'purple' ||
    value === 'black'
  ) {
    return value;
  }

  return null;
};

const resolveTheme = (theme: ThemePreference): 'light' | 'dark' => {
  if (theme === 'light' || theme === 'dark') {
    return theme;
  }

  if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark';
  }

  return 'light';
};

export const readUiPreferences = (): UiPreferences => {
  const theme = parseThemePreference(window.localStorage.getItem(THEME_PREFERENCE_KEY));
  const parsedAccentColor = parseAccentColorPreference(window.localStorage.getItem(ACCENT_COLOR_KEY));
  const legacyAccentEnabled = window.localStorage.getItem(LEGACY_ACCENT_ENABLED_KEY) === '1';
  const accentColor =
    parsedAccentColor ?? (legacyAccentEnabled ? 'orange' : DEFAULT_PREFERENCES.accentColor);

  return {
    theme,
    accentColor,
  };
};

export const writeThemePreference = (theme: ThemePreference): void => {
  window.localStorage.setItem(THEME_PREFERENCE_KEY, theme);
};

export const writeAccentColorPreference = (accentColor: AccentColorPreference): void => {
  window.localStorage.setItem(ACCENT_COLOR_KEY, accentColor);
};

export const applyUiPreferences = (preferences: UiPreferences): void => {
  const root = document.documentElement;
  const resolvedTheme = resolveTheme(preferences.theme);

  root.dataset.zeroadeTheme = resolvedTheme;
  root.dataset.zeroadeThemePreference = preferences.theme;
  root.dataset.zeroadeAccent = preferences.accentColor;
  root.style.colorScheme = resolvedTheme;
  window.dispatchEvent(new CustomEvent('zeroade-ui-preferences-changed'));
};
