import * as React from 'react';
import {
  Cog,
  ChevronDown,
  ChevronRight,
  Ellipsis,
  Folder,
  FolderPlus,
  FolderOpen,
  Search,
  SquarePen,
} from 'lucide-react';
import type { ComponentType } from 'react';
import { ScrollArea } from '@renderer/components/ui/scroll-area';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@renderer/components/ui/dropdown-menu';
import { cn } from '@renderer/lib/cn';
import type { ThreadGroupView } from '@renderer/store/use-shell-state';

type ThreadIndicatorState = 'running' | 'completed';

interface SidebarProps {
  width: number;
  isResizing: boolean;
  selectedThreadId: string;
  isSettingsOpen: boolean;
  groups: ThreadGroupView[];
  threadIndicatorById: Record<string, ThreadIndicatorState>;
  onSelectThread: (threadId: string) => void;
  onCreateThread: () => void;
  onOpenFolder: () => void;
  onOpenCommandPalette: () => void;
  onCreateThreadInGroup: (workspaceId: string) => void;
  onRenameGroup: (workspaceId: string) => void;
  onRemoveGroup: (workspaceId: string) => void;
  onRenameThread: (threadId: string) => void;
  onRemoveThread: (threadId: string, currentTitle: string) => void;
  onOpenSettings: () => void;
}

const COLLAPSED_PROJECTS_KEY = 'zeroade.sidebar.collapsed-projects.v1';

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

