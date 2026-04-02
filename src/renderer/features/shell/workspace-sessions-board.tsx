import * as React from 'react';
import {
  Archive as ArchiveIcon,
  Check,
  ChevronDown,
  Circle,
  Columns3,
  Eye,
  Loader2,
  Play,
  SquarePen,
} from 'lucide-react';
import { Button } from '@renderer/components/ui/button';
import { cn } from '@renderer/lib/cn';
import {
  THREAD_BOARD_COLUMNS,
  type ThreadBoardStatus,
  type ThreadGroupView,
} from '@renderer/store/use-shell-state';

type ThreadIndicatorState = 'running' | 'completed';
type InsertPlacement = 'before' | 'after';
type BoardThread = ThreadGroupView['threads'][number];

interface WorkspaceSessionsBoardProps {
  hasWorkspaceSelected: boolean;
  groups: ThreadGroupView[];
  selectedThreadId: string;
  threadAgentBadgeById: Record<
    string,
    {
      label: string;
      iconUrl: string | null;
    }
  >;
  threadIndicatorById: Record<string, ThreadIndicatorState>;
  onSelectThread: (threadId: string) => void;
  onCreateThread: (projectId: string) => void;
  onMoveThread: (input: {
    threadId: string;
    targetStatus: ThreadBoardStatus;
    targetThreadId?: string;
    placement?: InsertPlacement;
  }) => void;
  onCreateWorkspace: () => void;
}

const STATUS_GRID_CLASS = 'grid min-w-[1080px] grid-cols-[repeat(4,minmax(240px,1fr))] gap-3';

const getToolbarIcon = (status: ThreadBoardStatus): JSX.Element => {
  switch (status) {
    case 'open':
      return <Circle className="h-4.5 w-4.5" />;
    case 'in_progress':
      return <Play className="h-4.5 w-4.5" />;
    case 'review':
      return <Eye className="h-4.5 w-4.5" />;
    case 'archive':
      return <ArchiveIcon className="h-4.5 w-4.5" />;
  }
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
): InsertPlacement => {
  const bounds = element.getBoundingClientRect();
  return clientY <= bounds.top + bounds.height / 2 ? 'before' : 'after';
};

const createEmptyThreadMap = (): Record<ThreadBoardStatus, BoardThread[]> => ({
  open: [],
  in_progress: [],
  review: [],
  archive: [],
});

const ThreadAgentBadge = ({
  label,
  iconUrl,
}: {
  label: string;
  iconUrl: string | null;
}): JSX.Element => {
  return (
    <span title={label} className="inline-flex h-5 w-5 shrink-0 items-center justify-center">
      {iconUrl ? (
        <img
          src={iconUrl}
          alt={`${label} icon`}
          className="zeroade-agent-icon-image h-full w-full object-contain"
        />
      ) : null}
    </span>
  );
};

