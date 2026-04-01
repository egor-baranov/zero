import * as React from 'react';
import { EllipsisVertical, X } from 'lucide-react';
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@renderer/components/ui/dropdown-menu';
import { SideBySideDiffView } from '@renderer/features/workspace/side-by-side-diff-view';
import {
  clearWorkspacePathDiagnostics,
  closeWorkspaceModelInLsp,
  ensureMonacoLsp,
  syncWorkspaceModelWithLsp,
} from '@renderer/lib/monaco-lsp';
import { attachPeekReferencesHeaderFormatter } from '@renderer/lib/monaco-peek-header';
import { toFileIconComponent } from '@renderer/lib/code-language-icons';
import { cn } from '@renderer/lib/cn';
import { ensureMonacoSetup, getMonacoLanguage } from '@renderer/lib/monaco-setup';
import { ensureMonacoThemes } from '@renderer/lib/monaco-theme';
import {
  getMonacoEditorLineHeight,
  readResolvedCodeFontFamily,
  readResolvedCodeFontLigatures,
  readResolvedEditorFontSize,
  readResolvedMonacoTheme,
} from '@renderer/store/ui-preferences';
import type { ReviewFileState } from '@renderer/store/use-workspace-review';

interface ReviewPanelProps {
  open: boolean;
  loading: boolean;
  workspacePath: string;
  tabs: ReviewFileState[];
  activeFilePath: string | null;
  revealLocation?: {
    requestId: number;
    relativePath: string;
    lineNumber: number;
    column: number;
    focusEditor?: boolean;
  } | null;
  onSelectTab: (path: string) => void;
  onCloseTab: (path: string) => void;
  onReorderTabs: (
    sourcePath: string,
    targetPath: string,
    placement?: 'before' | 'after',
  ) => void;
  onRefreshPath: (path: string) => Promise<void>;
  onStatusText?: (text: string) => void;
}

const getFileName = (filePath: string | null): string => {
  if (!filePath) {
    return 'No file selected';
  }

  return filePath.split('/').filter(Boolean).pop() ?? filePath;
};

const EMPTY_MODEL_KEY = '__zeroade_empty__';
const SPLIT_RATIO_DEFAULT = 0.5;
const SPLIT_RATIO_MIN = 0.28;
const SPLIT_RATIO_MAX = 0.72;

const clampSplitRatio = (value: number): number =>
  Math.min(Math.max(value, SPLIT_RATIO_MIN), SPLIT_RATIO_MAX);

const getMonacoTheme = (): string =>
  readResolvedMonacoTheme();

const getModelUri = (pathKey: string): monaco.Uri => {
  if (pathKey === EMPTY_MODEL_KEY) {
    return monaco.Uri.from({
      scheme: 'inmemory',
      path: '/zeroade-empty',
    });
  }

  const normalizedPath = pathKey.startsWith('/') ? pathKey : `/${pathKey}`;
  return monaco.Uri.from({
    scheme: 'file',
    path: normalizedPath,
  });
};

interface FileTypeIconProps {
  fileName: string;
}

const FileTypeIcon = ({ fileName }: FileTypeIconProps): JSX.Element => {
  const Icon = toFileIconComponent(fileName);
  return <Icon className="h-4 w-4 text-stone-500" />;
};

const isWithinReviewTabBar = (target: EventTarget | null): boolean =>
  target instanceof Element &&
  Boolean(target.closest('[data-review-tab-bar="true"]'));

const getTabInsertPlacement = (
  clientX: number,
  element: HTMLElement,
): 'before' | 'after' => {
  const bounds = element.getBoundingClientRect();
  return clientX <= bounds.left + bounds.width / 2 ? 'before' : 'after';
};

