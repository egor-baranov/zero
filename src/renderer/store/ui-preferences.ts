export type ThemePreference = 'light' | 'dark' | 'system';
export type EditorThemeMode = 'light' | 'dark';
export type EditorThemePreset =
  | 'absolutely'
  | 'catppuccin'
  | 'everforest'
  | 'github'
  | 'graphite'
  | 'gruvbox'
  | 'linear'
  | 'notion'
  | 'one'
  | 'paper'
  | 'zero'
  | 'custom';
export type CodeFontPreference = 'system' | 'sf-mono' | 'menlo';
export type ResolvedMonacoTheme = 'zeroade-editor-light' | 'zeroade-editor-dark';
export type AccentColorPreference =
  | 'default'
  | 'orange'
  | 'yellow'
  | 'green'
  | 'blue'
  | 'pink'
  | 'purple'
  | 'black';

export interface EditorThemeFonts {
  code: CodeFontPreference | null;
  ui: string | null;
}

export interface EditorThemeSemanticColors {
  diffAdded: string;
  diffRemoved: string;
  skill: string;
}

export interface EditorThemeSettings {
  preset: EditorThemePreset;
  accent: string;
  background: string;
  foreground: string;
  codeFont: CodeFontPreference;
  uiFont: string | null;
  contrast: number;
  opaqueWindows: boolean;
  diffAdded: string;
  diffRemoved: string;
  skill: string;
}

export interface UiPreferences {
  theme: ThemePreference;
  accentColor: AccentColorPreference;
  editorThemes: Record<EditorThemeMode, EditorThemeSettings>;
}

