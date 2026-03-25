import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import { readUiPreferences, type EditorThemeMode, type EditorThemeSettings } from '@renderer/store/ui-preferences';

const THEME_IDS = {
  light: 'zeroade-editor-light',
  dark: 'zeroade-editor-dark',
} as const;

let appliedThemeSignature = '';

interface RgbColor {
  r: number;
  g: number;
  b: number;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

const hexToRgb = (value: string): RgbColor => {
  const normalized = value.replace('#', '');
  const expanded =
    normalized.length === 3
      ? `${normalized[0]}${normalized[0]}${normalized[1]}${normalized[1]}${normalized[2]}${normalized[2]}`
      : normalized;

  return {
    r: Number.parseInt(expanded.slice(0, 2), 16),
    g: Number.parseInt(expanded.slice(2, 4), 16),
    b: Number.parseInt(expanded.slice(4, 6), 16),
  };
};

const rgbToHex = ({ r, g, b }: RgbColor): string =>
  `#${[r, g, b]
    .map((channel) => clamp(Math.round(channel), 0, 255).toString(16).padStart(2, '0'))
    .join('')}`;

const toTokenColor = (value: string): string => value.replace('#', '').toUpperCase();

const mixColors = (left: string, right: string, amount: number): string => {
  const weight = clamp(amount, 0, 1);
  const leftRgb = hexToRgb(left);
  const rightRgb = hexToRgb(right);

  return rgbToHex({
    r: leftRgb.r + (rightRgb.r - leftRgb.r) * weight,
    g: leftRgb.g + (rightRgb.g - leftRgb.g) * weight,
    b: leftRgb.b + (rightRgb.b - leftRgb.b) * weight,
  });
};

const withAlpha = (value: string, alpha: number): string => {
  const normalizedAlpha = clamp(alpha, 0, 1);
  const alphaChannel = Math.round(normalizedAlpha * 255)
    .toString(16)
    .padStart(2, '0');

  return `${rgbToHex(hexToRgb(value))}${alphaChannel}`;
};

const buildTheme = (
  settings: EditorThemeSettings,
  mode: EditorThemeMode,
): monaco.editor.IStandaloneThemeData => {
  const intensity = settings.contrast / 100;
  const base = mode === 'dark' ? 'vs-dark' : 'vs';
  const background = settings.background;
  const foreground = settings.foreground;
  const accent = settings.accent;
  const diffAdded = settings.diffAdded;
  const diffRemoved = settings.diffRemoved;
  const skill = settings.skill;
  const widget = mixColors(
    background,
    foreground,
    mode === 'dark' ? 0.08 + intensity * 0.08 : 0.03 + intensity * 0.05,
  );
  const panel = mixColors(
    background,
    foreground,
    mode === 'dark' ? 0.045 + intensity * 0.035 : 0.016 + intensity * 0.025,
  );
  const panelElevated = mixColors(
    panel,
    foreground,
    mode === 'dark' ? 0.045 + intensity * 0.03 : 0.018 + intensity * 0.02,
  );
  const gutter = mixColors(
    background,
    foreground,
    mode === 'dark' ? 0.075 + intensity * 0.04 : 0.028 + intensity * 0.03,
  );
  const comment = mixColors(
    foreground,
    background,
    mode === 'dark' ? 0.48 : 0.58,
  );
  const descriptionTone = withAlpha(foreground, mode === 'dark' ? 0.62 : 0.54);
  const widgetShadow = withAlpha(
    mode === 'dark' ? '#000000' : foreground,
    mode === 'dark' ? 0.28 : 0.1,
  );
  const peekEditor = mixColors(background, panel, 0.6);
  const peekMatch = withAlpha(
    accent,
    mode === 'dark' ? 0.11 + intensity * 0.05 : 0.08 + intensity * 0.04,
  );
  const peekSelection = withAlpha(
    accent,
    mode === 'dark' ? 0.14 + intensity * 0.05 : 0.09 + intensity * 0.04,
  );
  const stringTone = mode === 'dark' ? mixColors('#9fd7a7', accent, 0.18) : mixColors('#2f855a', accent, 0.14);
  const numberTone = mode === 'dark' ? mixColors('#f6c177', accent, 0.22) : mixColors('#b45309', accent, 0.24);
  const typeTone = mode === 'dark' ? mixColors(skill, accent, 0.3) : mixColors(skill, accent, 0.2);
  const delimiterTone = mixColors(foreground, accent, mode === 'dark' ? 0.12 : 0.08);

  return {
    base,
    inherit: true,
    rules: [
      { token: 'comment', foreground: toTokenColor(comment), fontStyle: 'italic' },
      { token: 'keyword', foreground: toTokenColor(accent), fontStyle: 'bold' },
      { token: 'type.identifier', foreground: toTokenColor(typeTone) },
      { token: 'number', foreground: toTokenColor(numberTone) },
      { token: 'string', foreground: toTokenColor(stringTone) },
      { token: 'delimiter', foreground: toTokenColor(delimiterTone) },
      { token: 'operator', foreground: toTokenColor(delimiterTone) },
    ],
    colors: {
      'editor.background': background,
      'editor.foreground': foreground,
      'editorLineNumber.foreground': withAlpha(foreground, mode === 'dark' ? 0.42 : 0.34),
      'editorLineNumber.activeForeground': foreground,
      'editorCursor.foreground': accent,
      'editor.selectionBackground': withAlpha(accent, 0.16 + intensity * 0.08),
      'editor.inactiveSelectionBackground': withAlpha(accent, 0.08 + intensity * 0.05),
      'editor.selectionHighlightBackground': withAlpha(accent, 0.06 + intensity * 0.04),
      'editor.lineHighlightBackground': withAlpha(
        accent,
        mode === 'dark' ? 0.06 + intensity * 0.06 : 0.025 + intensity * 0.04,
      ),
      'editor.wordHighlightBackground': withAlpha(accent, 0.07 + intensity * 0.03),
      'editor.wordHighlightStrongBackground': withAlpha(accent, 0.1 + intensity * 0.04),
      'editorIndentGuide.background1': withAlpha(foreground, mode === 'dark' ? 0.12 : 0.08),
      'editorIndentGuide.activeBackground1': withAlpha(accent, 0.24 + intensity * 0.12),
      'editorWidget.background': widget,
      'editorWidget.border': withAlpha(accent, 0.2 + intensity * 0.16),
      'widget.shadow': widgetShadow,
      'editorHoverWidget.background': widget,
      'editorHoverWidget.border': withAlpha(accent, 0.18 + intensity * 0.14),
      'editorGutter.background': background,
      'editorWhitespace.foreground': withAlpha(foreground, mode === 'dark' ? 0.08 : 0.06),
      'editorBracketMatch.border': withAlpha(accent, 0.24 + intensity * 0.16),
      'scrollbarSlider.background': withAlpha(foreground, mode === 'dark' ? 0.18 : 0.16),
      'scrollbarSlider.hoverBackground': withAlpha(foreground, mode === 'dark' ? 0.28 : 0.24),
      'scrollbarSlider.activeBackground': withAlpha(accent, 0.34 + intensity * 0.12),
      'diffEditor.insertedTextBackground': withAlpha(diffAdded, 0.18 + intensity * 0.08),
      'diffEditor.removedTextBackground': withAlpha(diffRemoved, 0.16 + intensity * 0.08),
      'peekView.border': withAlpha(
        foreground,
        mode === 'dark' ? 0.16 + intensity * 0.06 : 0.1 + intensity * 0.04,
      ),
      'peekViewTitle.background': panelElevated,
      'peekViewTitleLabel.foreground': foreground,
      'peekViewTitleDescription.foreground': descriptionTone,
      'peekViewResult.background': panel,
      'peekViewResult.fileForeground': foreground,
      'peekViewResult.lineForeground': withAlpha(foreground, mode === 'dark' ? 0.78 : 0.7),
      'peekViewResult.selectionBackground': peekSelection,
      'peekViewResult.selectionForeground': foreground,
      'peekViewResult.matchHighlightBackground': peekMatch,
      'peekViewEditor.background': peekEditor,
      'peekViewEditorGutter.background': gutter,
      'peekViewEditorStickyScroll.background': panelElevated,
      'peekViewEditorStickyScrollGutter.background': gutter,
      'peekViewEditor.matchHighlightBackground': peekMatch,
      'peekViewEditor.matchHighlightBorder': withAlpha(
        accent,
        mode === 'dark' ? 0.26 + intensity * 0.1 : 0.18 + intensity * 0.08,
      ),
    },
  };
};

export const ensureMonacoThemes = (): void => {
  const preferences = readUiPreferences();
  const signature = JSON.stringify(preferences.editorThemes);

  if (signature === appliedThemeSignature) {
    return;
  }

  monaco.editor.defineTheme(THEME_IDS.light, buildTheme(preferences.editorThemes.light, 'light'));
  monaco.editor.defineTheme(THEME_IDS.dark, buildTheme(preferences.editorThemes.dark, 'dark'));
  appliedThemeSignature = signature;
};
