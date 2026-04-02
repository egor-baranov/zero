import * as React from 'react';

export interface WorkspaceRecord {
  id: string;
  name: string;
  path: string;
  lastOpenedAt: number;
}

export interface WorkspaceScopeRecord {
  id: string;
  name: string;
  projectIds: string[];
  lastOpenedAt: number;
}

export type ThreadBoardStatus = 'open' | 'in_progress' | 'review' | 'archive';

export const THREAD_BOARD_COLUMNS: ReadonlyArray<{
  id: ThreadBoardStatus;
  label: string;
}> = [
  { id: 'open', label: 'Open' },
  { id: 'in_progress', label: 'In progress' },
  { id: 'review', label: 'Review' },
  { id: 'archive', label: 'Archive' },
];

export interface ThreadRecord {
  id: string;
  workspaceId: string;
  projectId: string;
  status: ThreadBoardStatus;
  isDraft: boolean;
  title: string;
  titleSource: 'auto' | 'manual';
  preview: string;
  updatedAtMs: number;
}

export interface ThreadGroupView {
  id: string;
  label: string;
  projectId: string;
  path: string;
  threads: ThreadRecord[];
}

type InsertPlacement = 'before' | 'after';

interface ShellState {
  projects: WorkspaceRecord[];
  workspaces: WorkspaceScopeRecord[];
  threads: ThreadRecord[];
  selectedThreadId: string;
  selectedWorkspaceId: string;
  selectedProjectId: string;
}

interface PersistedThreadRecord extends Partial<ThreadRecord> {
  updatedAt?: unknown;
}

const STORAGE_KEY = 'zeroade.shell.state.v3';
const MAX_RECENT_PROJECTS = 8;
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;
const MONTH_MS = 30 * DAY_MS;

const EMPTY_STATE: ShellState = {
  projects: [],
  workspaces: [],
  threads: [],
  selectedThreadId: '',
  selectedWorkspaceId: '',
  selectedProjectId: '',
};

const LEGACY_DEMO_PROJECT_IDS = new Set([
  'workspace-zero-ade',
  'workspace-desktop-lab',
]);

const LEGACY_DEMO_THREAD_IDS = new Set([
  'thread-shell-fidelity',
  'thread-spacing-pass',
  'thread-composer-motion',
  'thread-toolbar-actions',
]);

const slugify = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '') || 'workspace';

const getFolderName = (folderPath: string): string =>
  folderPath.split(/[\\/]/).filter(Boolean).pop() ?? folderPath;

const normalizeFolderPath = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }

  if (trimmed === '/' || trimmed === '\\') {
    return trimmed;
  }

  if (/^[a-zA-Z]:[\\/]?$/.test(trimmed)) {
    return trimmed.slice(0, 2) + trimmed.slice(2).replace(/[\\/]/g, '\\');
  }

  return trimmed.replace(/[\\/]+$/, '');
};

const normalizeMessageText = (value: string): string =>
  value.replace(/\s+/g, ' ').trim();

const isThreadBoardStatus = (value: unknown): value is ThreadBoardStatus =>
  value === 'open' ||
  value === 'in_progress' ||
  value === 'review' ||
  value === 'archive';

const toPlainPreviewText = (value: string): string =>
  normalizeMessageText(
    value
      .replace(/\r\n?/g, '\n')
      .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '$1')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
      .replace(/```(?:[\w-]+)?/g, '')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/^\s{0,3}#{1,6}\s+/gm, '')
      .replace(/^\s*[-*+]\s+/gm, '')
      .replace(/^\s*\d+\.\s+/gm, ''),
  );

const isDefaultThreadTitle = (title: string): boolean => {
  const normalized = title.trim().toLowerCase();
  return normalized === 'new chat' || normalized.startsWith('new chat ');
};

const parseLegacyUpdatedAtMs = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value;
  }

  if (typeof value !== 'string') {
    return Date.now();
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized === 'now') {
    return Date.now();
  }

  if (normalized === 'yesterday') {
    return Date.now() - DAY_MS;
  }

  const minuteMatch = normalized.match(/^(\d+)m$/);
  if (minuteMatch) {
    return Date.now() - Number(minuteMatch[1]) * MINUTE_MS;
  }

  const hourMatch = normalized.match(/^(\d+)h$/);
  if (hourMatch) {
    return Date.now() - Number(hourMatch[1]) * HOUR_MS;
  }

  const dayMatch = normalized.match(/^(\d+)d$/);
  if (dayMatch) {
    return Date.now() - Number(dayMatch[1]) * DAY_MS;
  }

  const weekMatch = normalized.match(/^(\d+)w$/);
  if (weekMatch) {
    return Date.now() - Number(weekMatch[1]) * WEEK_MS;
  }

  const monthMatch = normalized.match(/^(\d+)mo$/);
  if (monthMatch) {
    return Date.now() - Number(monthMatch[1]) * MONTH_MS;
  }

  return Date.now();
};

const createNewChatThread = (
  projectName: string,
  projectId: string,
  workspaceId: string,
): ThreadRecord => {
  const suffix = Date.now().toString(36);

  return {
    id: `thread-${slugify(projectName)}-${suffix}`,
    workspaceId,
    projectId,
    status: 'open',
    isDraft: true,
    title: 'New chat',
    titleSource: 'auto',
    preview: 'New conversation',
    updatedAtMs: Date.now(),
  };
};

const toThreadTitleFromPrompt = (prompt: string): string => {
  const normalized = normalizeMessageText(prompt);
  if (!normalized) {
    return 'New chat';
  }

  const maxLength = 56;
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength).trimEnd()}…`;
};

