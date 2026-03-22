import * as React from 'react';
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import 'monaco-editor/min/vs/editor/editor.main.css';
import 'monaco-editor/esm/vs/basic-languages/css/css.contribution';
import 'monaco-editor/esm/vs/basic-languages/go/go.contribution';
import 'monaco-editor/esm/vs/basic-languages/html/html.contribution';
import 'monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution';
import 'monaco-editor/esm/vs/basic-languages/java/java.contribution';
import 'monaco-editor/esm/vs/basic-languages/kotlin/kotlin.contribution';
import 'monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution';
import 'monaco-editor/esm/vs/basic-languages/python/python.contribution';
import 'monaco-editor/esm/vs/basic-languages/ruby/ruby.contribution';
import 'monaco-editor/esm/vs/basic-languages/rust/rust.contribution';
import 'monaco-editor/esm/vs/basic-languages/shell/shell.contribution';
import 'monaco-editor/esm/vs/basic-languages/typescript/typescript.contribution';
import 'monaco-editor/esm/vs/basic-languages/xml/xml.contribution';
import 'monaco-editor/esm/vs/basic-languages/yaml/yaml.contribution';
import 'monaco-editor/esm/vs/language/json/monaco.contribution';
// eslint-disable-next-line import/default
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
// eslint-disable-next-line import/default
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
// eslint-disable-next-line import/default
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
// eslint-disable-next-line import/default
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
// eslint-disable-next-line import/default
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';
import { cn } from '@renderer/lib/cn';

interface MonacoEnvironmentGlobal {
  MonacoEnvironment?: {
    getWorker: (_moduleId: string, label: string) => Worker;
  };
}

const monacoGlobal = globalThis as typeof globalThis & MonacoEnvironmentGlobal;

monacoGlobal.MonacoEnvironment = {
  ...(monacoGlobal.MonacoEnvironment ?? {}),
  getWorker: (_moduleId, label) => {
    if (label === 'json') {
      return new jsonWorker();
    }

    if (label === 'css' || label === 'scss' || label === 'less') {
      return new cssWorker();
    }

    if (label === 'html' || label === 'handlebars' || label === 'razor') {
      return new htmlWorker();
    }

    if (label === 'typescript' || label === 'javascript') {
      return new tsWorker();
    }

    return new editorWorker();
  },
};

const MAX_DIFF_PREVIEW_CHARACTERS = 400_000;
const GUTTER_OVERLAY_WIDTH = 44;
const ORIGINAL_RIGHT_GUTTER_INSET = 0;

const getMonacoTheme = (): 'vs' | 'vs-dark' =>
  document.documentElement.dataset.zeroadeTheme === 'dark' ? 'vs-dark' : 'vs';

const getOpaqueEditorBackground = (): string =>
  getMonacoTheme() === 'vs-dark' ? '#1e1e1e' : '#ffffff';

const getFileExtension = (filePath: string): string => {
  const normalizedPath = filePath.replaceAll('\\', '/');
  const fileName = normalizedPath.split('/').filter(Boolean).at(-1) ?? normalizedPath;
  const parts = fileName.toLowerCase().split('.');
  if (parts.length < 2) {
    return '';
  }

  return parts.at(-1) ?? '';
};

const getMonacoLanguage = (filePath: string): string => {
  const extension = getFileExtension(filePath);

  if (extension === 'ts' || extension === 'tsx') {
    return 'typescript';
  }
  if (extension === 'js' || extension === 'jsx' || extension === 'mjs' || extension === 'cjs') {
    return 'javascript';
  }
  if (extension === 'json') {
    return 'json';
  }
  if (extension === 'go') {
    return 'go';
  }
  if (extension === 'java') {
    return 'java';
  }
  if (extension === 'kt' || extension === 'kts') {
    return 'kotlin';
  }
  if (extension === 'md') {
    return 'markdown';
  }
  if (extension === 'py') {
    return 'python';
  }
  if (extension === 'rb') {
    return 'ruby';
  }
  if (extension === 'rs') {
    return 'rust';
  }
  if (extension === 'css' || extension === 'scss' || extension === 'less') {
    return 'css';
  }
  if (extension === 'html') {
    return 'html';
  }
  if (extension === 'xml') {
    return 'xml';
  }
  if (extension === 'yml' || extension === 'yaml') {
    return 'yaml';
  }
  if (extension === 'sh' || extension === 'zsh' || extension === 'bash') {
    return 'shell';
  }

  return 'plaintext';
};

