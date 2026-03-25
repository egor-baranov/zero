import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import type {
  LspCompletionItem,
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

let activeWorkspacePath = '';
let hasRegisteredProviders = false;
let removeLspListener: (() => void) | null = null;

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

  const createLocationProvider = (
    request: (
      model: monaco.editor.ITextModel,
      position: monaco.Position,
    ) => Promise<{
      locations: Array<{ relativePath: string; range: LspRange }>;
    }>,
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

  const definitionProvider = createLocationProvider((model, position) => {
    const relativePath = getRelativePathFromModel(model);
    if (!relativePath) {
      return Promise.resolve({
        locations: [],
      });
    }

    return window.desktop.lspDefinition({
      workspacePath: activeWorkspacePath,
      relativePath,
      languageId: model.getLanguageId(),
      position: toLspPosition(position),
    }).catch(() => ({
      locations: [],
    }));
  });

  const declarationProvider = createLocationProvider((model, position) => {
    const relativePath = getRelativePathFromModel(model);
    if (!relativePath) {
      return Promise.resolve({
        locations: [],
      });
    }

    return window.desktop.lspDeclaration({
      workspacePath: activeWorkspacePath,
      relativePath,
      languageId: model.getLanguageId(),
      position: toLspPosition(position),
    }).catch(() => ({
      locations: [],
    }));
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
