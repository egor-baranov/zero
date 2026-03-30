import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import {
  LSP_SEMANTIC_TOKEN_MODIFIERS,
  LSP_SEMANTIC_TOKEN_TYPES,
} from '@shared/types/lsp';
import type {
  LspCompletionItem,
  LspDefinitionResult,
  LspDiagnostic,
  LspPosition,
  LspRange,
  LspRendererEvent,
} from '@shared/types/lsp';
import { getMonacoLanguage } from '@renderer/lib/monaco-setup';

const COMPLETION_TRIGGER_CHARACTERS = ['.', '"', "'", '/', '@', '<', ':'];
const SUPPORTED_LANGUAGES = [
  'typescript',
  'javascript',
  'python',
  'go',
  'kotlin',
  'rust',
  'java',
  'json',
  'yaml',
  'shell',
  'html',
  'css',
] as const;
const SEMANTIC_TOKENS_LEGEND: monaco.languages.SemanticTokensLegend = {
  tokenTypes: [...LSP_SEMANTIC_TOKEN_TYPES],
  tokenModifiers: [...LSP_SEMANTIC_TOKEN_MODIFIERS],
};
const SEMANTIC_TOKEN_TYPE_INDEX = new Map(
  SEMANTIC_TOKENS_LEGEND.tokenTypes.map((tokenType, index) => [tokenType, index]),
);
const SEMANTIC_TOKEN_MODIFIER_INDEX = new Map(
  SEMANTIC_TOKENS_LEGEND.tokenModifiers.map((modifier, index) => [modifier, index]),
);
const KOTLIN_CALL_KEYWORDS = new Set([
  'if',
  'for',
  'while',
  'when',
  'catch',
  'return',
  'throw',
  'typeof',
  'super',
  'this',
]);

let activeWorkspacePath = '';
let hasRegisteredProviders = false;
let removeLspListener: (() => void) | null = null;
const EMPTY_DEFINITION_RESULT: LspDefinitionResult = { locations: [] };

interface AbsoluteSemanticToken {
  line: number;
  startCharacter: number;
  length: number;
  tokenType: number;
  tokenModifiers: number;
}

interface KotlinParameterScope {
  baseDepth: number;
  parameterNames: string[];
}

const getWorkspaceModelUri = (relativePath: string): monaco.Uri => {
  const normalizedPath = relativePath.startsWith('/') ? relativePath : `/${relativePath}`;
  return monaco.Uri.from({
    scheme: 'file',
    path: normalizedPath,
  });
};

const getRelativePathFromModel = (model: monaco.editor.ITextModel): string | null => {
  if (model.uri.scheme !== 'file') {
    return null;
  }

  const relativePath = model.uri.path.replace(/^\/+/, '');
  return relativePath.length > 0 ? relativePath : null;
};

const toLspPosition = (position: monaco.Position): LspPosition => ({
  line: position.lineNumber - 1,
  character: position.column - 1,
});

const toMonacoRange = (range: LspRange): monaco.IRange => ({
  startLineNumber: range.start.line + 1,
  startColumn: range.start.character + 1,
  endLineNumber: range.end.line + 1,
  endColumn: range.end.character + 1,
});

const toMonacoSeverity = (severity: LspDiagnostic['severity']): monaco.MarkerSeverity => {
  if (severity === 'error') {
    return monaco.MarkerSeverity.Error;
  }

  if (severity === 'warning') {
    return monaco.MarkerSeverity.Warning;
  }

  if (severity === 'hint') {
    return monaco.MarkerSeverity.Hint;
  }

  return monaco.MarkerSeverity.Info;
};