export const ReviewPanel = ({
  open,
  loading,
  workspacePath,
  tabs,
  activeFilePath,
  revealLocation = null,
  onSelectTab,
  onCloseTab,
  onReorderTabs,
}: ReviewPanelProps): JSX.Element => {
  const primaryEditorContainerRef = React.useRef<HTMLDivElement | null>(null);
  const secondaryEditorContainerRef = React.useRef<HTMLDivElement | null>(null);
  const editorsContainerRef = React.useRef<HTMLDivElement | null>(null);
  const primaryTabScrollerRef = React.useRef<HTMLDivElement | null>(null);
  const secondaryTabScrollerRef = React.useRef<HTMLDivElement | null>(null);
  const primaryEditorRef = React.useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const secondaryEditorRef = React.useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const tabButtonByPathRef = React.useRef<Map<string, HTMLButtonElement>>(new Map());
  const modelsRef = React.useRef<Map<string, monaco.editor.ITextModel>>(new Map());
  const editedContentByPathRef = React.useRef<Map<string, string>>(new Map());
  const lspSyncTimeoutByPathRef = React.useRef<Map<string, number>>(new Map());
  const lastHandledRevealRequestIdRef = React.useRef<number | null>(null);
  const splitResizeActiveRef = React.useRef(false);
  const [draggingTabPath, setDraggingTabPath] = React.useState<string | null>(null);
  const [dragOverTabPath, setDragOverTabPath] = React.useState<string | null>(null);
  const [dropSide, setDropSide] = React.useState<'left' | 'right' | null>(null);
  const [isSplitView, setIsSplitView] = React.useState(false);
  const [secondaryFilePath, setSecondaryFilePath] = React.useState<string | null>(null);
  const [rightPanePaths, setRightPanePaths] = React.useState<string[]>([]);
  const [splitRatio, setSplitRatio] = React.useState(SPLIT_RATIO_DEFAULT);
  const [isSplitResizing, setIsSplitResizing] = React.useState(false);
  const [isDarkEditorTheme, setIsDarkEditorTheme] = React.useState(
    () => getMonacoTheme() === 'zeroade-editor-dark',
  );
  const tabById = React.useMemo(
    () => new Map(tabs.map((tab) => [tab.id, tab])),
    [tabs],
  );
  const activeTab = React.useMemo(() => {
    if (!activeFilePath) {
      return tabs.at(-1) ?? null;
    }

    return tabById.get(activeFilePath) ?? tabs.at(-1) ?? null;
  }, [activeFilePath, tabById, tabs]);
  const activeFileTab = activeTab?.kind === 'file' ? activeTab : null;
  const fileContentByPath = React.useMemo(
    () =>
      Object.fromEntries(
        tabs
          .filter((tab) => tab.kind === 'file')
          .map((tab) => [tab.relativePath, tab.content]),
      ),
    [tabs],
  );

  const toEditorContent = React.useCallback(
    (path: string | null): string => {
      if (!path) {
        return 'No file selected.';
      }

      const editedValue = editedContentByPathRef.current.get(path);
      if (typeof editedValue === 'string') {
        return editedValue;
      }

      return fileContentByPath[path] ?? (loading ? 'Loading file content...' : '');
    },
    [fileContentByPath, loading],
  );

  const scheduleLspSyncForModel = React.useCallback(
    (model: monaco.editor.ITextModel | null): void => {
      if (!model || !workspacePath || workspacePath === '/') {
        return;
      }

      const pathKey = model.uri.path.replace(/^\/+/, '');
      if (!pathKey || pathKey === EMPTY_MODEL_KEY) {
        return;
      }

      const existingTimeout = lspSyncTimeoutByPathRef.current.get(pathKey);
      if (typeof existingTimeout === 'number') {
        window.clearTimeout(existingTimeout);
      }

      const timeoutId = window.setTimeout(() => {
        lspSyncTimeoutByPathRef.current.delete(pathKey);
        void syncWorkspaceModelWithLsp(workspacePath, model);
      }, 120);

      lspSyncTimeoutByPathRef.current.set(pathKey, timeoutId);
    },
    [workspacePath],
  );

  const createEditor = React.useCallback((container: HTMLDivElement) => {
    ensureMonacoSetup();
    ensureMonacoThemes();
    ensureMonacoLsp(workspacePath);
    const fontSize = readResolvedEditorFontSize();

    const editor = monaco.editor.create(container, {
      value: '',
      language: 'plaintext',
      theme: getMonacoTheme(),
      'semanticHighlighting.enabled': true,
      readOnly: false,
      automaticLayout: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      renderLineHighlight: 'none',
      wordWrap: 'off',
      fontSize,
      lineHeight: getMonacoEditorLineHeight(fontSize),
      lineNumbersMinChars: 3,
      cursorSmoothCaretAnimation: 'on',
      padding: {
        top: 12,
        bottom: 12,
      },
      fontFamily: readResolvedCodeFontFamily(),
      fontLigatures: readResolvedCodeFontLigatures(),
      overviewRulerLanes: 0,
      hideCursorInOverviewRuler: true,
      scrollbar: {
        horizontalScrollbarSize: 8,
        verticalScrollbarSize: 8,
      },
    });

    editor.addAction({
      id: 'zeroade.find-references',
      label: 'Find References',
      keybindings: [monaco.KeyMod.Shift | monaco.KeyCode.F12],
      contextMenuGroupId: 'navigation',
      contextMenuOrder: 1.6,
      run: (currentEditor) => {
        currentEditor.trigger('zeroade', 'editor.action.referenceSearch.trigger', null);
      },
    });

    const detachPeekReferencesHeaderFormatter = attachPeekReferencesHeaderFormatter(editor);
    editor.onDidDispose(() => {
      detachPeekReferencesHeaderFormatter();
    });

    editor.onDidChangeModelContent(() => {
      const model = editor.getModel();
      if (!model || model.uri.scheme !== 'file') {
        return;
      }

      const pathKey = model.uri.path.replace(/^\/+/, '');
      if (!pathKey || pathKey === EMPTY_MODEL_KEY) {
        return;
      }

      editedContentByPathRef.current.set(pathKey, model.getValue());
      scheduleLspSyncForModel(model);
    });

    return editor;
  }, [scheduleLspSyncForModel, workspacePath]);

  const getModelForPath = React.useCallback(
    (path: string | null): monaco.editor.ITextModel => {
      const pathKey = path ?? EMPTY_MODEL_KEY;
      let model = modelsRef.current.get(pathKey);
      const nextValue = toEditorContent(path);
      const nextLanguage = getMonacoLanguage(getFileName(path));

      if (!model) {
        const uri = getModelUri(pathKey);
        model =
          monaco.editor.getModel(uri) ?? monaco.editor.createModel(nextValue, nextLanguage, uri);
        modelsRef.current.set(pathKey, model);
        scheduleLspSyncForModel(model);
      }

      if (model.getValue() !== nextValue) {
        editedContentByPathRef.current.delete(pathKey);
        model.setValue(nextValue);
      }

      if (model.getLanguageId() !== nextLanguage) {
        monaco.editor.setModelLanguage(model, nextLanguage);
        scheduleLspSyncForModel(model);
      }

      return model;
    },
    [toEditorContent],
  );

  const setTabButtonRef = React.useCallback(
    (path: string) => (node: HTMLButtonElement | null) => {
      if (node) {
        tabButtonByPathRef.current.set(path, node);
        return;
      }

      tabButtonByPathRef.current.delete(path);
    },
    [],
  );

  const rightPanePathSet = React.useMemo(() => new Set(rightPanePaths), [rightPanePaths]);

  const leftTabs = React.useMemo(() => {
    if (!isSplitView) {
      return tabs;
    }

    return tabs.filter((tab) => !rightPanePathSet.has(tab.id));
  }, [isSplitView, rightPanePathSet, tabs]);

  const rightTabs = React.useMemo(() => {
    if (!isSplitView) {
      return [];
    }

    return tabs.filter(
      (tab) => tab.kind === 'file' && tab.id !== activeFilePath && rightPanePathSet.has(tab.id),
    );
  }, [activeFilePath, isSplitView, rightPanePathSet, tabs]);

  const effectiveSecondaryPath = React.useMemo<ReviewFileState | null>(() => {
    if (!isSplitView) {
      return null;
    }

    if (secondaryFilePath) {
      const nextTab = rightTabs.find((tab) => tab.id === secondaryFilePath) ?? null;
      if (nextTab) {
        return nextTab;
      }
    }

    return rightTabs[0] ?? null;
  }, [isSplitView, rightTabs, secondaryFilePath]);

  const scrollTabIntoView = React.useCallback(
    (container: HTMLDivElement | null, path: string | null) => {
      if (!container || !path) {
        return;
      }

      const button = tabButtonByPathRef.current.get(path);
      if (!button) {
        return;
      }

      const containerRect = container.getBoundingClientRect();
      const buttonRect = button.getBoundingClientRect();

      if (buttonRect.left < containerRect.left || buttonRect.right > containerRect.right) {
        button.scrollIntoView({
          block: 'nearest',
          inline: 'nearest',
        });
      }
    },
    [],
  );

  const stopSplitResizing = React.useCallback(() => {
    if (!splitResizeActiveRef.current) {
      return;
    }

    splitResizeActiveRef.current = false;
    setIsSplitResizing(false);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, []);

  const handleUnsplit = React.useCallback(() => {
    setIsSplitView(false);
    setSecondaryFilePath(null);
    setRightPanePaths([]);
    setDropSide(null);
  }, []);

  const startSplitResizing = React.useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    splitResizeActiveRef.current = true;
    setIsSplitResizing(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  const handleDropInPane = React.useCallback(
    (side: 'left' | 'right', path: string): void => {
      const droppedTab = tabById.get(path);
      if (!droppedTab) {
        return;
      }

      if (side === 'left') {
        setRightPanePaths((previous) => {
          const next = previous.filter((candidatePath) => candidatePath !== path);
          if (next.length === 0) {
            setIsSplitView(false);
            setSecondaryFilePath(null);
            return [];
          }

          if (secondaryFilePath === path) {
            setSecondaryFilePath(next[0] ?? null);
          }

          return next;
        });
        onSelectTab(path);
        return;
      }

      if (droppedTab.kind !== 'file') {
        handleUnsplit();
        onSelectTab(path);
        return;
      }

      const nextRightPaths = Array.from(
        new Set([...rightPanePaths.filter((candidatePath) => candidatePath !== activeFilePath), path]),
      );

      if (path === activeFilePath) {
        const nextPrimaryPath =
          tabs.find(
            (candidateTab) =>
              candidateTab.id !== path && !nextRightPaths.includes(candidateTab.id),
          )?.id ?? tabs.find((candidateTab) => candidateTab.id !== path)?.id;

        if (nextPrimaryPath) {
          onSelectTab(nextPrimaryPath);
        }
      }

      setIsSplitView(nextRightPaths.length > 0);
      setRightPanePaths(nextRightPaths);
      setSecondaryFilePath(path);
    },
    [activeFilePath, handleUnsplit, onSelectTab, rightPanePaths, secondaryFilePath, tabById, tabs],
  );

  const handleSelectSecondaryTab = React.useCallback(
    (path: string): void => {
      if (!isSplitView) {
        onSelectTab(path);
        return;
      }

      setSecondaryFilePath(path);
    },
    [isSplitView, onSelectTab],
  );

  const getDropSideFromClientX = React.useCallback(
    (clientX: number): 'left' | 'right' => {
      const bounds = editorsContainerRef.current?.getBoundingClientRect();
      if (!bounds) {
        return 'left';
      }

      const splitBoundary = bounds.left + bounds.width * (isSplitView ? splitRatio : 0.5);
      return clientX <= splitBoundary ? 'left' : 'right';
    },
    [isSplitView, splitRatio],
  );

  const handleEditorDragOver = React.useCallback(
    (event: React.DragEvent<HTMLDivElement>): void => {
      if (!draggingTabPath) {
        return;
      }

      if (isWithinReviewTabBar(event.target)) {
        setDropSide(null);
        return;
      }

      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      setDropSide(getDropSideFromClientX(event.clientX));
    },
    [draggingTabPath, getDropSideFromClientX],
  );

  const handleEditorDrop = React.useCallback(
    (event: React.DragEvent<HTMLDivElement>): void => {
      if (!draggingTabPath) {
        return;
      }

      if (isWithinReviewTabBar(event.target)) {
        return;
      }

      event.preventDefault();
      const side = getDropSideFromClientX(event.clientX);
      handleDropInPane(side, draggingTabPath);
      setDraggingTabPath(null);
      setDropSide(null);
      setDragOverTabPath(null);
    },
    [draggingTabPath, getDropSideFromClientX, handleDropInPane],
  );

  const handleEditorDragLeave = React.useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setDropSide(null);
    }
  }, []);

  React.useEffect(() => {
    if (activeTab?.kind === 'diff' && isSplitView) {
      handleUnsplit();
      return;
    }

    if (!isSplitView) {
      if (rightPanePaths.length > 0) {
        setRightPanePaths([]);
      }
      setDropSide(null);
      return;
    }

    const sanitizedRightPaths = rightPanePaths.filter(
      (path, index, currentPaths) =>
        path !== activeFilePath &&
        tabs.some((tab) => tab.id === path && tab.kind === 'file') &&
        currentPaths.indexOf(path) === index,
    );

    if (sanitizedRightPaths.length !== rightPanePaths.length) {
      setRightPanePaths(sanitizedRightPaths);
      return;
    }

    if (!leftTabs.length || !sanitizedRightPaths.length || !effectiveSecondaryPath) {
      setIsSplitView(false);
      setSecondaryFilePath(null);
      setRightPanePaths([]);
      return;
    }

    if (secondaryFilePath !== effectiveSecondaryPath.id) {
      setSecondaryFilePath(effectiveSecondaryPath.id);
    }
  }, [
    activeTab?.kind,
    activeFilePath,
    effectiveSecondaryPath,
    handleUnsplit,
    isSplitView,
    leftTabs.length,
    rightPanePaths,
    secondaryFilePath,
    tabs,
  ]);

  React.useEffect(() => {
    const handlePointerMove = (event: PointerEvent): void => {
      if (!splitResizeActiveRef.current) {
        return;
      }

      const bounds = editorsContainerRef.current?.getBoundingClientRect();
      if (!bounds || bounds.width <= 0) {
        return;
      }

      const nextRatio = clampSplitRatio((event.clientX - bounds.left) / bounds.width);
      setSplitRatio(nextRatio);
    };

    const stopResizing = (): void => {
      stopSplitResizing();
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', stopResizing);
    window.addEventListener('pointercancel', stopResizing);
    window.addEventListener('blur', stopResizing);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', stopResizing);
      window.removeEventListener('pointercancel', stopResizing);
      window.removeEventListener('blur', stopResizing);
      stopSplitResizing();
    };
  }, [stopSplitResizing]);

  React.useEffect(() => {
    ensureMonacoLsp(workspacePath);
  }, [workspacePath]);

  React.useLayoutEffect(() => {
    const primaryPath = activeFilePath ?? tabs.at(-1)?.id ?? null;
    scrollTabIntoView(primaryTabScrollerRef.current, primaryPath);
  }, [activeFilePath, scrollTabIntoView, tabs]);

  React.useLayoutEffect(() => {
    if (!isSplitView) {
      return;
    }

    scrollTabIntoView(secondaryTabScrollerRef.current, effectiveSecondaryPath?.id ?? null);
  }, [effectiveSecondaryPath?.id, isSplitView, scrollTabIntoView]);

  React.useEffect(() => {
    const applyTheme = (): void => {
      const nextTheme = getMonacoTheme();
      setIsDarkEditorTheme(nextTheme === 'zeroade-editor-dark');
      ensureMonacoSetup();
      ensureMonacoThemes();
      monaco.editor.setTheme(nextTheme);
      const fontSize = readResolvedEditorFontSize();
      const nextOptions = {
        fontFamily: readResolvedCodeFontFamily(),
        fontLigatures: readResolvedCodeFontLigatures(),
        fontSize,
        lineHeight: getMonacoEditorLineHeight(fontSize),
        cursorSmoothCaretAnimation: 'on' as const,
        'semanticHighlighting.enabled': true as const,
      };
      primaryEditorRef.current?.updateOptions(nextOptions);
      secondaryEditorRef.current?.updateOptions(nextOptions);
    };

    applyTheme();
    window.addEventListener('zeroade-ui-preferences-changed', applyTheme);

    return () => {
      window.removeEventListener('zeroade-ui-preferences-changed', applyTheme);
    };
  }, []);

  React.useEffect(() => {
    const container = primaryEditorContainerRef.current;
    if (!container || primaryEditorRef.current) {
      return;
    }

    primaryEditorRef.current = createEditor(container);
    return () => {
      primaryEditorRef.current?.dispose();
      primaryEditorRef.current = null;
    };
  }, [createEditor]);

  React.useEffect(() => {
    if (!isSplitView) {
      secondaryEditorRef.current?.dispose();
      secondaryEditorRef.current = null;
      return;
    }

    const container = secondaryEditorContainerRef.current;
    if (!container || secondaryEditorRef.current) {
      return;
    }

    secondaryEditorRef.current = createEditor(container);
    return () => {
      secondaryEditorRef.current?.dispose();
      secondaryEditorRef.current = null;
    };
  }, [createEditor, isSplitView]);

  React.useEffect(() => {
    return () => {
      lspSyncTimeoutByPathRef.current.forEach((timeoutId) => {
        window.clearTimeout(timeoutId);
      });
      lspSyncTimeoutByPathRef.current.clear();
      modelsRef.current.forEach((model) => {
        void closeWorkspaceModelInLsp(workspacePath, model);
        model.dispose();
      });
      modelsRef.current.clear();
      editedContentByPathRef.current.clear();
    };
  }, [workspacePath]);

  React.useEffect(() => {
    const editor = primaryEditorRef.current;
    if (!editor) {
      return;
    }

    const model = getModelForPath(activeFileTab?.relativePath ?? null);
    if (editor.getModel() !== model) {
      editor.setModel(model);
    }
  }, [activeFilePath, activeFileTab, getModelForPath]);

  React.useEffect(() => {
    const editor = primaryEditorRef.current;
    if (
      !editor ||
      !revealLocation ||
      lastHandledRevealRequestIdRef.current === revealLocation.requestId ||
      activeFileTab?.relativePath !== revealLocation.relativePath
    ) {
      return;
    }

    const model = editor.getModel();
    if (!model) {
      return;
    }

    const safeLineNumber = Math.min(
      Math.max(revealLocation.lineNumber, 1),
      Math.max(model.getLineCount(), 1),
    );
    const safeColumn = Math.min(
      Math.max(revealLocation.column, 1),
      model.getLineMaxColumn(safeLineNumber),
    );
    const position = {
      lineNumber: safeLineNumber,
      column: safeColumn,
    };

    editor.setPosition(position);
    editor.setSelection(new monaco.Selection(safeLineNumber, safeColumn, safeLineNumber, safeColumn));
    editor.revealPositionInCenter(position, monaco.editor.ScrollType.Smooth);
    if (revealLocation.focusEditor !== false) {
      editor.focus();
    }
    lastHandledRevealRequestIdRef.current = revealLocation.requestId;
  }, [activeFileTab?.relativePath, revealLocation]);

  React.useEffect(() => {
    if (!isSplitView || !effectiveSecondaryPath) {
      return;
    }

    const editor = secondaryEditorRef.current;
    if (!editor) {
      return;
    }

    const model = getModelForPath(effectiveSecondaryPath.relativePath);
    if (editor.getModel() !== model) {
      editor.setModel(model);
    }
  }, [effectiveSecondaryPath, getModelForPath, isSplitView]);

  React.useEffect(() => {
    primaryEditorRef.current?.layout();
    secondaryEditorRef.current?.layout();
  }, [isSplitView, splitRatio]);

  React.useEffect(() => {
    const keep = new Set(tabs.filter((tab) => tab.kind === 'file').map((tab) => tab.relativePath));

    if (!activeFileTab) {
      keep.add(EMPTY_MODEL_KEY);
    }

    if (effectiveSecondaryPath) {
      keep.add(effectiveSecondaryPath.relativePath);
    }

    modelsRef.current.forEach((model, key) => {
      if (keep.has(key)) {
        return;
      }

      model.dispose();
      modelsRef.current.delete(key);
      editedContentByPathRef.current.delete(key);
      clearWorkspacePathDiagnostics(key);
      void closeWorkspaceModelInLsp(workspacePath, model);
    });
  }, [activeFileTab, effectiveSecondaryPath, tabs, workspacePath]);

  React.useEffect(() => {
    if (!tabs.length) {
      setIsSplitView(false);
      setSecondaryFilePath(null);
      setRightPanePaths([]);
      return;
    }
  }, [activeFilePath, tabs]);

  if (!open) {
    return <></>;
  }

  const optionsMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="File view options"
          className="inline-flex h-7 w-7 items-center justify-center rounded-full text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700"
        >
          <EllipsisVertical className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuItem
          disabled={!isSplitView}
          onSelect={() => {
            if (isSplitView) {
              handleUnsplit();
            }
          }}
        >
          Unsplit
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const renderTabBar = (
    tabItems: ReviewFileState[],
    currentPath: string | null,
    onSelectPath: (path: string) => void,
    showOptions: boolean,
    scrollerRef: React.RefObject<HTMLDivElement | null>,
  ): JSX.Element => (
    <div data-review-tab-bar="true" className="flex min-h-10 items-center bg-white/90">
      <div
        ref={scrollerRef}
        className="min-w-0 flex-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <div className="flex w-max min-w-full items-center gap-2 px-2 pb-1.5 pt-0">
          {tabItems.map((tab) => {
            const tabName = getFileName(tab.relativePath);
            const isActive = tab.id === currentPath;

            return (
              <button
                key={tab.id}
                ref={setTabButtonRef(tab.id)}
                type="button"
                draggable
                className={cn(
                  'no-drag group flex h-8 max-w-[220px] shrink-0 items-center gap-1.5 rounded-[12px] px-3 text-[13px] transition-colors',
                  isDarkEditorTheme
                    ? 'bg-white/[0.04] text-stone-300 hover:bg-white/[0.08] hover:text-stone-100'
                    : 'bg-stone-50 text-stone-600 hover:bg-stone-100 hover:text-stone-900',
                  isActive &&
                    (isDarkEditorTheme
                      ? 'bg-white/[0.14] text-stone-100'
                      : 'bg-stone-200/75 text-stone-900'),
                  draggingTabPath === tab.id && 'opacity-60',
                  dragOverTabPath === tab.id &&
                    draggingTabPath !== tab.id &&
                    (isDarkEditorTheme ? 'bg-white/[0.08]' : 'bg-stone-200/65'),
                )}
                onClick={() => onSelectPath(tab.id)}
                onDragStart={(event) => {
                  setDraggingTabPath(tab.id);
                  event.dataTransfer.effectAllowed = 'move';
                  event.dataTransfer.setData('text/plain', tab.id);
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  if (draggingTabPath && draggingTabPath !== tab.id) {
                    setDragOverTabPath(tab.id);
                    onReorderTabs(
                      draggingTabPath,
                      tab.id,
                      getTabInsertPlacement(event.clientX, event.currentTarget),
                    );
                  }
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  const sourcePath = draggingTabPath ?? event.dataTransfer.getData('text/plain');
                  if (!sourcePath || sourcePath === tab.id) {
                    return;
                  }

                  onReorderTabs(
                    sourcePath,
                    tab.id,
                    getTabInsertPlacement(event.clientX, event.currentTarget),
                  );
                }}
                onDragEnd={() => {
                  setDraggingTabPath(null);
                  setDragOverTabPath(null);
                  setDropSide(null);
                }}
                onDragLeave={() => {
                  if (dragOverTabPath === tab.id) {
                    setDragOverTabPath(null);
                  }
                }}
                title={tab.relativePath}
              >
                <FileTypeIcon fileName={tabName} />
                <span className="truncate">{tabName}</span>
                <span
                  role="button"
                  tabIndex={0}
                  className="inline-flex h-3.5 w-3 items-center justify-center rounded text-stone-400 opacity-0 transition group-hover:opacity-100 hover:bg-stone-300/70 hover:text-stone-700"
                  onClick={(event) => {
                    event.stopPropagation();
                    onCloseTab(tab.id);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      event.stopPropagation();
                      onCloseTab(tab.id);
                    }
                  }}
                >
                  <X className="h-[11px] w-[11px]" />
                </span>
              </button>
            );
          })}
        </div>
      </div>
      {showOptions ? (
        <div className="no-drag flex h-full w-11 shrink-0 items-center justify-center">{optionsMenu}</div>
      ) : null}
    </div>
  );

  return (
    <section className="flex h-full w-full min-w-0 flex-col">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[#fdfdff]">
        <div className="relative min-h-0 flex-1 bg-[#fdfdff] px-2 pb-2 pt-0">
          <div ref={editorsContainerRef} className="flex h-full w-full min-w-0">
            <div
              className="flex min-h-0 shrink-0 flex-col overflow-hidden bg-[#fdfdff]"
              style={{
                width: isSplitView ? `${splitRatio * 100}%` : '100%',
              }}
            >
              {renderTabBar(
                isSplitView ? leftTabs : tabs,
                activeFilePath,
                onSelectTab,
                !isSplitView,
                primaryTabScrollerRef,
              )}
              <div className="min-h-0 flex-1">
                <div
                  ref={primaryEditorContainerRef}
                  className={cn('h-full w-full', activeTab?.kind === 'diff' && 'hidden')}
                />
                {activeTab?.kind === 'diff' ? (
                  <SideBySideDiffView
                    filePath={activeTab.relativePath}
                    originalContent={activeTab.originalContent ?? ''}
                    modifiedContent={activeTab.modifiedContent ?? ''}
                    patch={activeTab.patch ?? ''}
                  />
                ) : null}
              </div>
            </div>

            {isSplitView ? (
              <>
                <button
                  type="button"
                  className={cn(
                    'no-drag group relative w-2 shrink-0 cursor-col-resize',
                    isSplitResizing && 'bg-stone-200/70',
                  )}
                  onPointerDown={startSplitResizing}
                  onDoubleClick={handleUnsplit}
                  aria-label="Resize split view"
                  title="Drag to resize; double-click to unsplit"
                >
                  <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors group-hover:bg-stone-300/80" />
                </button>
                <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[#fdfdff]">
                  {renderTabBar(
                    rightTabs,
                    effectiveSecondaryPath?.id ?? null,
                    handleSelectSecondaryTab,
                    true,
                    secondaryTabScrollerRef,
                  )}
                  <div className="min-h-0 flex-1">
                    <div ref={secondaryEditorContainerRef} className="h-full w-full" />
                  </div>
                </div>
              </>
            ) : null}
          </div>

          {draggingTabPath ? (
            <div
              className="no-drag absolute inset-x-2 bottom-2 top-12 z-20"
              onDragOver={handleEditorDragOver}
              onDrop={handleEditorDrop}
              onDragLeave={handleEditorDragLeave}
            >
              {dropSide ? (
                <div className="pointer-events-none grid h-full grid-cols-2 gap-2">
                  <div
                    className={cn(
                      'rounded-[16px] border border-solid border-stone-300/65 bg-white/20 backdrop-blur-[1px]',
                      dropSide === 'left' &&
                        'border-stone-400/90 bg-stone-100/45 shadow-[0_0_0_1px_rgba(255,255,255,0.48)_inset]',
                    )}
                  />
                  <div
                    className={cn(
                      'rounded-[16px] border border-solid border-stone-300/65 bg-white/20 backdrop-blur-[1px]',
                      dropSide === 'right' &&
                        'border-stone-400/90 bg-stone-100/45 shadow-[0_0_0_1px_rgba(255,255,255,0.48)_inset]',
                    )}
                  />
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
};