const getModelUri = (
  filePath: string,
  side: 'original' | 'modified',
): monaco.Uri => {
  const normalizedPath = filePath.replaceAll('\\', '/');
  const basePath = normalizedPath.startsWith('/') ? normalizedPath : `/${normalizedPath}`;

  return monaco.Uri.from({
    scheme: 'file',
    path: `/zeroade-review-diff/${side}${basePath}`,
    query: side,
  });
};

interface SideBySideDiffViewProps {
  filePath: string;
  originalContent: string;
  modifiedContent: string;
  patch: string;
}

interface GutterOverlayLine {
  key: string;
  label: string;
  top: number;
  tone: 'normal' | 'insert' | 'delete';
}

interface GutterOverlayState {
  left: number;
  width: number;
  lineHeight: number;
  lines: GutterOverlayLine[];
}

const getLineRangeCount = (startLineNumber: number, endLineNumber: number): number => {
  if (startLineNumber <= 0 || endLineNumber <= 0 || endLineNumber < startLineNumber) {
    return 0;
  }

  return endLineNumber - startLineNumber + 1;
};

const configureOriginalEditor = (
  editor: monaco.editor.IStandaloneDiffEditor,
): void => {
  const originalEditor = editor.getOriginalEditor();
  originalEditor.updateOptions({
    lineNumbers: 'off',
    lineNumbersMinChars: 0,
    lineDecorationsWidth: 0,
    glyphMargin: false,
  });
};

const positionOriginalScrollbar = (
  editor: monaco.editor.IStandaloneDiffEditor,
): void => {
  const originalDomNode = editor.getOriginalEditor().getDomNode();
  const verticalScrollbar = originalDomNode?.querySelector<HTMLElement>('.scrollbar.vertical');
  if (verticalScrollbar) {
    verticalScrollbar.style.left = '0';
    verticalScrollbar.style.right = 'auto';
  }
};

const configureModifiedEditor = (
  editor: monaco.editor.IStandaloneDiffEditor,
): void => {
  const modifiedEditor = editor.getModifiedEditor();
  modifiedEditor.updateOptions({
    lineNumbers: 'off',
    lineNumbersMinChars: 0,
    lineDecorationsWidth: GUTTER_OVERLAY_WIDTH,
    glyphMargin: false,
  });
};

const buildModelContent = (content: string): string =>
  content.length > 0 ? content : '';

const buildGutterOverlayState = ({
  containerRect,
  editorRect,
  editor,
  getLine,
  side,
}: {
  containerRect: DOMRect;
  editorRect: DOMRect;
  editor: monaco.editor.ICodeEditor;
  getLine: (lineNumber: number) => Pick<GutterOverlayLine, 'label' | 'tone'>;
  side: 'left' | 'right';
}): GutterOverlayState => {
  const lineHeight = editor.getOption(monaco.editor.EditorOption.lineHeight);
  const scrollTop = editor.getScrollTop();
  const visibleRanges = editor.getVisibleRanges();
  const visibleLines: GutterOverlayLine[] = [];
  const seenLines = new Set<number>();

  for (const range of visibleRanges) {
    for (
      let lineNumber = range.startLineNumber;
      lineNumber <= range.endLineNumber;
      lineNumber += 1
    ) {
      if (seenLines.has(lineNumber)) {
        continue;
      }

      seenLines.add(lineNumber);
      const top = editor.getTopForLineNumber(lineNumber) - scrollTop;
      if (top + lineHeight < 0 || top > editorRect.height) {
        continue;
      }

      visibleLines.push({
        key: `line-${lineNumber}`,
        ...getLine(lineNumber),
        top,
      });
    }
  }

  return {
    left:
      side === 'right'
        ? Math.max(
            0,
            editorRect.right - containerRect.left - GUTTER_OVERLAY_WIDTH - ORIGINAL_RIGHT_GUTTER_INSET,
          )
        : Math.max(0, editorRect.left - containerRect.left),
    width: GUTTER_OVERLAY_WIDTH,
    lineHeight,
    lines: visibleLines,
  };
};