export const WorkspaceSessionsBoard = ({
  hasWorkspaceSelected,
  groups,
  selectedThreadId,
  threadAgentBadgeById,
  threadIndicatorById,
  onSelectThread,
  onCreateThread,
  onMoveThread,
  onCreateWorkspace,
}: WorkspaceSessionsBoardProps): JSX.Element => {
  const [clockMs, setClockMs] = React.useState(() => Date.now());
  const [draggingThreadId, setDraggingThreadId] = React.useState('');
  const [collapsedProjectIds, setCollapsedProjectIds] = React.useState<Set<string>>(() => new Set());
  const [dropTarget, setDropTarget] = React.useState<{
    projectId: string;
    status: ThreadBoardStatus;
    threadId?: string;
    placement?: InsertPlacement;
  } | null>(null);

  React.useEffect(() => {
    const intervalId = window.setInterval(() => {
      setClockMs(Date.now());
    }, 60_000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  const clearDragState = React.useCallback(() => {
    setDraggingThreadId('');
    setDropTarget(null);
  }, []);

  React.useEffect(() => {
    const availableProjectIds = new Set(groups.map((group) => group.projectId));

    setCollapsedProjectIds((previous) => {
      const next = new Set(
        Array.from(previous).filter((projectId) => availableProjectIds.has(projectId)),
      );

      if (next.size === previous.size) {
        let unchanged = true;
        for (const projectId of previous) {
          if (!next.has(projectId)) {
            unchanged = false;
            break;
          }
        }

        if (unchanged) {
          return previous;
        }
      }

      return next;
    });
  }, [groups]);

  const threadById = React.useMemo(() => {
    const map = new Map<string, BoardThread>();

    for (const group of groups) {
      for (const thread of group.threads) {
        map.set(thread.id, thread);
      }
    }

    return map;
  }, [groups]);

  const projectRows = React.useMemo(
    () =>
      groups.map((group) => {
        const threadsByStatus = createEmptyThreadMap();
        for (const thread of group.threads) {
          threadsByStatus[thread.status].push(thread);
        }

        return {
          ...group,
          threadsByStatus,
          hasSelectedThread: group.threads.some((thread) => thread.id === selectedThreadId),
        };
      }),
    [groups, selectedThreadId],
  );

  const canAcceptDrop = React.useCallback(
    (projectId: string): boolean => {
      if (!draggingThreadId) {
        return false;
      }

      return threadById.get(draggingThreadId)?.projectId === projectId;
    },
    [draggingThreadId, threadById],
  );

  const toggleProjectCollapsed = React.useCallback((projectId: string) => {
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

  if (!hasWorkspaceSelected) {
    return (
      <div className="flex h-full min-h-0 flex-col px-2 pb-4 pt-2">
        <div className="flex flex-1 items-center justify-center">
          <div className="w-full max-w-[560px] rounded-[32px] border border-stone-200 bg-white/80 p-8 text-center shadow-[0_32px_80px_-48px_rgba(28,25,23,0.42)]">
            <span className="mx-auto inline-flex h-14 w-14 items-center justify-center rounded-[20px] border border-stone-200 bg-stone-50 text-stone-700">
              <Columns3 className="h-6 w-6" />
            </span>
            <h1 className="mt-5 text-[32px] font-semibold tracking-[-0.03em] text-stone-900">
              Workspace board
            </h1>
            <p className="mt-3 text-[14px] leading-[1.6] text-stone-500">
              Pick a workspace to see projects as lanes and move threads through each status.
            </p>
            <Button
              type="button"
              variant="primary"
              className="mt-6 rounded-[14px] px-5"
              onClick={onCreateWorkspace}
            >
              Create workspace
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col px-2 pb-4 pt-2">
      {projectRows.length === 0 ? (
        <div className="flex flex-1 items-center justify-center rounded-[28px] border border-dashed border-stone-300 bg-stone-50/70 px-6 text-center">
          <div>
            <p className="text-[18px] font-semibold tracking-[-0.02em] text-stone-900">
              No projects in this workspace yet
            </p>
            <p className="mt-2 text-[13px] text-stone-500">
              Add a project to start grouping threads here.
            </p>
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto pb-2">
          <div className="space-y-6 pr-2">
            <div className="sticky top-0 z-10">
              <div
                className={cn(
                  STATUS_GRID_CLASS,
                  'px-3 pb-1',
                )}
              >
                {THREAD_BOARD_COLUMNS.map((column, columnIndex) => (
                  <div
                    key={column.id}
                    className="relative flex items-center justify-center gap-3 px-2 py-1 text-[22px] font-bold tracking-[-0.03em] text-stone-800"
                  >
                    {columnIndex < THREAD_BOARD_COLUMNS.length - 1 ? (
                      <span className="pointer-events-none absolute -right-1.5 bottom-1 top-1 w-px bg-stone-200" />
                    ) : null}
                    <span className="text-stone-500">{getToolbarIcon(column.id)}</span>
                    {column.label}
                  </div>
                ))}
              </div>
            </div>

            {projectRows.map((group) => (
              <section key={group.id} className="px-3 pt-2">
                {(() => {
                  const isCollapsed = collapsedProjectIds.has(group.projectId);

                  return (
                    <>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-[22px] border border-stone-200 bg-white px-4 py-3.5">
                  <div
                    className={cn(
                      'flex min-w-0 items-center gap-3',
                    )}
                  >
                    <button
                      type="button"
                      aria-label={isCollapsed ? `Expand ${group.label}` : `Collapse ${group.label}`}
                      className="no-drag inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-stone-500 transition-colors hover:text-stone-800"
                      onClick={() => {
                        toggleProjectCollapsed(group.projectId);
                      }}
                    >
                      <ChevronDown
                        className={cn(
                          'h-4 w-4 transition-transform duration-200 ease-out',
                          isCollapsed ? '-rotate-90' : 'rotate-0',
                        )}
                      />
                    </button>

                      <div className="min-w-0 flex items-center gap-3">
                        <p className="truncate text-[18px] font-semibold tracking-[-0.02em] text-stone-900">
                          {group.label}
                        </p>
                        <p
                          className="truncate text-[12px] leading-[1.55] text-stone-500"
                          title={group.path}
                        >
                          {group.path}
                        </p>
                      </div>
                  </div>

                  <Button
                    type="button"
                    size="icon"
                    variant="outline"
                    aria-label={`Create thread in ${group.label}`}
                    title="New thread"
                    className="h-9 w-9 rounded-[12px] border-stone-200 bg-white text-stone-600 hover:border-stone-300 hover:bg-white hover:text-stone-800"
                    onClick={() => onCreateThread(group.projectId)}
                  >
                    <SquarePen className="h-3.5 w-3.5" />
                  </Button>
                </div>

                <div
                  className={cn(
                    'grid overflow-hidden transition-[grid-template-rows,opacity,margin] duration-200 ease-out',
                    isCollapsed ? 'mb-0 grid-rows-[0fr] opacity-0' : 'mb-0 grid-rows-[1fr] opacity-100',
                  )}
                >
                  <div className="min-h-0 overflow-hidden">
                  <div className={STATUS_GRID_CLASS}>
                  {THREAD_BOARD_COLUMNS.map((column, columnIndex) => {
                    const laneThreads = group.threadsByStatus[column.id];
                    const canDropInLane = canAcceptDrop(group.projectId);
                    const isLaneDropTarget =
                      dropTarget?.projectId === group.projectId &&
                      dropTarget.status === column.id &&
                      !dropTarget.threadId;
                    const lastThreadInLane = laneThreads[laneThreads.length - 1];
                    const showColumnDivider = columnIndex < THREAD_BOARD_COLUMNS.length - 1;

                    return (
                      <div
                        key={`${group.id}-${column.id}`}
                        className="relative flex min-h-[190px] flex-col p-3"
                        onDragOver={(event) => {
                          if (!canDropInLane) {
                            return;
                          }

                          event.preventDefault();
                          event.stopPropagation();
                          setDropTarget({
                            projectId: group.projectId,
                            status: column.id,
                          });
                        }}
                        onDrop={(event) => {
                          if (!canDropInLane || !draggingThreadId) {
                            clearDragState();
                            return;
                          }

                          event.preventDefault();
                          event.stopPropagation();
                          onMoveThread({
                            threadId: draggingThreadId,
                            targetStatus: column.id,
                            targetThreadId: lastThreadInLane?.id,
                            placement: 'after',
                          });
                          clearDragState();
                        }}
                      >
                        {showColumnDivider ? (
                          <span className="pointer-events-none absolute -right-1.5 bottom-3 top-3 w-px bg-stone-200" />
                        ) : null}

                        {laneThreads.length === 0 ? (
                          <div
                            className={cn(
                              'min-h-[122px] flex-1 transition-colors',
                              isLaneDropTarget
                                ? 'rounded-[18px] bg-stone-200/65'
                                : '',
                            )}
                          />
                        ) : (
                          <div className="flex flex-1 flex-col gap-2">
                            {laneThreads.map((thread) => {
                              const isSelected = thread.id === selectedThreadId;
                              const isDragging = draggingThreadId === thread.id;
                              const isCardDropTarget = dropTarget?.threadId === thread.id;
                              const threadAgentBadge = threadAgentBadgeById[thread.id];
                              const indicatorState = threadIndicatorById[thread.id];

                              return (
                                <button
                                  key={thread.id}
                                  type="button"
                                  draggable
                                  className={cn(
                                    'no-drag w-full rounded-[18px] border bg-white px-3.5 py-3 text-left transition-[border-color,box-shadow,opacity]',
                                    isSelected
                                      ? 'border-stone-200 text-stone-900 shadow-[0_10px_28px_-18px_rgba(28,25,23,0.22)]'
                                      : 'border-stone-200 text-stone-800 hover:border-stone-300',
                                    isDragging && 'opacity-45',
                                    isCardDropTarget &&
                                      (dropTarget?.placement === 'before'
                                        ? 'shadow-[inset_0_4px_0_0_rgba(231,229,228,1)]'
                                        : 'shadow-[inset_0_-4px_0_0_rgba(231,229,228,1)]'),
                                  )}
                                  onClick={() => onSelectThread(thread.id)}
                                  onDragStart={(event) => {
                                    setDraggingThreadId(thread.id);
                                    event.dataTransfer.effectAllowed = 'move';
                                    event.dataTransfer.setData('text/plain', thread.id);
                                  }}
                                  onDragOver={(event) => {
                                    if (!canDropInLane || draggingThreadId === thread.id) {
                                      return;
                                    }

                                    event.preventDefault();
                                    event.stopPropagation();
                                    setDropTarget({
                                      projectId: group.projectId,
                                      status: column.id,
                                      threadId: thread.id,
                                      placement: getVerticalInsertPlacement(
                                        event.clientY,
                                        event.currentTarget,
                                      ),
                                    });
                                  }}
                                  onDrop={(event) => {
                                    if (
                                      !canDropInLane ||
                                      !draggingThreadId ||
                                      draggingThreadId === thread.id
                                    ) {
                                      clearDragState();
                                      return;
                                    }

                                    event.preventDefault();
                                    event.stopPropagation();
                                    onMoveThread({
                                      threadId: draggingThreadId,
                                      targetStatus: column.id,
                                      targetThreadId: thread.id,
                                      placement: getVerticalInsertPlacement(
                                        event.clientY,
                                        event.currentTarget,
                                      ),
                                    });
                                    clearDragState();
                                  }}
                                  onDragLeave={() => {
                                    if (dropTarget?.threadId === thread.id) {
                                      setDropTarget(null);
                                    }
                                  }}
                                  onDragEnd={clearDragState}
                                >
                                  <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0 flex-1">
                                      <p
                                        className={cn(
                                          'truncate text-[13px] font-medium',
                                          isSelected ? 'text-stone-900' : 'text-stone-800',
                                        )}
                                      >
                                        {thread.title}
                                      </p>
                                      <p
                                        className={cn(
                                          'mt-1 line-clamp-3 text-[12px] leading-[1.5]',
                                          isSelected ? 'text-stone-600' : 'text-stone-500',
                                        )}
                                      >
                                        {thread.preview}
                                      </p>
                                    </div>

                                    <div className="flex shrink-0 items-center gap-1.5 pt-0.5">
                                      {threadAgentBadge ? (
                                        <ThreadAgentBadge
                                          label={threadAgentBadge.label}
                                          iconUrl={threadAgentBadge.iconUrl}
                                        />
                                      ) : null}

                                      {indicatorState === 'running' ? (
                                        <Loader2
                                          className={cn(
                                            'h-3.5 w-3.5 shrink-0 animate-spin',
                                            isSelected ? 'text-blue-600' : 'text-blue-500',
                                          )}
                                        />
                                      ) : indicatorState === 'completed' ? (
                                        <Check
                                          className={cn(
                                            'h-3.5 w-3.5 shrink-0',
                                            isSelected ? 'text-blue-600' : 'text-blue-500',
                                          )}
                                        />
                                      ) : null}
                                    </div>
                                  </div>

                                  <div
                                    className={cn(
                                      'mt-3 text-[11px]',
                                      isSelected ? 'text-stone-500' : 'text-stone-400',
                                    )}
                                  >
                                    <span>{formatRelativeTime(thread.updatedAtMs, clockMs)}</span>
                                  </div>
                                </button>
                              );
                            })}

                            <div
                              className={cn(
                                'min-h-3 rounded-full transition-colors',
                                isLaneDropTarget
                                  ? 'bg-stone-200/80'
                                  : 'bg-transparent',
                              )}
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                  </div>
                  </div>
                </div>
                    </>
                  );
                })()}
              </section>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
