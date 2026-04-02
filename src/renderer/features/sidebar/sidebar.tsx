import * as React from 'react';
import {
  Bell,
  Check,
  Cog,
  Columns3,
  ChevronDown,
  ChevronRight,
  Ellipsis,
  Folder,
  FolderOpen,
  FolderPlus,
  Search,
  SquarePen,
} from 'lucide-react';
import type { ComponentType } from 'react';
import { ScrollArea } from '@renderer/components/ui/scroll-area';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@renderer/components/ui/dropdown-menu';
import { cn } from '@renderer/lib/cn';
import type {
  ThreadGroupView,
  WorkspaceScopeRecord,
} from '@renderer/store/use-shell-state';

type ThreadIndicatorState = 'running' | 'completed';

interface SidebarProps {
  width: number;
  isResizing: boolean;
  selectedThreadId: string;
  selectedWorkspaceId: string;
  selectedProjectId: string;
  isSettingsOpen: boolean;
  workspaces: WorkspaceScopeRecord[];
  groups: ThreadGroupView[];
  threadIndicatorById: Record<string, ThreadIndicatorState>;
  onSelectThread: (threadId: string) => void;
  onSelectWorkspace: (workspaceId: string) => void;
  onSelectProject: (projectId: string) => void;
  onCreateThread: () => void;
  onOpenFolder: () => void;
  onAddProjectToScope: () => void;
  onOpenCommandPalette: () => void;
  onCreateWorkspace: () => void;
  onOpenWorkspaceBoard: () => void;
  onCreateThreadInGroup: (projectId: string) => void;
  onRenameThread: (threadId: string) => void;
  onRemoveThread: (threadId: string, currentTitle: string) => void;
  onReorderProject: (
    sourceProjectId: string,
    targetProjectId: string,
    placement?: 'before' | 'after',
  ) => void;
  onReorderThread: (
    sourceThreadId: string,
    targetThreadId: string,
    placement?: 'before' | 'after',
  ) => void;
  onOpenSettings: () => void;
  unreadPushCount: number;
  isPushPanelOpen: boolean;
  onTogglePushPanel: () => void;
  isWorkspaceBoardOpen: boolean;
}

const COLLAPSED_PROJECTS_KEY = 'zeroade.sidebar.collapsed-projects.v2';

const readCollapsedProjects = (): Set<string> => {
  const raw = window.localStorage.getItem(COLLAPSED_PROJECTS_KEY);
  if (!raw) {
    return new Set();
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return new Set();
    }

    return new Set(parsed.filter((value): value is string => typeof value === 'string'));
  } catch {
    return new Set();
  }
};

const areSetsEqual = (left: Set<string>, right: Set<string>): boolean => {
  if (left.size !== right.size) {
    return false;
  }

  for (const value of left) {
    if (!right.has(value)) {
      return false;
    }
  }

  return true;
};

const formatRelativeTime = (updatedAtMs: number, nowMs: number): string => {
  if (!Number.isFinite(updatedAtMs) || updatedAtMs <= 0) {
    return '1m';
  }

  const diffMs = Math.max(0, nowMs - updatedAtMs);
  const totalMinutes = Math.max(1, Math.floor(diffMs / 60_000));

  if (totalMinutes < 60) {
    return `${totalMinutes}m`;
  }

  const totalHours = Math.floor(totalMinutes / 60);
  if (totalHours < 24) {
    return `${totalHours}h`;
  }

  const totalDays = Math.floor(totalHours / 24);
  if (totalDays < 7) {
    return `${totalDays}d`;
  }

  const totalWeeks = Math.floor(totalDays / 7);
  if (totalWeeks < 4) {
    return `${totalWeeks}w`;
  }

  const totalMonths = Math.max(1, Math.floor(totalDays / 30));
  return `${totalMonths}mo`;
};