const buildDiffLineToneSets = (
  diffEditor: monaco.editor.IStandaloneDiffEditor,
): {
  missingOriginalModifiedLines: Set<number>;
  originalChangedModifiedLines: Set<number>;
  modifiedChangedLines: Set<number>;
} => {
  const lineChanges = diffEditor.getLineChanges() ?? [];
  const missingOriginalModifiedLines = new Set<number>();
  const originalChangedModifiedLines = new Set<number>();
  const modifiedChangedLines = new Set<number>();

  for (const change of lineChanges) {
    const originalCount = getLineRangeCount(
      change.originalStartLineNumber,
      change.originalEndLineNumber,
    );
    const modifiedCount = getLineRangeCount(
      change.modifiedStartLineNumber,
      change.modifiedEndLineNumber,
    );
    const pairedCount = Math.min(originalCount, modifiedCount);

    for (let offset = 0; offset < pairedCount; offset += 1) {
      const modifiedLine = change.modifiedStartLineNumber + offset;
      originalChangedModifiedLines.add(modifiedLine);
      modifiedChangedLines.add(modifiedLine);
    }

    if (modifiedCount > pairedCount) {
      for (
        let lineNumber = change.modifiedStartLineNumber + pairedCount;
        lineNumber <= change.modifiedEndLineNumber;
        lineNumber += 1
      ) {
        missingOriginalModifiedLines.add(lineNumber);
        modifiedChangedLines.add(lineNumber);
      }
    }
  }

  return {
    missingOriginalModifiedLines,
    originalChangedModifiedLines,
    modifiedChangedLines,
  };
};