const THEME_PREFERENCE_KEY = 'zeroade.ui.theme.v1';
const ACCENT_COLOR_KEY = 'zeroade.ui.accent-color.v1';
const EDITOR_THEMES_KEY = 'zeroade.ui.editor-themes.v1';
const LEGACY_ACCENT_ENABLED_KEY = 'zeroade.ui.accent-enabled.v1';
const CODE_FONT_STACKS: Record<CodeFontPreference, string> = {
  system: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
  'sf-mono':
    '"SF Mono", SFMono-Regular, ui-monospace, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
  menlo: 'Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

const isEditorThemeMode = (value: unknown): value is EditorThemeMode =>
  value === 'light' || value === 'dark';

const normalizeHexColor = (value: unknown, fallback: string): string => {
  if (typeof value !== 'string') {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(normalized)) {
    return normalized;
  }

  if (/^#[0-9a-f]{3}$/.test(normalized)) {
    return `#${normalized[1]}${normalized[1]}${normalized[2]}${normalized[2]}${normalized[3]}${normalized[3]}`;
  }

  return fallback;
};

const parseThemePreference = (value: string | null): ThemePreference => {
  if (value === 'light' || value === 'dark' || value === 'system') {
    return value;
  }

  return 'system';
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

const parseEditorThemePreset = (value: unknown): EditorThemePreset | null => {
  if (
    value === 'absolutely' ||
    value === 'catppuccin' ||
    value === 'everforest' ||
    value === 'github' ||
    value === 'gruvbox' ||
    value === 'linear' ||
    value === 'notion' ||
    value === 'one' ||
    value === 'zero' ||
    value === 'paper' ||
    value === 'graphite' ||
    value === 'custom'
  ) {
    return value;
  }

  if (value === 'codex') {
    return 'zero';
  }

  return null;
};

const parseCodeFontPreference = (value: unknown): CodeFontPreference | null => {
  if (value === 'system' || value === 'sf-mono' || value === 'menlo') {
    return value;
  }

  return null;
};

const resolveTheme = (theme: ThemePreference): EditorThemeMode => {
  if (theme === 'light' || theme === 'dark') {
    return theme;
  }

  if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark';
  }

  return 'light';
};

const DEFAULT_EDITOR_THEME_EXTRAS: Record<
  EditorThemeMode,
  Omit<EditorThemeSettings, 'preset' | 'accent' | 'background' | 'foreground' | 'codeFont' | 'contrast'>
> = {
  light: {
    uiFont: null,
    opaqueWindows: false,
    diffAdded: '#00a240',
    diffRemoved: '#e02e2a',
    skill: '#751ed9',
  },
  dark: {
    uiFont: null,
    opaqueWindows: false,
    diffAdded: '#17c964',
    diffRemoved: '#ff5f57',
    skill: '#9f67ff',
  },
};

const EDITOR_THEME_PRESETS: Record<
  Exclude<EditorThemePreset, 'custom'>,
  Record<
    EditorThemeMode,
    Pick<EditorThemeSettings, 'accent' | 'background' | 'foreground' | 'codeFont' | 'contrast'> &
      Partial<Pick<EditorThemeSettings, 'uiFont' | 'opaqueWindows' | 'diffAdded' | 'diffRemoved' | 'skill'>>
  >
> = {
  absolutely: {
    light: {
      accent: '#d9825b',
      background: '#fff8f1',
      foreground: '#261d18',
      codeFont: 'sf-mono',
      contrast: 42,
    },
    dark: {
      accent: '#ffb487',
      background: '#1c1512',
      foreground: '#fff2e8',
      codeFont: 'sf-mono',
      contrast: 58,
    },
  },
  catppuccin: {
    light: {
      accent: '#8b5cf6',
      background: '#f7f3ff',
      foreground: '#4c3b64',
      codeFont: 'sf-mono',
      contrast: 46,
    },
    dark: {
      accent: '#cba6f7',
      background: '#1e1e2e',
      foreground: '#cdd6f4',
      codeFont: 'sf-mono',
      contrast: 62,
    },
  },
  everforest: {
    light: {
      accent: '#7a9a3d',
      background: '#f4f0e8',
      foreground: '#374145',
      codeFont: 'menlo',
      contrast: 43,
    },
    dark: {
      accent: '#a7c080',
      background: '#2d353b',
      foreground: '#d3c6aa',
      codeFont: 'menlo',
      contrast: 59,
    },
  },
  github: {
    light: {
      accent: '#0969da',
      background: '#ffffff',
      foreground: '#1f2328',
      codeFont: 'system',
      contrast: 40,
    },
    dark: {
      accent: '#58a6ff',
      background: '#0d1117',
      foreground: '#e6edf3',
      codeFont: 'system',
      contrast: 63,
    },
  },
  zero: {
    light: {
      accent: '#0169cc',
      background: '#ffffff',
      foreground: '#0d0d0d',
      codeFont: 'system',
      contrast: 45,
    },
    dark: {
      accent: '#339cff',
      background: '#181818',
      foreground: '#ffffff',
      codeFont: 'system',
      contrast: 60,
    },
  },
  gruvbox: {
    light: {
      accent: '#458588',
      background: '#fbf1c7',
      foreground: '#3c3836',
      codeFont: 'menlo',
      contrast: 55,
    },
    dark: {
      accent: '#83a598',
      background: '#282828',
      foreground: '#ebdbb2',
      codeFont: 'menlo',
      contrast: 72,
    },
  },
  linear: {
    light: {
      accent: '#5e6ad2',
      background: '#f7f7fa',
      foreground: '#1f1f26',
      codeFont: 'system',
      contrast: 44,
    },
    dark: {
      accent: '#8892ff',
      background: '#0f1016',
      foreground: '#f5f7ff',
      codeFont: 'system',
      contrast: 60,
    },
  },
  notion: {
    light: {
      accent: '#2f2f2f',
      background: '#ffffff',
      foreground: '#37352f',
      codeFont: 'system',
      contrast: 34,
    },
    dark: {
      accent: '#ebebeb',
      background: '#191919',
      foreground: '#ffffff',
      codeFont: 'system',
      contrast: 54,
    },
  },
  one: {
    light: {
      accent: '#4f6df5',
      background: '#fafafa',
      foreground: '#383a42',
      codeFont: 'sf-mono',
      contrast: 41,
    },
    dark: {
      accent: '#61afef',
      background: '#282c34',
      foreground: '#abb2bf',
      codeFont: 'sf-mono',
      contrast: 64,
    },
  },
  paper: {
    light: {
      accent: '#1d4ed8',
      background: '#fcfcfa',
      foreground: '#1f2937',
      codeFont: 'sf-mono',
      contrast: 38,
    },
    dark: {
      accent: '#7cc7ff',
      background: '#151923',
      foreground: '#eef2ff',
      codeFont: 'sf-mono',
      contrast: 56,
    },
  },
  graphite: {
    light: {
      accent: '#0f766e',
      background: '#f5f7fb',
      foreground: '#111827',
      codeFont: 'menlo',
      contrast: 52,
    },
    dark: {
      accent: '#4fd1c5',
      background: '#0f1724',
      foreground: '#f4f7fb',
      codeFont: 'menlo',
      contrast: 68,
    },
  },
};

export const getEditorThemePresetDefaults = (
  mode: EditorThemeMode,
  preset: EditorThemePreset,
): EditorThemeSettings => {
  const basePreset = preset === 'custom' ? 'zero' : preset;
  const base = EDITOR_THEME_PRESETS[basePreset][mode];
  const extras = DEFAULT_EDITOR_THEME_EXTRAS[mode];

  return {
    preset,
    accent: base.accent,
    background: base.background,
    foreground: base.foreground,
    codeFont: base.codeFont,
    uiFont: base.uiFont ?? extras.uiFont,
    contrast: base.contrast,
    opaqueWindows: base.opaqueWindows ?? extras.opaqueWindows,
    diffAdded: base.diffAdded ?? extras.diffAdded,
    diffRemoved: base.diffRemoved ?? extras.diffRemoved,
    skill: base.skill ?? extras.skill,
  };
};

const normalizeEditorThemeSettings = (
  value: unknown,
  mode: EditorThemeMode,
): EditorThemeSettings => {
  const parsedPreset = isRecord(value) ? parseEditorThemePreset(value.preset) : null;
  const base = getEditorThemePresetDefaults(mode, parsedPreset ?? 'zero');

  if (!isRecord(value)) {
    return base;
  }

  return {
    preset: parsedPreset ?? base.preset,
    accent: normalizeHexColor(value.accent, base.accent),
    background: normalizeHexColor(value.background, base.background),
    foreground: normalizeHexColor(value.foreground, base.foreground),
    codeFont: parseCodeFontPreference(value.codeFont) ?? base.codeFont,
    uiFont: typeof value.uiFont === 'string' && value.uiFont.trim().length > 0 ? value.uiFont.trim() : null,
    contrast:
      typeof value.contrast === 'number' && Number.isFinite(value.contrast)
        ? clamp(Math.round(value.contrast), 0, 100)
        : base.contrast,
    opaqueWindows: typeof value.opaqueWindows === 'boolean' ? value.opaqueWindows : base.opaqueWindows,
    diffAdded: normalizeHexColor(value.diffAdded, base.diffAdded),
    diffRemoved: normalizeHexColor(value.diffRemoved, base.diffRemoved),
    skill: normalizeHexColor(value.skill, base.skill),
  };
};

const DEFAULT_PREFERENCES: UiPreferences = {
  theme: 'system',
  accentColor: 'default',
  editorThemes: {
    light: getEditorThemePresetDefaults('light', 'zero'),
    dark: getEditorThemePresetDefaults('dark', 'zero'),
  },
};

const readEditorThemesPreference = (): Record<EditorThemeMode, EditorThemeSettings> => {
  const raw = window.localStorage.getItem(EDITOR_THEMES_KEY);
  if (!raw) {
    return DEFAULT_PREFERENCES.editorThemes;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) {
      return DEFAULT_PREFERENCES.editorThemes;
    }

    return {
      light: normalizeEditorThemeSettings(parsed.light, 'light'),
      dark: normalizeEditorThemeSettings(parsed.dark, 'dark'),
    };
  } catch {
    return DEFAULT_PREFERENCES.editorThemes;
  }
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
    editorThemes: readEditorThemesPreference(),
  };
};

