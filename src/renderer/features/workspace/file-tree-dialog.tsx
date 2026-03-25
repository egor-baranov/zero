import * as React from 'react';
import { createPortal } from 'react-dom';
import {
  ClipboardPaste,
  ChevronDown,
  ChevronRight,
  Copy,
  Folder,
  FolderOpen,
  Link2,
  Pencil,
  Scissors,
  Search,
  Trash2,
} from 'lucide-react';
import { Button } from '@renderer/components/ui/button';
import { Dialog, DialogContent } from '@renderer/components/ui/dialog';
import { ScrollArea } from '@renderer/components/ui/scroll-area';
import { toFileIconComponent } from '@renderer/lib/code-language-icons';
import { cn } from '@renderer/lib/cn';
import { buildFileTree, type TreeNode } from '@renderer/features/workspace/file-tree-utils';

interface FileTreeDialogProps {
  open: boolean;
  files: string[];
  loading: boolean;
  workspacePath: string;
  workspaceName: string;
  activeFilePath: string | null;
  onOpenFile: (path: string) => void;
  onRefreshFiles: () => Promise<void>;
  onCollapse: () => void;
  onStatusText?: (text: string) => void;
  side?: 'left' | 'right';
}

interface TreeClipboardEntry {
  mode: 'copy' | 'cut';
  path: string;
  nodeType: TreeNode['type'];
  name: string;
}

interface ContextMenuState {
  node: TreeNode;
  x: number;
  y: number;
}

interface RenameTarget {
  path: string;
  name: string;
  type: TreeNode['type'];
}

interface DraggedTreeEntry {
  path: string;
  nodeType: TreeNode['type'];
  name: string;
}

const FILE_TREE_WIDTH_KEY = 'zeroade.filetree.width';
const FILE_TREE_WIDTH_DEFAULT = 360;
const FILE_TREE_WIDTH_OPEN = 250;
const FILE_TREE_WIDTH_MIN = 0;
const FILE_TREE_WIDTH_MAX = 760;
const FILE_TREE_COLLAPSE_THRESHOLD = 48;
const ROOT_NODE_PATH = '__workspace_root__';
const CONTEXT_MENU_WIDTH = 184;
const CONTEXT_MENU_ESTIMATED_HEIGHT = 236;

const clampWidth = (value: number, viewportWidth: number): number => {
  const maxFromViewport = Math.max(FILE_TREE_WIDTH_DEFAULT, Math.floor(viewportWidth * 0.7));
  return Math.min(
    FILE_TREE_WIDTH_MAX,
    Math.max(FILE_TREE_WIDTH_MIN, Math.min(value, maxFromViewport)),
  );
};

const readStoredWidth = (): number => {
  if (typeof window === 'undefined') {
    return FILE_TREE_WIDTH_DEFAULT;
  }

  const raw = window.localStorage.getItem(FILE_TREE_WIDTH_KEY);
  if (!raw) {
    return clampWidth(FILE_TREE_WIDTH_DEFAULT, window.innerWidth);
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return clampWidth(FILE_TREE_WIDTH_DEFAULT, window.innerWidth);
  }

  return clampWidth(parsed, window.innerWidth);
};

const sortByName = (left: string, right: string): number =>
  left.localeCompare(right, undefined, {
    sensitivity: 'base',
    numeric: true,
  });

const collectAncestorDirectoryPaths = (
  nodes: TreeNode[],
  targetPath: string,
): Set<string> => {
  const matchingPaths = new Set<string>();

  const visit = (entries: TreeNode[]): boolean => {
    for (const entry of entries) {
      if (entry.type === 'file') {
        if (entry.path === targetPath) {
          return true;
        }

        continue;
      }

      const isDirectAncestor = targetPath.startsWith(`${entry.path}/`);
      const containsTarget = isDirectAncestor || visit(entry.children);
      if (containsTarget) {
        matchingPaths.add(entry.path);
        return true;
      }
    }

    return false;
  };

  visit(nodes);
  return matchingPaths;
};

const normalizeTreePath = (value: string): string => value.replaceAll('\\', '/');