const toMonacoMarkers = (
  diagnostics: LspDiagnostic[],
): monaco.editor.IMarkerData[] =>
  diagnostics.map((diagnostic) => ({
    ...toMonacoRange(diagnostic.range),
    severity: toMonacoSeverity(diagnostic.severity),
    message: diagnostic.message,
    source: diagnostic.source ?? undefined,
    code: diagnostic.code ?? undefined,
  }));

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const toSemanticModifierSet = (modifiers: string[]): number =>
  modifiers.reduce((mask, modifier) => {
    const index = SEMANTIC_TOKEN_MODIFIER_INDEX.get(modifier);
    return typeof index === 'number' ? mask | (1 << index) : mask;
  }, 0);

const pushSemanticToken = (
  tokens: AbsoluteSemanticToken[],
  line: number,
  startCharacter: number,
  length: number,
  tokenType: string,
  modifiers: string[] = [],
): void => {
  const tokenTypeIndex = SEMANTIC_TOKEN_TYPE_INDEX.get(tokenType);
  if (
    typeof tokenTypeIndex !== 'number' ||
    !Number.isFinite(startCharacter) ||
    !Number.isFinite(length) ||
    length <= 0
  ) {
    return;
  }

  tokens.push({
    line,
    startCharacter,
    length,
    tokenType: tokenTypeIndex,
    tokenModifiers: toSemanticModifierSet(modifiers),
  });
};

const encodeSemanticTokens = (tokens: AbsoluteSemanticToken[]): Uint32Array => {
  const sortedTokens = [...tokens].sort((left, right) => {
    if (left.line !== right.line) {
      return left.line - right.line;
    }

    if (left.startCharacter !== right.startCharacter) {
      return left.startCharacter - right.startCharacter;
    }

    return left.length - right.length;
  });
  const encoded: number[] = [];
  let previousLine = 0;
  let previousStartCharacter = 0;
  let lastAcceptedLine = -1;
  let lastAcceptedEndCharacter = -1;

  for (const token of sortedTokens) {
    if (
      token.line === lastAcceptedLine &&
      token.startCharacter < lastAcceptedEndCharacter
    ) {
      continue;
    }

    encoded.push(
      token.line - previousLine,
      token.line === previousLine
        ? token.startCharacter - previousStartCharacter
        : token.startCharacter,
      token.length,
      token.tokenType,
      token.tokenModifiers,
    );

    previousLine = token.line;
    previousStartCharacter = token.startCharacter;
    lastAcceptedLine = token.line;
    lastAcceptedEndCharacter = token.startCharacter + token.length;
  }

  return new Uint32Array(encoded);
};

const decodeSemanticTokens = (data: Uint32Array | number[]): AbsoluteSemanticToken[] => {
  const rawData = Array.from(data);
  const tokens: AbsoluteSemanticToken[] = [];
  let line = 0;
  let startCharacter = 0;

  for (let index = 0; index + 4 < rawData.length; index += 5) {
    const deltaLine = rawData[index];
    const deltaCharacter = rawData[index + 1];
    const length = rawData[index + 2];
    const tokenType = rawData[index + 3];
    const tokenModifiers = rawData[index + 4];

    line += deltaLine;
    startCharacter = deltaLine === 0 ? startCharacter + deltaCharacter : deltaCharacter;

    if (!Number.isFinite(length) || length <= 0) {
      continue;
    }

    tokens.push({
      line,
      startCharacter,
      length,
      tokenType,
      tokenModifiers,
    });
  }

  return tokens;
};

const mergeSemanticTokens = (
  primary: Uint32Array | number[],
  supplement: Uint32Array | number[],
): Uint32Array => {
  const mergedByRange = new Map<string, AbsoluteSemanticToken>();

  for (const token of decodeSemanticTokens(primary)) {
    mergedByRange.set(
      `${token.line}:${token.startCharacter}:${token.length}`,
      token,
    );
  }

  for (const token of decodeSemanticTokens(supplement)) {
    mergedByRange.set(
      `${token.line}:${token.startCharacter}:${token.length}`,
      token,
    );
  }

  return encodeSemanticTokens(Array.from(mergedByRange.values()));
};

