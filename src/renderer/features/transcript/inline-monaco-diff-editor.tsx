import * as React from 'react';
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import { cn } from '@renderer/lib/cn';
import { ensureMonacoSetup, getMonacoLanguage } from '@renderer/lib/monaco-setup';
import { ensureMonacoThemes } from '@renderer/lib/monaco-theme';
import {
  getMonacoInlineDiffLineHeight,
  readResolvedCodeFontFamily,
  readResolvedCodeFontLigatures,
  readResolvedEditorFontSize,
  readResolvedMonacoTheme,
} from '@renderer/store/ui-preferences';

const diffHunkHeaderExpression = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
const MAX_DIFF_PREVIEW_CHARACTERS = 200_000;
const MIN_DIFF_PREVIEW_HEIGHT = 88;
const MAX_DIFF_PREVIEW_HEIGHT = 420;
let diffEditorInstanceCounter = 0;

const getMonacoTheme = (): string =>
  readResolvedMonacoTheme();


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
  className?: string;
}

export const InlineMonacoDiffEditor = ({
  filePath,
  patch,
  className,
}: InlineMonacoDiffEditorProps): JSX.Element => {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const editorRef = React.useRef<monaco.editor.IStandaloneDiffEditor | null>(null);
  const originalModelRef = React.useRef<monaco.editor.ITextModel | null>(null);
  const modifiedModelRef = React.useRef<monaco.editor.ITextModel | null>(null);
  const instanceIdRef = React.useRef<number>(diffEditorInstanceCounter += 1);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [editorFontSize, setEditorFontSize] = React.useState<number>(() => readResolvedEditorFontSize());

  const content = React.useMemo(() => buildDiffEditorContent(patch), [patch]);
  const language = React.useMemo(() => getMonacoLanguage(filePath), [filePath]);
  const totalCharacterCount = content.original.length + content.modified.length;
  const diffEditorLineHeight = React.useMemo(
    () => getMonacoInlineDiffLineHeight(editorFontSize),
    [editorFontSize],
  );
  const editorHeight = React.useMemo(() => {
    const visibleLineCount = Math.max(
      countEditorLines(content.original),
      countEditorLines(content.modified),
      1,
    );

    return Math.min(
      MAX_DIFF_PREVIEW_HEIGHT,
      Math.max(MIN_DIFF_PREVIEW_HEIGHT, visibleLineCount * diffEditorLineHeight),
    );
  }, [content.modified, content.original, diffEditorLineHeight]);

  React.useEffect(() => {
    const container = containerRef.current;
    if (!container || editorRef.current) {
      return;
    }

    try {
      ensureMonacoSetup();
      ensureMonacoThemes();
      const fontSize = readResolvedEditorFontSize();
      const editor = monaco.editor.createDiffEditor(container, {
        theme: getMonacoTheme(),
        'semanticHighlighting.enabled': true,
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
        cursorSmoothCaretAnimation: 'on',
        scrollBeyondLastLine: false,
        wordWrap: 'off',
        minimap: { enabled: false },
        overviewRulerLanes: 0,
        hideCursorInOverviewRuler: true,
        lineNumbers: 'on',
        fontSize,
        lineHeight: getMonacoInlineDiffLineHeight(fontSize),
        padding: {
          top: 0,
          bottom: 0,
        },
        fontFamily: readResolvedCodeFontFamily(),
        fontLigatures: readResolvedCodeFontLigatures(),
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
      ensureMonacoSetup();
      ensureMonacoThemes();
      monaco.editor.setTheme(getMonacoTheme());
      const fontSize = readResolvedEditorFontSize();
      setEditorFontSize(fontSize);
      editorRef.current?.updateOptions({
        fontFamily: readResolvedCodeFontFamily(),
        fontLigatures: readResolvedCodeFontLigatures(),
        fontSize,
        lineHeight: getMonacoInlineDiffLineHeight(fontSize),
        cursorSmoothCaretAnimation: 'on',
        'semanticHighlighting.enabled': true,
      });
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
      <div
        className={cn(
          'flex h-[360px] items-center justify-center rounded-xl bg-stone-100/85 px-4 text-center text-[13px] text-stone-500',
          className,
        )}
      >
        {errorMessage}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={cn('zeroade-inline-monaco-diff w-full overflow-hidden', className)}
      style={{ height: `${editorHeight}px` }}
    />
  );
};
