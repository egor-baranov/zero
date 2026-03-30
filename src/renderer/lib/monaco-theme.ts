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

interface ResolvedEditorThemeVisuals {
  editorColors: {
    activeIndentGuide: string;
    activeLineNumber: string;
    bracketMatchBorder: string;
    cursor: string;
    indentGuide: string;
    lineHighlightBackground: string;
    lineNumber: string;
    selectionBackground: string;
  };
  syntaxColors: {
    comment: string;
    delimiter: string;
    function: string;
    interface: string;
    keyword: string;
    metadata: string;
    number: string;
    operator: string;
    parameter: string;
    property: string;
    string: string;
    type: string;
    variable: string;
  };
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

export const resolveEditorThemeVisuals = (
  settings: EditorThemeSettings,
  mode: EditorThemeMode,
): ResolvedEditorThemeVisuals => {
  const intensity = settings.contrast / 100;
  const background = settings.background;
  const foreground = settings.foreground;
  const accent = settings.accent;
  const skill = settings.skill;
  const syntaxColors = settings.syntaxColors ?? {};
  const editorColors = settings.editorColors ?? {};
  const defaultComment = mixColors(
    foreground,
    background,
    mode === 'dark' ? 0.48 : 0.58,
  );
  const resolvedSyntaxColors = {
    comment: syntaxColors.comment ?? defaultComment,
    delimiter:
      syntaxColors.delimiter ?? mixColors(foreground, accent, mode === 'dark' ? 0.12 : 0.08),
    function:
      syntaxColors.function ??
      (mode === 'dark' ? mixColors('#82aaff', accent, 0.24) : mixColors('#2563eb', accent, 0.2)),
    interface:
      syntaxColors.interface ??
      (mode === 'dark'
        ? mixColors('#89ddff', skill, 0.3)
        : mixColors('#2563eb', skill, 0.22)),
    keyword: syntaxColors.keyword ?? accent,
    metadata:
      syntaxColors.metadata ??
      (mode === 'dark' ? mixColors('#82aaff', accent, 0.18) : mixColors('#2563eb', accent, 0.14)),
    number:
      syntaxColors.number ??
      (mode === 'dark' ? mixColors('#f6c177', accent, 0.22) : mixColors('#b45309', accent, 0.24)),
    operator:
      syntaxColors.operator ?? mixColors(foreground, accent, mode === 'dark' ? 0.12 : 0.08),
    parameter:
      syntaxColors.parameter ??
      (mode === 'dark' ? mixColors('#f78c6c', accent, 0.12) : mixColors('#c2410c', accent, 0.14)),
    property:
      syntaxColors.property ??
      (mode === 'dark' ? mixColors('#eeffff', foreground, 0.08) : mixColors('#0f172a', foreground, 0.08)),
    string:
      syntaxColors.string ??
      (mode === 'dark' ? mixColors('#9fd7a7', accent, 0.18) : mixColors('#2f855a', accent, 0.14)),
    type:
      syntaxColors.type ??
      (mode === 'dark' ? mixColors(skill, accent, 0.3) : mixColors(skill, accent, 0.2)),
    variable: syntaxColors.variable ?? foreground,
  };
  const resolvedEditorColors = {
    activeIndentGuide:
      editorColors.activeIndentGuide ?? withAlpha(accent, 0.24 + intensity * 0.12),
    activeLineNumber: editorColors.activeLineNumber ?? foreground,
    bracketMatchBorder:
      editorColors.bracketMatchBorder ?? withAlpha(accent, 0.24 + intensity * 0.16),
    cursor: editorColors.cursor ?? accent,
    indentGuide:
      editorColors.indentGuide ?? withAlpha(foreground, mode === 'dark' ? 0.12 : 0.08),
    lineHighlightBackground:
      editorColors.lineHighlightBackground ??
      withAlpha(accent, mode === 'dark' ? 0.06 + intensity * 0.06 : 0.025 + intensity * 0.04),
    lineNumber:
      editorColors.lineNumber ?? withAlpha(foreground, mode === 'dark' ? 0.42 : 0.34),
    selectionBackground:
      editorColors.selectionBackground ?? withAlpha(accent, 0.16 + intensity * 0.08),
  };

  return {
    editorColors: resolvedEditorColors,
    syntaxColors: resolvedSyntaxColors,
  };
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
  const syntaxStyles = settings.syntaxStyles ?? {};
  const visuals = resolveEditorThemeVisuals(settings, mode);
  const syntaxColors = visuals.syntaxColors;
  const editorColors = visuals.editorColors;
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
  const keywordTone = syntaxColors.keyword;
  const functionTone = syntaxColors.function;
  const interfaceTone = syntaxColors.interface;
  const stringTone = syntaxColors.string;
  const numberTone = syntaxColors.number;
  const typeTone = syntaxColors.type;
  const variableTone = syntaxColors.variable;
  const commentTone = syntaxColors.comment;
  const delimiterTone = syntaxColors.delimiter;
  const operatorTone = syntaxColors.operator;
  const parameterTone = syntaxColors.parameter;
  const propertyTone = syntaxColors.property;
  const metadataTone = syntaxColors.metadata;
  const selectionBackground = editorColors.selectionBackground;
  const inactiveSelectionBackground = editorColors.selectionBackground
    ? withAlpha(editorColors.selectionBackground, mode === 'dark' ? 0.78 : 0.7)
    : withAlpha(accent, 0.08 + intensity * 0.05);
  const selectionHighlightBackground = editorColors.selectionBackground
    ? withAlpha(editorColors.selectionBackground, mode === 'dark' ? 0.6 : 0.5)
    : withAlpha(accent, 0.06 + intensity * 0.04);
  const lineHighlightBackground = editorColors.lineHighlightBackground;
  const lineNumberForeground = editorColors.lineNumber;
  const lineNumberActiveForeground = editorColors.activeLineNumber;
  const cursorForeground = editorColors.cursor;
  const indentGuideBackground = editorColors.indentGuide;
  const activeIndentGuideBackground = editorColors.activeIndentGuide;
  const bracketMatchBorder = editorColors.bracketMatchBorder;
  const widgetBorder = withAlpha(accent, 0.2 + intensity * 0.16);
  const focusBorder = withAlpha(accent, mode === 'dark' ? 0.9 : 0.82);
  const inputBackground = mixColors(
    widget,
    background,
    mode === 'dark' ? 0.16 + intensity * 0.04 : 0.24 + intensity * 0.04,
  );
  const inputBorder = withAlpha(
    foreground,
    mode === 'dark' ? 0.12 + intensity * 0.08 : 0.1 + intensity * 0.06,
  );
  const hoverWidgetBorder = inputBorder;
  const inputPlaceholderForeground = withAlpha(foreground, mode === 'dark' ? 0.42 : 0.38);
  const inputOptionHoverBackground = withAlpha(foreground, mode === 'dark' ? 0.1 : 0.06);
  const inputOptionActiveBackground = withAlpha(
    accent,
    mode === 'dark' ? 0.16 + intensity * 0.06 : 0.1 + intensity * 0.05,
  );
  const inputOptionActiveBorder = withAlpha(
    accent,
    mode === 'dark' ? 0.42 + intensity * 0.12 : 0.34 + intensity * 0.1,
  );
  const findMatchBackground = withAlpha(
    accent,
    mode === 'dark' ? 0.24 + intensity * 0.06 : 0.18 + intensity * 0.05,
  );
  const findMatchHighlightBackground = withAlpha(
    accent,
    mode === 'dark' ? 0.12 + intensity * 0.04 : 0.08 + intensity * 0.04,
  );
  const findRangeHighlightBackground = withAlpha(foreground, mode === 'dark' ? 0.09 : 0.06);
  const findRangeHighlightBorder = withAlpha(accent, mode === 'dark' ? 0.24 : 0.18);

  return {
    base,
    inherit: true,
    rules: [
      {
        token: 'comment',
        foreground: toTokenColor(commentTone),
        fontStyle: syntaxStyles.comment ?? 'italic',
      },
      {
        token: 'keyword',
        foreground: toTokenColor(keywordTone),
        fontStyle: syntaxStyles.keyword ?? 'bold',
      },
      {
        token: 'keyword.control',
        foreground: toTokenColor(keywordTone),
        fontStyle: syntaxStyles.keyword ?? 'bold',
      },
      { token: 'storage', foreground: toTokenColor(keywordTone), fontStyle: syntaxStyles.keyword ?? 'bold' },
      { token: 'storage.type', foreground: toTokenColor(typeTone), fontStyle: syntaxStyles.type ?? '' },
      {
        token: 'storage.modifier',
        foreground: toTokenColor(keywordTone),
        fontStyle: syntaxStyles.keyword ?? 'bold',
      },
      { token: 'function', foreground: toTokenColor(functionTone), fontStyle: syntaxStyles.function ?? '' },
      { token: 'function.call', foreground: toTokenColor(functionTone), fontStyle: syntaxStyles.function ?? '' },
      {
        token: 'function.definition',
        foreground: toTokenColor(functionTone),
        fontStyle: syntaxStyles.function ?? '',
      },
      { token: 'method', foreground: toTokenColor(functionTone), fontStyle: syntaxStyles.function ?? '' },
      { token: 'event', foreground: toTokenColor(functionTone), fontStyle: syntaxStyles.function ?? '' },
      { token: 'macro', foreground: toTokenColor(functionTone), fontStyle: syntaxStyles.function ?? '' },
      {
        token: 'entity.name.function',
        foreground: toTokenColor(functionTone),
        fontStyle: syntaxStyles.function ?? '',
      },
      { token: 'support.function', foreground: toTokenColor(functionTone), fontStyle: syntaxStyles.function ?? '' },
      { token: 'namespace', foreground: toTokenColor(typeTone), fontStyle: syntaxStyles.type ?? '' },
      { token: 'type.identifier', foreground: toTokenColor(typeTone) },
      { token: 'type', foreground: toTokenColor(typeTone), fontStyle: syntaxStyles.type ?? '' },
      { token: 'class', foreground: toTokenColor(typeTone), fontStyle: syntaxStyles.type ?? '' },
      { token: 'enum', foreground: toTokenColor(typeTone), fontStyle: syntaxStyles.type ?? '' },
      {
        token: 'interface',
        foreground: toTokenColor(interfaceTone),
        fontStyle: syntaxStyles.interface ?? syntaxStyles.type ?? '',
      },
      { token: 'struct', foreground: toTokenColor(typeTone), fontStyle: syntaxStyles.type ?? '' },
      { token: 'typeParameter', foreground: toTokenColor(typeTone), fontStyle: syntaxStyles.type ?? '' },
      { token: 'class.identifier', foreground: toTokenColor(typeTone), fontStyle: syntaxStyles.type ?? '' },
      { token: 'entity.name.type', foreground: toTokenColor(typeTone), fontStyle: syntaxStyles.type ?? '' },
      { token: 'entity.name.class', foreground: toTokenColor(typeTone), fontStyle: syntaxStyles.type ?? '' },
      { token: 'support.type', foreground: toTokenColor(typeTone), fontStyle: syntaxStyles.type ?? '' },
      { token: 'number', foreground: toTokenColor(numberTone) },
      { token: 'enumMember', foreground: toTokenColor(propertyTone), fontStyle: syntaxStyles.property ?? '' },
      { token: 'string', foreground: toTokenColor(stringTone) },
      { token: 'regexp', foreground: toTokenColor(stringTone) },
      { token: 'variable', foreground: toTokenColor(variableTone), fontStyle: syntaxStyles.variable ?? '' },
      {
        token: 'variable.parameter',
        foreground: toTokenColor(parameterTone),
        fontStyle: syntaxStyles.parameter ?? '',
      },
      { token: 'parameter', foreground: toTokenColor(parameterTone), fontStyle: syntaxStyles.parameter ?? '' },
      {
        token: 'entity.name.variable.parameter',
        foreground: toTokenColor(parameterTone),
        fontStyle: syntaxStyles.parameter ?? '',
      },
      { token: 'property', foreground: toTokenColor(propertyTone), fontStyle: syntaxStyles.property ?? '' },
      {
        token: 'variable.object.property',
        foreground: toTokenColor(propertyTone),
        fontStyle: syntaxStyles.property ?? '',
      },
      {
        token: 'variable.other.property',
        foreground: toTokenColor(propertyTone),
        fontStyle: syntaxStyles.property ?? '',
      },
      {
        token: 'variable.other.constant',
        foreground: toTokenColor(numberTone),
        fontStyle: syntaxStyles.variable ?? '',
      },
      { token: 'delimiter', foreground: toTokenColor(delimiterTone) },
      { token: 'delimiter.bracket', foreground: toTokenColor(delimiterTone), fontStyle: syntaxStyles.delimiter ?? '' },
      { token: 'delimiter.parenthesis', foreground: toTokenColor(delimiterTone), fontStyle: syntaxStyles.delimiter ?? '' },
      { token: 'delimiter.array', foreground: toTokenColor(delimiterTone), fontStyle: syntaxStyles.delimiter ?? '' },
      { token: 'punctuation', foreground: toTokenColor(delimiterTone), fontStyle: syntaxStyles.delimiter ?? '' },
      { token: 'punctuation.definition', foreground: toTokenColor(delimiterTone), fontStyle: syntaxStyles.delimiter ?? '' },
      { token: 'punctuation.separator', foreground: toTokenColor(delimiterTone), fontStyle: syntaxStyles.delimiter ?? '' },
      { token: 'operator', foreground: toTokenColor(operatorTone), fontStyle: syntaxStyles.operator ?? '' },
      { token: 'keyword.operator', foreground: toTokenColor(operatorTone), fontStyle: syntaxStyles.operator ?? '' },
      { token: 'operators', foreground: toTokenColor(operatorTone), fontStyle: syntaxStyles.operator ?? '' },
      { token: 'modifier', foreground: toTokenColor(keywordTone), fontStyle: syntaxStyles.keyword ?? 'bold' },
      { token: 'annotation', foreground: toTokenColor(metadataTone), fontStyle: syntaxStyles.metadata ?? '' },
      { token: 'decorator', foreground: toTokenColor(metadataTone), fontStyle: syntaxStyles.metadata ?? '' },
      { token: 'meta', foreground: toTokenColor(metadataTone), fontStyle: syntaxStyles.metadata ?? '' },
      { token: 'tag', foreground: toTokenColor(metadataTone), fontStyle: syntaxStyles.metadata ?? '' },
    ],
    colors: {
      'editor.background': background,
      'editor.foreground': foreground,
      'editorLineNumber.foreground': lineNumberForeground,
      'editorLineNumber.activeForeground': lineNumberActiveForeground,
      'editorCursor.foreground': cursorForeground,
      'editor.selectionBackground': selectionBackground,
      'editor.inactiveSelectionBackground': inactiveSelectionBackground,
      'editor.selectionHighlightBackground': selectionHighlightBackground,
      'editor.lineHighlightBackground': lineHighlightBackground,
      'editor.wordHighlightBackground': withAlpha(accent, 0.07 + intensity * 0.03),
      'editor.wordHighlightStrongBackground': withAlpha(accent, 0.1 + intensity * 0.04),
      'editorIndentGuide.background1': indentGuideBackground,
      'editorIndentGuide.activeBackground1': activeIndentGuideBackground,
      'focusBorder': focusBorder,
      'input.background': inputBackground,
      'input.foreground': foreground,
      'input.border': inputBorder,
      'input.placeholderForeground': inputPlaceholderForeground,
      'inputOption.hoverBackground': inputOptionHoverBackground,
      'inputOption.activeBackground': inputOptionActiveBackground,
      'inputOption.activeBorder': inputOptionActiveBorder,
      'inputOption.activeForeground': foreground,
      'toolbar.hoverBackground': inputOptionHoverBackground,
      'editor.findMatchBackground': findMatchBackground,
      'editor.findMatchForeground': foreground,
      'editor.findMatchBorder': inputOptionActiveBorder,
      'editor.findMatchHighlightBackground': findMatchHighlightBackground,
      'editor.findMatchHighlightForeground': foreground,
      'editor.findRangeHighlightBackground': findRangeHighlightBackground,
      'editor.findRangeHighlightBorder': findRangeHighlightBorder,
      'editorWidget.foreground': foreground,
      'editorWidget.background': widget,
      'editorWidget.border': widgetBorder,
      'editorWidget.resizeBorder': inputOptionActiveBorder,
      'widget.shadow': widgetShadow,
      'editorHoverWidget.background': widget,
      'editorHoverWidget.border': hoverWidgetBorder,
      'editorHoverWidget.foreground': foreground,
      'editorHoverWidget.statusBarBackground': widget,
      'editorGutter.background': background,
      'editorWhitespace.foreground': withAlpha(foreground, mode === 'dark' ? 0.08 : 0.06),
      'editorBracketMatch.border': bracketMatchBorder,
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