const sanitizeKotlinLine = (line: string): string => {
  let sanitized = '';
  let inString: '"' | "'" | null = null;
  let escaped = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    const nextCharacter = line[index + 1] ?? '';

    if (!inString && character === '/' && nextCharacter === '/') {
      sanitized += ' '.repeat(line.length - index);
      break;
    }

    if (inString) {
      sanitized += ' ';

      if (escaped) {
        escaped = false;
        continue;
      }

      if (character === '\\') {
        escaped = true;
        continue;
      }

      if (character === inString) {
        inString = null;
      }

      continue;
    }

    if (character === '"' || character === "'") {
      inString = character;
      sanitized += ' ';
      continue;
    }

    sanitized += character;
  }

  return sanitized.padEnd(line.length, ' ');
};

const countCharacters = (value: string, character: '{' | '}'): number =>
  Array.from(value).filter((entry) => entry === character).length;

const getPreviousNonWhitespaceCharacter = (value: string, index: number): string | null => {
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const character = value[cursor];
    if (!/\s/.test(character)) {
      return character;
    }
  }

  return null;
};

const collectKotlinParameterUsages = (
  tokens: AbsoluteSemanticToken[],
  line: string,
  lineNumber: number,
  scopeStack: KotlinParameterScope[],
  startCharacter: number,
): void => {
  if (scopeStack.length === 0 || startCharacter >= line.length) {
    return;
  }

  const parameterNames = Array.from(
    new Set(scopeStack.flatMap((scope) => scope.parameterNames)),
  ).sort((left, right) => right.length - left.length);
  const searchSlice = line.slice(startCharacter);

  for (const parameterName of parameterNames) {
    const pattern = new RegExp(`\\b${escapeRegExp(parameterName)}\\b`, 'g');
    let match: RegExpExecArray | null = pattern.exec(searchSlice);

    while (match) {
      pushSemanticToken(
        tokens,
        lineNumber,
        startCharacter + match.index,
        parameterName.length,
        'parameter',
      );
      match = pattern.exec(searchSlice);
    }
  }
};

