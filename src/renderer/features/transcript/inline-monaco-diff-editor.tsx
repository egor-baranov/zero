import * as React from 'react';
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import 'monaco-editor/min/vs/editor/editor.main.css';
import 'monaco-editor/esm/vs/basic-languages/css/css.contribution';
import 'monaco-editor/esm/vs/basic-languages/html/html.contribution';
import 'monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution';
import 'monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution';
import 'monaco-editor/esm/vs/basic-languages/shell/shell.contribution';
import 'monaco-editor/esm/vs/basic-languages/typescript/typescript.contribution';
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

const diffHunkHeaderExpression = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
const MAX_DIFF_PREVIEW_CHARACTERS = 200_000;
const MIN_DIFF_PREVIEW_HEIGHT = 88;
const MAX_DIFF_PREVIEW_HEIGHT = 420;
const DIFF_EDITOR_LINE_HEIGHT = 22;
let diffEditorInstanceCounter = 0;

const getMonacoTheme = (): 'vs' | 'vs-dark' =>
  document.documentElement.dataset.zeroadeTheme === 'dark' ? 'vs-dark' : 'vs';

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
  if (extension === 'md') {
    return 'markdown';
  }
  if (extension === 'css' || extension === 'scss' || extension === 'less') {
    return 'css';
  }
  if (extension === 'html') {
    return 'html';
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
  instanceId: number,
): monaco.Uri => {
  const normalizedPath = filePath.replaceAll('\\', '/');
  const basePath = normalizedPath.startsWith('/') ? normalizedPath : `/${normalizedPath}`;

  return monaco.Uri.from({
    scheme: 'file',
    path: `/zeroade-transcript-diff/${instanceId}/${side}${basePath}`,
    query: side,
  });
};

const buildDiffEditorContent = (
  patch: string,
): {
  original: string;
  modified: string;
  originalChangedLineNumbers: number[];
  modifiedChangedLineNumbers: number[];
} => {
  const originalLines: string[] = [];
  const modifiedLines: string[] = [];
  const originalChangedLineNumbers: number[] = [];
  const modifiedChangedLineNumbers: number[] = [];
  const lines = patch.replace(/\r\n?/g, '\n').split('\n');
  let originalLineCursor = 1;
  let modifiedLineCursor = 1;
  let insideHunk = false;

  for (const line of lines) {
    const hunkHeaderMatch = line.match(diffHunkHeaderExpression);
    if (hunkHeaderMatch) {
      insideHunk = true;
      const nextOriginalStart = Number.parseInt(hunkHeaderMatch[1] ?? '1', 10);
      const nextModifiedStart = Number.parseInt(hunkHeaderMatch[3] ?? '1', 10);

      while (originalLineCursor < nextOriginalStart) {
        originalLines.push('');
        originalLineCursor += 1;
      }

      while (modifiedLineCursor < nextModifiedStart) {
        modifiedLines.push('');
        modifiedLineCursor += 1;
      }

      continue;
    }

    if (!insideHunk) {
      continue;
    }

    if (line.startsWith('\\ No newline at end of file')) {
      continue;
    }

    if (line.startsWith('+')) {
      modifiedChangedLineNumbers.push(modifiedLineCursor);
      modifiedLines.push(line.slice(1));
      modifiedLineCursor += 1;
      continue;
    }

    if (line.startsWith('-')) {
      originalChangedLineNumbers.push(originalLineCursor);
      originalLines.push(line.slice(1));
      originalLineCursor += 1;
      continue;
    }

    if (line.startsWith(' ')) {
      const content = line.slice(1);
      originalLines.push(content);
      modifiedLines.push(content);
      originalLineCursor += 1;
      modifiedLineCursor += 1;
    }
  }

  return {
    original: originalLines.join('\n'),
    modified: modifiedLines.join('\n'),
    originalChangedLineNumbers,
    modifiedChangedLineNumbers,
  };
};

const countEditorLines = (value: string): number => {
  if (value.length === 0) {
    return 1;
  }

  return value.replace(/\r\n?/g, '\n').split('\n').length;
};

interface InlineMonacoDiffEditorProps {
  filePath: string;
  patch: string;
}