const toAbsoluteTreePath = (workspacePath: string, treePath: string): string => {
  const separator = window.desktop.platform === 'win32' ? '\\' : '/';
  const normalizedWorkspacePath = workspacePath.replace(/[\\/]+$/, '');
  const normalizedTreeSegments = normalizeTreePath(treePath)
    .split('/')
    .filter(Boolean);

  if (normalizedTreeSegments.length === 0) {
    return normalizedWorkspacePath;
  }

  return `${normalizedWorkspacePath}${separator}${normalizedTreeSegments.join(separator)}`;
};

const getParentTreePath = (value: string): string => {
  const normalized = normalizeTreePath(value);
  const lastSlashIndex = normalized.lastIndexOf('/');
  if (lastSlashIndex < 0) {
    return '';
  }

  return normalized.slice(0, lastSlashIndex);
};

const isSameOrDescendantPath = (candidate: string, target: string): boolean =>
  candidate === target || candidate.startsWith(`${target}/`);

const getDropDirectoryForNode = (node: TreeNode): string => {
  if (node.path === ROOT_NODE_PATH) {
    return '';
  }

  return node.type === 'dir' ? node.path : getParentTreePath(node.path);
};

const remapPathPrefix = (value: string, sourcePath: string, destinationPath: string): string => {
  if (value === sourcePath) {
    return destinationPath;
  }

  return `${destinationPath}/${value.slice(sourcePath.length + 1)}`;
};

const remapExpandedDirectoryPaths = (
  currentPaths: Set<string>,
  sourcePath: string,
  destinationPath: string,
): Set<string> => {
  const next = new Set<string>();

  for (const entry of currentPaths) {
    if (!isSameOrDescendantPath(entry, sourcePath)) {
      next.add(entry);
      continue;
    }

    next.add(remapPathPrefix(entry, sourcePath, destinationPath));
  }

  return next;
};

const removeExpandedDirectoryPaths = (
  currentPaths: Set<string>,
  targetPath: string,
): Set<string> => {
  const next = new Set<string>();

  for (const entry of currentPaths) {
    if (!isSameOrDescendantPath(entry, targetPath)) {
      next.add(entry);
    }
  }

  return next;
};

const writeTextToClipboard = async (value: string): Promise<void> => {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textArea = document.createElement('textarea');
  textArea.value = value;
  textArea.setAttribute('readonly', 'true');
  textArea.style.position = 'fixed';
  textArea.style.left = '-9999px';
  textArea.style.opacity = '0';
  document.body.appendChild(textArea);
  textArea.select();
  document.execCommand('copy');
  document.body.removeChild(textArea);
};

const toErrorMessage = (error: unknown, fallback: string): string => {
  const missingHandlerMessage =
    'Restart the app once to enable file tree rename/copy/paste/delete. The renderer updated, but the Electron main process has not reloaded the new file-operation handlers yet.';

  if (error instanceof Error && error.message.trim().length > 0) {
    if (error.message.includes("No handler registered for 'workspace:")) {
      return missingHandlerMessage;
    }

    return error.message.trim();
  }

  if (typeof error === 'string' && error.trim().length > 0) {
    if (error.includes("No handler registered for 'workspace:")) {
      return missingHandlerMessage;
    }

    return error.trim();
  }

  return fallback;
};

const isPasteTargetAvailable = (node: TreeNode, clipboardEntry: TreeClipboardEntry | null): boolean => {
  if (!clipboardEntry || node.path === ROOT_NODE_PATH) {
    return false;
  }

  const targetDirectory = getDropDirectoryForNode(node);
  return !(clipboardEntry.mode === 'cut' && targetDirectory === getParentTreePath(clipboardEntry.path));
};

const isDragDropTargetAvailable = (
  node: TreeNode,
  draggedEntry: DraggedTreeEntry | null,
): boolean => {
  if (!draggedEntry) {
    return false;
  }

  const sourcePath = normalizeTreePath(draggedEntry.path);
  const targetDirectory = getDropDirectoryForNode(node);
  if (targetDirectory === getParentTreePath(sourcePath)) {
    return false;
  }

  if (draggedEntry.nodeType === 'dir' && isSameOrDescendantPath(targetDirectory, sourcePath)) {
    return false;
  }

  return true;
};