const collectKotlinParameterDeclarations = (
  tokens: AbsoluteSemanticToken[],
  lineNumber: number,
  openParenIndex: number,
  paramsText: string,
): string[] => {
  const parameterNames: string[] = [];
  const parameterPattern =
    /\b(?:vararg\s+)?(?:noinline\s+|crossinline\s+)?(?:val\s+|var\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*:/g;
  let parameterMatch: RegExpExecArray | null = parameterPattern.exec(paramsText);

  while (parameterMatch) {
    const parameterName = parameterMatch[1];
    const parameterStartInParams = paramsText.indexOf(parameterName, parameterMatch.index);
    if (parameterStartInParams >= 0) {
      parameterNames.push(parameterName);
      pushSemanticToken(
        tokens,
        lineNumber,
        openParenIndex + 1 + parameterStartInParams,
        parameterName.length,
        'parameter',
        ['declaration', 'definition'],
      );
    }

    parameterMatch = parameterPattern.exec(paramsText);
  }

  return parameterNames;
};

const collectKotlinInterfaceDeclarations = (
  tokens: AbsoluteSemanticToken[],
  line: string,
  lineNumber: number,
): void => {
  const interfacePattern =
    /\b(?:sealed\s+|fun\s+)?interface\s+([A-Za-z_][A-Za-z0-9_]*)\b/g;
  let interfaceMatch: RegExpExecArray | null = interfacePattern.exec(line);

  while (interfaceMatch) {
    const interfaceName = interfaceMatch[1];
    const interfaceNameStart = line.indexOf(interfaceName, interfaceMatch.index);
    if (interfaceNameStart >= 0) {
      pushSemanticToken(
        tokens,
        lineNumber,
        interfaceNameStart,
        interfaceName.length,
        'interface',
        ['declaration', 'definition'],
      );
    }

    interfaceMatch = interfacePattern.exec(line);
  }
};

const collectKotlinSupertypes = (
  tokens: AbsoluteSemanticToken[],
  line: string,
  lineNumber: number,
): void => {
  const headerPattern =
    /\b(?:(?:data|enum|sealed|annotation|value|inline)\s+class|class|object|(?:sealed\s+|fun\s+)?interface)\s+[A-Za-z_][A-Za-z0-9_]*(?:<[^>{}]+>)?\s*(?:\([^)]*\))?\s*:\s*([^{]+)/g;
  let headerMatch: RegExpExecArray | null = headerPattern.exec(line);

  while (headerMatch) {
    const clause = headerMatch[1]
      .split(/\bwhere\b/)[0]
      .trim();
    const clauseOffset = line.indexOf(clause, headerMatch.index);
    const segments = clause
      .split(',')
      .map((segment) => segment.replace(/\bby\b.+$/, '').trim())
      .filter(Boolean);

    let searchStart = clauseOffset;
    for (const segment of segments) {
      const segmentOffset = line.indexOf(segment, searchStart);
      searchStart = segmentOffset >= 0 ? segmentOffset + segment.length : searchStart;
      if (segmentOffset < 0) {
        continue;
      }

      const typeMatch = /(?:[A-Za-z_][A-Za-z0-9_]*\.)*([A-Z][A-Za-z0-9_]*)/.exec(segment);
      if (!typeMatch || typeof typeMatch.index !== 'number') {
        continue;
      }

      const typeName = typeMatch[1];
      const typeNameStart = segmentOffset + typeMatch.index + typeMatch[0].lastIndexOf(typeName);
      const segmentRemainder = segment.slice(typeMatch.index + typeMatch[0].length).trimStart();
      const tokenType = segmentRemainder.startsWith('(') ? 'class' : 'interface';

      pushSemanticToken(tokens, lineNumber, typeNameStart, typeName.length, tokenType);
    }

    headerMatch = headerPattern.exec(line);
  }
};

const buildKotlinFallbackSemanticTokens = (
  model: monaco.editor.ITextModel,
): Uint32Array | null => {
  const lines = model.getLinesContent();
  const tokens: AbsoluteSemanticToken[] = [];
  const scopeStack: KotlinParameterScope[] = [];
  let braceDepth = 0;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const sanitizedLine = sanitizeKotlinLine(lines[lineIndex]);
    collectKotlinInterfaceDeclarations(tokens, sanitizedLine, lineIndex);
    collectKotlinSupertypes(tokens, sanitizedLine, lineIndex);
    let skipUsageUntil = 0;
    const definitionPattern = /\bfun\b(?:\s*<[^>]+>)?\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)/g;
    let definitionMatch: RegExpExecArray | null = definitionPattern.exec(sanitizedLine);

    while (definitionMatch) {
      const functionName = definitionMatch[1];
      const paramsText = definitionMatch[2] ?? '';
      const functionNameStart = sanitizedLine.indexOf(functionName, definitionMatch.index);
      if (functionNameStart >= 0) {
        pushSemanticToken(
          tokens,
          lineIndex,
          functionNameStart,
          functionName.length,
          'function',
          ['declaration', 'definition'],
        );
      }

      const openParenIndex = sanitizedLine.indexOf('(', functionNameStart + functionName.length);
      const parameterNames =
        openParenIndex >= 0
          ? collectKotlinParameterDeclarations(tokens, lineIndex, openParenIndex, paramsText)
          : [];

      if (sanitizedLine.includes('{', definitionMatch.index) && parameterNames.length > 0) {
        scopeStack.push({
          baseDepth: braceDepth,
          parameterNames,
        });
      }

      skipUsageUntil = Math.max(skipUsageUntil, definitionMatch.index + definitionMatch[0].length);
      definitionMatch = definitionPattern.exec(sanitizedLine);
    }

    const constructorPattern =
      /\b(?:enum\s+class|data\s+class|sealed\s+class|annotation\s+class|value\s+class|inline\s+class|class)\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?:<[^>{}]+>)?\s*(?:constructor\s*)?\(([^)]*)\)/g;
    let constructorMatch: RegExpExecArray | null = constructorPattern.exec(sanitizedLine);

    while (constructorMatch) {
      const typeName = constructorMatch[1];
      const paramsText = constructorMatch[2] ?? '';
      const typeNameStart = sanitizedLine.indexOf(typeName, constructorMatch.index);
      const openParenIndex =
        typeNameStart >= 0
          ? sanitizedLine.indexOf('(', typeNameStart + typeName.length)
          : -1;

      if (openParenIndex >= 0) {
        collectKotlinParameterDeclarations(tokens, lineIndex, openParenIndex, paramsText);
      }

      skipUsageUntil = Math.max(
        skipUsageUntil,
        constructorMatch.index + constructorMatch[0].length,
      );
      constructorMatch = constructorPattern.exec(sanitizedLine);
    }

    collectKotlinParameterUsages(tokens, sanitizedLine, lineIndex, scopeStack, skipUsageUntil);

    const callPattern = /\b([a-z_][A-Za-z0-9_]*)\s*\(/g;
    let callMatch: RegExpExecArray | null = callPattern.exec(sanitizedLine);

    while (callMatch) {
      const functionName = callMatch[1];
      const nameStart = callMatch.index;
      const callPrefix = sanitizedLine.slice(Math.max(0, nameStart - 8), nameStart);
      const previousCharacter = getPreviousNonWhitespaceCharacter(sanitizedLine, nameStart);

      if (
        nameStart >= skipUsageUntil &&
        !KOTLIN_CALL_KEYWORDS.has(functionName) &&
        !/\bfun\s*$/.test(callPrefix)
      ) {
        pushSemanticToken(
          tokens,
          lineIndex,
          nameStart,
          functionName.length,
          previousCharacter === '.' ? 'method' : 'function',
        );
      }

      callMatch = callPattern.exec(sanitizedLine);
    }

    braceDepth += countCharacters(sanitizedLine, '{');
    braceDepth -= countCharacters(sanitizedLine, '}');

    while (
      scopeStack.length > 0 &&
      scopeStack[scopeStack.length - 1].baseDepth >= braceDepth
    ) {
      scopeStack.pop();
    }
  }

  return tokens.length > 0 ? encodeSemanticTokens(tokens) : null;
};