export const writeThemePreference = (theme: ThemePreference): void => {
  window.localStorage.setItem(THEME_PREFERENCE_KEY, theme);
};

export const writeAccentColorPreference = (accentColor: AccentColorPreference): void => {
  window.localStorage.setItem(ACCENT_COLOR_KEY, accentColor);
};

export const writeEditorThemesPreference = (
  editorThemes: Record<EditorThemeMode, EditorThemeSettings>,
): void => {
  window.localStorage.setItem(EDITOR_THEMES_KEY, JSON.stringify(editorThemes));
};

const SERIALIZED_EDITOR_THEME_PREFIX = 'zero-theme-v1:';
const LEGACY_SERIALIZED_EDITOR_THEME_PREFIX = 'codex-theme-v1:';

const toTransferCodeFont = (codeFont: CodeFontPreference): CodeFontPreference | null =>
  codeFont === 'system' ? null : codeFont;

const parseTransferCodeFont = (value: unknown, fallback: CodeFontPreference): CodeFontPreference => {
  if (value === null) {
    return 'system';
  }

  return parseCodeFontPreference(value) ?? fallback;
};

const parseOptionalUiFont = (value: unknown, fallback: string | null): string | null => {
  if (value === null) {
    return null;
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }

  return fallback;
};

export const serializeEditorThemeForClipboard = (
  mode: EditorThemeMode,
  settings: EditorThemeSettings,
): string => {
  const payload = {
    codeThemeId: settings.preset === 'custom' ? 'custom' : settings.preset,
    theme: {
      accent: settings.accent,
      contrast: settings.contrast,
      fonts: {
        code: toTransferCodeFont(settings.codeFont),
        ui: settings.uiFont,
      } as EditorThemeFonts,
      ink: settings.foreground,
      opaqueWindows: settings.opaqueWindows,
      semanticColors: {
        diffAdded: settings.diffAdded,
        diffRemoved: settings.diffRemoved,
        skill: settings.skill,
      } as EditorThemeSemanticColors,
      surface: settings.background,
    },
    variant: mode,
  };

  return `${SERIALIZED_EDITOR_THEME_PREFIX}${JSON.stringify(payload)}`;
};