export const InlineMonacoDiffEditor = ({
  filePath,
  patch,
}: InlineMonacoDiffEditorProps): JSX.Element => {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const editorRef = React.useRef<monaco.editor.IStandaloneDiffEditor | null>(null);
  const originalModelRef = React.useRef<monaco.editor.ITextModel | null>(null);
  const modifiedModelRef = React.useRef<monaco.editor.ITextModel | null>(null);
  const instanceIdRef = React.useRef<number>(diffEditorInstanceCounter += 1);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  const content = React.useMemo(() => buildDiffEditorContent(patch), [patch]);
  const language = React.useMemo(() => getMonacoLanguage(filePath), [filePath]);
  const totalCharacterCount = content.original.length + content.modified.length;
  const editorHeight = React.useMemo(() => {
    const visibleLineCount = Math.max(
      countEditorLines(content.original),
      countEditorLines(content.modified),
      1,
    );

    return Math.min(
      MAX_DIFF_PREVIEW_HEIGHT,
      Math.max(MIN_DIFF_PREVIEW_HEIGHT, visibleLineCount * DIFF_EDITOR_LINE_HEIGHT),
    );
  }, [content.modified, content.original]);

  React.useEffect(() => {
    const container = containerRef.current;
    if (!container || editorRef.current) {
      return;
    }

    try {
      const editor = monaco.editor.createDiffEditor(container, {
        theme: getMonacoTheme(),
        automaticLayout: true,
        readOnly: true,
        renderSideBySide: false,
        compactMode: true,
        originalEditable: false,
        diffCodeLens: false,
        renderMarginRevertIcon: false,
        renderOverviewRuler: false,
        renderIndicators: false,
        glyphMargin: false,
        lineDecorationsWidth: 8,
        lineNumbersMinChars: 3,
        scrollBeyondLastLine: false,
        wordWrap: 'off',
        minimap: { enabled: false },
        overviewRulerLanes: 0,
        hideCursorInOverviewRuler: true,
        lineNumbers: 'on',
        fontSize: 13,
        lineHeight: DIFF_EDITOR_LINE_HEIGHT,
        padding: {
          top: 0,
          bottom: 0,
        },
        fontFamily: 'SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
        scrollbar: {
          horizontalScrollbarSize: 8,
          verticalScrollbarSize: 8,
          ignoreHorizontalScrollbarInContentHeight: true,
        },
      });

      editorRef.current = editor;
      setErrorMessage(null);
      editor.layout();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to initialize diff preview.';
      setErrorMessage(message);
    }

    return () => {
      editorRef.current?.setModel(null);
      originalModelRef.current?.dispose();
      modifiedModelRef.current?.dispose();
      originalModelRef.current = null;
      modifiedModelRef.current = null;
      editorRef.current?.dispose();
      editorRef.current = null;
    };
  }, []);

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
    if (totalCharacterCount > MAX_DIFF_PREVIEW_CHARACTERS) {
      setErrorMessage('Diff preview is too large to render inline.');
      return;
    }

    const editor = editorRef.current;
    if (!editor) {
      return;
    }

    originalModelRef.current?.dispose();
    modifiedModelRef.current?.dispose();

    try {
      const originalUri = getModelUri(filePath, 'original', instanceIdRef.current);
      const modifiedUri = getModelUri(filePath, 'modified', instanceIdRef.current);

      monaco.editor.getModel(originalUri)?.dispose();
      monaco.editor.getModel(modifiedUri)?.dispose();

      originalModelRef.current = monaco.editor.createModel(content.original, language, originalUri);
      modifiedModelRef.current = monaco.editor.createModel(content.modified, language, modifiedUri);

      originalModelRef.current.deltaDecorations(
        [],
        content.originalChangedLineNumbers.map((lineNumber) => ({
          range: new monaco.Range(lineNumber, 1, lineNumber, 1),
          options: {
            lineNumberClassName: 'zeroade-diff-line-number-delete',
          },
        })),
      );

      modifiedModelRef.current.deltaDecorations(
        [],
        content.modifiedChangedLineNumbers.map((lineNumber) => ({
          range: new monaco.Range(lineNumber, 1, lineNumber, 1),
          options: {
            lineNumberClassName: 'zeroade-diff-line-number-insert',
          },
        })),
      );

      editor.setModel({
        original: originalModelRef.current,
        modified: modifiedModelRef.current,
      });
      editor.layout();
      setErrorMessage(null);
    } catch (error) {
      editor.setModel(null);
      originalModelRef.current?.dispose();
      modifiedModelRef.current?.dispose();
      originalModelRef.current = null;
      modifiedModelRef.current = null;
      const message = error instanceof Error ? error.message : 'Unable to load diff preview.';
      setErrorMessage(message);
    }

    return () => {
      editor.setModel(null);
      originalModelRef.current?.dispose();
      modifiedModelRef.current?.dispose();
      originalModelRef.current = null;
      modifiedModelRef.current = null;
    };
  }, [content, filePath, language, totalCharacterCount]);

  if (errorMessage) {
    return (
      <div className="flex h-[360px] items-center justify-center rounded-xl bg-stone-100/85 px-4 text-center text-[13px] text-stone-500">
        {errorMessage}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="zeroade-inline-monaco-diff w-full"
      style={{ height: `${editorHeight}px` }}
    />
  );
};