const buildFallbackSemanticTokens = (
  model: monaco.editor.ITextModel,
): Uint32Array | null => {
  if (model.getLanguageId() === 'kotlin') {
    return buildKotlinFallbackSemanticTokens(model);
  }

  return null;
};

const toMonacoCompletionKind = (kind?: number): monaco.languages.CompletionItemKind => {
  switch (kind) {
    case 2:
      return monaco.languages.CompletionItemKind.Method;
    case 3:
      return monaco.languages.CompletionItemKind.Function;
    case 4:
      return monaco.languages.CompletionItemKind.Constructor;
    case 5:
      return monaco.languages.CompletionItemKind.Field;
    case 6:
      return monaco.languages.CompletionItemKind.Variable;
    case 7:
      return monaco.languages.CompletionItemKind.Class;
    case 8:
      return monaco.languages.CompletionItemKind.Interface;
    case 9:
      return monaco.languages.CompletionItemKind.Module;
    case 10:
      return monaco.languages.CompletionItemKind.Property;
    case 11:
      return monaco.languages.CompletionItemKind.Unit;
    case 12:
      return monaco.languages.CompletionItemKind.Value;
    case 13:
      return monaco.languages.CompletionItemKind.Enum;
    case 14:
      return monaco.languages.CompletionItemKind.Keyword;
    case 15:
      return monaco.languages.CompletionItemKind.Snippet;
    case 16:
      return monaco.languages.CompletionItemKind.Color;
    case 17:
      return monaco.languages.CompletionItemKind.File;
    case 18:
      return monaco.languages.CompletionItemKind.Reference;
    case 19:
      return monaco.languages.CompletionItemKind.Folder;
    case 20:
      return monaco.languages.CompletionItemKind.EnumMember;
    case 21:
      return monaco.languages.CompletionItemKind.Constant;
    case 22:
      return monaco.languages.CompletionItemKind.Struct;
    case 23:
      return monaco.languages.CompletionItemKind.Event;
    case 24:
      return monaco.languages.CompletionItemKind.Operator;
    case 25:
      return monaco.languages.CompletionItemKind.TypeParameter;
    case 1:
    default:
      return monaco.languages.CompletionItemKind.Text;
  }
};