export const Sidebar = ({
  width,
  isResizing,
  selectedThreadId,
  isSettingsOpen,
  groups,
  threadIndicatorById,
  onSelectThread,
  onCreateThread,
  onOpenFolder,
  onOpenCommandPalette,
  onCreateThreadInGroup,
  onRenameGroup,
  onRemoveGroup,
  onRenameThread,
  onRemoveThread,
  onOpenSettings,
}: SidebarProps): JSX.Element => {
  const [collapsedProjectIds, setCollapsedProjectIds] = React.useState<Set<string>>(() =>
    readCollapsedProjects(),
  );
  const [clockMs, setClockMs] = React.useState(() => Date.now());

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
    const availableWorkspaceIds = new Set(groups.map((group) => group.workspaceId));

    setCollapsedProjectIds((previous) => {
      const next = new Set(
        Array.from(previous).filter((workspaceId) => availableWorkspaceIds.has(workspaceId)),
      );

      if (areSetsEqual(previous, next)) {
        return previous;
      }

      return next;
    });
  }, [groups]);

  const toggleProject = React.useCallback((workspaceId: string) => {
    setCollapsedProjectIds((previous) => {
      const next = new Set(previous);

      if (next.has(workspaceId)) {
        next.delete(workspaceId);
      } else {
        next.add(workspaceId);
      }

      return next;
    });
  }, []);

  return (
    <aside
      style={{ width }}
      className={cn(
        'relative flex h-full flex-col border-r border-stone-200/55 bg-[rgba(249,250,252,0.02)] backdrop-blur-[1px] backdrop-saturate-125',
        !isResizing && 'transition-[width,opacity] duration-200',
      )}
    >
      <div className="px-3 pt-2.5">
        <SidebarAction icon={SquarePen} label="New thread" onClick={onCreateThread} />
        <SidebarAction icon={FolderOpen} label="Open" onClick={onOpenFolder} />
        <SidebarAction icon={Search} label="Search" onClick={onOpenCommandPalette} />
      </div>

      <div className="px-3 pb-1 pt-2">
        <div className="flex items-center justify-between px-1">
          <p className="text-[12px] font-semibold tracking-[0.01em] text-stone-600">Threads</p>
            <button
              type="button"
              aria-label="New project"
              title="New project"
              className={cn(
              'zeroade-sidebar-hover-shadow no-drag inline-flex h-6 w-6 items-center justify-center rounded-md',
              'text-stone-600 transition-colors hover:bg-white/55',
            )}
            onClick={onOpenFolder}
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
              Add a workspace..
            </button>
          </div>
        ) : (
          <div className="space-y-2 pt-1.5">
            {groups.map((group) => {
              const isCollapsed = collapsedProjectIds.has(group.workspaceId);

              return (
                <section key={group.id} className="group/project space-y-0.5">
                  <div
                    className={cn(
                      'zeroade-sidebar-hover-shadow no-drag group relative flex h-9 w-full items-center justify-between rounded-xl px-2 text-left transition-colors hover:bg-white/55',
                    )}
                  >
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-center gap-1.5 pr-8 text-left"
                      onClick={() => {
                        toggleProject(group.workspaceId);
                      }}
                    >
                      {isCollapsed ? (
                        <ChevronRight className="h-3.5 w-3.5 text-stone-500" />
                      ) : (
                        <ChevronDown className="h-3.5 w-3.5 text-stone-500" />
                      )}
                      {isCollapsed ? (
                        <Folder className="h-4 w-4 text-stone-500" />
                      ) : (
                        <FolderOpen className="h-4 w-4 text-stone-500" />
                      )}
                      <span
                        className={cn(
                          'truncate text-[13px] font-medium text-stone-700 transition-colors',
                        )}
                      >
                        {group.label}
                      </span>
                    </button>

                    <div className="absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            aria-label={`Project options for ${group.label}`}
                            className={cn(
                              'zeroade-sidebar-hover-shadow inline-flex h-6 w-6 items-center justify-center rounded-md text-stone-500 transition-all hover:bg-white/55 hover:text-stone-700',
                              'opacity-0 pointer-events-none group-hover/project:opacity-100 group-hover/project:pointer-events-auto',
                              'focus-visible:opacity-100 focus-visible:pointer-events-auto data-[state=open]:opacity-100 data-[state=open]:pointer-events-auto',
                            )}
                          >
                            <Ellipsis className="h-3.5 w-3.5" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-40">
                          <DropdownMenuItem onClick={() => onRenameGroup(group.workspaceId)}>
                            Rename
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-rose-600 focus:bg-rose-50"
                            onClick={() => onRemoveGroup(group.workspaceId)}
                          >
                            Remove
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>

                      <button
                        type="button"
                        aria-label={`Create new chat in ${group.label}`}
                        className={cn(
                          'zeroade-sidebar-hover-shadow inline-flex h-6 w-6 items-center justify-center rounded-md text-stone-500 transition-all hover:bg-white/55 hover:text-stone-700',
                          'opacity-0 pointer-events-none group-hover/project:opacity-100 group-hover/project:pointer-events-auto',
                          'focus-visible:opacity-100 focus-visible:pointer-events-auto',
                        )}
                        onClick={() => onCreateThreadInGroup(group.workspaceId)}
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
                      <div className="space-y-0.5">
                        {group.threads.map((thread) => (
                          <div key={thread.id} className="group/thread relative">
                            <button
                              type="button"
                              className={cn(
                                'zeroade-sidebar-hover-shadow no-drag flex w-full rounded-xl text-left transition-colors hover:bg-white/55',
                                'flex-col gap-0.5 py-1.5 pl-8 pr-9',
                                thread.id === selectedThreadId && 'bg-white/45',
                              )}
                              onClick={() => onSelectThread(thread.id)}
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
                                    'zeroade-sidebar-hover-shadow absolute right-1.5 top-1.5 inline-flex h-6 w-6 items-center justify-center rounded-md text-stone-500 transition-all hover:bg-white/55 hover:text-stone-700',
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
                                  <DropdownMenuItem
                                    onSelect={() => onRenameThread(thread.id)}
                                  >
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
                        ))}
                      </div>
                    </div>
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </ScrollArea>

      <div className="px-2.5 py-2">
        <button
          type="button"
          className={cn(
            'zeroade-sidebar-hover-shadow no-drag flex h-8 w-full items-center rounded-lg text-stone-600 transition-colors hover:bg-white/55',
            'gap-2 px-2.5 text-sm',
            isSettingsOpen && 'bg-white/45 text-stone-900',
          )}
          onClick={onOpenSettings}
        >
          <Cog className="h-4 w-4" />
          <span>Settings</span>
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
        'zeroade-sidebar-hover-shadow no-drag mb-0.5 flex w-full items-center rounded-lg text-stone-600 transition-colors hover:bg-white/55',
        'h-8 gap-2 px-2.5 text-sm',
      )}
    >
      <Icon className="h-4 w-4" />
      <span>{label}</span>
    </button>
  );
};
