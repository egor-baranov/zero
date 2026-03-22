import * as React from 'react';
import {
  Check,
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
} from 'lucide-react';
import { Button } from '@renderer/components/ui/button';
import { ScrollArea } from '@renderer/components/ui/scroll-area';
import { toFileIconComponent } from '@renderer/lib/code-language-icons';
import { cn } from '@renderer/lib/cn';
import { buildFileTree, type TreeNode } from '@renderer/features/workspace/file-tree-utils';
import type { WorkspaceGitStatusResult } from '@shared/types/workspace';

interface CommitPanelProps {
  open: boolean;
  workspacePath: string;
  activeFilePath: string | null;
  onOpenDiff: (path: string) => void;
  onRequestClose: () => void;
  onCommitted: (payload: { message: string; pushed: boolean }) => void;
  side?: 'left' | 'right';
}

const COMMIT_PANEL_WIDTH_KEY = 'zeroade.commitpanel.width';
const COMMIT_PANEL_WIDTH_DEFAULT = 360;
const COMMIT_PANEL_WIDTH_OPEN = 360;
const COMMIT_PANEL_WIDTH_MIN = 0;
const COMMIT_PANEL_WIDTH_MAX = 760;
const COMMIT_PANEL_COLLAPSE_THRESHOLD = 48;

const clampWidth = (value: number, viewportWidth: number): number => {
  const maxFromViewport = Math.max(
    COMMIT_PANEL_WIDTH_DEFAULT,
    Math.floor(viewportWidth * 0.7),
  );
  return Math.min(
    COMMIT_PANEL_WIDTH_MAX,
    Math.max(COMMIT_PANEL_WIDTH_MIN, Math.min(value, maxFromViewport)),
  );
};

const readStoredWidth = (): number => {
  if (typeof window === 'undefined') {
    return COMMIT_PANEL_WIDTH_DEFAULT;
  }

  const raw = window.localStorage.getItem(COMMIT_PANEL_WIDTH_KEY);
  if (!raw) {
    return clampWidth(COMMIT_PANEL_WIDTH_DEFAULT, window.innerWidth);
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return clampWidth(COMMIT_PANEL_WIDTH_DEFAULT, window.innerWidth);
  }

  return clampWidth(parsed, window.innerWidth);
};

const collectExpandedDirs = (nodes: TreeNode[]): Set<string> => {
  const paths = new Set<string>();

  const visit = (entries: TreeNode[]): void => {
    for (const entry of entries) {
      if (entry.type !== 'dir') {
        continue;
      }

      paths.add(entry.path);
      visit(entry.children);
    }
  };

  visit(nodes);
  return paths;
};