const dedupeDefinitionLocations = (
  result: LspDefinitionResult,
): LspDefinitionResult => {
  const seen = new Set<string>();

  return {
    locations: result.locations.filter((location) => {
      const key = [
        location.relativePath,
        location.range.start.line,
        location.range.start.character,
        location.range.end.line,
        location.range.end.character,
      ].join(':');

      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    }),
  };
};

const requestDefinitionLocations = async (
  request: () => Promise<LspDefinitionResult>,
): Promise<LspDefinitionResult> => request().catch(() => EMPTY_DEFINITION_RESULT);

const toMonacoTextEdit = (
  edit: NonNullable<LspCompletionItem['textEdit']>,
): monaco.languages.TextEdit => ({
  range: toMonacoRange(edit.range),
  text: edit.newText,
});

const toMonacoCompletionItem = (
  item: LspCompletionItem,
  model: monaco.editor.ITextModel,
  position: monaco.Position,
): monaco.languages.CompletionItem => {
  const wordUntil = model.getWordUntilPosition(position);
  const fallbackRange = {
    startLineNumber: position.lineNumber,
    startColumn: wordUntil.startColumn,
    endLineNumber: position.lineNumber,
    endColumn: wordUntil.endColumn,
  };

  return {
    label: item.label,
    kind: toMonacoCompletionKind(item.kind),
    detail: item.detail,
    documentation: item.documentation
      ? {
          value: item.documentation,
        }
      : undefined,
    insertText: item.textEdit?.newText ?? item.insertText ?? item.label,
    sortText: item.sortText,
    filterText: item.filterText,
    preselect: item.preselect,
    range: item.textEdit ? toMonacoRange(item.textEdit.range) : fallbackRange,
    additionalTextEdits: item.additionalTextEdits?.map((edit) => toMonacoTextEdit(edit)),
    commitCharacters: item.commitCharacters,
    insertTextRules:
      item.insertTextFormat === 2
        ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
        : undefined,
  };
};

const ensureWorkspaceModel = async (
  workspacePath: string,
  relativePath: string,
): Promise<monaco.editor.ITextModel | null> => {
  const uri = getWorkspaceModelUri(relativePath);
  const existingModel = monaco.editor.getModel(uri);
  if (existingModel) {
    return existingModel;
  }

  try {
    const file = await window.desktop.workspaceReadFile({
      workspacePath,
      filePath: relativePath,
    });

    return (
      monaco.editor.getModel(uri) ??
      monaco.editor.createModel(file.content, getMonacoLanguage(relativePath), uri)
    );
  } catch {
    return null;
  }
};

const applyDiagnosticsEvent = (event: LspRendererEvent): void => {
  if (event.kind !== 'diagnostics' || event.workspacePath !== activeWorkspacePath) {
    return;
  }

  const model = monaco.editor.getModel(getWorkspaceModelUri(event.relativePath));
  if (!model) {
    return;
  }

  monaco.editor.setModelMarkers(model, 'lsp', toMonacoMarkers(event.diagnostics));
};

