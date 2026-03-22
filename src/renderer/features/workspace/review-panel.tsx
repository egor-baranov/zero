import * as React from 'react';
import { EllipsisVertical, X } from 'lucide-react';
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@renderer/components/ui/dropdown-menu';
import { SideBySideDiffView } from '@renderer/features/workspace/side-by-side-diff-view';
import { toFileIconComponent } from '@renderer/lib/code-language-icons';
import { cn } from '@renderer/lib/cn';
import type { ReviewFileState } from '@renderer/store/use-workspace-review';

interface ReviewPanelProps {
  open: boolean;
  loading: boolean;
  tabs: ReviewFileState[];
  activeFilePath: string | null;
  onSelectTab: (path: string) => void;
  onCloseTab: (path: string) => void;
  onReorderTabs: (sourcePath: string, targetPath: string) => void;
}

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

const getMonacoTheme = (): 'vs' | 'vs-dark' =>
  document.documentElement.dataset.zeroadeTheme === 'dark' ? 'vs-dark' : 'vs';

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

const getFileExtension = (fileName: string): string => {
  const parts = fileName.toLowerCase().split('.');
  if (parts.length < 2) {
    return '';
  }

  return parts.at(-1) ?? '';
};

const getMonacoLanguage = (fileName: string): string => {
  const extension = getFileExtension(fileName);

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

interface FileTypeIconProps {
  fileName: string;
}

const FileTypeIcon = ({ fileName }: FileTypeIconProps): JSX.Element => {
  const Icon = toFileIconComponent(fileName);
  return <Icon className="h-4 w-4 text-stone-500" />;
};

export const ReviewPanel = ({
  open,
  loading,
  tabs,
  activeFilePath,
  onSelectTab,
  onCloseTab,
  onReorderTabs,
}: ReviewPanelProps): JSX.Element => {
  const primaryEditorContainerRef = React.useRef<HTMLDivElement | null>(null);
  const secondaryEditorContainerRef = React.useRef<HTMLDivElement | null>(null);
  const editorsContainerRef = React.useRef<HTMLDivElement | null>(null);
  const primaryEditorRef = React.useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const secondaryEditorRef = React.useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const modelsRef = React.useRef<Map<string, monaco.editor.ITextModel>>(new Map());
  const editedContentByPathRef = React.useRef<Map<string, string>>(new Map());
  const splitResizeActiveRef = React.useRef(false);
  const [draggingTabPath, setDraggingTabPath] = React.useState<string | null>(null);
  const [dragOverTabPath, setDragOverTabPath] = React.useState<string | null>(null);
  const [dropSide, setDropSide] = React.useState<'left' | 'right' | null>(null);
  const [isSplitView, setIsSplitView] = React.useState(false);
  const [secondaryFilePath, setSecondaryFilePath] = React.useState<string | null>(null);
  const [rightPanePaths, setRightPanePaths] = React.useState<string[]>([]);
  const [splitRatio, setSplitRatio] = React.useState(SPLIT_RATIO_DEFAULT);
  const [isSplitResizing, setIsSplitResizing] = React.useState(false);
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

  const createEditor = React.useCallback((container: HTMLDivElement) => {
    const editor = monaco.editor.create(container, {
      value: '',
      language: 'plaintext',
      theme: getMonacoTheme(),
      readOnly: false,
      automaticLayout: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      renderLineHighlight: 'none',
      wordWrap: 'off',
      fontSize: 13,
      lineHeight: 21,
      lineNumbersMinChars: 3,
      padding: {
        top: 12,
        bottom: 12,
      },
      fontFamily: 'SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
      overviewRulerLanes: 0,
      hideCursorInOverviewRuler: true,
      scrollbar: {
        horizontalScrollbarSize: 8,
        verticalScrollbarSize: 8,
      },
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
    });

    return editor;
  }, []);

  const getModelForPath = React.useCallback(
    (path: string | null): monaco.editor.ITextModel => {
      const pathKey = path ?? EMPTY_MODEL_KEY;
      let model = modelsRef.current.get(pathKey);
      const nextValue = toEditorContent(path);
      const nextLanguage = getMonacoLanguage(getFileName(path));

      if (!model) {
      const uri = getModelUri(pathKey);
      model = monaco.editor.getModel(uri) ?? monaco.editor.createModel(nextValue, nextLanguage, uri);
      modelsRef.current.set(pathKey, model);
    }

    if (model.getValue() !== nextValue) {
      editedContentByPathRef.current.delete(pathKey);
      model.setValue(nextValue);
    }

      if (model.getLanguageId() !== nextLanguage) {
        monaco.editor.setModelLanguage(model, nextLanguage);
      }

      return model;
    },
    [toEditorContent],
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
          tabs.find((candidateTab) => candidateTab.id !== path && !nextRightPaths.includes(candidateTab.id))
            ?.id ??
          tabs.find((candidateTab) => candidateTab.id !== path)?.id;

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

      event.preventDefault();
      const side = getDropSideFromClientX(event.clientX);
      handleDropInPane(side, draggingTabPath);
      setDraggingTabPath(null);
      setDropSide(null);
      setDragOverTabPath(null);
    },
    [draggingTabPath, getDropSideFromClientX, handleDropInPane],
  );

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
      modelsRef.current.forEach((model) => {
        model.dispose();
      });
      modelsRef.current.clear();
      editedContentByPathRef.current.clear();
    };
  }, []);

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
    const keep = new Set(
      tabs.filter((tab) => tab.kind === 'file').map((tab) => tab.relativePath),
    );

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
    });
  }, [activeFileTab, effectiveSecondaryPath, tabs]);

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
  ): JSX.Element => (
    <div className="flex min-h-10 items-center bg-white/90">
      <div className="min-w-0 flex-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="flex w-max min-w-full items-center gap-2 px-2 pb-1.5 pt-0">
          {tabItems.map((tab) => {
            const tabName = getFileName(tab.relativePath);
            const isActive = tab.id === currentPath;

            return (
              <button
                key={tab.id}
                type="button"
                draggable
                className={cn(
                  'no-drag group flex h-8 max-w-[220px] shrink-0 items-center gap-1.5 rounded-[12px] bg-stone-50 px-3 text-[13px] text-stone-600 transition-colors hover:bg-stone-100 hover:text-stone-900',
                  isActive && 'bg-stone-200/75 text-stone-900',
                  draggingTabPath === tab.id && 'opacity-60',
                  dragOverTabPath === tab.id && draggingTabPath !== tab.id && 'bg-stone-200/65',
                )}
                onClick={() => onSelectPath(tab.id)}
                onDragStart={(event) => {
                  setDraggingTabPath(tab.id);
                  event.dataTransfer.effectAllowed = 'move';
                  event.dataTransfer.setData('text/plain', tab.id);
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  if (draggingTabPath && draggingTabPath !== tab.id) {
                    setDragOverTabPath(tab.id);
                  }
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  const sourcePath = draggingTabPath ?? event.dataTransfer.getData('text/plain');
                  if (!sourcePath || sourcePath === tab.id) {
                    return;
                  }

                  onReorderTabs(sourcePath, tab.id);
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
          <div
            ref={editorsContainerRef}
            className="flex h-full w-full min-w-0"
            onDragOver={handleEditorDragOver}
            onDrop={handleEditorDrop}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                setDropSide(null);
              }
            }}
          >
            <div
              className="flex min-h-0 shrink-0 flex-col overflow-hidden bg-[#fdfdff]"
              style={{
                width: isSplitView ? `${splitRatio * 100}%` : '100%',
              }}
            >
              {renderTabBar(isSplitView ? leftTabs : tabs, activeFilePath, onSelectTab, !isSplitView)}
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
                  {renderTabBar(rightTabs, effectiveSecondaryPath?.id ?? null, handleSelectSecondaryTab, true)}
                  <div className="min-h-0 flex-1">
                    <div ref={secondaryEditorContainerRef} className="h-full w-full" />
                  </div>
                </div>
              </>
            ) : null}
          </div>

          {draggingTabPath ? (
            <div className="no-drag pointer-events-none absolute inset-2 z-20 grid grid-cols-2 gap-2">
              <div
                className={cn(
                  'rounded-lg border-2 border-dashed border-stone-300/75 bg-stone-100/35',
                  dropSide === 'left' && 'border-stone-500/75 bg-stone-200/45',
                )}
              />
              <div
                className={cn(
                  'rounded-lg border-2 border-dashed border-stone-300/75 bg-stone-100/35',
                  dropSide === 'right' && 'border-stone-500/75 bg-stone-200/45',
                )}
              />
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
};