const getVerticalInsertPlacement = (
  clientY: number,
  element: HTMLElement,
): 'before' | 'after' => {
  const bounds = element.getBoundingClientRect();
  return clientY <= bounds.top + bounds.height / 2 ? 'before' : 'after';
};

export const Sidebar = ({
  width,
  isResizing,
  selectedThreadId,
  selectedWorkspaceId,
  selectedProjectId,
  isSettingsOpen,
  workspaces,
  groups,
  threadIndicatorById,
  onSelectThread,
  onSelectWorkspace,
  onSelectProject,
  onCreateThread,
  onOpenFolder,
  onAddProjectToScope,
  onOpenCommandPalette,
  onCreateWorkspace,
  onOpenWorkspaceBoard,
  onCreateThreadInGroup,
  onRenameThread,
  onRemoveThread,
  onReorderProject,
  onReorderThread,
  onOpenSettings,
  unreadPushCount,
  isPushPanelOpen,
  onTogglePushPanel,
  isWorkspaceBoardOpen,
}: SidebarProps): JSX.Element => {
  const [collapsedProjectIds, setCollapsedProjectIds] = React.useState<Set<string>>(() =>
    readCollapsedProjects(),
  );
  const [clockMs, setClockMs] = React.useState(() => Date.now());
  const [draggingProjectId, setDraggingProjectId] = React.useState('');
  const [projectDropTarget, setProjectDropTarget] = React.useState<{
    projectId: string;
    placement: 'before' | 'after';
  } | null>(null);
  const [draggingThreadId, setDraggingThreadId] = React.useState('');
  const [threadDropTarget, setThreadDropTarget] = React.useState<{
    threadId: string;
    placement: 'before' | 'after';
  } | null>(null);
  const selectedWorkspace = workspaces.find((workspace) => workspace.id === selectedWorkspaceId);
  const workspaceLabel = selectedWorkspace?.name ?? 'No workspace';

  React.useEffect(() => {
    const intervalId = window.setInterval(() => {
      setClockMs(Date.now());
    }, 60_000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  React.useEffect(() => {
    window.localStorage.setItem(
      COLLAPSED_PROJECTS_KEY,
      JSON.stringify(Array.from(collapsedProjectIds)),
    );
  }, [collapsedProjectIds]);

  React.useEffect(() => {
    const availableProjectIds = new Set(groups.map((group) => group.projectId));

    setCollapsedProjectIds((previous) => {
      const next = new Set(
        Array.from(previous).filter((projectId) => availableProjectIds.has(projectId)),
      );

      if (areSetsEqual(previous, next)) {
        return previous;
      }

      return next;
    });
  }, [groups]);

  const toggleProject = React.useCallback((projectId: string) => {
    setCollapsedProjectIds((previous) => {
      const next = new Set(previous);

      if (next.has(projectId)) {
        next.delete(projectId);
      } else {
        next.add(projectId);
      }

      return next;
    });
  }, []);

  const clearProjectDragState = React.useCallback(() => {
    setDraggingProjectId('');
    setProjectDropTarget(null);
  }, []);

  const clearThreadDragState = React.useCallback(() => {
    setDraggingThreadId('');
    setThreadDropTarget(null);
  }, []);

  return (
    <aside
      style={{ width }}
      className={cn(
        'zeroade-sidebar-panel-surface relative flex h-full flex-col border-r border-r-[var(--zeroade-shell-divider)]',
        !isResizing && 'transition-[width,opacity] duration-200',
      )}
    >
      <div className="px-3 pt-2.5">
        <SidebarAction icon={SquarePen} label="New thread" onClick={onCreateThread} />
        <SidebarAction icon={FolderOpen} label="Open project" onClick={onOpenFolder} />
        <SidebarAction icon={Search} label="Search" onClick={onOpenCommandPalette} />
      </div>

      <div className="space-y-2 px-3 pb-1 pt-2">
        <div className="flex items-center justify-between px-1">
          <p className="text-[12px] font-semibold tracking-[0.01em] text-stone-600">Workspace</p>
          <button
            type="button"
            aria-label="Open workspace board"
            title="Open workspace board"
            className={cn(
              'zeroade-sidebar-hover-shadow zeroade-sidebar-hover-surface no-drag inline-flex h-6 w-6 items-center justify-center rounded-md',
              'text-stone-600 transition-colors',
              isWorkspaceBoardOpen && 'zeroade-sidebar-active-surface text-stone-900',
            )}
            onClick={onOpenWorkspaceBoard}
          >
            <Columns3 className="h-3.5 w-3.5" />
          </button>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={cn(
                'zeroade-sidebar-hover-shadow zeroade-sidebar-hover-surface no-drag flex h-9 w-full items-center justify-between rounded-xl px-3 text-left transition-colors',
                'text-stone-700',
              )}
            >
              <span className="flex min-w-0 items-center gap-2">
                <Folder className="h-4 w-4 shrink-0 text-stone-500" />
                <span className="truncate text-[13px] font-medium">{workspaceLabel}</span>
              </span>
              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-stone-500" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-[250px]">
            <DropdownMenuItem onSelect={() => onSelectWorkspace('')}>
              <span className="flex flex-1 items-center justify-between gap-3">
                <span>No workspace</span>
                {!selectedWorkspaceId ? <Check className="h-4 w-4" /> : null}
              </span>
            </DropdownMenuItem>
            {workspaces.length > 0 ? <DropdownMenuSeparator /> : null}
            {workspaces.map((workspace) => (
              <DropdownMenuItem
                key={workspace.id}
                onSelect={() => {
                  onSelectWorkspace(workspace.id);
                }}
              >
                <span className="flex min-w-0 flex-1 items-center justify-between gap-3">
                  <span className="min-w-0">
                    <span className="block truncate">{workspace.name}</span>
                    <span className="block truncate text-[11px] text-stone-500">
                      {workspace.projectIds.length} project
                      {workspace.projectIds.length === 1 ? '' : 's'}
                    </span>
                  </span>
                  {workspace.id === selectedWorkspaceId ? (
                    <Check className="h-4 w-4 shrink-0" />
                  ) : null}
                </span>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onCreateWorkspace}>
              <FolderPlus className="mr-2 h-3.5 w-3.5" />
              Create workspace
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="flex items-center justify-between px-1 pt-1">
          <p className="text-[12px] font-semibold tracking-[0.01em] text-stone-600">Projects</p>
          <button
            type="button"
            aria-label="Add project"
            title="Add project"
            className={cn(
              'zeroade-sidebar-hover-shadow zeroade-sidebar-hover-surface no-drag inline-flex h-6 w-6 items-center justify-center rounded-md',
              'text-stone-600 transition-colors',
            )}
            onClick={onAddProjectToScope}
          >
            <FolderPlus className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1 px-2.5 pb-3">
        {groups.length === 0 ? (
          <div className="flex min-h-full items-center justify-center">
            <button
              type="button"
              className={cn(
                'no-drag cursor-pointer rounded-md px-2 py-1 text-[14px] text-stone-500 transition-colors',
                'hover:text-stone-700 hover:underline underline-offset-2',
                'focus-visible:underline focus-visible:outline-none',
              )}
              onClick={onOpenFolder}
            >
              Open a project to get started
            </button>
          </div>
        ) : (
          <div className="space-y-2 pt-1.5">
            {groups.map((group) => {
              const isCollapsed = collapsedProjectIds.has(group.projectId);
              const isSelectedProject = group.projectId === selectedProjectId;
              const isDraggingProject = draggingProjectId === group.projectId;
              const isProjectDropTarget =
                projectDropTarget?.projectId === group.projectId &&
                draggingProjectId &&
                draggingProjectId !== group.projectId;

              return (
                <section key={group.id} className="space-y-0.5">
                  <div className="group/project-row flex items-center">
                    <div
                      title={group.path}
                      draggable
                      className={cn(
                        'zeroade-sidebar-hover-shadow zeroade-sidebar-hover-surface relative flex h-8 min-w-0 flex-1 items-center rounded-lg transition-[background-color,box-shadow,opacity] duration-150',
                        'cursor-grab active:cursor-grabbing',
                        isSelectedProject && 'zeroade-sidebar-active-surface text-stone-900',
                        isDraggingProject && 'opacity-55',
                        isProjectDropTarget &&
                          'bg-stone-100/90 shadow-[0_10px_24px_-20px_rgba(28,25,23,0.4)]',
                        isProjectDropTarget &&
                          (projectDropTarget?.placement === 'before'
                            ? 'shadow-[inset_0_2px_0_0_rgba(28,25,23,0.34),0_10px_24px_-20px_rgba(28,25,23,0.4)]'
                            : 'shadow-[inset_0_-2px_0_0_rgba(28,25,23,0.34),0_10px_24px_-20px_rgba(28,25,23,0.4)]'),
                      )}
                      onDragStart={(event) => {
                        setDraggingProjectId(group.projectId);
                        event.dataTransfer.effectAllowed = 'move';
                        event.dataTransfer.setData('text/plain', group.projectId);
                      }}
                      onDragOver={(event) => {
                        if (!draggingProjectId || draggingProjectId === group.projectId) {
                          return;
                        }

                        event.preventDefault();
                        event.stopPropagation();
                        const placement = getVerticalInsertPlacement(
                          event.clientY,
                          event.currentTarget,
                        );
                        setProjectDropTarget({
                          projectId: group.projectId,
                          placement,
                        });
                        onReorderProject(draggingProjectId, group.projectId, placement);
                      }}
                      onDrop={(event) => {
                        event.preventDefault();
                        event.stopPropagation();

                        const sourceProjectId =
                          draggingProjectId ?? event.dataTransfer.getData('text/plain');
                        if (!sourceProjectId || sourceProjectId === group.projectId) {
                          clearProjectDragState();
                          return;
                        }

                        onReorderProject(
                          sourceProjectId,
                          group.projectId,
                          getVerticalInsertPlacement(event.clientY, event.currentTarget),
                        );
                        clearProjectDragState();
                      }}
                      onDragLeave={() => {
                        if (projectDropTarget?.projectId === group.projectId) {
                          setProjectDropTarget(null);
                        }
                      }}
                      onDragEnd={clearProjectDragState}
                    >
                      <button
                        type="button"
                        aria-label={
                          isCollapsed ? `Expand ${group.label}` : `Collapse ${group.label}`
                        }
                        className="no-drag inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-l-lg text-stone-500 transition-colors hover:text-stone-700"
                        onClick={() => {
                          toggleProject(group.projectId);
                        }}
                      >
                        {isCollapsed ? (
                          <ChevronRight className="h-3.5 w-3.5" />
                        ) : (
                          <ChevronDown className="h-3.5 w-3.5" />
                        )}
                      </button>

                      <button
                        type="button"
                        className="no-drag flex h-8 min-w-0 flex-1 items-center gap-2 pr-10 text-left transition-colors"
                        onClick={() => {
                          onSelectProject(group.projectId);
                          toggleProject(group.projectId);
                        }}
                      >
                        {isCollapsed ? (
                          <Folder className="h-4 w-4 shrink-0 text-stone-500" />
                        ) : (
                          <FolderOpen className="h-4 w-4 shrink-0 text-stone-500" />
                        )}
                        <span className="truncate text-[13px] font-medium text-stone-700">
                          {group.label}
                        </span>
                      </button>

                      <button
                        type="button"
                        aria-label={`Create new chat in ${group.label}`}
                        className={cn(
                          'no-drag absolute right-0.5 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-stone-500 transition-all hover:text-stone-700',
                          'opacity-0 hover:opacity-100 group-hover/project-row:opacity-100',
                          'focus-visible:opacity-100 focus-visible:pointer-events-auto',
                        )}
                        onClick={() => onCreateThreadInGroup(group.projectId)}
                      >
                        <SquarePen className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  <div
                    className={cn(
                      'grid transition-[grid-template-rows,opacity,margin] duration-200 ease-out',
                      isCollapsed ? 'grid-rows-[0fr] opacity-0' : 'mt-1 grid-rows-[1fr] opacity-100',
                    )}
                  >
                    <div className="overflow-hidden">
                        {group.threads.length === 0 ? (
                          <div className="px-8 py-1.5 text-[12px] text-stone-400">No chats yet</div>
                        ) : (
                          <div className="space-y-0.5">
                          {group.threads.map((thread) => {
                            const isThreadDropTarget =
                              threadDropTarget?.threadId === thread.id &&
                              draggingThreadId &&
                              draggingThreadId !== thread.id;

                            return (
                            <div key={thread.id} className="group/thread relative">
                              <button
                                type="button"
                                draggable
                                className={cn(
                                  'zeroade-sidebar-hover-shadow zeroade-sidebar-hover-surface no-drag flex w-full rounded-xl text-left transition-colors',
                                  'flex-col gap-0.5 py-1.5 pl-8 pr-9 cursor-grab active:cursor-grabbing',
                                  thread.id === selectedThreadId && 'zeroade-sidebar-active-surface',
                                  isThreadDropTarget &&
                                    (threadDropTarget?.placement === 'before'
                                      ? 'shadow-[inset_0_2px_0_0_rgba(28,25,23,0.3)]'
                                      : 'shadow-[inset_0_-2px_0_0_rgba(28,25,23,0.3)]'),
                                )}
                                onClick={() => onSelectThread(thread.id)}
                                onDragStart={(event) => {
                                  setDraggingThreadId(thread.id);
                                  event.dataTransfer.effectAllowed = 'move';
                                  event.dataTransfer.setData('text/plain', thread.id);
                                }}
                                onDragOver={(event) => {
                                  if (!draggingThreadId || draggingThreadId === thread.id) {
                                    return;
                                  }

                                  event.preventDefault();
                                  event.stopPropagation();
                                  setThreadDropTarget({
                                    threadId: thread.id,
                                    placement: getVerticalInsertPlacement(
                                      event.clientY,
                                      event.currentTarget,
                                    ),
                                  });
                                }}
                                onDrop={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();

                                  const sourceThreadId =
                                    draggingThreadId ?? event.dataTransfer.getData('text/plain');
                                  if (!sourceThreadId || sourceThreadId === thread.id) {
                                    clearThreadDragState();
                                    return;
                                  }

                                  onReorderThread(
                                    sourceThreadId,
                                    thread.id,
                                    getVerticalInsertPlacement(event.clientY, event.currentTarget),
                                  );
                                  clearThreadDragState();
                                }}
                                onDragLeave={() => {
                                  if (threadDropTarget?.threadId === thread.id) {
                                    setThreadDropTarget(null);
                                  }
                                }}
                                onDragEnd={clearThreadDragState}
                              >
                                <div className="flex items-center gap-2">
                                  <p
                                    className={cn(
                                      'truncate text-[13px] font-medium text-stone-700',
                                      thread.id === selectedThreadId && 'text-stone-900',
                                    )}
                                  >
                                    {thread.title}
                                  </p>
                                </div>
                                <p
                                  className={cn(
                                    'line-clamp-1 text-[11px] text-stone-500',
                                    thread.id === selectedThreadId && 'text-stone-700',
                                  )}
                                >
                                  {thread.preview}
                                </p>
                              </button>

                              <span className="pointer-events-none absolute left-2 top-1/2 inline-flex h-4 w-4 -translate-y-1/2 items-center justify-center">
                                {threadIndicatorById[thread.id] === 'running' ? (
                                  <span className="h-3 w-3 animate-spin rounded-full border border-blue-500 border-t-transparent" />
                                ) : null}
                                {threadIndicatorById[thread.id] === 'completed' ? (
                                  <span className="h-2 w-2 rounded-full bg-blue-500" />
                                ) : null}
                              </span>

                              <span
                                className={cn(
                                  'absolute right-2 top-2 text-[10px] text-stone-500 transition-opacity duration-150',
                                  thread.id === selectedThreadId && 'text-stone-700',
                                  'group-hover/thread:opacity-0 group-focus-within/thread:opacity-0',
                                )}
                              >
                                {formatRelativeTime(thread.updatedAtMs, clockMs)}
                              </span>

                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <button
                                    type="button"
                                    aria-label={`Thread options for ${thread.title}`}
                                    className={cn(
                                      'zeroade-sidebar-hover-shadow zeroade-sidebar-hover-surface absolute right-1.5 top-1.5 inline-flex h-6 w-6 items-center justify-center rounded-md text-stone-500 transition-all hover:text-stone-700',
                                      'opacity-0 pointer-events-none group-hover/thread:opacity-100 group-hover/thread:pointer-events-auto',
                                      'group-focus-within/thread:opacity-100 group-focus-within/thread:pointer-events-auto',
                                      'focus-visible:opacity-100 focus-visible:pointer-events-auto data-[state=open]:opacity-100 data-[state=open]:pointer-events-auto',
                                    )}
                                    onClick={(event) => {
                                      event.stopPropagation();
                                    }}
                                  >
                                    <Ellipsis className="h-3.5 w-3.5" />
                                  </button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-40">
                                  <DropdownMenuItem onSelect={() => onRenameThread(thread.id)}>
                                    Rename
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    className="text-rose-600 focus:bg-rose-50"
                                    onSelect={() => onRemoveThread(thread.id, thread.title)}
                                  >
                                    Remove
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </ScrollArea>

      <div className="flex items-center gap-1.5 px-2.5 py-2">
        <button
          type="button"
          className={cn(
            'zeroade-sidebar-hover-shadow zeroade-sidebar-hover-surface no-drag flex h-8 flex-1 items-center rounded-lg text-stone-600 transition-colors',
            'gap-2 px-2.5 text-sm',
            isSettingsOpen && 'zeroade-sidebar-active-surface text-stone-900',
          )}
          onClick={onOpenSettings}
        >
          <Cog className="h-4 w-4" />
          <span>Settings</span>
        </button>

        <button
          type="button"
          aria-label="Notifications"
          className={cn(
            'zeroade-sidebar-hover-shadow zeroade-sidebar-hover-surface no-drag relative inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-stone-600 transition-colors',
            isPushPanelOpen && 'zeroade-sidebar-active-surface text-stone-900',
          )}
          onClick={onTogglePushPanel}
        >
          <Bell className="h-4 w-4" />
          {unreadPushCount > 0 ? (
            <span className="absolute -right-0.5 -top-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-stone-800 px-1 text-[10px] font-medium text-white">
              {unreadPushCount > 9 ? '9+' : unreadPushCount}
            </span>
          ) : null}
        </button>
      </div>
    </aside>
  );
};

interface SidebarActionProps {
  icon: ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
}

const SidebarAction = ({
  icon: Icon,
  label,
  onClick,
}: SidebarActionProps): JSX.Element => {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'zeroade-sidebar-hover-shadow zeroade-sidebar-hover-surface no-drag mb-0.5 flex w-full items-center rounded-lg text-stone-600 transition-colors',
        'h-8 gap-2 px-2.5 text-sm',
      )}
    >
      <Icon className="h-4 w-4" />
      <span>{label}</span>
    </button>
  );
};