const registerProviders = (): void => {
  if (hasRegisteredProviders) {
    return;
  }

  const hoverProvider: monaco.languages.HoverProvider = {
    provideHover: async (model, position) => {
      if (!activeWorkspacePath) {
        return null;
      }

      const relativePath = getRelativePathFromModel(model);
      if (!relativePath) {
        return null;
      }

      const result = await window.desktop.lspHover({
        workspacePath: activeWorkspacePath,
        relativePath,
        languageId: model.getLanguageId(),
        position: toLspPosition(position),
      }).catch(() => ({
        markdown: null,
        range: null,
      }));

      if (!result.markdown) {
        return null;
      }

      return {
        contents: [
          {
            value: result.markdown,
          },
        ],
        range: result.range ? toMonacoRange(result.range) : undefined,
      };
    },
  };

  const completionProvider: monaco.languages.CompletionItemProvider = {
    triggerCharacters: COMPLETION_TRIGGER_CHARACTERS,
    provideCompletionItems: async (model, position, context) => {
      if (!activeWorkspacePath) {
        return {
          suggestions: [],
        };
      }

      const relativePath = getRelativePathFromModel(model);
      if (!relativePath) {
        return {
          suggestions: [],
        };
      }

      const result = await window.desktop.lspCompletion({
        workspacePath: activeWorkspacePath,
        relativePath,
        languageId: model.getLanguageId(),
        position: toLspPosition(position),
        triggerCharacter: context.triggerCharacter,
        triggerKind: context.triggerKind,
      }).catch(() => ({
        items: [],
        isIncomplete: false,
      }));

      return {
        suggestions: result.items.map((item) => toMonacoCompletionItem(item, model, position)),
        incomplete: result.isIncomplete,
      };
    },
  };

  const semanticTokensProvider: monaco.languages.DocumentSemanticTokensProvider = {
    getLegend: () => SEMANTIC_TOKENS_LEGEND,
    provideDocumentSemanticTokens: async (model) => {
      if (!activeWorkspacePath) {
        return null;
      }

      const relativePath = getRelativePathFromModel(model);
      if (!relativePath) {
        return null;
      }

      const result = await window.desktop.lspSemanticTokens({
        workspacePath: activeWorkspacePath,
        relativePath,
        languageId: model.getLanguageId(),
      }).catch(() => ({
        supported: false,
        data: [],
        resultId: null,
      }));

      if (!result.supported) {
        const fallbackData = buildFallbackSemanticTokens(model);
        return fallbackData ? { data: fallbackData } : null;
      }

      const fallbackData = buildFallbackSemanticTokens(model);
      if (result.data.length === 0) {
        return fallbackData ? { data: fallbackData } : { data: new Uint32Array() };
      }

      const data = fallbackData
        ? mergeSemanticTokens(result.data, fallbackData)
        : new Uint32Array(result.data);

      return {
        data,
        resultId: result.resultId ?? undefined,
      };
    },
    releaseDocumentSemanticTokens: () => undefined,
  };

  const createLocationProvider = (
    request: (
      model: monaco.editor.ITextModel,
      position: monaco.Position,
    ) => Promise<LspDefinitionResult>,
  ): monaco.languages.DefinitionProvider => ({
    provideDefinition: async (model, position) => {
      if (!activeWorkspacePath) {
        return [];
      }

      const result = await request(model, position);
      if (result.locations.length === 0) {
        return [];
      }

      await Promise.all(
        result.locations.map((location) =>
          ensureWorkspaceModel(activeWorkspacePath, location.relativePath),
        ),
      );

      return result.locations.map((location) => ({
        uri: getWorkspaceModelUri(location.relativePath),
        range: toMonacoRange(location.range),
      }));
    },
  });

  const buildTextDocumentPositionRequest = (
    model: monaco.editor.ITextModel,
    position: monaco.Position,
  ) => {
    const relativePath = getRelativePathFromModel(model);
    if (!relativePath) {
      return null;
    }

    return {
      workspacePath: activeWorkspacePath,
      relativePath,
      languageId: model.getLanguageId(),
      position: toLspPosition(position),
    };
  };

  const definitionProvider = createLocationProvider(async (model, position) => {
    const request = buildTextDocumentPositionRequest(model, position);
    if (!request) {
      return EMPTY_DEFINITION_RESULT;
    }

    const primary = await requestDefinitionLocations(() =>
      window.desktop.lspDefinition(request),
    );
    if (primary.locations.length > 0) {
      return primary;
    }

    const fallback = await requestDefinitionLocations(() =>
      window.desktop.lspDeclaration(request),
    );

    return dedupeDefinitionLocations(fallback);
  });

  const declarationProvider = createLocationProvider(async (model, position) => {
    const request = buildTextDocumentPositionRequest(model, position);
    if (!request) {
      return EMPTY_DEFINITION_RESULT;
    }

    const primary = await requestDefinitionLocations(() =>
      window.desktop.lspDeclaration(request),
    );
    if (primary.locations.length > 0) {
      return primary;
    }

    const fallback = await requestDefinitionLocations(() =>
      window.desktop.lspDefinition(request),
    );

    return dedupeDefinitionLocations(fallback);
  });

  const referenceProvider: monaco.languages.ReferenceProvider = {
    provideReferences: async (model, position, context) => {
      if (!activeWorkspacePath) {
        return [];
      }

      const relativePath = getRelativePathFromModel(model);
      if (!relativePath) {
        return [];
      }

      const result = await window.desktop.lspReferences({
        workspacePath: activeWorkspacePath,
        relativePath,
        languageId: model.getLanguageId(),
        position: toLspPosition(position),
        includeDeclaration: context.includeDeclaration,
      }).catch(() => ({
        locations: [],
      }));

      if (result.locations.length === 0) {
        return [];
      }

      await Promise.all(
        result.locations.map((location) =>
          ensureWorkspaceModel(activeWorkspacePath, location.relativePath),
        ),
      );

      return result.locations.map((location) => ({
        uri: getWorkspaceModelUri(location.relativePath),
        range: toMonacoRange(location.range),
      }));
    },
  };

  for (const languageId of SUPPORTED_LANGUAGES) {
    monaco.languages.registerHoverProvider(languageId, hoverProvider);
    monaco.languages.registerCompletionItemProvider(languageId, completionProvider);
    monaco.languages.registerDocumentSemanticTokensProvider(
      languageId,
      semanticTokensProvider,
    );
    monaco.languages.registerDefinitionProvider(languageId, definitionProvider);
    monaco.languages.registerDeclarationProvider(languageId, declarationProvider);
    monaco.languages.registerReferenceProvider(languageId, referenceProvider);
  }

  hasRegisteredProviders = true;
};

