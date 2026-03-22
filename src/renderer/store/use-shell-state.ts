import * as React from 'react';

export interface WorkspaceRecord {
  id: string;
  name: string;
  path: string;
  lastOpenedAt: number;
}

export interface ThreadRecord {
  id: string;
  workspaceId: string;
  title: string;
  titleSource: 'auto' | 'manual';
  preview: string;
  updatedAtMs: number;
}

export interface ThreadGroupView {
  id: string;
  label: string;
  workspaceId: string;
  path: string;
  threads: ThreadRecord[];
}

interface ShellState {
  workspaces: WorkspaceRecord[];
  threads: ThreadRecord[];
  selectedThreadId: string;
  selectedWorkspaceId: string;
}

const STORAGE_KEY = 'zeroade.shell.state.v2';
const MAX_RECENT_WORKSPACES = 8;
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;
const MONTH_MS = 30 * DAY_MS;

const EMPTY_STATE: ShellState = {
  workspaces: [],
  threads: [],
  selectedThreadId: '',
  selectedWorkspaceId: '',
};

const LEGACY_DEMO_WORKSPACE_IDS = new Set([
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

const UNASSIGNED_WORKSPACE_ID = '';

const normalizeMessageText = (value: string): string =>
  value.replace(/\s+/g, ' ').trim();

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
  workspaceName: string,
): ThreadRecord => {
  const suffix = Date.now().toString(36);

  return {
    id: `thread-${slugify(workspaceName)}-${suffix}`,
    workspaceId: UNASSIGNED_WORKSPACE_ID,
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

const isUnassignedThread = (thread: ThreadRecord): boolean =>
  thread.workspaceId.trim().length === 0;

const compareThreadsByRecentActivity = (left: ThreadRecord, right: ThreadRecord): number => {
  const leftUpdatedAt = Number.isFinite(left.updatedAtMs) ? left.updatedAtMs : 0;
  const rightUpdatedAt = Number.isFinite(right.updatedAtMs) ? right.updatedAtMs : 0;
  if (rightUpdatedAt !== leftUpdatedAt) {
    return rightUpdatedAt - leftUpdatedAt;
  }

  return left.title.localeCompare(right.title);
};

const isLegacyDemoState = (state: ShellState): boolean => {
  if (state.workspaces.length === 0 && state.threads.length === 0) {
    return false;
  }

  const workspacesMatch =
    state.workspaces.length > 0 &&
    state.workspaces.every((workspace) => LEGACY_DEMO_WORKSPACE_IDS.has(workspace.id));
  const threadsMatch =
    state.threads.length > 0 &&
    state.threads.every(
      (thread) =>
        LEGACY_DEMO_THREAD_IDS.has(thread.id) &&
        LEGACY_DEMO_WORKSPACE_IDS.has(thread.workspaceId),
    );
  const selectedWorkspaceMatches =
    !state.selectedWorkspaceId ||
    LEGACY_DEMO_WORKSPACE_IDS.has(state.selectedWorkspaceId);
  const selectedThreadMatches =
    !state.selectedThreadId ||
    LEGACY_DEMO_THREAD_IDS.has(state.selectedThreadId);

  return workspacesMatch && threadsMatch && selectedWorkspaceMatches && selectedThreadMatches;
};

const parsePersistedState = (): ShellState => {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return EMPTY_STATE;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<ShellState>;

    if (
      !parsed ||
      !Array.isArray(parsed.workspaces) ||
      !Array.isArray(parsed.threads) ||
      typeof parsed.selectedThreadId !== 'string' ||
      typeof parsed.selectedWorkspaceId !== 'string'
    ) {
      return EMPTY_STATE;
    }

    const normalizedThreads = (parsed.threads as Array<
      ThreadRecord & {
        updatedAt?: unknown;
      }
    >).map((thread) => {
      const previewSource =
        typeof thread.preview === 'string' ? thread.preview : '';

      return {
        ...thread,
        titleSource:
          thread.titleSource === 'manual' || thread.titleSource === 'auto'
            ? thread.titleSource
            : isDefaultThreadTitle(thread.title)
              ? 'auto'
              : 'manual',
        preview: toThreadPreviewFromPrompt(previewSource),
        updatedAtMs: parseLegacyUpdatedAtMs(thread.updatedAtMs ?? thread.updatedAt),
      };
    });

    const nextState: ShellState = {
      workspaces: parsed.workspaces as WorkspaceRecord[],
      threads: normalizedThreads,
      selectedThreadId: parsed.selectedThreadId,
      selectedWorkspaceId: parsed.selectedWorkspaceId,
    };

    if (isLegacyDemoState(nextState)) {
      return EMPTY_STATE;
    }

    return nextState;
  } catch {
    return EMPTY_STATE;
  }
};

const getMostRecentWorkspaceOrder = (
  workspaces: WorkspaceRecord[],
): WorkspaceRecord[] => {
  return [...workspaces]
    .sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)
    .slice(0, MAX_RECENT_WORKSPACES);
};

export const useShellState = (): {
  workspaces: WorkspaceRecord[];
  recentWorkspaces: WorkspaceRecord[];
  threadGroups: ThreadGroupView[];
  selectedThread: ThreadRecord | undefined;
  selectedWorkspace: WorkspaceRecord | undefined;
  selectedThreadId: string;
  selectedWorkspaceId: string;
  selectThread: (threadId: string) => void;
  selectWorkspace: (workspaceId: string) => void;
  createThreadInWorkspace: (workspaceId: string) => void;
  bindThreadToWorkspace: (
    threadId: string,
    workspaceId: string,
    firstMessage: string,
  ) => void;
  updateThreadFromMessage: (
    threadId: string,
    message: string,
    options?: {
      allowAutoTitle?: boolean;
      touchUpdatedAt?: boolean;
    },
  ) => void;
  updateThreadUpdatedAt: (threadId: string, updatedAtMs: number) => void;
  applyAutoThreadTitle: (threadId: string, title: string) => void;
  renameThread: (threadId: string, title: string) => void;
  removeThread: (threadId: string) => void;
  renameWorkspace: (workspaceId: string, name: string) => void;
  removeWorkspace: (workspaceId: string) => void;
  openWorkspaceFromPath: (folderPath: string) => void;
} => {
  const [state, setState] = React.useState<ShellState>(() => parsePersistedState());

  React.useEffect(() => {
    setState((previous) => {
      let didUpdate = false;
      const normalizedThreads = previous.threads.map((thread) => {
        const nextPreview = toThreadPreviewFromPrompt(thread.preview);
        if (nextPreview === thread.preview) {
          return thread;
        }

        didUpdate = true;
        return {
          ...thread,
          preview: nextPreview,
        };
      });

      if (!didUpdate) {
        return previous;
      }

      return {
        ...previous,
        threads: normalizedThreads,
      };
    });
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

      return {
        ...previous,
        selectedThreadId: thread.id,
        selectedWorkspaceId: isUnassignedThread(thread)
          ? previous.selectedWorkspaceId
          : thread.workspaceId,
      };
    });
  }, []);

  const selectWorkspace = React.useCallback((workspaceId: string) => {
    setState((previous) => {
      const workspaceExists = previous.workspaces.some(
        (workspace) => workspace.id === workspaceId,
      );
      if (!workspaceExists) {
        return previous;
      }

      const selectedThreadInWorkspace = previous.threads.find(
        (thread) => thread.id === previous.selectedThreadId && thread.workspaceId === workspaceId,
      );
      const selectedThread = previous.threads.find(
        (thread) => thread.id === previous.selectedThreadId,
      );
      const shouldPreserveSelectedThread =
        Boolean(selectedThread) && isUnassignedThread(selectedThread);

      const fallbackThread = previous.threads.find(
        (thread) => thread.workspaceId === workspaceId,
      );

      return {
        ...previous,
        selectedWorkspaceId: workspaceId,
        selectedThreadId:
          shouldPreserveSelectedThread
            ? previous.selectedThreadId
            : selectedThreadInWorkspace?.id ?? fallbackThread?.id ?? previous.selectedThreadId,
      };
    });
  }, []);

  const createThreadInWorkspace = React.useCallback((workspaceId: string) => {
    setState((previous) => {
      const workspace = previous.workspaces.find((item) => item.id === workspaceId);
      if (!workspace) {
        return previous;
      }

      const thread = createNewChatThread(workspace.name);

      return {
        ...previous,
        threads: [thread, ...previous.threads],
        selectedWorkspaceId: workspaceId,
        selectedThreadId: thread.id,
      };
    });
  }, []);

  const bindThreadToWorkspace = React.useCallback(
    (threadId: string, workspaceId: string, firstMessage: string) => {
      const trimmedMessage = normalizeMessageText(firstMessage);
      if (!threadId || !workspaceId || !trimmedMessage) {
        return;
      }

      setState((previous) => {
        const thread = previous.threads.find((item) => item.id === threadId);
        if (!thread) {
          return previous;
        }

        const workspaceExists = previous.workspaces.some(
          (workspace) => workspace.id === workspaceId,
        );
        if (!workspaceExists) {
          return previous;
        }

        const shouldRename =
          thread.titleSource !== 'manual' &&
          (isUnassignedThread(thread) || isDefaultThreadTitle(thread.title));

        const nextThread: ThreadRecord = {
          ...thread,
          workspaceId,
          title: shouldRename ? toThreadTitleFromPrompt(trimmedMessage) : thread.title,
          titleSource: shouldRename ? 'auto' : thread.titleSource,
          preview: toThreadPreviewFromPrompt(trimmedMessage),
          updatedAtMs: Date.now(),
        };

        return {
          ...previous,
          threads: [nextThread, ...previous.threads.filter((item) => item.id !== threadId)],
          selectedWorkspaceId: workspaceId,
          selectedThreadId: threadId,
        };
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
      },
    ) => {
      const trimmedMessage = normalizeMessageText(message);
      if (!threadId || !trimmedMessage) {
        return;
      }

      const allowAutoTitle = options?.allowAutoTitle ?? true;
      const touchUpdatedAt = options?.touchUpdatedAt ?? true;

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
          title: shouldRename ? toThreadTitleFromPrompt(trimmedMessage) : thread.title,
          titleSource: shouldRename ? 'auto' : thread.titleSource,
          preview: toThreadPreviewFromPrompt(trimmedMessage),
          updatedAtMs: touchUpdatedAt ? Date.now() : thread.updatedAtMs,
        };

        if (
          nextThread.title === thread.title &&
          nextThread.titleSource === thread.titleSource &&
          nextThread.preview === thread.preview &&
          nextThread.updatedAtMs === thread.updatedAtMs
        ) {
          return previous;
        }

        return {
          ...previous,
          threads: [nextThread, ...previous.threads.filter((item) => item.id !== threadId)],
        };
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

      return {
        ...previous,
        threads: [nextThread, ...previous.threads.filter((item) => item.id !== threadId)],
      };
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

      return {
        ...previous,
        threads,
      };
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

      return {
        ...previous,
        threads,
      };
    });
  }, []);

  const removeThread = React.useCallback((threadId: string) => {
    if (!threadId) {
      return;
    }

    setState((previous) => {
      const hasThread = previous.threads.some((thread) => thread.id === threadId);
      if (!hasThread) {
        return previous;
      }

      const threads = previous.threads.filter((thread) => thread.id !== threadId);
      const hasCurrentSelection = threads.some(
        (thread) => thread.id === previous.selectedThreadId,
      );
      const selectedWorkspaceExists = previous.workspaces.some(
        (workspace) => workspace.id === previous.selectedWorkspaceId,
      );

      const fallbackThread =
        threads.find((thread) => thread.workspaceId === previous.selectedWorkspaceId) ??
        threads[0];

      const nextSelectedThreadId = hasCurrentSelection
        ? previous.selectedThreadId
        : fallbackThread?.id ?? '';

      const nextSelectedWorkspaceId = fallbackThread?.workspaceId?.trim()
        ? fallbackThread.workspaceId
        : selectedWorkspaceExists
          ? previous.selectedWorkspaceId
          : previous.workspaces[0]?.id ?? '';

      return {
        ...previous,
        threads,
        selectedThreadId: nextSelectedThreadId,
        selectedWorkspaceId: nextSelectedWorkspaceId,
      };
    });
  }, []);

  const renameWorkspace = React.useCallback((workspaceId: string, name: string) => {
    const nextName = name.trim();
    if (!nextName) {
      return;
    }

    setState((previous) => {
      const hasWorkspace = previous.workspaces.some((workspace) => workspace.id === workspaceId);
      if (!hasWorkspace) {
        return previous;
      }

      return {
        ...previous,
        workspaces: previous.workspaces.map((workspace) =>
          workspace.id === workspaceId
            ? {
                ...workspace,
                name: nextName,
              }
            : workspace,
        ),
      };
    });
  }, []);

  const removeWorkspace = React.useCallback((workspaceId: string) => {
    setState((previous) => {
      const hasWorkspace = previous.workspaces.some((workspace) => workspace.id === workspaceId);
      if (!hasWorkspace) {
        return previous;
      }

      const workspaces = previous.workspaces.filter((workspace) => workspace.id !== workspaceId);
      const threads = previous.threads.filter((thread) => thread.workspaceId !== workspaceId);

      let nextSelectedWorkspaceId =
        previous.selectedWorkspaceId === workspaceId ? workspaces[0]?.id ?? '' : previous.selectedWorkspaceId;
      const hasSelectedWorkspace = workspaces.some(
        (workspace) => workspace.id === nextSelectedWorkspaceId,
      );
      if (!hasSelectedWorkspace) {
        nextSelectedWorkspaceId = workspaces[0]?.id ?? '';
      }

      let nextSelectedThreadId = threads.some((thread) => thread.id === previous.selectedThreadId)
        ? previous.selectedThreadId
        : '';

      if (!nextSelectedThreadId) {
        const preferredThread =
          threads.find((thread) => thread.workspaceId === nextSelectedWorkspaceId) ?? threads[0];

        nextSelectedThreadId = preferredThread?.id ?? '';
        nextSelectedWorkspaceId = preferredThread?.workspaceId ?? nextSelectedWorkspaceId;
      }

      return {
        ...previous,
        workspaces,
        threads,
        selectedWorkspaceId: nextSelectedWorkspaceId,
        selectedThreadId: nextSelectedThreadId,
      };
    });
  }, []);

  const openWorkspaceFromPath = React.useCallback((folderPath: string) => {
    const workspaceName = getFolderName(folderPath);

    setState((previous) => {
      const existing = previous.workspaces.find(
        (workspace) => workspace.path === folderPath,
      );
      const timestamp = Date.now();

      if (existing) {
        const refreshedWorkspace: WorkspaceRecord = {
          ...existing,
          lastOpenedAt: timestamp,
        };

        const workspaces = getMostRecentWorkspaceOrder([
          refreshedWorkspace,
          ...previous.workspaces.filter((workspace) => workspace.id !== existing.id),
        ]);

        const selectedThread = previous.threads.find(
          (thread) => thread.workspaceId === existing.id,
        );

        return {
          ...previous,
          workspaces,
          threads: previous.threads,
          selectedWorkspaceId: existing.id,
          selectedThreadId: selectedThread?.id ?? '',
        };
      }

      const workspaceId = `workspace-${slugify(workspaceName)}-${timestamp.toString(36)}`;
      const workspace: WorkspaceRecord = {
        id: workspaceId,
        name: workspaceName,
        path: folderPath,
        lastOpenedAt: timestamp,
      };

      return {
        workspaces: getMostRecentWorkspaceOrder([workspace, ...previous.workspaces]),
        threads: previous.threads,
        selectedWorkspaceId: workspaceId,
        selectedThreadId: '',
      };
    });
  }, []);

  const selectedThread = React.useMemo(
    () => state.threads.find((thread) => thread.id === state.selectedThreadId),
    [state.selectedThreadId, state.threads],
  );

  const selectedWorkspace = React.useMemo(
    () =>
      state.workspaces.find(
        (workspace) => workspace.id === state.selectedWorkspaceId,
      ),
    [state.selectedWorkspaceId, state.workspaces],
  );

  const threadGroups = React.useMemo<ThreadGroupView[]>(() => {
    return state.workspaces
      .map((workspace) => ({
        id: `group-${workspace.id}`,
        label: workspace.name,
        workspaceId: workspace.id,
        path: workspace.path,
        threads: state.threads
          .filter((thread) => thread.workspaceId === workspace.id)
          .sort(compareThreadsByRecentActivity),
      }));
  }, [state.threads, state.workspaces]);

  const recentWorkspaces = React.useMemo(
    () => getMostRecentWorkspaceOrder(state.workspaces),
    [state.workspaces],
  );

  return {
    workspaces: state.workspaces,
    recentWorkspaces,
    threadGroups,
    selectedThread,
    selectedWorkspace,
    selectedThreadId: state.selectedThreadId,
    selectedWorkspaceId: state.selectedWorkspaceId,
    selectThread,
    selectWorkspace,
    createThreadInWorkspace,
    bindThreadToWorkspace,
    updateThreadFromMessage,
    updateThreadUpdatedAt,
    applyAutoThreadTitle,
    renameThread,
    removeThread,
    renameWorkspace,
    removeWorkspace,
    openWorkspaceFromPath,
  };
};