export const SideBySideDiffView = ({
  filePath,
  originalContent,
  modifiedContent,
  patch,
}: SideBySideDiffViewProps): JSX.Element => {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const editorHostRef = React.useRef<HTMLDivElement | null>(null);
  const editorRef = React.useRef<monaco.editor.IStandaloneDiffEditor | null>(null);
  const originalModelRef = React.useRef<monaco.editor.ITextModel | null>(null);
  const modifiedModelRef = React.useRef<monaco.editor.ITextModel | null>(null);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const language = React.useMemo(() => getMonacoLanguage(filePath), [filePath]);
  const [originalGutterOverlay, setOriginalGutterOverlay] =
    React.useState<GutterOverlayState | null>(null);
  const [modifiedGutterOverlay, setModifiedGutterOverlay] =
    React.useState<GutterOverlayState | null>(null);

  const updateGutterOverlays = React.useCallback(() => {
    const editor = editorRef.current;
    const container = containerRef.current;
    if (!editor || !container) {
      setOriginalGutterOverlay(null);
      setModifiedGutterOverlay(null);
      return;
    }

    const originalEditor = editor.getOriginalEditor();
    const modifiedEditor = editor.getModifiedEditor();
    const originalDomNode = originalEditor.getDomNode();
    const modifiedDomNode = modifiedEditor.getDomNode();
    if (!originalDomNode || !modifiedDomNode) {
      setOriginalGutterOverlay(null);
      setModifiedGutterOverlay(null);
      return;
    }

    const containerRect = container.getBoundingClientRect();
    const originalRect = originalDomNode.getBoundingClientRect();
    const modifiedRect = modifiedDomNode.getBoundingClientRect();
    const {
      missingOriginalModifiedLines,
      originalChangedModifiedLines,
      modifiedChangedLines,
    } = buildDiffLineToneSets(editor);

    setOriginalGutterOverlay(
      buildGutterOverlayState({
        containerRect,
        editorRect: originalRect,
        editor: modifiedEditor,
        getLine: (lineNumber) => ({
          label: missingOriginalModifiedLines.has(lineNumber) ? '' : String(lineNumber),
          tone:
            !missingOriginalModifiedLines.has(lineNumber) &&
            originalChangedModifiedLines.has(lineNumber)
              ? 'delete'
              : 'normal',
        }),
        side: 'right',
      }),
    );
    setModifiedGutterOverlay(
      buildGutterOverlayState({
        containerRect,
        editorRect: modifiedRect,
        editor: modifiedEditor,
        getLine: (lineNumber) => ({
          label: String(lineNumber),
          tone: modifiedChangedLines.has(lineNumber) ? 'insert' : 'normal',
        }),
        side: 'left',
      }),
    );
  }, []);

  React.useEffect(() => {
    const editorHost = editorHostRef.current;
    if (!editorHost || editorRef.current) {
      return;
    }

    try {
      const editor = monaco.editor.createDiffEditor(editorHost, {
        theme: getMonacoTheme(),
        automaticLayout: true,
        readOnly: true,
        renderSideBySide: true,
        originalEditable: false,
        diffCodeLens: false,
        renderMarginRevertIcon: false,
        renderOverviewRuler: false,
        renderIndicators: true,
        glyphMargin: false,
        hideUnchangedRegions: {
          enabled: false,
        },
        lineNumbersMinChars: 3,
        scrollBeyondLastLine: false,
        wordWrap: 'off',
        minimap: { enabled: false },
        fontSize: 13,
        lineHeight: 21,
        fontFamily: 'SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
        scrollbar: {
          horizontalScrollbarSize: 8,
          verticalScrollbarSize: 8,
          ignoreHorizontalScrollbarInContentHeight: true,
        },
      });

      configureOriginalEditor(editor);
      positionOriginalScrollbar(editor);
      configureModifiedEditor(editor);
      const originalEditor = editor.getOriginalEditor();
      const modifiedEditor = editor.getModifiedEditor();

      const scrollDisposable = originalEditor.onDidScrollChange(() => {
        updateGutterOverlays();
      });
      const modifiedScrollDisposable = modifiedEditor.onDidScrollChange(() => {
        updateGutterOverlays();
      });
      const originalLayoutDisposable = originalEditor.onDidLayoutChange(() => {
        positionOriginalScrollbar(editor);
        updateGutterOverlays();
      });
      const modifiedLayoutDisposable = modifiedEditor.onDidLayoutChange(() => {
        updateGutterOverlays();
      });
      const diffUpdateDisposable = editor.onDidUpdateDiff(() => {
        positionOriginalScrollbar(editor);
        updateGutterOverlays();
      });

      editorRef.current = editor;
      setErrorMessage(null);

      return () => {
        scrollDisposable.dispose();
        modifiedScrollDisposable.dispose();
        originalLayoutDisposable.dispose();
        modifiedLayoutDisposable.dispose();
        diffUpdateDisposable.dispose();
        editorRef.current?.setModel(null);
        originalModelRef.current?.dispose();
        modifiedModelRef.current?.dispose();
        originalModelRef.current = null;
        modifiedModelRef.current = null;
        editorRef.current?.dispose();
        editorRef.current = null;
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to initialize diff viewer.';
      setErrorMessage(message);
    }

    return undefined;
  }, [updateGutterOverlays]);

  React.useEffect(() => {
    const applyTheme = (): void => {
      monaco.editor.setTheme(getMonacoTheme());
    };

    applyTheme();
    window.addEventListener('zeroade-ui-preferences-changed', applyTheme);
    return () => {
      window.removeEventListener('zeroade-ui-preferences-changed', applyTheme);
    };
  }, []);

  React.useEffect(() => {
    if (!originalContent.trim().length && !modifiedContent.trim().length && !patch.trim().length) {
      setErrorMessage('No diff available.');
      return;
    }

    if (originalContent.length + modifiedContent.length > MAX_DIFF_PREVIEW_CHARACTERS) {
      setErrorMessage('Diff is too large to render here.');
      return;
    }

    const editor = editorRef.current;
    if (!editor) {
      return;
    }

    originalModelRef.current?.dispose();
    modifiedModelRef.current?.dispose();

    const originalModel = monaco.editor.createModel(
      buildModelContent(originalContent),
      language,
      getModelUri(filePath, 'original'),
    );
    const modifiedModel = monaco.editor.createModel(
      buildModelContent(modifiedContent),
      language,
      getModelUri(filePath, 'modified'),
    );

    originalModelRef.current = originalModel;
    modifiedModelRef.current = modifiedModel;
    editor.setModel({
      original: originalModel,
      modified: modifiedModel,
    });
    configureOriginalEditor(editor);
    positionOriginalScrollbar(editor);
    configureModifiedEditor(editor);
    editor.layout();
    updateGutterOverlays();
    setErrorMessage(null);
  }, [filePath, language, modifiedContent, originalContent, patch, updateGutterOverlays]);

  React.useEffect(() => {
    updateGutterOverlays();
  }, [updateGutterOverlays]);

  if (errorMessage) {
    return (
      <div className="flex h-full w-full items-center justify-center rounded-[12px] bg-stone-50 text-[13px] text-stone-500">
        {errorMessage}
      </div>
    );
  }

  return (
    <div ref={containerRef} className="zeroade-side-by-side-diff relative h-full w-full">
      <div ref={editorHostRef} className="h-full w-full" />
      {editorRef.current && originalGutterOverlay ? (
        <div
          className="pointer-events-none absolute inset-y-0 z-10 overflow-hidden"
          style={{
            left: `${originalGutterOverlay.left}px`,
            width: `${originalGutterOverlay.width}px`,
            backgroundColor: getOpaqueEditorBackground(),
            boxShadow: 'inset 1px 0 0 rgba(0, 0, 0, 0.06)',
          }}
        >
          {originalGutterOverlay.lines.map((line) => (
            <div
              key={line.key}
              className={cn(
                'zeroade-side-by-side-diff-gutter-line absolute inset-x-0 pr-2 text-right font-mono text-[13px]',
                line.tone === 'delete' && 'zeroade-side-by-side-diff-gutter-line-delete',
                line.tone === 'insert' && 'zeroade-side-by-side-diff-gutter-line-insert',
              )}
              style={{
                top: `${line.top}px`,
                lineHeight: `${originalGutterOverlay.lineHeight}px`,
              }}
            >
              {line.label}
            </div>
          ))}
        </div>
      ) : null}
      {editorRef.current && modifiedGutterOverlay ? (
        <div
          className="pointer-events-none absolute inset-y-0 z-10 overflow-hidden"
          style={{
            left: `${modifiedGutterOverlay.left}px`,
            width: `${modifiedGutterOverlay.width}px`,
            backgroundColor: getOpaqueEditorBackground(),
            boxShadow: 'inset -1px 0 0 rgba(0, 0, 0, 0.06)',
          }}
        >
          {modifiedGutterOverlay.lines.map((line) => (
            <div
              key={line.key}
              className={cn(
                'zeroade-side-by-side-diff-gutter-line absolute inset-x-0 pl-2 pr-2 text-left font-mono text-[13px]',
                line.tone === 'delete' && 'zeroade-side-by-side-diff-gutter-line-delete',
                line.tone === 'insert' && 'zeroade-side-by-side-diff-gutter-line-insert',
              )}
              style={{
                top: `${line.top}px`,
                lineHeight: `${modifiedGutterOverlay.lineHeight}px`,
              }}
            >
              {line.label}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
};