export const ensureMonacoLsp = (workspacePath: string): void => {
  activeWorkspacePath = workspacePath;
  registerProviders();

  if (removeLspListener) {
    return;
  }

  removeLspListener = window.desktop.onLspEvent((event) => {
    applyDiagnosticsEvent(event);
  });
};

export const syncWorkspaceModelWithLsp = async (
  workspacePath: string,
  model: monaco.editor.ITextModel,
): Promise<void> => {
  const relativePath = getRelativePathFromModel(model);
  if (!relativePath) {
    return;
  }

  await window.desktop.lspDocumentSync({
    workspacePath,
    relativePath,
    languageId: model.getLanguageId(),
    content: model.getValue(),
    version: model.getVersionId(),
  }).catch(() => undefined);
};

export const closeWorkspaceModelInLsp = async (
  workspacePath: string,
  model: monaco.editor.ITextModel,
): Promise<void> => {
  const relativePath = getRelativePathFromModel(model);
  if (!relativePath) {
    return;
  }

  monaco.editor.setModelMarkers(model, 'lsp', []);
  await window.desktop.lspDocumentClose({
    workspacePath,
    relativePath,
    languageId: model.getLanguageId(),
  }).catch(() => undefined);
};

export const clearWorkspacePathDiagnostics = (relativePath: string): void => {
  const model = monaco.editor.getModel(getWorkspaceModelUri(relativePath));
  if (!model) {
    return;
  }

  monaco.editor.setModelMarkers(model, 'lsp', []);
};