const remapActiveFilePathAfterMove = (
  activeFilePath: string | null,
  sourcePath: string,
  destinationPath: string,
): string | null => {
  if (!activeFilePath) {
    return null;
  }

  if (!isSameOrDescendantPath(activeFilePath, sourcePath)) {
    return null;
  }

  return remapPathPrefix(activeFilePath, sourcePath, destinationPath);
};

export const FileTreeDialog = ({
  open,
  files,
  loading,
  workspacePath,
  workspaceName,
  activeFilePath,
  onOpenFile,
  onRefreshFiles,
  onCollapse,
  onStatusText,
  side = 'right',
}: FileTreeDialogProps): JSX.Element => {
  const [query, setQuery] = React.useState('');
  const [isSearchVisible, setIsSearchVisible] = React.useState(false);
  const [expandedDirs, setExpandedDirs] = React.useState<Set<string>>(new Set());
  const [panelWidth, setPanelWidth] = React.useState(FILE_TREE_WIDTH_DEFAULT);
  const [isResizing, setIsResizing] = React.useState(false);
  const [clipboardEntry, setClipboardEntry] = React.useState<TreeClipboardEntry | null>(null);
  const [contextMenuState, setContextMenuState] = React.useState<ContextMenuState | null>(null);
  const [isMutating, setIsMutating] = React.useState(false);
  const [renameTarget, setRenameTarget] = React.useState<RenameTarget | null>(null);
  const [renameValue, setRenameValue] = React.useState('');
  const [draggedEntry, setDraggedEntry] = React.useState<DraggedTreeEntry | null>(null);
  const [dropTargetPath, setDropTargetPath] = React.useState<string | null>(null);
  const resizingRef = React.useRef(false);
  const panelRef = React.useRef<HTMLElement | null>(null);
  const searchInputRef = React.useRef<HTMLInputElement | null>(null);
  const contextMenuRef = React.useRef<HTMLDivElement | null>(null);

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
      setQuery('');
      setIsSearchVisible(false);
      setContextMenuState(null);
      setRenameTarget(null);
      setDraggedEntry(null);
      setDropTargetPath(null);
      return;
    }

    const nextWidth = clampWidth(FILE_TREE_WIDTH_OPEN, window.innerWidth);
    setPanelWidth(nextWidth);
    window.localStorage.setItem(FILE_TREE_WIDTH_KEY, String(nextWidth));
  }, [open]);

  React.useEffect(() => {
    if (!open) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent): void => {
      const isFindShortcut =
        (event.metaKey || event.ctrlKey) &&
        !event.shiftKey &&
        !event.altKey &&
        event.key.toLowerCase() === 'f';

      if (isFindShortcut) {
        event.preventDefault();
        setIsSearchVisible(true);
        requestAnimationFrame(() => {
          searchInputRef.current?.focus();
          searchInputRef.current?.select();
        });
        return;
      }

      if (event.key === 'Escape') {
        if (contextMenuState) {
          event.preventDefault();
          setContextMenuState(null);
          return;
        }

        if (isSearchVisible) {
          event.preventDefault();
          setQuery('');
          setIsSearchVisible(false);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [contextMenuState, isSearchVisible, open]);

  React.useEffect(() => {
    if (!contextMenuState) {
      return;
    }

    const handlePointerDown = (event: PointerEvent): void => {
      if (contextMenuRef.current?.contains(event.target as Node)) {
        return;
      }

      setContextMenuState(null);
    };

    const closeMenu = (): void => {
      setContextMenuState(null);
    };

    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('blur', closeMenu);
    window.addEventListener('resize', closeMenu);

    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('blur', closeMenu);
      window.removeEventListener('resize', closeMenu);
    };
  }, [contextMenuState]);

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

      if (rawWidth <= FILE_TREE_COLLAPSE_THRESHOLD) {
        stopResizing();
        onCollapse();
        return;
      }

      const nextWidth = clampWidth(rawWidth, window.innerWidth);
      setPanelWidth(nextWidth);
      window.localStorage.setItem(FILE_TREE_WIDTH_KEY, String(nextWidth));
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
  }, [onCollapse, side]);

  const startResizing = React.useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    resizingRef.current = true;
    setIsResizing(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  const normalizedQuery = query.trim().toLowerCase();

  const sortedFiles = React.useMemo(() => {
    return [...files].sort(sortByName);
  }, [files]);

  const filteredFiles = React.useMemo(() => {
    if (normalizedQuery.length === 0) {
      return sortedFiles;
    }

    return sortedFiles.filter((file) => file.toLowerCase().includes(normalizedQuery));
  }, [normalizedQuery, sortedFiles]);

  const fullTree = React.useMemo(() => buildFileTree(sortedFiles), [sortedFiles]);
  const tree = React.useMemo(() => buildFileTree(filteredFiles), [filteredFiles]);

  const rootName = React.useMemo(
    () => workspaceName.trim() || 'workspace',
    [workspaceName],
  );

  const fullRootNode = React.useMemo<TreeNode>(
    () => ({
      type: 'dir',
      name: rootName,
      path: ROOT_NODE_PATH,
      children: fullTree,
    }),
    [fullTree, rootName],
  );

  const rootNode = React.useMemo<TreeNode>(
    () => ({
      type: 'dir',
      name: rootName,
      path: ROOT_NODE_PATH,
      children: tree,
    }),
    [rootName, tree],
  );

  React.useEffect(() => {
    if (!open) {
      return;
    }

    setExpandedDirs(new Set([ROOT_NODE_PATH]));
  }, [fullRootNode.path, open]);

  React.useEffect(() => {
    if (!open || !activeFilePath) {
      return;
    }

    const ancestorPaths = collectAncestorDirectoryPaths(fullTree, activeFilePath);
    if (ancestorPaths.size === 0) {
      return;
    }

    setExpandedDirs((previous) => {
      const next = new Set(previous);
      next.add(ROOT_NODE_PATH);
      ancestorPaths.forEach((entryPath) => {
        next.add(entryPath);
      });
      return next;
    });
  }, [activeFilePath, fullTree, open]);

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

  const closeContextMenu = React.useCallback(() => {
    setContextMenuState(null);
  }, []);

  React.useEffect(() => {
    if (!renameTarget) {
      setRenameValue('');
      return;
    }

    setRenameValue(renameTarget.name);
  }, [renameTarget]);

  const runMutation = React.useCallback(
    async (action: () => Promise<void>, fallbackErrorText: string) => {
      closeContextMenu();
      setIsMutating(true);

      try {
        await action();
      } catch (error) {
        window.alert(toErrorMessage(error, fallbackErrorText));
      } finally {
        setIsMutating(false);
      }
    },
    [closeContextMenu],
  );

  const handleCopyPath = React.useCallback(
    async (node: TreeNode) => {
      await runMutation(async () => {
        const absolutePath = toAbsoluteTreePath(workspacePath, node.path);
        await writeTextToClipboard(absolutePath);
        onStatusText?.(`Copied path ${absolutePath}`);
      }, 'Failed to copy path.');
    },
    [onStatusText, runMutation, workspacePath],
  );

  const handleCut = React.useCallback(
    (node: TreeNode) => {
      closeContextMenu();
      setClipboardEntry({
        mode: 'cut',
        path: node.path,
        nodeType: node.type,
        name: node.name,
      });
      onStatusText?.(`Cut ${node.name}`);
    },
    [closeContextMenu, onStatusText],
  );

  const handleCopy = React.useCallback(
    (node: TreeNode) => {
      closeContextMenu();
      setClipboardEntry({
        mode: 'copy',
        path: node.path,
        nodeType: node.type,
        name: node.name,
      });
      onStatusText?.(`Copied ${node.name}`);
    },
    [closeContextMenu, onStatusText],
  );

  const handlePaste = React.useCallback(
    async (targetNode: TreeNode) => {
      if (!clipboardEntry) {
        return;
      }

      const targetDirectory =
        targetNode.type === 'dir' ? targetNode.path : getParentTreePath(targetNode.path);
      const sourcePath = normalizeTreePath(clipboardEntry.path);
      const sourceName = sourcePath.split('/').filter(Boolean).at(-1) ?? sourcePath;
      const destinationPath = [targetDirectory, sourceName].filter(Boolean).join('/');

      await runMutation(async () => {
        if (clipboardEntry.mode === 'cut') {
          const result = await window.desktop.workspaceMoveEntry({
            workspacePath,
            sourcePath,
            destinationPath,
          });

          setClipboardEntry(null);
          if (clipboardEntry.nodeType === 'dir') {
            setExpandedDirs((previous) =>
              remapExpandedDirectoryPaths(previous, sourcePath, result.relativePath),
            );
          }
          const nextActiveFilePath = remapActiveFilePathAfterMove(
            activeFilePath,
            sourcePath,
            result.relativePath,
          );
          if (nextActiveFilePath) {
            onOpenFile(nextActiveFilePath);
          }
          onStatusText?.(`Moved ${clipboardEntry.name}`);
        } else {
          await window.desktop.workspaceCopyEntry({
            workspacePath,
            sourcePath,
            destinationPath,
          });
          onStatusText?.(`Copied ${clipboardEntry.name}`);
        }

        if (targetDirectory) {
          setExpandedDirs((previous) => {
            const next = new Set(previous);
            next.add(targetDirectory);
            return next;
          });
        }

        await onRefreshFiles();
      }, `Failed to paste ${clipboardEntry.name}.`);
    },
    [
      activeFilePath,
      clipboardEntry,
      onOpenFile,
      onRefreshFiles,
      onStatusText,
      runMutation,
      workspacePath,
    ],
  );

  const openRenameDialog = React.useCallback((node: TreeNode) => {
    closeContextMenu();
    setRenameTarget({
      path: node.path,
      name: node.name,
      type: node.type,
    });
  }, [closeContextMenu]);

  const handleRenameSave = React.useCallback(async () => {
    if (!renameTarget) {
      return;
    }

    const nextName = renameValue.trim();
    if (!nextName || nextName === renameTarget.name) {
      setRenameTarget(null);
      return;
    }

    if (nextName.includes('/') || nextName.includes('\\')) {
      window.alert('Name cannot include path separators.');
      return;
    }

    const sourcePath = normalizeTreePath(renameTarget.path);
    const destinationPath = [getParentTreePath(renameTarget.path), nextName].filter(Boolean).join('/');

    setRenameTarget(null);

    await runMutation(async () => {
      const result = await window.desktop.workspaceMoveEntry({
        workspacePath,
        sourcePath,
        destinationPath,
      });

      if (renameTarget.type === 'dir') {
        setExpandedDirs((previous) =>
          remapExpandedDirectoryPaths(previous, sourcePath, result.relativePath),
        );
      }
      const nextActiveFilePath = remapActiveFilePathAfterMove(
        activeFilePath,
        sourcePath,
        result.relativePath,
      );
      if (nextActiveFilePath) {
        onOpenFile(nextActiveFilePath);
      }

      await onRefreshFiles();
      onStatusText?.(`Renamed ${renameTarget.name} to ${nextName}`);
    }, `Failed to rename ${renameTarget.name}.`);
  }, [
    activeFilePath,
    onOpenFile,
    onRefreshFiles,
    onStatusText,
    renameTarget,
    renameValue,
    runMutation,
      workspacePath,
  ]);

  const handleDragStart = React.useCallback(
    (event: React.DragEvent<HTMLElement>, node: TreeNode) => {
      if (node.path === ROOT_NODE_PATH || isMutating) {
        event.preventDefault();
        return;
      }

      closeContextMenu();
      setDraggedEntry({
        path: node.path,
        nodeType: node.type,
        name: node.name,
      });
      setDropTargetPath(null);
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', node.path);
    },
    [closeContextMenu, isMutating],
  );

  const handleDragEnd = React.useCallback(() => {
    setDraggedEntry(null);
    setDropTargetPath(null);
  }, []);

  const handleDragOverTarget = React.useCallback(
    (event: React.DragEvent<HTMLElement>, node: TreeNode) => {
      if (!isDragDropTargetAvailable(node, draggedEntry)) {
        return;
      }

      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      setDropTargetPath(node.path);
    },
    [draggedEntry],
  );

  const handleDropOnTarget = React.useCallback(
    async (event: React.DragEvent<HTMLElement>, node: TreeNode) => {
      if (!draggedEntry || !isDragDropTargetAvailable(node, draggedEntry)) {
        return;
      }

      event.preventDefault();
      const sourcePath = normalizeTreePath(draggedEntry.path);
      const sourceName = sourcePath.split('/').filter(Boolean).at(-1) ?? sourcePath;
      const targetDirectory = getDropDirectoryForNode(node);
      const destinationPath = [targetDirectory, sourceName].filter(Boolean).join('/');

      setDropTargetPath(null);
      setDraggedEntry(null);

      await runMutation(async () => {
        const result = await window.desktop.workspaceMoveEntry({
          workspacePath,
          sourcePath,
          destinationPath,
        });

        if (draggedEntry.nodeType === 'dir') {
          setExpandedDirs((previous) =>
            remapExpandedDirectoryPaths(previous, sourcePath, result.relativePath),
          );
        }
        if (targetDirectory) {
          setExpandedDirs((previous) => {
            const next = new Set(previous);
            next.add(targetDirectory);
            return next;
          });
        }

        const nextActiveFilePath = remapActiveFilePathAfterMove(
          activeFilePath,
          sourcePath,
          result.relativePath,
        );
        if (nextActiveFilePath) {
          onOpenFile(nextActiveFilePath);
        }

        await onRefreshFiles();
        onStatusText?.(`Moved ${draggedEntry.name}`);
      }, `Failed to move ${draggedEntry.name}.`);
    },
    [
      activeFilePath,
      draggedEntry,
      onOpenFile,
      onRefreshFiles,
      onStatusText,
      runMutation,
      workspacePath,
    ],
  );

  const handleDelete = React.useCallback(
    async (node: TreeNode) => {
      const confirmed = window.confirm(
        `Delete ${node.type === 'dir' ? 'folder' : 'file'} "${node.name}"?`,
      );
      if (!confirmed) {
        closeContextMenu();
        return;
      }

      await runMutation(async () => {
        await window.desktop.workspaceDeleteEntry({
          workspacePath,
          targetPath: node.path,
        });

        if (node.type === 'dir') {
          setExpandedDirs((previous) => removeExpandedDirectoryPaths(previous, node.path));
        }
        if (clipboardEntry?.path === node.path) {
          setClipboardEntry(null);
        }

        await onRefreshFiles();
        onStatusText?.(`Deleted ${node.name}`);
      }, `Failed to delete ${node.name}.`);
    },
    [clipboardEntry?.path, closeContextMenu, onRefreshFiles, onStatusText, runMutation, workspacePath],
  );

  const openContextMenu = React.useCallback((event: React.MouseEvent, node: TreeNode) => {
    if (node.path === ROOT_NODE_PATH) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    setContextMenuState({
      node,
      x: event.clientX,
      y: event.clientY,
    });
  }, []);

  const renderNode = React.useCallback(
    (node: TreeNode, depth: number): JSX.Element => {
      const isDropTarget = dropTargetPath === node.path && isDragDropTargetAvailable(node, draggedEntry);
      const isDraggingNode = draggedEntry?.path === node.path;

      if (node.type === 'dir') {
        const isExpanded = normalizedQuery.length > 0 || expandedDirs.has(node.path);

        return (
          <div key={node.path}>
            <button
              type="button"
              draggable={node.path !== ROOT_NODE_PATH && !isMutating}
              className={cn(
                'no-drag flex h-8 w-full items-center gap-1.5 rounded-lg pr-2 text-left transition-colors hover:bg-stone-100',
                isDropTarget && 'bg-sky-50 ring-1 ring-inset ring-sky-300',
                isDraggingNode && 'opacity-50',
              )}
              style={{ paddingLeft: `${depth * 18 + 4}px` }}
              onClick={() => toggleDirectory(node.path)}
              onContextMenu={(event) => openContextMenu(event, node)}
              onDragStart={(event) => handleDragStart(event, node)}
              onDragEnd={handleDragEnd}
              onDragOver={(event) => handleDragOverTarget(event, node)}
              onDrop={(event) => {
                void handleDropOnTarget(event, node);
              }}
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

            {isExpanded && <div>{node.children.map((child) => renderNode(child, depth + 1))}</div>}
          </div>
        );
      }

      const isActive = activeFilePath === node.path;

      return (
        <button
          type="button"
          key={node.path}
          draggable={!isMutating}
          className={cn(
            'no-drag flex h-8 w-full items-center gap-2 rounded-lg pr-2 text-left transition-colors hover:bg-stone-100',
            isActive && 'bg-stone-200/70',
            isDraggingNode && 'opacity-50',
          )}
          style={{ paddingLeft: `${depth * 18 + 22}px` }}
          onClick={() => {
            onOpenFile(node.path);
          }}
          onContextMenu={(event) => openContextMenu(event, node)}
          onDragStart={(event) => handleDragStart(event, node)}
          onDragEnd={handleDragEnd}
        >
          <FileTypeIcon fileName={node.name} />
          <span className="truncate text-sm text-stone-700">{node.name}</span>
        </button>
      );
    },
    [
      activeFilePath,
      draggedEntry,
      dropTargetPath,
      expandedDirs,
      handleDragEnd,
      handleDragOverTarget,
      handleDragStart,
      handleDropOnTarget,
      isMutating,
      normalizedQuery.length,
      onOpenFile,
      openContextMenu,
      toggleDirectory,
    ],
  );

  const clampedMenuX = contextMenuState
    ? Math.max(12, Math.min(contextMenuState.x, window.innerWidth - CONTEXT_MENU_WIDTH - 12))
    : 0;
  const clampedMenuY = contextMenuState
    ? Math.max(12, Math.min(contextMenuState.y, window.innerHeight - CONTEXT_MENU_ESTIMATED_HEIGHT - 12))
    : 0;
  const contextTargetNode = contextMenuState?.node ?? null;

  return (
    <>
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
          aria-label="Resize files panel"
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
          {isSearchVisible && (
            <div className="px-3 pb-2 pt-2">
              <div className="flex items-center gap-2 rounded-xl border border-stone-200 bg-stone-50 px-3 py-2">
                <Search className="h-4 w-4 text-stone-500" />
                <input
                  ref={searchInputRef}
                  autoFocus={open}
                  placeholder="Filter files..."
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  className="w-full bg-transparent text-sm text-stone-700 placeholder:text-stone-400 focus:outline-none"
                />
              </div>
            </div>
          )}

          <ScrollArea className="min-h-0 flex-1 pb-3">
            <div className="pl-2 pr-0.5">
              {loading ? (
                <div className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-500">
                  Loading files...
                </div>
              ) : filteredFiles.length === 0 ? (
                <div className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-500">
                  No files found.
                </div>
              ) : (
                <div className="space-y-0.5 pb-2">{renderNode(rootNode, 0)}</div>
              )}
            </div>
          </ScrollArea>
        </div>
      </aside>

      {contextTargetNode
        ? createPortal(
            <div
              ref={contextMenuRef}
              style={{
                left: clampedMenuX,
                top: clampedMenuY,
              }}
              className="fixed z-50 min-w-[184px] overflow-hidden rounded-xl border border-stone-200 bg-white p-1 text-stone-700 shadow-[0_18px_36px_-22px_rgba(42,42,42,0.45)]"
            >
              <ContextMenuItem
                disabled={isMutating}
                onClick={() => {
                  void handleCopyPath(contextTargetNode);
                }}
                icon={Link2}
              >
                Copy Path
              </ContextMenuItem>
              <ContextMenuItem
                disabled={isMutating}
                onClick={() => handleCut(contextTargetNode)}
                icon={Scissors}
              >
                Cut
              </ContextMenuItem>
              <ContextMenuItem
                disabled={isMutating}
                onClick={() => handleCopy(contextTargetNode)}
                icon={Copy}
              >
                Copy
              </ContextMenuItem>
              <ContextMenuItem
                disabled={isMutating || !isPasteTargetAvailable(contextTargetNode, clipboardEntry)}
                onClick={() => {
                  void handlePaste(contextTargetNode);
                }}
                icon={ClipboardPaste}
              >
                Paste
              </ContextMenuItem>
              <ContextMenuItem
                disabled={isMutating}
                onClick={() => {
                  openRenameDialog(contextTargetNode);
                }}
                icon={Pencil}
              >
                Rename
              </ContextMenuItem>
              <ContextMenuItem
                disabled={isMutating}
                destructive
                onClick={() => {
                  void handleDelete(contextTargetNode);
                }}
                icon={Trash2}
              >
                Delete
              </ContextMenuItem>
            </div>,
            document.body,
          )
        : null}

      <Dialog
        open={renameTarget !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            setRenameTarget(null);
          }
        }}
      >
        <DialogContent className="no-drag max-w-[360px] rounded-[18px] p-0">
          <div className="px-4 pb-4 pt-4">
            <h2 className="text-[19px] font-semibold tracking-[-0.02em] text-stone-900">
              Rename {renameTarget?.type === 'dir' ? 'folder' : 'file'}
            </h2>

            <input
              autoFocus
              value={renameValue}
              onChange={(event) => setRenameValue(event.target.value)}
              onKeyDown={(event) => {
                const trimmedValue = renameValue.trim();
                const canSave =
                  Boolean(renameTarget) &&
                  trimmedValue.length > 0 &&
                  trimmedValue !== renameTarget.name;

                if (event.key === 'Enter' && canSave) {
                  event.preventDefault();
                  void handleRenameSave();
                }
              }}
              className="no-drag mt-2 h-10 w-full rounded-[10px] border border-stone-200 bg-white px-3 text-[14px] text-stone-900 focus:outline-none"
            />

            <div className="mt-3 flex items-center justify-end gap-2">
              <Button
                variant="ghost"
                className="h-8 rounded-[10px] px-3 text-[13px]"
                onClick={() => setRenameTarget(null)}
              >
                Cancel
              </Button>
              <Button
                className="h-8 rounded-[10px] bg-stone-900 px-4 text-[13px] font-semibold text-white hover:bg-stone-800 disabled:bg-stone-300"
                disabled={
                  !renameTarget ||
                  renameValue.trim().length === 0 ||
                  renameValue.trim() === renameTarget.name
                }
                onClick={() => {
                  void handleRenameSave();
                }}
              >
                Save
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};

interface FileTypeIconProps {
  fileName: string;
}

const FileTypeIcon = ({ fileName }: FileTypeIconProps): JSX.Element => {
  const Icon = toFileIconComponent(fileName);
  return <Icon className="h-4 w-4 text-stone-500" />;
};

interface ContextMenuItemProps {
  children: React.ReactNode;
  destructive?: boolean;
  disabled?: boolean;
  icon: React.ComponentType<{ className?: string }>;
  onClick: () => void;
}

const ContextMenuItem = ({
  children,
  destructive = false,
  disabled = false,
  icon: Icon,
  onClick,
}: ContextMenuItemProps): JSX.Element => (
  <button
    type="button"
    disabled={disabled}
    className={cn(
      'flex w-full select-none items-center rounded-lg px-2.5 py-2 text-left text-sm outline-none transition-colors',
      disabled
        ? 'cursor-not-allowed text-stone-400'
        : destructive
          ? 'text-rose-600 hover:bg-rose-50'
          : 'text-stone-700 hover:bg-stone-100',
    )}
    onClick={onClick}
  >
    <Icon className="mr-2 h-4 w-4 shrink-0" />
    {children}
  </button>
);