const toThreadPreviewFromPrompt = (prompt: string): string => {
  const normalized = toPlainPreviewText(prompt);
  if (!normalized) {
    return 'Conversation started';
  }

  const maxLength = 92;
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength).trimEnd()}…`;
};

const compareByRecent = <T extends { lastOpenedAt: number }>(left: T, right: T): number =>
  right.lastOpenedAt - left.lastOpenedAt;

const reorderItemsById = <T extends { id: string }>(
  items: T[],
  sourceId: string,
  targetId: string,
  placement: InsertPlacement = 'before',
): T[] => {
  if (!sourceId || !targetId || sourceId === targetId) {
    return items;
  }

  const sourceIndex = items.findIndex((item) => item.id === sourceId);
  const targetIndex = items.findIndex((item) => item.id === targetId);
  if (sourceIndex < 0 || targetIndex < 0) {
    return items;
  }

  const nextItems = [...items];
  const [movedItem] = nextItems.splice(sourceIndex, 1);
  if (!movedItem) {
    return items;
  }

  const nextTargetIndex = nextItems.findIndex((item) => item.id === targetId);
  if (nextTargetIndex < 0) {
    return items;
  }

  const insertionIndex = nextTargetIndex + (placement === 'after' ? 1 : 0);
  if (insertionIndex === sourceIndex) {
    return items;
  }

  nextItems.splice(insertionIndex, 0, movedItem);
  return nextItems;
};

const getMostRecentProjects = (projects: WorkspaceRecord[]): WorkspaceRecord[] =>
  [...projects].sort(compareByRecent).slice(0, MAX_RECENT_PROJECTS);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const normalizeProjectRecords = (value: unknown): WorkspaceRecord[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  const projects: WorkspaceRecord[] = [];
  const seenIds = new Set<string>();

  for (const entry of value) {
    if (!isRecord(entry)) {
      continue;
    }

    const id = typeof entry.id === 'string' ? entry.id.trim() : '';
    const name = typeof entry.name === 'string' ? entry.name.trim() : '';
    const path = typeof entry.path === 'string' ? normalizeFolderPath(entry.path) : '';
    if (!id || !name || !path || seenIds.has(id)) {
      continue;
    }

    seenIds.add(id);
    projects.push({
      id,
      name,
      path,
      lastOpenedAt:
        typeof entry.lastOpenedAt === 'number' && Number.isFinite(entry.lastOpenedAt)
          ? entry.lastOpenedAt
          : Date.now(),
    });
  }

  return projects;
};

const normalizeWorkspaceScopeRecords = (
  value: unknown,
  validProjectIds: Set<string>,
): WorkspaceScopeRecord[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  const workspaces: WorkspaceScopeRecord[] = [];
  const seenIds = new Set<string>();

  for (const entry of value) {
    if (!isRecord(entry)) {
      continue;
    }

    const id = typeof entry.id === 'string' ? entry.id.trim() : '';
    const name = typeof entry.name === 'string' ? entry.name.trim() : '';
    const projectIds = Array.isArray(entry.projectIds)
      ? Array.from(
          new Set(
            entry.projectIds.filter(
              (projectId): projectId is string =>
                typeof projectId === 'string' && validProjectIds.has(projectId),
            ),
          ),
        )
      : [];

    if (!id || !name || projectIds.length === 0 || seenIds.has(id)) {
      continue;
    }

    seenIds.add(id);
    workspaces.push({
      id,
      name,
      projectIds,
      lastOpenedAt:
        typeof entry.lastOpenedAt === 'number' && Number.isFinite(entry.lastOpenedAt)
          ? entry.lastOpenedAt
          : Date.now(),
    });
  }

  return workspaces;
};

const normalizeThreadRecords = (
  value: unknown,
  validProjectIds: Set<string>,
  validWorkspaceIds: Set<string>,
  isLegacyState: boolean,
): ThreadRecord[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  const threads: ThreadRecord[] = [];
  const seenIds = new Set<string>();

  for (const entry of value) {
    if (!isRecord(entry)) {
      continue;
    }

    const thread = entry as PersistedThreadRecord;
    const id = typeof thread.id === 'string' ? thread.id.trim() : '';
    const legacyWorkspaceId =
      typeof thread.workspaceId === 'string' ? thread.workspaceId.trim() : '';
    const projectId = typeof thread.projectId === 'string'
      ? thread.projectId.trim()
      : legacyWorkspaceId
        ? legacyWorkspaceId
        : '';
    const workspaceId = isLegacyState
      ? ''
      : legacyWorkspaceId
        ? legacyWorkspaceId
        : '';

    if (
      !id ||
      !projectId ||
      !validProjectIds.has(projectId) ||
      (workspaceId && !validWorkspaceIds.has(workspaceId)) ||
      seenIds.has(id)
    ) {
      continue;
    }

    seenIds.add(id);
    threads.push({
      id,
      workspaceId,
      projectId,
      status: isThreadBoardStatus(thread.status) ? thread.status : 'open',
      isDraft:
        typeof thread.isDraft === 'boolean'
          ? thread.isDraft
          : isLegacyState
            ? legacyWorkspaceId.length === 0
            : false,
      title: typeof thread.title === 'string' && thread.title.trim().length > 0
        ? thread.title
        : 'New chat',
      titleSource:
        thread.titleSource === 'manual' || thread.titleSource === 'auto'
          ? thread.titleSource
          : isDefaultThreadTitle(typeof thread.title === 'string' ? thread.title : '')
            ? 'auto'
            : 'manual',
      preview: toThreadPreviewFromPrompt(
        typeof thread.preview === 'string' ? thread.preview : '',
      ),
      updatedAtMs: parseLegacyUpdatedAtMs(thread.updatedAtMs ?? thread.updatedAt),
    });
  }

  return threads;
};

const getProjectIdsForWorkspace = (
  projects: WorkspaceRecord[],
  workspaces: WorkspaceScopeRecord[],
  workspaceId: string,
): string[] => {
  if (!workspaceId.trim()) {
    return projects.map((project) => project.id);
  }

  return workspaces.find((workspace) => workspace.id === workspaceId)?.projectIds ?? [];
};

const sanitizeState = (state: ShellState): ShellState => {
  const projects = normalizeProjectRecords(state.projects);
  const validProjectIds = new Set(projects.map((project) => project.id));
  const workspaces = normalizeWorkspaceScopeRecords(state.workspaces, validProjectIds);
  const validWorkspaceIds = new Set(workspaces.map((workspace) => workspace.id));
  const threads = normalizeThreadRecords(state.threads, validProjectIds, validWorkspaceIds, false);

  const selectedThread = threads.find((thread) => thread.id === state.selectedThreadId);
  const selectedWorkspaceId = selectedThread
    ? selectedThread.workspaceId
    : validWorkspaceIds.has(state.selectedWorkspaceId)
      ? state.selectedWorkspaceId
      : '';
  const visibleProjectIds = getProjectIdsForWorkspace(
    projects,
    workspaces,
    selectedWorkspaceId,
  );
  const selectedProjectId = selectedThread
    ? selectedThread.projectId
    : visibleProjectIds.includes(state.selectedProjectId)
      ? state.selectedProjectId
      : visibleProjectIds[0] ?? '';

  return {
    projects,
    workspaces,
    threads,
    selectedThreadId: selectedThread?.id ?? '',
    selectedWorkspaceId,
    selectedProjectId,
  };
};

const isLegacyDemoState = (state: ShellState): boolean => {
  if (state.projects.length === 0 && state.threads.length === 0) {
    return false;
  }

  const projectsMatch =
    state.projects.length > 0 &&
    state.projects.every((project) => LEGACY_DEMO_PROJECT_IDS.has(project.id));
  const threadsMatch =
    state.threads.length > 0 &&
    state.threads.every(
      (thread) =>
        LEGACY_DEMO_THREAD_IDS.has(thread.id) &&
        LEGACY_DEMO_PROJECT_IDS.has(thread.projectId),
    );
  const selectedProjectMatches =
    !state.selectedProjectId ||
    LEGACY_DEMO_PROJECT_IDS.has(state.selectedProjectId);
  const selectedThreadMatches =
    !state.selectedThreadId ||
    LEGACY_DEMO_THREAD_IDS.has(state.selectedThreadId);

  return projectsMatch && threadsMatch && selectedProjectMatches && selectedThreadMatches;
};

const parsePersistedState = (): ShellState => {
  const raw = window.localStorage.getItem(STORAGE_KEY) ?? window.localStorage.getItem('zeroade.shell.state.v2');
  if (!raw) {
    return EMPTY_STATE;
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const hasProjects = Array.isArray(parsed.projects);
    const projects = hasProjects
      ? normalizeProjectRecords(parsed.projects)
      : normalizeProjectRecords(parsed.workspaces);
    const validProjectIds = new Set(projects.map((project) => project.id));
    const workspaces = hasProjects
      ? normalizeWorkspaceScopeRecords(parsed.workspaces, validProjectIds)
      : [];
    const validWorkspaceIds = new Set(workspaces.map((workspace) => workspace.id));
    const threads = normalizeThreadRecords(
      parsed.threads,
      validProjectIds,
      validWorkspaceIds,
      !hasProjects,
    );

    const nextState = sanitizeState({
      projects,
      workspaces,
      threads,
      selectedThreadId: typeof parsed.selectedThreadId === 'string' ? parsed.selectedThreadId : '',
      selectedWorkspaceId:
        hasProjects && typeof parsed.selectedWorkspaceId === 'string'
          ? parsed.selectedWorkspaceId
          : '',
      selectedProjectId:
        typeof parsed.selectedProjectId === 'string'
          ? parsed.selectedProjectId
          : typeof parsed.selectedWorkspaceId === 'string'
            ? parsed.selectedWorkspaceId
            : '',
    });

    if (isLegacyDemoState(nextState)) {
      return EMPTY_STATE;
    }

    return nextState;
  } catch {
    return EMPTY_STATE;
  }
};

const upsertProject = (
  projects: WorkspaceRecord[],
  folderPath: string,
): { projects: WorkspaceRecord[]; project: WorkspaceRecord } | null => {
  const normalizedPath = normalizeFolderPath(folderPath);
  if (!normalizedPath) {
    return null;
  }

  const timestamp = Date.now();
  const existing = projects.find((project) => project.path === normalizedPath);
  if (existing) {
    const refreshedProject: WorkspaceRecord = {
      ...existing,
      lastOpenedAt: timestamp,
    };

    return {
      projects: projects.map((project) =>
        project.id === existing.id ? refreshedProject : project,
      ),
      project: refreshedProject,
    };
  }

  const project: WorkspaceRecord = {
    id: `project-${slugify(getFolderName(normalizedPath))}-${timestamp.toString(36)}`,
    name: getFolderName(normalizedPath),
    path: normalizedPath,
    lastOpenedAt: timestamp,
  };

  return {
    projects: [...projects, project],
    project,
  };
};

export const useShellState = (): {
  projects: WorkspaceRecord[];
  recentProjects: WorkspaceRecord[];
  workspaces: WorkspaceScopeRecord[];
  threadGroups: ThreadGroupView[];
  selectedThread: ThreadRecord | undefined;
  selectedWorkspace: WorkspaceScopeRecord | undefined;
  selectedProject: WorkspaceRecord | undefined;
  selectedThreadId: string;
  selectedWorkspaceId: string;
  selectedProjectId: string;
  selectThread: (threadId: string) => void;
  clearThreadSelection: () => void;
  selectWorkspace: (workspaceId: string) => void;
  selectProject: (projectId: string) => void;
  createThread: (options?: {
    workspaceId?: string;
    projectId?: string;
  }) => void;
  setThreadProject: (threadId: string, projectId: string) => void;
  setThreadStatus: (threadId: string, status: ThreadBoardStatus) => void;
  moveThreadInBoard: (
    threadId: string,
    targetStatus: ThreadBoardStatus,
    targetThreadId?: string,
    placement?: InsertPlacement,
  ) => void;
  updateThreadFromMessage: (
    threadId: string,
    message: string,
    options?: {
      allowAutoTitle?: boolean;
      touchUpdatedAt?: boolean;
      markStarted?: boolean;
    },
  ) => void;
  updateThreadUpdatedAt: (threadId: string, updatedAtMs: number) => void;
  applyAutoThreadTitle: (threadId: string, title: string) => void;
  renameThread: (threadId: string, title: string) => void;
  removeThread: (threadId: string) => void;
  reorderProjects: (
    sourceProjectId: string,
    targetProjectId: string,
    placement?: InsertPlacement,
  ) => void;
  reorderThreads: (
    sourceThreadId: string,
    targetThreadId: string,
    placement?: InsertPlacement,
  ) => void;
  createWorkspace: (input: {
    name: string;
    projectPaths: string[];
  }) => WorkspaceScopeRecord | null;
  renameWorkspace: (workspaceId: string, name: string) => void;
  removeWorkspace: (workspaceId: string) => void;
  openWorkspaceFromPath: (folderPath: string) => WorkspaceRecord | null;
  addProjectToWorkspace: (workspaceId: string, folderPath: string) => WorkspaceRecord | null;
} => {
  const [state, setState] = React.useState<ShellState>(() => parsePersistedState());

  React.useEffect(() => {
    setState((previous) =>
      sanitizeState({
        ...previous,
        threads: previous.threads.map((thread) => {
          const nextPreview = toThreadPreviewFromPrompt(thread.preview);
          if (nextPreview === thread.preview) {
            return thread;
          }

          return {
            ...thread,
            preview: nextPreview,
          };
        }),
      }),
    );
  }, []);

  React.useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  const selectThread = React.useCallback((threadId: string) => {
    setState((previous) => {
      const thread = previous.threads.find((item) => item.id === threadId);
      if (!thread) {
        return previous;
      }

      return sanitizeState({
        ...previous,
        selectedThreadId: thread.id,
        selectedWorkspaceId: thread.workspaceId,
        selectedProjectId: thread.projectId,
      });
    });
  }, []);

  const clearThreadSelection = React.useCallback(() => {
    setState((previous) =>
      sanitizeState({
        ...previous,
        selectedThreadId: '',
      }),
    );
  }, []);

  const selectWorkspace = React.useCallback((workspaceId: string) => {
    setState((previous) => {
      if (workspaceId && !previous.workspaces.some((workspace) => workspace.id === workspaceId)) {
        return previous;
      }

      const visibleProjectIds = getProjectIdsForWorkspace(
        previous.projects,
        previous.workspaces,
        workspaceId,
      );
      const currentSelectedThread = previous.threads.find(
        (thread) => thread.id === previous.selectedThreadId,
      );
      const shouldKeepSelectedThread =
        currentSelectedThread?.workspaceId === workspaceId &&
        visibleProjectIds.includes(currentSelectedThread.projectId);
      const fallbackThread = previous.threads.find(
        (thread) =>
          thread.workspaceId === workspaceId && visibleProjectIds.includes(thread.projectId),
      );
      const nextSelectedProjectId = shouldKeepSelectedThread
        ? currentSelectedThread?.projectId ?? previous.selectedProjectId
        : visibleProjectIds.includes(previous.selectedProjectId)
          ? previous.selectedProjectId
          : fallbackThread?.projectId ?? visibleProjectIds[0] ?? '';

      return sanitizeState({
        ...previous,
        workspaces: previous.workspaces.map((workspace) =>
          workspace.id === workspaceId
            ? {
                ...workspace,
                lastOpenedAt: Date.now(),
              }
            : workspace,
        ),
        selectedWorkspaceId: workspaceId,
        selectedProjectId: nextSelectedProjectId,
        selectedThreadId:
          shouldKeepSelectedThread
            ? previous.selectedThreadId
            : fallbackThread?.id ?? '',
      });
    });
  }, []);

  const selectProject = React.useCallback((projectId: string) => {
    setState((previous) => {
      const project = previous.projects.find((item) => item.id === projectId);
      if (!project) {
        return previous;
      }

      const visibleProjectIds = getProjectIdsForWorkspace(
        previous.projects,
        previous.workspaces,
        previous.selectedWorkspaceId,
      );
      if (!visibleProjectIds.includes(projectId)) {
        return previous;
      }

      return sanitizeState({
        ...previous,
        projects: previous.projects.map((item) =>
          item.id === projectId
            ? {
                ...item,
                lastOpenedAt: Date.now(),
              }
            : item,
        ),
        selectedProjectId: project.id,
      });
    });
  }, []);

  const createThread = React.useCallback(
    (options?: {
      workspaceId?: string;
      projectId?: string;
    }) => {
      setState((previous) => {
        const workspaceId = options?.workspaceId ?? previous.selectedWorkspaceId;
        if (
          workspaceId &&
          !previous.workspaces.some((workspace) => workspace.id === workspaceId)
        ) {
          return previous;
        }

        const visibleProjectIds = getProjectIdsForWorkspace(
          previous.projects,
          previous.workspaces,
          workspaceId,
        );
        const projectId =
          options?.projectId ??
          (visibleProjectIds.includes(previous.selectedProjectId)
            ? previous.selectedProjectId
            : visibleProjectIds[0]);
        if (!projectId || !visibleProjectIds.includes(projectId)) {
          return previous;
        }
        const project = previous.projects.find((item) => item.id === projectId);
        if (!project) {
          return previous;
        }

        const thread = createNewChatThread(project.name, project.id, workspaceId);

        return sanitizeState({
          ...previous,
          threads: [thread, ...previous.threads],
          selectedThreadId: thread.id,
          selectedWorkspaceId: workspaceId,
          selectedProjectId: project.id,
        });
      });
    },
    [],
  );

  const setThreadProject = React.useCallback((threadId: string, projectId: string) => {
    setState((previous) => {
      const thread = previous.threads.find((item) => item.id === threadId);
      const project = previous.projects.find((item) => item.id === projectId);
      if (!thread || !project) {
        return previous;
      }

      const visibleProjectIds = getProjectIdsForWorkspace(
        previous.projects,
        previous.workspaces,
        thread.workspaceId,
      );
      if (!visibleProjectIds.includes(projectId) || thread.projectId === projectId) {
        return previous;
      }

      return sanitizeState({
        ...previous,
        threads: previous.threads.map((item) =>
          item.id === threadId
            ? {
                ...item,
                projectId,
              }
            : item,
        ),
        selectedProjectId: previous.selectedThreadId === threadId ? projectId : previous.selectedProjectId,
      });
    });
  }, []);

  const setThreadStatus = React.useCallback((threadId: string, status: ThreadBoardStatus) => {
    setState((previous) => {
      const thread = previous.threads.find((item) => item.id === threadId);
      if (!thread || thread.status === status) {
        return previous;
      }

      return sanitizeState({
        ...previous,
        threads: previous.threads.map((item) =>
          item.id === threadId
            ? {
                ...item,
                status,
              }
            : item,
        ),
      });
    });
  }, []);

  const moveThreadInBoard = React.useCallback(
    (
      threadId: string,
      targetStatus: ThreadBoardStatus,
      targetThreadId?: string,
      placement: InsertPlacement = 'before',
    ) => {
      if (!threadId || !targetStatus) {
        return;
      }

      setState((previous) => {
        const sourceThread = previous.threads.find((thread) => thread.id === threadId);
        if (!sourceThread) {
          return previous;
        }

        let nextThreads =
          sourceThread.status === targetStatus
            ? previous.threads
            : previous.threads.map((thread) =>
                thread.id === threadId
                  ? {
                      ...thread,
                      status: targetStatus,
                    }
                  : thread,
              );

        if (targetThreadId && targetThreadId !== threadId) {
          const targetThread = nextThreads.find((thread) => thread.id === targetThreadId);
          if (
            targetThread &&
            targetThread.projectId === sourceThread.projectId &&
            targetThread.workspaceId === sourceThread.workspaceId &&
            targetThread.status === targetStatus
          ) {
            nextThreads = reorderItemsById(nextThreads, threadId, targetThreadId, placement);
          }
        }

        if (nextThreads === previous.threads) {
          return previous;
        }

        return sanitizeState({
          ...previous,
          threads: nextThreads,
        });
      });
    },
    [],
  );

  const updateThreadFromMessage = React.useCallback(
    (
      threadId: string,
      message: string,
      options?: {
        allowAutoTitle?: boolean;
        touchUpdatedAt?: boolean;
        markStarted?: boolean;
      },
    ) => {
      const trimmedMessage = normalizeMessageText(message);
      if (!threadId || !trimmedMessage) {
        return;
      }

      const allowAutoTitle = options?.allowAutoTitle ?? true;
      const touchUpdatedAt = options?.touchUpdatedAt ?? true;
      const markStarted = options?.markStarted ?? true;

      setState((previous) => {
        const thread = previous.threads.find((item) => item.id === threadId);
        if (!thread) {
          return previous;
        }

        const shouldRename =
          allowAutoTitle &&
          thread.titleSource !== 'manual' &&
          isDefaultThreadTitle(thread.title);

        const nextThread: ThreadRecord = {
          ...thread,
          isDraft: markStarted ? false : thread.isDraft,
          title: shouldRename ? toThreadTitleFromPrompt(trimmedMessage) : thread.title,
          titleSource: shouldRename ? 'auto' : thread.titleSource,
          preview: toThreadPreviewFromPrompt(trimmedMessage),
          updatedAtMs: touchUpdatedAt ? Date.now() : thread.updatedAtMs,
        };

        if (
          nextThread.isDraft === thread.isDraft &&
          nextThread.title === thread.title &&
          nextThread.titleSource === thread.titleSource &&
          nextThread.preview === thread.preview &&
          nextThread.updatedAtMs === thread.updatedAtMs
        ) {
          return previous;
        }

        return sanitizeState({
          ...previous,
          threads: previous.threads.map((item) => (item.id === threadId ? nextThread : item)),
        });
      });
    },
    [],
  );

  const updateThreadUpdatedAt = React.useCallback((threadId: string, updatedAtMs: number) => {
    if (!threadId || !Number.isFinite(updatedAtMs) || updatedAtMs <= 0) {
      return;
    }

    setState((previous) => {
      const thread = previous.threads.find((item) => item.id === threadId);
      if (!thread || thread.updatedAtMs === updatedAtMs) {
        return previous;
      }

      const nextThread: ThreadRecord = {
        ...thread,
        updatedAtMs,
      };

      return sanitizeState({
        ...previous,
        threads: previous.threads.map((item) => (item.id === threadId ? nextThread : item)),
      });
    });
  }, []);

  const applyAutoThreadTitle = React.useCallback((threadId: string, title: string) => {
    const nextTitle = normalizeMessageText(title);
    if (!threadId || !nextTitle) {
      return;
    }

    setState((previous) => {
      let didUpdate = false;
      const threads = previous.threads.map((thread) => {
        if (thread.id !== threadId) {
          return thread;
        }

        if (thread.titleSource === 'manual' || thread.title === nextTitle) {
          return thread;
        }

        didUpdate = true;
        return {
          ...thread,
          title: nextTitle,
          titleSource: 'auto',
        };
      });

      if (!didUpdate) {
        return previous;
      }

      return sanitizeState({
        ...previous,
        threads,
      });
    });
  }, []);

  const renameThread = React.useCallback((threadId: string, title: string) => {
    const nextTitle = normalizeMessageText(title);
    if (!threadId || !nextTitle) {
      return;
    }

    setState((previous) => {
      let didUpdate = false;
      const threads = previous.threads.map((thread) => {
        if (thread.id !== threadId) {
          return thread;
        }

        if (thread.title === nextTitle && thread.titleSource === 'manual') {
          return thread;
        }

        didUpdate = true;
        return {
          ...thread,
          title: nextTitle,
          titleSource: 'manual',
        };
      });

      if (!didUpdate) {
        return previous;
      }

      return sanitizeState({
        ...previous,
        threads,
      });
    });
  }, []);

  const removeThread = React.useCallback((threadId: string) => {
    if (!threadId) {
      return;
    }

    setState((previous) => {
      if (!previous.threads.some((thread) => thread.id === threadId)) {
        return previous;
      }

      return sanitizeState({
        ...previous,
        threads: previous.threads.filter((thread) => thread.id !== threadId),
        selectedThreadId: previous.selectedThreadId === threadId ? '' : previous.selectedThreadId,
      });
    });
  }, []);

  const reorderProjects = React.useCallback(
    (
      sourceProjectId: string,
      targetProjectId: string,
      placement: InsertPlacement = 'before',
    ) => {
      setState((previous) => {
        const nextProjects = reorderItemsById(
          previous.projects,
          sourceProjectId,
          targetProjectId,
          placement,
        );

        if (nextProjects === previous.projects) {
          return previous;
        }

        return sanitizeState({
          ...previous,
          projects: nextProjects,
        });
      });
    },
    [],
  );

  const reorderThreads = React.useCallback(
    (
      sourceThreadId: string,
      targetThreadId: string,
      placement: InsertPlacement = 'before',
    ) => {
      setState((previous) => {
        const sourceThread = previous.threads.find((thread) => thread.id === sourceThreadId);
        const targetThread = previous.threads.find((thread) => thread.id === targetThreadId);
        if (
          !sourceThread ||
          !targetThread ||
          sourceThread.projectId !== targetThread.projectId ||
          sourceThread.workspaceId !== targetThread.workspaceId
        ) {
          return previous;
        }

        const nextThreads = reorderItemsById(
          previous.threads,
          sourceThreadId,
          targetThreadId,
          placement,
        );
        if (nextThreads === previous.threads) {
          return previous;
        }

        return sanitizeState({
          ...previous,
          threads: nextThreads,
        });
      });
    },
    [],
  );

  const createWorkspace = React.useCallback((input: {
    name: string;
    projectPaths: string[];
  }): WorkspaceScopeRecord | null => {
    const nextName = input.name.trim();
    const normalizedPaths = Array.from(
      new Set(
        input.projectPaths
          .map((projectPath) => normalizeFolderPath(projectPath))
          .filter((projectPath) => projectPath.length > 0),
      ),
    );

    if (!nextName || normalizedPaths.length === 0) {
      return null;
    }

    let createdWorkspace: WorkspaceScopeRecord | null = null;

    setState((previous) => {
      let projects = previous.projects;
      const projectIds: string[] = [];

      for (const projectPath of normalizedPaths) {
        const result = upsertProject(projects, projectPath);
        if (!result) {
          continue;
        }

        projects = result.projects;
        projectIds.push(result.project.id);
      }

      if (projectIds.length === 0) {
        return previous;
      }

      const timestamp = Date.now();
      createdWorkspace = {
        id: `workspace-${slugify(nextName)}-${timestamp.toString(36)}`,
        name: nextName,
        projectIds: Array.from(new Set(projectIds)),
        lastOpenedAt: timestamp,
      };

      return sanitizeState({
        ...previous,
        projects,
        workspaces: [...previous.workspaces, createdWorkspace],
        selectedWorkspaceId: createdWorkspace.id,
        selectedProjectId: createdWorkspace.projectIds[0] ?? '',
        selectedThreadId: '',
      });
    });

    return createdWorkspace;
  }, []);

  const renameWorkspace = React.useCallback((workspaceId: string, name: string) => {
    const nextName = name.trim();
    if (!nextName) {
      return;
    }

    setState((previous) => {
      if (!previous.workspaces.some((workspace) => workspace.id === workspaceId)) {
        return previous;
      }

      return sanitizeState({
        ...previous,
        workspaces: previous.workspaces.map((workspace) =>
          workspace.id === workspaceId
            ? {
                ...workspace,
                name: nextName,
              }
            : workspace,
        ),
      });
    });
  }, []);

  const removeWorkspace = React.useCallback((workspaceId: string) => {
    setState((previous) => {
      if (!previous.workspaces.some((workspace) => workspace.id === workspaceId)) {
        return previous;
      }

      return sanitizeState({
        ...previous,
        workspaces: previous.workspaces.filter((workspace) => workspace.id !== workspaceId),
        threads: previous.threads.filter((thread) => thread.workspaceId !== workspaceId),
        selectedWorkspaceId: previous.selectedWorkspaceId === workspaceId ? '' : previous.selectedWorkspaceId,
      });
    });
  }, []);

  const openWorkspaceFromPath = React.useCallback((folderPath: string): WorkspaceRecord | null => {
    let openedProject: WorkspaceRecord | null = null;

    setState((previous) => {
      const result = upsertProject(previous.projects, folderPath);
      if (!result) {
        return previous;
      }

      openedProject = result.project;
      const shouldKeepWorkspaceSelection =
        previous.selectedWorkspaceId &&
        previous.workspaces.some(
          (workspace) =>
            workspace.id === previous.selectedWorkspaceId &&
            workspace.projectIds.includes(result.project.id),
        );

      return sanitizeState({
        ...previous,
        projects: result.projects,
        selectedWorkspaceId: shouldKeepWorkspaceSelection ? previous.selectedWorkspaceId : '',
        selectedProjectId: result.project.id,
      });
    });

    return openedProject;
  }, []);

  const addProjectToWorkspace = React.useCallback(
    (workspaceId: string, folderPath: string): WorkspaceRecord | null => {
      let addedProject: WorkspaceRecord | null = null;

      setState((previous) => {
        const workspace = previous.workspaces.find((item) => item.id === workspaceId);
        if (!workspace) {
          return previous;
        }

        const result = upsertProject(previous.projects, folderPath);
        if (!result) {
          return previous;
        }

        addedProject = result.project;

        return sanitizeState({
          ...previous,
          projects: result.projects,
          workspaces: previous.workspaces.map((item) =>
            item.id === workspaceId
              ? {
                  ...item,
                  projectIds: Array.from(new Set([...item.projectIds, result.project.id])),
                  lastOpenedAt: Date.now(),
                }
              : item,
          ),
          selectedWorkspaceId: workspaceId,
          selectedProjectId:
            previous.selectedWorkspaceId === workspaceId
              ? result.project.id
              : previous.selectedProjectId,
        });
      });

      return addedProject;
    },
    [],
  );

  const selectedThread = React.useMemo(
    () => state.threads.find((thread) => thread.id === state.selectedThreadId),
    [state.selectedThreadId, state.threads],
  );

  const selectedWorkspace = React.useMemo(
    () => state.workspaces.find((workspace) => workspace.id === state.selectedWorkspaceId),
    [state.selectedWorkspaceId, state.workspaces],
  );

  const selectedProject = React.useMemo(
    () => state.projects.find((project) => project.id === state.selectedProjectId),
    [state.projects, state.selectedProjectId],
  );

  const threadGroups = React.useMemo<ThreadGroupView[]>(() => {
    return state.projects.map((project) => ({
      id: `group-${project.id}`,
      label: project.name,
      projectId: project.id,
      path: project.path,
      threads: state.threads.filter((thread) => thread.projectId === project.id),
    }));
  }, [state.projects, state.threads]);

  const recentProjects = React.useMemo(
    () => getMostRecentProjects(state.projects),
    [state.projects],
  );

  return {
    projects: state.projects,
    recentProjects,
    workspaces: state.workspaces,
    threadGroups,
    selectedThread,
    selectedWorkspace,
    selectedProject,
    selectedThreadId: state.selectedThreadId,
    selectedWorkspaceId: state.selectedWorkspaceId,
    selectedProjectId: state.selectedProjectId,
    selectThread,
    clearThreadSelection,
    selectWorkspace,
    selectProject,
    createThread,
    setThreadProject,
    setThreadStatus,
    moveThreadInBoard,
    updateThreadFromMessage,
    updateThreadUpdatedAt,
    applyAutoThreadTitle,
    renameThread,
    removeThread,
    reorderProjects,
    reorderThreads,
    createWorkspace,
    renameWorkspace,
    removeWorkspace,
    openWorkspaceFromPath,
    addProjectToWorkspace,
  };
};