export const CommitPanel = ({
  open,
  workspacePath,
  activeFilePath,
  onOpenDiff,
  onRequestClose,
  onCommitted,
  side = 'left',
}: CommitPanelProps): JSX.Element => {
  const [panelWidth, setPanelWidth] = React.useState(COMMIT_PANEL_WIDTH_DEFAULT);
  const [isResizing, setIsResizing] = React.useState(false);
  const [status, setStatus] = React.useState<WorkspaceGitStatusResult | null>(null);
  const [isLoading, setIsLoading] = React.useState(false);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [message, setMessage] = React.useState('');
  const [errorText, setErrorText] = React.useState<string | null>(null);
  const [selectedPaths, setSelectedPaths] = React.useState<Set<string>>(new Set());
  const [expandedDirs, setExpandedDirs] = React.useState<Set<string>>(new Set());
  const resizingRef = React.useRef(false);
  const panelRef = React.useRef<HTMLElement | null>(null);

  React.useEffect(() => {
    setPanelWidth(readStoredWidth());
  }, []);

  React.useEffect(() => {
    const clampToViewport = (): void => {
      setPanelWidth((previous) => clampWidth(previous, window.innerWidth));
    };

    window.addEventListener('resize', clampToViewport);
    return () => {
      window.removeEventListener('resize', clampToViewport);
    };
  }, []);

  React.useEffect(() => {
    if (!open) {
      setMessage('');
      setErrorText(null);
      return;
    }

    const nextWidth = clampWidth(COMMIT_PANEL_WIDTH_OPEN, window.innerWidth);
    setPanelWidth(nextWidth);
    window.localStorage.setItem(COMMIT_PANEL_WIDTH_KEY, String(nextWidth));
  }, [open]);

  const loadStatus = React.useCallback(async () => {
    if (!open) {
      return;
    }

    if (!workspacePath) {
      setStatus(null);
      setSelectedPaths(new Set());
      setExpandedDirs(new Set());
      setErrorText('Open a project first.');
      return;
    }

    setIsLoading(true);
    setErrorText(null);

    try {
      const nextStatus = await window.desktop.workspaceGitStatus({
        workspacePath,
      });
      setStatus(nextStatus);
    } catch {
      setStatus(null);
      setSelectedPaths(new Set());
      setExpandedDirs(new Set());
      setErrorText('Failed to load changed files.');
    } finally {
      setIsLoading(false);
    }
  }, [open, workspacePath]);

  React.useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const changedPaths = React.useMemo(
    () => (status?.available ? status.fileStats.map((entry) => entry.path) : []),
    [status],
  );

  const tree = React.useMemo(() => buildFileTree(changedPaths), [changedPaths]);

  React.useEffect(() => {
    if (!open) {
      return;
    }

    setSelectedPaths(new Set());
    setExpandedDirs(collectExpandedDirs(tree));
  }, [changedPaths, open, tree]);

  React.useEffect(() => {
    const handlePointerMove = (event: PointerEvent): void => {
      if (!resizingRef.current) {
        return;
      }

      const panelLeft = panelRef.current?.getBoundingClientRect().left ?? 0;
      const rawWidth =
        side === 'left'
          ? event.clientX - panelLeft
          : window.innerWidth - event.clientX;

      if (rawWidth <= COMMIT_PANEL_COLLAPSE_THRESHOLD) {
        stopResizing();
        onRequestClose();
        return;
      }

      const nextWidth = clampWidth(rawWidth, window.innerWidth);
      setPanelWidth(nextWidth);
      window.localStorage.setItem(COMMIT_PANEL_WIDTH_KEY, String(nextWidth));
    };

    const stopResizing = (): void => {
      if (!resizingRef.current) {
        return;
      }

      resizingRef.current = false;
      setIsResizing(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', stopResizing);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', stopResizing);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [onRequestClose, side]);

  const startResizing = React.useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      resizingRef.current = true;
      setIsResizing(true);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    },
    [],
  );

  const toggleDirectory = React.useCallback((path: string) => {
    setExpandedDirs((previous) => {
      const next = new Set(previous);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const toggleFile = React.useCallback((path: string) => {
    setSelectedPaths((previous) => {
      const next = new Set(previous);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const handleCommit = React.useCallback(
    async (pushAfterCommit: boolean) => {
      const trimmedMessage = message.trim();
      const filePaths = Array.from(selectedPaths);

      if (!workspacePath || !status?.available || filePaths.length === 0 || trimmedMessage.length === 0) {
        return;
      }

      setIsSubmitting(true);
      setErrorText(null);

      try {
        const commitResult = await window.desktop.workspaceGitCommit({
          workspacePath,
          filePaths,
          message: trimmedMessage,
        });

        if (!commitResult.ok) {
          setErrorText(commitResult.error ?? 'Failed to commit selected changes.');
          return;
        }

        if (pushAfterCommit) {
          const pushResult = await window.desktop.workspaceGitPush({
            workspacePath,
          });

          if (!pushResult.ok) {
            await loadStatus();
            setErrorText(pushResult.error ?? 'Commit completed, but push failed.');
            return;
          }
        }

        onCommitted({
          message: trimmedMessage,
          pushed: pushAfterCommit,
        });
        onRequestClose();
      } finally {
        setIsSubmitting(false);
      }
    },
    [loadStatus, message, onCommitted, onRequestClose, selectedPaths, status, workspacePath],
  );

  const renderNode = React.useCallback(
    (node: TreeNode, depth: number): JSX.Element => {
      if (node.type === 'dir') {
        const isExpanded = expandedDirs.has(node.path);

        return (
          <div key={node.path}>
            <button
              type="button"
              className="no-drag flex h-8 w-full items-center gap-1.5 rounded-lg pr-2 text-left transition-colors hover:bg-stone-100/80"
              style={{ paddingLeft: `${depth * 18 + 4}px` }}
              onClick={() => toggleDirectory(node.path)}
            >
              {isExpanded ? (
                <ChevronDown className="h-3.5 w-3.5 text-stone-500" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5 text-stone-500" />
              )}
              {isExpanded ? (
                <FolderOpen className="h-4 w-4 text-stone-500" />
              ) : (
                <Folder className="h-4 w-4 text-stone-500" />
              )}
              <span className="truncate text-sm text-stone-700">{node.name}</span>
            </button>

            {isExpanded ? <div>{node.children.map((child) => renderNode(child, depth + 1))}</div> : null}
          </div>
        );
      }

      const checked = selectedPaths.has(node.path);
      const isActive = activeFilePath === node.path;

      return (
        <div
          key={node.path}
          className={cn(
            'no-drag flex h-8 w-full items-center gap-2 rounded-lg pr-2 transition-colors hover:bg-stone-100/80',
            isActive && 'bg-stone-200/70',
          )}
          style={{ paddingLeft: `${depth * 18 + 22}px` }}
        >
          <label className="cursor-pointer">
            <input
              type="checkbox"
              checked={checked}
              onChange={() => toggleFile(node.path)}
              className="peer sr-only"
            />
            <span
              className={cn(
                'inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] border bg-white text-transparent transition-colors',
                'border-stone-300 peer-focus-visible:ring-2 peer-focus-visible:ring-stone-300',
                checked && 'border-stone-900 bg-stone-900 text-white',
              )}
            >
              <Check className="h-3.5 w-3.5 stroke-[3]" />
            </span>
          </label>
          <button
            type="button"
            className="min-w-0 flex-1 text-left"
            onClick={() => onOpenDiff(node.path)}
          >
            <span className="flex min-w-0 items-center gap-2">
              <FileTypeIcon fileName={node.name} />
              <span className="truncate text-sm text-stone-700">{node.name}</span>
            </span>
          </button>
        </div>
      );
    },
    [activeFilePath, expandedDirs, onOpenDiff, selectedPaths, toggleDirectory, toggleFile],
  );

  const canSubmit =
    Boolean(workspacePath) &&
    Boolean(status?.available) &&
    selectedPaths.size > 0 &&
    message.trim().length > 0 &&
    !isSubmitting;

  return (
    <aside
      ref={panelRef}
      style={{ width: open ? panelWidth : 0 }}
      className={cn(
        'relative h-full shrink-0 overflow-hidden bg-[#fdfdfff2] backdrop-blur-xl transition-[width] duration-200 ease-out',
        side === 'left' ? 'border-r border-stone-200' : 'border-l border-stone-200',
        isResizing && 'transition-none',
        !open && 'border-transparent',
      )}
    >
      <button
        type="button"
        aria-label="Resize commit panel"
        className={cn(
          'no-drag group absolute inset-y-0 z-10 w-4 cursor-col-resize',
          side === 'left' ? 'right-0' : 'left-0',
          !open && 'pointer-events-none opacity-0',
        )}
        onPointerDown={startResizing}
      >
        <span
          className={cn(
            'absolute inset-y-0 w-px bg-transparent transition-colors group-hover:bg-stone-300/70',
            side === 'left' ? 'right-0' : 'left-0',
          )}
        />
      </button>

      <div
        className={cn(
          'flex h-full w-full flex-col transition-opacity duration-150',
          open ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
      >
        <div className="min-h-0 flex-1 overflow-hidden">
          <ScrollArea className="h-full">
            <div className="space-y-3 px-2 pb-3 pt-2.5">
              {isLoading ? (
                <div className="rounded-xl bg-stone-50 px-3 py-2 text-sm text-stone-500">
                  Loading changed files...
                </div>
              ) : !workspacePath ? (
                <div className="rounded-xl bg-stone-50 px-3 py-2 text-sm text-stone-500">
                  Open a project first.
                </div>
              ) : !status?.available ? (
                <div className="rounded-xl bg-stone-50 px-3 py-2 text-sm text-stone-500">
                  Current project is not a git repository.
                </div>
              ) : changedPaths.length === 0 ? (
                <div className="rounded-xl bg-stone-50 px-3 py-2 text-sm text-stone-500">
                  No changed files.
                </div>
              ) : (
                <div className="space-y-0.5 pb-2">{tree.map((node) => renderNode(node, 0))}</div>
              )}
            </div>
          </ScrollArea>
        </div>

        <div className="px-3 pb-3 pt-3">
          <div className="rounded-xl bg-stone-50 px-3 py-2">
            <input
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="Commit message"
              className="no-drag w-full bg-transparent text-[14px] text-stone-800 placeholder:text-stone-400 focus:outline-none"
            />
          </div>

          {errorText ? <p className="mt-2 text-[12px] text-rose-600">{errorText}</p> : null}

          <div className="mt-3 flex gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="h-9 flex-1 rounded-xl border-0 bg-stone-100 text-[13px] hover:bg-stone-200"
              disabled={!canSubmit}
              onClick={() => {
                void handleCommit(false);
              }}
            >
              Commit
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              className="h-9 flex-1 rounded-xl text-[13px]"
              disabled={!canSubmit}
              onClick={() => {
                void handleCommit(true);
              }}
            >
              Commit and push
            </Button>
          </div>
        </div>
      </div>
    </aside>
  );
};

interface FileTypeIconProps {
  fileName: string;
}

const FileTypeIcon = ({ fileName }: FileTypeIconProps): JSX.Element => {
  const Icon = toFileIconComponent(fileName);
  return <Icon className="h-4 w-4 text-stone-500" />;
};
