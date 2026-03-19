import * as React from 'react';
import {
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  Search,
} from 'lucide-react';
import { ScrollArea } from '@renderer/components/ui/scroll-area';
import { toFileIconComponent } from '@renderer/lib/code-language-icons';
import { cn } from '@renderer/lib/cn';

interface FileTreeDialogProps {
  open: boolean;
  files: string[];
  loading: boolean;
  workspaceName: string;
  activeFilePath: string | null;
  onOpenFile: (path: string) => void;
  side?: 'left' | 'right';
}

interface TreeNode {
  type: 'file' | 'dir';
  name: string;
  path: string;
  children: TreeNode[];
}

interface MutableTreeNode {
  type: 'file' | 'dir';
  name: string;
  path: string;
  children: Map<string, MutableTreeNode>;
}

const FILE_TREE_WIDTH_KEY = 'zeroade.filetree.width';
const FILE_TREE_WIDTH_DEFAULT = 360;
const FILE_TREE_WIDTH_MIN = 300;
const FILE_TREE_WIDTH_MAX = 620;
const ROOT_NODE_PATH = '__workspace_root__';

const clampWidth = (value: number): number =>
  Math.min(Math.max(value, FILE_TREE_WIDTH_MIN), FILE_TREE_WIDTH_MAX);

const readStoredWidth = (): number => {
  const raw = window.localStorage.getItem(FILE_TREE_WIDTH_KEY);
  if (!raw) {
    return FILE_TREE_WIDTH_DEFAULT;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    return FILE_TREE_WIDTH_DEFAULT;
  }

  return clampWidth(parsed);
};

const sortByName = (left: string, right: string): number =>
  left.localeCompare(right, undefined, {
    sensitivity: 'base',
    numeric: true,
  });

const buildFileTree = (filePaths: string[]): TreeNode[] => {
  const root = new Map<string, MutableTreeNode>();

  for (const rawPath of filePaths) {
    const normalizedPath = rawPath
      .split('/')
      .map((segment) => segment.trim())
      .filter(Boolean)
      .join('/');

    if (!normalizedPath) {
      continue;
    }

    const segments = normalizedPath.split('/');
    let currentLevel = root;
    let parentPath = '';

    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index];
      const segmentPath = parentPath ? `${parentPath}/${segment}` : segment;
      const isLeaf = index === segments.length - 1;

      const existing = currentLevel.get(segment);
      if (existing) {
        if (!isLeaf) {
          existing.type = 'dir';
          currentLevel = existing.children;
          parentPath = segmentPath;
        }

        continue;
      }

      const nextNode: MutableTreeNode = {
        type: isLeaf ? 'file' : 'dir',
        name: segment,
        path: segmentPath,
        children: new Map<string, MutableTreeNode>(),
      };

      currentLevel.set(segment, nextNode);

      if (!isLeaf) {
        currentLevel = nextNode.children;
        parentPath = segmentPath;
      }
    }
  }

  const finalize = (level: Map<string, MutableTreeNode>): TreeNode[] => {
    const values = Array.from(level.values());
    values.sort((left, right) => {
      if (left.type === right.type) {
        return sortByName(left.name, right.name);
      }

      return left.type === 'dir' ? -1 : 1;
    });

    return values.map((node) => ({
      type: node.type,
      name: node.name,
      path: node.path,
      children: finalize(node.children),
    }));
  };

  return finalize(root);
};

export const FileTreeDialog = ({
  open,
  files,
  loading,
  workspaceName,
  activeFilePath,
  onOpenFile,
  side = 'right',
}: FileTreeDialogProps): JSX.Element => {
  const [query, setQuery] = React.useState('');
  const [isSearchVisible, setIsSearchVisible] = React.useState(false);
  const [expandedDirs, setExpandedDirs] = React.useState<Set<string>>(new Set());
  const [panelWidth, setPanelWidth] = React.useState(FILE_TREE_WIDTH_DEFAULT);
  const [isResizing, setIsResizing] = React.useState(false);
  const resizingRef = React.useRef(false);
  const panelRef = React.useRef<HTMLElement | null>(null);
  const searchInputRef = React.useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    setPanelWidth(readStoredWidth());
  }, []);

  React.useEffect(() => {
    if (!open) {
      setQuery('');
      setIsSearchVisible(false);
    }
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

      if (event.key === 'Escape' && isSearchVisible) {
        event.preventDefault();
        setQuery('');
        setIsSearchVisible(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isSearchVisible, open]);

  React.useEffect(() => {
    const handlePointerMove = (event: PointerEvent): void => {
      if (!resizingRef.current) {
        return;
      }

      const panelLeft = panelRef.current?.getBoundingClientRect().left ?? 0;
      const nextWidth =
        side === 'left'
          ? clampWidth(event.clientX - panelLeft)
          : clampWidth(window.innerWidth - event.clientX);
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
  }, [side]);

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

  const renderNode = React.useCallback(
    (node: TreeNode, depth: number): JSX.Element => {
      if (node.type === 'dir') {
        const isExpanded = normalizedQuery.length > 0 || expandedDirs.has(node.path);

        return (
          <div key={node.path}>
            <button
              type="button"
              className="no-drag flex h-8 w-full items-center gap-1.5 rounded-lg pr-2 text-left transition-colors hover:bg-stone-100"
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

            {isExpanded && <div>{node.children.map((child) => renderNode(child, depth + 1))}</div>}
          </div>
        );
      }

      const isActive = activeFilePath === node.path;

      return (
        <button
          type="button"
          key={node.path}
          className={cn(
            'no-drag flex h-8 w-full items-center gap-2 rounded-lg pr-2 text-left transition-colors hover:bg-stone-100',
            isActive && 'bg-stone-200/70',
          )}
          style={{ paddingLeft: `${depth * 18 + 22}px` }}
          onClick={() => {
            onOpenFile(node.path);
          }}
        >
          <FileTypeIcon fileName={node.name} />
          <span className="truncate text-sm text-stone-700">{node.name}</span>
        </button>
      );
    },
    [activeFilePath, expandedDirs, normalizedQuery.length, onOpenFile, toggleDirectory],
  );

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
        aria-label="Resize files panel"
        className={cn(
          'no-drag group absolute inset-y-0 z-10 w-2 cursor-col-resize',
          side === 'left' ? 'right-0 translate-x-full' : 'left-0 -translate-x-full',
          !open && 'pointer-events-none opacity-0',
        )}
        onPointerDown={startResizing}
      >
        <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors group-hover:bg-stone-300/70" />
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
  );
};

interface FileTypeIconProps {
  fileName: string;
}

const FileTypeIcon = ({ fileName }: FileTypeIconProps): JSX.Element => {
  const Icon = toFileIconComponent(fileName);
  return <Icon className="h-4 w-4 text-stone-500" />;
};