const extractSerializedEditorThemePayload = (value: string): string => {
  const trimmed = value.trim();

  if (trimmed.startsWith(SERIALIZED_EDITOR_THEME_PREFIX)) {
    return trimmed.slice(SERIALIZED_EDITOR_THEME_PREFIX.length);
  }

  if (trimmed.startsWith(LEGACY_SERIALIZED_EDITOR_THEME_PREFIX)) {
    return trimmed.slice(LEGACY_SERIALIZED_EDITOR_THEME_PREFIX.length);
  }

  if (trimmed.startsWith('{')) {
    return trimmed;
  }

  throw new Error('Theme format is not recognized.');
};

export const parseEditorThemeFromClipboard = (
  value: string,
  fallbackMode: EditorThemeMode,
): EditorThemeSettings => {
  const rawPayload = extractSerializedEditorThemePayload(value);
  const parsed = JSON.parse(rawPayload) as unknown;

  if (!isRecord(parsed)) {
    throw new Error('Theme payload must be an object.');
  }

  const payloadMode = isEditorThemeMode(parsed.variant) ? parsed.variant : fallbackMode;
  const parsedPreset =
    typeof parsed.codeThemeId === 'string' ? parseEditorThemePreset(parsed.codeThemeId) : null;
  const base = getEditorThemePresetDefaults(payloadMode, parsedPreset ?? 'custom');
  const theme = isRecord(parsed.theme) ? parsed.theme : parsed;
  const fonts = isRecord(theme.fonts) ? theme.fonts : null;
  const semanticColors = isRecord(theme.semanticColors) ? theme.semanticColors : null;

  return {
    preset: parsedPreset ?? 'custom',
    accent: normalizeHexColor(theme.accent, base.accent),
    background: normalizeHexColor(theme.surface, base.background),
    foreground: normalizeHexColor(theme.ink, base.foreground),
    codeFont: parseTransferCodeFont(fonts?.code, base.codeFont),
    uiFont: parseOptionalUiFont(fonts?.ui, base.uiFont),
    contrast:
      typeof theme.contrast === 'number' && Number.isFinite(theme.contrast)
        ? clamp(Math.round(theme.contrast), 0, 100)
        : base.contrast,
    opaqueWindows:
      typeof theme.opaqueWindows === 'boolean' ? theme.opaqueWindows : base.opaqueWindows,
    diffAdded: normalizeHexColor(semanticColors?.diffAdded, base.diffAdded),
    diffRemoved: normalizeHexColor(semanticColors?.diffRemoved, base.diffRemoved),
    skill: normalizeHexColor(semanticColors?.skill, base.skill),
  };
};

export const getCodeFontFamily = (codeFont: CodeFontPreference): string =>
  CODE_FONT_STACKS[codeFont];

export const readResolvedMonacoTheme = (): ResolvedMonacoTheme => {
  const root = document.documentElement;
  const theme = root.dataset.zeroadeMonacoTheme;

  if (theme === 'zeroade-editor-light' || theme === 'zeroade-editor-dark') {
    return theme;
  }

  return root.dataset.zeroadeTheme === 'dark' ? 'zeroade-editor-dark' : 'zeroade-editor-light';
};

export const readResolvedEditorThemeSettings = (): EditorThemeSettings => {
  const preferences = readUiPreferences();
  const resolvedTheme = document.documentElement.dataset.zeroadeTheme === 'dark' ? 'dark' : 'light';
  return preferences.editorThemes[resolvedTheme];
};

export const readResolvedCodeFontFamily = (): string =>
  getCodeFontFamily(readResolvedEditorThemeSettings().codeFont);

export const applyUiPreferences = (preferences: UiPreferences): void => {
  const root = document.documentElement;
  const resolvedTheme = resolveTheme(preferences.theme);
  const resolvedEditorTheme = preferences.editorThemes[resolvedTheme];

  root.dataset.zeroadeTheme = resolvedTheme;
  root.dataset.zeroadeThemePreference = preferences.theme;
  root.dataset.zeroadeMonacoTheme =
    resolvedTheme === 'dark' ? 'zeroade-editor-dark' : 'zeroade-editor-light';
  root.dataset.zeroadeAccent = preferences.accentColor;
  root.dataset.zeroadeOpaqueWindows = resolvedEditorTheme.opaqueWindows ? 'true' : 'false';
  root.style.colorScheme = resolvedTheme;
  root.style.setProperty('--zeroade-code-font-family', getCodeFontFamily(resolvedEditorTheme.codeFont));
  root.style.setProperty('--zeroade-ui-font-family', resolvedEditorTheme.uiFont ?? '');
  window.dispatchEvent(new CustomEvent('zeroade-ui-preferences-changed'));
};
