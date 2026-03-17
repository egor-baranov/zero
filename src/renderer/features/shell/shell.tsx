import * as React from 'react';
import { Ellipsis, Loader2, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { Sidebar } from '@renderer/features/sidebar/sidebar';
import { Composer, type AgentPresetSelection } from '@renderer/features/composer/composer';
import { Transcript } from '@renderer/features/transcript/transcript';
import { ToolbarActions } from '@renderer/features/toolbar/toolbar-actions';
import { RunConfigurationDialog } from '@renderer/features/toolbar/run-configuration-dialog';
import { CommitDialog } from '@renderer/features/toolbar/commit-dialog';
import { RenameThreadDialog } from '@renderer/features/shell/rename-thread-dialog';
import {
  CommandPalette,
  type CommandPaletteItem,
} from '@renderer/features/command-palette/command-palette';
import { TerminalPanel } from '@renderer/features/terminal/terminal-panel';
import { FileTreeDialog } from '@renderer/features/workspace/file-tree-dialog';
import { ReviewPanel } from '@renderer/features/workspace/review-panel';
import { WebBrowserPanel } from '@renderer/features/workspace/web-browser-panel';
import { SettingsLayout } from '@renderer/features/settings/settings-layout';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@renderer/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@renderer/components/ui/tooltip';
import { Button } from '@renderer/components/ui/button';
import { cn } from '@renderer/lib/cn';
import { useSidebarWidth } from '@renderer/store/use-sidebar-width';
import { useShellState } from '@renderer/store/use-shell-state';
import { useAcp, type TimelineItem } from '@renderer/store/use-acp';
import { useWorkspaceReview } from '@renderer/store/use-workspace-review';
import type { AcpCustomAgentConfig, AcpPromptAttachment } from '@shared/types/acp';
import type { UpdaterState } from '@shared/types/updater';

const getFolderName = (folderPath: string): string =>
  folderPath.split(/[\\/]/).filter(Boolean).pop() ?? folderPath;
const RUN_CONFIGURATION_COMMAND_KEY = 'zeroade.run.command';
const normalizeMessageText = (value: string): string =>
  value.replace(/\s+/g, ' ').trim();

interface LatestTimelineMessage {
  id: string;
  text: string;
}

interface AssistantTimelineMessageOptions {
  noticeKind?: 'agent-change';
  iconUrl?: string | null;
}

const getLatestTimelineMessage = (
  timeline: TimelineItem[],
): LatestTimelineMessage | null => {
  for (let index = timeline.length - 1; index >= 0; index -= 1) {
    const item = timeline[index];
    if (
      (item.kind === 'user-message' || item.kind === 'assistant-message') &&
      item.text.trim().length > 0
    ) {
      return {
        id: item.id,
        text: normalizeMessageText(item.text),
      };
    }
  }

  return null;
};

const createAssistantTimelineMessage = (
  text: string,
  options?: AssistantTimelineMessageOptions,
): TimelineItem => ({
  kind: 'assistant-message',
  id: `assistant-system-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  text,
  noticeKind: options?.noticeKind,
  iconUrl: options?.iconUrl ?? null,
});

const appendAssistantTimelineMessage = (
  timeline: TimelineItem[],
  text: string,
  options?: AssistantTimelineMessageOptions,
): TimelineItem[] => {
  const normalizedTargetText = normalizeMessageText(text);
  const last = timeline[timeline.length - 1];
  if (
    last &&
    last.kind === 'assistant-message' &&
    normalizeMessageText(last.text) === normalizedTargetText
  ) {
    return timeline;
  }

  return [...timeline, createAssistantTimelineMessage(text, options)];
};

const mergeTimelineItems = (
  existing: TimelineItem[],
  incoming: TimelineItem[],
): TimelineItem[] => {
  if (incoming.length === 0) {
    return existing;
  }

  if (existing.length === 0) {
    return incoming;
  }

  const next = [...existing];
  const indexById = new Map<string, number>();
  for (let index = 0; index < next.length; index += 1) {
    indexById.set(next[index].id, index);
  }

  let changed = false;
  for (const item of incoming) {
    const existingIndex = indexById.get(item.id);
    if (existingIndex === undefined) {
      next.push(item);
      indexById.set(item.id, next.length - 1);
      changed = true;
      continue;
    }

    if (next[existingIndex] !== item) {
      next[existingIndex] = item;
      changed = true;
    }
  }

  return changed ? next : existing;
};

const toCustomAgentConfigSignature = (
  config: AcpCustomAgentConfig | null | undefined,
): string | null => {
  if (!config) {
    return null;
  }

  return JSON.stringify({
    command: config.command.trim(),
    args: config.args.map((entry) => entry.trim()).filter((entry) => entry.length > 0),
    cwd: config.cwd?.trim() ?? '',
    env: Object.entries(config.env ?? {})
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => [key, value]),
  });
};

interface BrowserOpenRequest {
  id: number;
  url: string;
}

interface QueuedPrompt {
  id: string;
  threadId: string;
  text: string;
  attachments: AcpPromptAttachment[];
}

interface RenameThreadTarget {
  threadId: string;
  initialTitle: string;
}

interface ShellToast {
  id: number;
  title: string;
  message: string;
}

const TOAST_LIFETIME_MS = 7_000;
const REVIEW_PANEL_WIDTH_KEY = 'zeroade.review-panel.width.v1';
const REVIEW_PANEL_WIDTH_DEFAULT = 560;
const REVIEW_PANEL_WIDTH_MIN = 320;
const REVIEW_PANEL_WIDTH_MAX = 980;
const REVIEW_PANEL_CHAT_MIN_WIDTH = 420;
const ANSI_ESCAPE_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'gi');
const LOOSE_ANSI_PATTERN = /\[(?:\d{1,3}(?:;\d{1,3})*)m/gi;

const clampReviewPanelWidth = (value: number, availableWidth: number): number => {
  const dynamicMax = Math.max(
    REVIEW_PANEL_WIDTH_MIN,
    Math.min(REVIEW_PANEL_WIDTH_MAX, availableWidth - REVIEW_PANEL_CHAT_MIN_WIDTH),
  );

  return Math.min(Math.max(value, REVIEW_PANEL_WIDTH_MIN), dynamicMax);
};

const readStoredReviewPanelWidth = (): number => {
  const raw = window.localStorage.getItem(REVIEW_PANEL_WIDTH_KEY);
  if (!raw) {
    return REVIEW_PANEL_WIDTH_DEFAULT;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    return REVIEW_PANEL_WIDTH_DEFAULT;
  }

  return Math.min(Math.max(parsed, REVIEW_PANEL_WIDTH_MIN), REVIEW_PANEL_WIDTH_MAX);
};

const toCleanErrorText = (value: string): string =>
  value
    .replace(ANSI_ESCAPE_PATTERN, '')
    .replace(LOOSE_ANSI_PATTERN, '')
    .replace(/\s+/g, ' ')
    .trim();

const toErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  return String(error);
};

const isAuthenticationRequiredMessage = (value: string): boolean => {
  const normalized = value.toLowerCase();
  return (
    normalized.includes('authentication required') ||
    normalized.includes('please run') ||
    normalized.includes('call authenticate(') ||
    normalized.includes('authenticate agent')
  );
};

export const Shell = (): JSX.Element => {
  const {
    sidebarWidth,
    activeSidebarWidth,
    isCollapsed,
    isResizing,
    toggleCollapsed,
    startResizing,
  } = useSidebarWidth();

  const {
    workspaces,
    recentWorkspaces,
    threadGroups,
    selectedThread,
    selectedWorkspace,
    selectedThreadId,
    selectedWorkspaceId,
    selectThread,
    selectWorkspace,
    createThreadInWorkspace,
    bindThreadToWorkspace,
    updateThreadFromMessage,
    applyAutoThreadTitle,
    renameThread,
    removeThread,
    renameWorkspace,
    removeWorkspace,
    openWorkspaceFromPath,
  } = useShellState();

  const {
    connectionState,
    connectionMessage,
    agentPreset,
    codexAgentConfig,
    claudeAgentConfig,
    customAgentConfig,
    activeTimeline,
    threadPromptingById,
    threadSessionTitleById,
    activeSessionControls,
    pendingPermission,
    setAgentPreset,
    saveAgentConfig,
    ensureSessionForThread,
    sendPrompt,
    authenticate,
    setSessionMode,
    setSessionModel,
    setSessionConfigOption,
    cancelPrompt,
    resolvePermission,
  } = useAcp();

  const [statusText, setStatusText] = React.useState('Shell ready');
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = React.useState(false);
  const [isTerminalOpen, setIsTerminalOpen] = React.useState(false);
  const [isRunConfigurationOpen, setIsRunConfigurationOpen] = React.useState(false);
  const [isCommitDialogOpen, setIsCommitDialogOpen] = React.useState(false);
  const [isWebBrowserOpen, setIsWebBrowserOpen] = React.useState(false);
  const [browserOpenRequest, setBrowserOpenRequest] = React.useState<BrowserOpenRequest | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = React.useState(false);
  const [runConfigurationCommand, setRunConfigurationCommand] = React.useState('');
  const [threadRenameTarget, setThreadRenameTarget] =
    React.useState<RenameThreadTarget | null>(null);
  const [completedThreadIds, setCompletedThreadIds] = React.useState<Set<string>>(
    () => new Set(),
  );
  const [runRequest, setRunRequest] = React.useState<{
    id: number;
    command: string;
  } | null>(null);
  const [queuedPromptsByThread, setQueuedPromptsByThread] = React.useState<
    Record<string, QueuedPrompt[]>
  >({});
  const [timelineSnapshotByThreadId, setTimelineSnapshotByThreadId] = React.useState<
    Record<string, TimelineItem[]>
  >({});
  const [toasts, setToasts] = React.useState<ShellToast[]>([]);
  const [updaterState, setUpdaterState] = React.useState<UpdaterState | null>(null);
  const [isAgentAuthRequired, setIsAgentAuthRequired] = React.useState(false);
  const [isAgentAuthLaunching, setIsAgentAuthLaunching] = React.useState(false);
  const [agentAuthMessage, setAgentAuthMessage] = React.useState<string | null>(null);
  const [composerPrefillRequest, setComposerPrefillRequest] = React.useState<{
    id: number;
    text: string;
  } | null>(null);
  const [reviewPanelWidth, setReviewPanelWidth] = React.useState<number>(() =>
    readStoredReviewPanelWidth(),
  );
  const [isReviewPanelResizing, setIsReviewPanelResizing] = React.useState(false);
  const lastShiftTapAtRef = React.useRef(0);
  const dispatchingQueuedPromptRef = React.useRef(false);
  const blockedQueuedPromptIdRef = React.useRef<string | null>(null);
  const previousThreadPromptingByIdRef = React.useRef<Record<string, boolean>>({});
  const appliedSessionTitleByThreadRef = React.useRef<Record<string, string>>({});
  const syncedPreviewByThreadRef = React.useRef<Record<string, string>>({});
  const connectionErrorToastRef = React.useRef('');
  const toastTimeoutByIdRef = React.useRef<Record<number, number>>({});
  const composerPrefillIdRef = React.useRef(0);
  const reviewPanelResizeActiveRef = React.useRef(false);
  const reviewPanelContainerRef = React.useRef<HTMLDivElement | null>(null);

  const platform = window.desktop?.platform ?? 'darwin';
  const navigationZoneClass =
    platform === 'darwin' ? 'w-[150px] pl-[82px] pr-2' : 'w-12 px-2';

  const selectedThreadWorkspace = React.useMemo(() => {
    if (!selectedThread) {
      return selectedWorkspace;
    }

    return (
      workspaces.find((workspace) => workspace.id === selectedThread.workspaceId) ??
      selectedWorkspace
    );
  }, [selectedThread, selectedWorkspace, workspaces]);

  const workspacePath = selectedThreadWorkspace?.path ?? '/';

  const {
    isFileTreeOpen,
    isReviewPanelOpen,
    isReviewPanelVisible,
    isLoadingTree,
    isLoadingFile,
    files,
    reviewFiles,
    activeReviewFile,
    activeReviewFilePath,
    openFileTree,
    closeFileTree,
    closeReviewPanel,
    toggleReviewPanelVisibility,
    openFile,
    setActiveReviewFile,
    closeReviewFile,
    reorderReviewFiles,
  } = useWorkspaceReview(workspacePath);

  const ensureSessionForThreadRef = React.useRef(ensureSessionForThread);

  React.useEffect(() => {
    ensureSessionForThreadRef.current = ensureSessionForThread;
  }, [ensureSessionForThread]);

  React.useEffect(() => {
    void ensureSessionForThreadRef.current(selectedThreadId, workspacePath).catch(() => {
      // Keep the shell interactive even if ACP startup fails.
    });
  }, [agentPreset, selectedThreadId, workspacePath]);

  React.useEffect(() => {
    if (connectionState === 'ready') {
      setStatusText('Connected');
      return;
    }

    if (connectionState === 'connecting') {
      const connectingMessage = toCleanErrorText(connectionMessage ?? '');
      setStatusText(connectingMessage || 'Connecting ACP');
      return;
    }

    if (connectionState === 'error') {
      setStatusText('ACP unavailable');
      return;
    }

    setStatusText('Shell ready');
  }, [connectionMessage, connectionState]);

  const removeToast = React.useCallback((toastId: number) => {
    const timeoutId = toastTimeoutByIdRef.current[toastId];
    if (Number.isFinite(timeoutId)) {
      window.clearTimeout(timeoutId);
    }
    delete toastTimeoutByIdRef.current[toastId];

    setToasts((previous) => previous.filter((toast) => toast.id !== toastId));
  }, []);

  const pushErrorToast = React.useCallback(
    (title: string, message: string) => {
      const cleanedMessage = toCleanErrorText(message);
      if (!cleanedMessage) {
        return;
      }

      const toastId = Date.now() + Math.floor(Math.random() * 1000);
      setToasts((previous) => {
        const duplicate = previous.some(
          (toast) => toast.title === title && toast.message === cleanedMessage,
        );
        if (duplicate) {
          return previous;
        }

        return [
          ...previous,
          {
            id: toastId,
            title,
            message: cleanedMessage,
          },
        ].slice(-4);
      });

      toastTimeoutByIdRef.current[toastId] = window.setTimeout(() => {
        removeToast(toastId);
      }, TOAST_LIFETIME_MS);
    },
    [removeToast],
  );

  const handleSelectLandingSuggestion = React.useCallback((value: string) => {
    const nextText = value.trim();
    if (!nextText) {
      return;
    }

    composerPrefillIdRef.current += 1;
    setComposerPrefillRequest({
      id: composerPrefillIdRef.current,
      text: nextText,
    });
  }, []);

  const startAgentAuthentication = React.useCallback(async () => {
    if (isAgentAuthLaunching) {
      return;
    }

    setIsAgentAuthLaunching(true);
    setStatusText('Opening agent authentication');

    try {
      const result = await authenticate(workspacePath);
      if (!result.started) {
        setIsAgentAuthRequired(true);
        setAgentAuthMessage(result.message);
        pushErrorToast('Agent authentication', result.message);
        setStatusText('Agent authentication unavailable');
        return;
      }

      setIsAgentAuthRequired(result.requiresUserAction);
      setAgentAuthMessage(result.message || null);
      setStatusText(
        result.requiresUserAction
          ? 'Complete authentication in terminal'
          : 'Agent authenticated',
      );
    } catch (error) {
      const message = toCleanErrorText(toErrorMessage(error));
      setIsAgentAuthRequired(true);
      setAgentAuthMessage(message || 'Failed to launch agent authentication.');
      setStatusText('Agent authentication failed to start');
      pushErrorToast(
        'Agent authentication',
        message || 'Failed to launch agent authentication.',
      );
    } finally {
      setIsAgentAuthLaunching(false);
    }
  }, [authenticate, isAgentAuthLaunching, pushErrorToast, workspacePath]);

  React.useEffect(() => {
    return () => {
      for (const timeoutId of Object.values(toastTimeoutByIdRef.current)) {
        window.clearTimeout(timeoutId);
      }
      toastTimeoutByIdRef.current = {};
    };
  }, []);

  React.useEffect(() => {
    let isActive = true;

    void window.desktop.updaterGetState().then((state) => {
      if (!isActive) {
        return;
      }

      setUpdaterState(state);
    });

    const unsubscribe = window.desktop.onUpdaterEvent((event) => {
      if (!isActive) {
        return;
      }

      setUpdaterState(event.state);
    });

    return () => {
      isActive = false;
      unsubscribe();
    };
  }, []);

  const stopReviewPanelResizing = React.useCallback(() => {
    if (!reviewPanelResizeActiveRef.current) {
      return;
    }

    reviewPanelResizeActiveRef.current = false;
    setIsReviewPanelResizing(false);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, []);

  React.useEffect(() => {
    const handlePointerMove = (event: PointerEvent): void => {
      if (!reviewPanelResizeActiveRef.current) {
        return;
      }

      const bounds = reviewPanelContainerRef.current?.getBoundingClientRect();
      if (!bounds) {
        return;
      }

      const nextWidth = clampReviewPanelWidth(event.clientX - bounds.left, bounds.width);
      setReviewPanelWidth(nextWidth);
      window.localStorage.setItem(REVIEW_PANEL_WIDTH_KEY, String(nextWidth));
    };

    const stopResizing = (): void => {
      stopReviewPanelResizing();
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
      stopReviewPanelResizing();
    };
  }, [stopReviewPanelResizing]);

  React.useEffect(() => {
    if (!isReviewPanelOpen) {
      return;
    }

    const clampToAvailableSpace = (): void => {
      const bounds = reviewPanelContainerRef.current?.getBoundingClientRect();
      if (!bounds) {
        return;
      }

      setReviewPanelWidth((previous) => {
        const next = clampReviewPanelWidth(previous, bounds.width);
        if (next !== previous) {
          window.localStorage.setItem(REVIEW_PANEL_WIDTH_KEY, String(next));
        }
        return next;
      });
    };

    clampToAvailableSpace();
    window.addEventListener('resize', clampToAvailableSpace);

    return () => {
      window.removeEventListener('resize', clampToAvailableSpace);
    };
  }, [isReviewPanelOpen]);

  React.useEffect(() => {
    if (connectionState !== 'error') {
      if (connectionState === 'ready') {
        connectionErrorToastRef.current = '';
      }
      return;
    }

    const cleaned = toCleanErrorText(connectionMessage ?? '');
    if (!cleaned || connectionErrorToastRef.current === cleaned) {
      return;
    }

    connectionErrorToastRef.current = cleaned;
    pushErrorToast('ACP error', cleaned);
  }, [connectionMessage, connectionState, pushErrorToast]);

  const connectingStatusMessage = React.useMemo(() => {
    if (connectionState !== 'connecting') {
      return null;
    }

    const cleaned = toCleanErrorText(connectionMessage ?? '');
    return cleaned || 'Connecting…';
  }, [connectionMessage, connectionState]);

  const composerDisabledMessage = React.useMemo(() => {
    if (connectionState === 'connecting') {
      return connectingStatusMessage;
    }

    return null;
  }, [connectingStatusMessage, connectionState]);
  const isComposerDisabled = connectionState === 'connecting';

  const updateButtonLabel = React.useMemo(() => {
    if (!updaterState) {
      return 'Update';
    }

    if (updaterState.status === 'available') {
      return 'Downloading…';
    }

    if (updaterState.status === 'checking') {
      return 'Checking…';
    }

    if (updaterState.status === 'downloading') {
      const percent = updaterState.downloadProgressPercent;
      if (typeof percent === 'number' && Number.isFinite(percent)) {
        return `Downloading ${Math.round(percent)}%`;
      }

      return 'Downloading…';
    }

    if (updaterState.status === 'downloaded') {
      return 'Restart to update';
    }

    return 'Update';
  }, [updaterState]);

  const shouldShowUpdateButton =
    updaterState?.status === 'available' ||
    updaterState?.status === 'downloading' ||
    updaterState?.status === 'downloaded';

  const isUpdateButtonDisabled = updaterState?.status !== 'downloaded';

  const handleUpdateAction = React.useCallback(async () => {
    if (updaterState?.status !== 'downloaded') {
      return;
    }

    try {
      const result = await window.desktop.updaterInstallDownloadedUpdate();

      setStatusText(result.message);
      if (!result.ok) {
        pushErrorToast('Update', result.message);
      }
    } catch {
      const fallbackMessage = 'Update action failed.';
      setStatusText(fallbackMessage);
      pushErrorToast('Update', fallbackMessage);
    }
  }, [pushErrorToast, updaterState?.status]);

  const startReviewPanelResizing = React.useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      reviewPanelResizeActiveRef.current = true;
      setIsReviewPanelResizing(true);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    },
    [],
  );

  const handleOpenCommandPalette = React.useCallback(() => {
    setIsCommandPaletteOpen(true);
  }, []);

  const handleOpenFolder = React.useCallback(async () => {
    const result = await window.desktop.openFolder();

    if (result.canceled) {
      setStatusText('Open canceled');
      return;
    }

    if (result.path) {
      openWorkspaceFromPath(result.path);
      const folderName = getFolderName(result.path);
      setStatusText(`Loaded ${folderName}`);
      return;
    }

    setStatusText('No folder selected');
  }, [openWorkspaceFromPath]);

  const handleCreateThreadInGroup = React.useCallback(
    (workspaceId: string) => {
      const workspace = workspaces.find((item) => item.id === workspaceId);
      createThreadInWorkspace(workspaceId);
      setIsSettingsOpen(false);
      setStatusText(`New chat in ${workspace?.name ?? 'project'}`);
    },
    [createThreadInWorkspace, workspaces],
  );

  const handleRenameGroup = React.useCallback(
    (workspaceId: string) => {
      const workspace = workspaces.find((item) => item.id === workspaceId);
      if (!workspace) {
        return;
      }

      const nextName = window.prompt('Rename project', workspace.name);
      if (nextName === null) {
        return;
      }

      const trimmedName = nextName.trim();
      if (!trimmedName || trimmedName === workspace.name) {
        return;
      }

      renameWorkspace(workspaceId, trimmedName);
      setStatusText(`Renamed project to ${trimmedName}`);
    },
    [renameWorkspace, workspaces],
  );

  const handleRemoveGroup = React.useCallback(
    (workspaceId: string) => {
      const workspace = workspaces.find((item) => item.id === workspaceId);
      if (!workspace) {
        return;
      }

      const isConfirmed = window.confirm(
        `Remove "${workspace.name}" and all chats in this project?`,
      );
      if (!isConfirmed) {
        return;
      }

      removeWorkspace(workspaceId);
      closeFileTree();
      closeReviewPanel();
      setIsWebBrowserOpen(false);
      setStatusText(`Removed project ${workspace.name}`);
    },
    [closeFileTree, closeReviewPanel, removeWorkspace, workspaces],
  );

  const threadTitleById = React.useMemo(() => {
    const titles = new Map<string, string>();

    for (const group of threadGroups) {
      for (const thread of group.threads) {
        titles.set(thread.id, thread.title);
      }
    }

    if (selectedThread) {
      titles.set(selectedThread.id, selectedThread.title);
    }

    return titles;
  }, [selectedThread, threadGroups]);

  const threadById = React.useMemo(() => {
    const threads = new Map<string, { id: string; workspaceId: string; title: string }>();

    for (const group of threadGroups) {
      for (const thread of group.threads) {
        threads.set(thread.id, thread);
      }
    }

    if (selectedThread) {
      threads.set(selectedThread.id, selectedThread);
    }

    return threads;
  }, [selectedThread, threadGroups]);

  React.useEffect(() => {
    const availableThreadIds = new Set(threadById.keys());

    setQueuedPromptsByThread((previous) => {
      const nextEntries = Object.entries(previous).filter(([threadId]) =>
        availableThreadIds.has(threadId),
      );

      if (nextEntries.length === Object.keys(previous).length) {
        return previous;
      }

      return Object.fromEntries(nextEntries);
    });
  }, [threadById]);

  React.useEffect(() => {
    const previousPromptingById = previousThreadPromptingByIdRef.current;

    setCompletedThreadIds((previousCompleted) => {
      let nextCompleted = previousCompleted;
      let didChange = false;
      const threadIds = new Set([
        ...Object.keys(previousPromptingById),
        ...Object.keys(threadPromptingById),
      ]);

      for (const threadId of threadIds) {
        const wasPrompting = Boolean(previousPromptingById[threadId]);
        const isPrompting = Boolean(threadPromptingById[threadId]);

        if (!wasPrompting && !isPrompting) {
          continue;
        }

        if (wasPrompting && !isPrompting) {
          if (threadId === selectedThreadId) {
            if (nextCompleted.has(threadId)) {
              if (!didChange) {
                nextCompleted = new Set(nextCompleted);
                didChange = true;
              }
              nextCompleted.delete(threadId);
            }
            continue;
          }

          if (!nextCompleted.has(threadId)) {
            if (!didChange) {
              nextCompleted = new Set(nextCompleted);
              didChange = true;
            }
            nextCompleted.add(threadId);
          }
          continue;
        }

        if (!wasPrompting && isPrompting && nextCompleted.has(threadId)) {
          if (!didChange) {
            nextCompleted = new Set(nextCompleted);
            didChange = true;
          }
          nextCompleted.delete(threadId);
        }
      }

      return didChange ? nextCompleted : previousCompleted;
    });

    previousThreadPromptingByIdRef.current = threadPromptingById;
  }, [selectedThreadId, threadPromptingById]);

  React.useEffect(() => {
    setCompletedThreadIds((previous) => {
      let didChange = false;

      for (const threadId of previous) {
        if (!threadById.has(threadId)) {
          didChange = true;
          break;
        }
      }

      if (!didChange) {
        return previous;
      }

      return new Set(Array.from(previous).filter((threadId) => threadById.has(threadId)));
    });
  }, [threadById]);

  React.useEffect(() => {
    if (!threadRenameTarget) {
      return;
    }

    if (threadById.has(threadRenameTarget.threadId)) {
      return;
    }

    setThreadRenameTarget(null);
  }, [threadById, threadRenameTarget]);

  React.useEffect(() => {
    const appliedTitles = appliedSessionTitleByThreadRef.current;

    for (const [threadId, title] of Object.entries(threadSessionTitleById)) {
      if (appliedTitles[threadId] === title) {
        continue;
      }

      appliedTitles[threadId] = title;
      applyAutoThreadTitle(threadId, title);
    }

    for (const threadId of Object.keys(appliedTitles)) {
      if (threadSessionTitleById[threadId]) {
        continue;
      }

      delete appliedTitles[threadId];
    }
  }, [applyAutoThreadTitle, threadSessionTitleById]);

  const openRenameThreadDialog = React.useCallback(
    (threadId: string) => {
      if (!threadId || !threadTitleById.has(threadId)) {
        return;
      }

      const initialTitle = (threadTitleById.get(threadId) ?? '').trim() || 'New chat';
      window.setTimeout(() => {
        setThreadRenameTarget({
          threadId,
          initialTitle,
        });
      }, 0);
    },
    [threadTitleById],
  );

  const handleSaveRenamedThread = React.useCallback(
    (nextTitle: string) => {
      const target = threadRenameTarget;
      if (!target) {
        return;
      }

      const trimmedTitle = nextTitle.trim();
      if (!trimmedTitle || trimmedTitle === target.initialTitle.trim()) {
        setThreadRenameTarget(null);
        return;
      }

      if (!threadById.has(target.threadId)) {
        setThreadRenameTarget(null);
        return;
      }

      renameThread(target.threadId, trimmedTitle);
      setStatusText(`Renamed chat to ${trimmedTitle}`);
      setThreadRenameTarget(null);
    },
    [renameThread, threadById, threadRenameTarget],
  );

  const handleRemoveThread = React.useCallback(
    (threadId: string, currentTitle: string) => {
      const initialTitle = currentTitle.trim();
      if (!threadId || !initialTitle) {
        return;
      }

      const isConfirmed = window.confirm(`Remove "${initialTitle}" chat?`);
      if (!isConfirmed) {
        return;
      }

      removeThread(threadId);
      setStatusText(`Removed chat ${initialTitle}`);
    },
    [removeThread],
  );

  const handleCreateThread = React.useCallback(() => {
    const workspaceId =
      selectedWorkspaceId || selectedWorkspace?.id || threadGroups[0]?.workspaceId || workspaces[0]?.id;
    if (!workspaceId) {
      setStatusText('Open a project first');
      return;
    }

    handleCreateThreadInGroup(workspaceId);
  }, [handleCreateThreadInGroup, selectedWorkspace, selectedWorkspaceId, threadGroups, workspaces]);

  const handleToggleFileTree = React.useCallback(() => {
    if (isFileTreeOpen) {
      closeFileTree();
      return;
    }

    void openFileTree();
  }, [closeFileTree, isFileTreeOpen, openFileTree]);

  const handleOpenWebLink = React.useCallback((url: string) => {
    setIsSettingsOpen(false);
    setIsWebBrowserOpen(true);
    setBrowserOpenRequest({
      id: Date.now() + Math.floor(Math.random() * 1000),
      url,
    });
  }, []);

  const sendPromptToThread = React.useCallback(
    async (
      threadId: string,
      text: string,
      attachments: AcpPromptAttachment[],
    ): Promise<boolean> => {
      const thread = threadById.get(threadId);
      if (!thread) {
        setStatusText('Thread no longer exists');
        return false;
      }

      const threadWorkspaceId = thread.workspaceId ?? '';
      const targetWorkspaceId =
        threadWorkspaceId.trim().length > 0
          ? threadWorkspaceId
          : selectedWorkspaceId || workspaces[0]?.id || '';
      if (!targetWorkspaceId) {
        setStatusText('Open a project first');
        return false;
      }

      const targetWorkspace = workspaces.find(
        (workspace) => workspace.id === targetWorkspaceId,
      );
      if (!targetWorkspace) {
        setStatusText('Select a valid project first');
        return false;
      }

      const trimmedText = normalizeMessageText(text);
      if (!trimmedText) {
        return false;
      }

      const isDraftThread = threadWorkspaceId.trim().length === 0;
      try {
        await ensureSessionForThreadRef.current(threadId, targetWorkspace.path);
        if (isDraftThread) {
          bindThreadToWorkspace(threadId, targetWorkspaceId, trimmedText);
        } else {
          updateThreadFromMessage(threadId, trimmedText);
        }
        await sendPrompt(trimmedText, attachments);
        setIsAgentAuthRequired(false);
        setAgentAuthMessage(null);
      } catch (error) {
        const cleanedError = toCleanErrorText(toErrorMessage(error));
        if (isAuthenticationRequiredMessage(cleanedError)) {
          setIsAgentAuthRequired(true);
          setAgentAuthMessage(cleanedError || 'Authentication required. Use Authenticate agent.');
          setStatusText('Authentication required');
          pushErrorToast(
            'Authentication required',
            cleanedError || 'Authentication required. Use Authenticate agent.',
          );
          if (!isAgentAuthLaunching) {
            void startAgentAuthentication();
          }
          return false;
        }

        setStatusText('Failed to send prompt');
        pushErrorToast(
          'Send failed',
          cleanedError || 'Failed to send prompt. Please try again.',
        );
        return false;
      }

      return true;
    },
    [
      bindThreadToWorkspace,
      selectedWorkspaceId,
      sendPrompt,
      threadById,
      updateThreadFromMessage,
      workspaces,
      pushErrorToast,
      isAgentAuthLaunching,
      startAgentAuthentication,
    ],
  );

  const threadTitle = selectedThread?.title ?? 'No thread selected';
  const isNewThread = Boolean(
    selectedThread && selectedThread.workspaceId.trim().length === 0,
  );
  const fallbackTimeline = timelineSnapshotByThreadId[selectedThreadId] ?? [];
  const effectiveTimeline = React.useMemo(() => {
    if (isNewThread) {
      return [];
    }

    if (fallbackTimeline.length === 0) {
      return activeTimeline.items;
    }

    if (activeTimeline.items.length === 0) {
      return fallbackTimeline;
    }

    return mergeTimelineItems(fallbackTimeline, activeTimeline.items);
  }, [activeTimeline.items, fallbackTimeline, isNewThread]);
  const effectiveIsPrompting = isNewThread ? false : activeTimeline.isPrompting;
  const effectivePendingPermission = isNewThread ? null : pendingPermission;
  const hasSessionForSelectedThread = React.useMemo(
    () => Object.prototype.hasOwnProperty.call(threadPromptingById, selectedThreadId),
    [selectedThreadId, threadPromptingById],
  );
  const effectiveSessionControls = hasSessionForSelectedThread
    ? activeSessionControls
    : null;
  const queuedPrompts = React.useMemo(
    () => queuedPromptsByThread[selectedThreadId] ?? [],
    [queuedPromptsByThread, selectedThreadId],
  );
  const landingSelectedProjectId = selectedWorkspaceId || workspaces[0]?.id || '';
  const workspaceName = selectedThreadWorkspace?.name ?? 'workspace';
  const headerTitle = threadTitle;
  const headerSubtitle = workspaceName;

  const handleSelectAgentPreset = React.useCallback(
    (selection: AgentPresetSelection) => {
      const currentCustomSignature = toCustomAgentConfigSignature(customAgentConfig);
      const incomingCustomSignature = toCustomAgentConfigSignature(
        selection.customConfig,
      );
      const isSameSelection =
        selection.preset === agentPreset &&
        (selection.preset !== 'custom' || currentCustomSignature === incomingCustomSignature);
      if (isSameSelection) {
        return;
      }

      const agentChangedMessage = `Agent changed to ${selection.label}`;
      if (selectedThreadId && !isNewThread) {
        setTimelineSnapshotByThreadId((previous) => {
          const baseTimeline = previous[selectedThreadId] ?? effectiveTimeline;
          const nextTimeline = appendAssistantTimelineMessage(baseTimeline, agentChangedMessage, {
            noticeKind: 'agent-change',
            iconUrl: selection.iconUrl ?? null,
          });
          if (nextTimeline === baseTimeline) {
            return previous;
          }

          return {
            ...previous,
            [selectedThreadId]: nextTimeline,
          };
        });

        syncedPreviewByThreadRef.current[selectedThreadId] = normalizeMessageText(
          agentChangedMessage,
        );
        updateThreadFromMessage(selectedThreadId, agentChangedMessage, {
          allowAutoTitle: false,
          touchUpdatedAt: false,
        });
      }

      setStatusText(`Agent changed to ${selection.label}`);
      setIsAgentAuthRequired(false);
      setIsAgentAuthLaunching(false);
      setAgentAuthMessage(null);
      if (selection.preset === 'custom' && selection.customConfig) {
        saveAgentConfig('custom', selection.customConfig, {
          resetThreadId: selectedThreadId || undefined,
        });
        return;
      }

      setAgentPreset(selection.preset, {
        resetThreadId: selectedThreadId || undefined,
      });
    },
    [
      agentPreset,
      customAgentConfig,
      effectiveTimeline,
      isNewThread,
      saveAgentConfig,
      selectedThreadId,
      setAgentPreset,
      updateThreadFromMessage,
    ],
  );

  React.useEffect(() => {
    if (isNewThread || !selectedThreadId || activeTimeline.items.length === 0) {
      return;
    }

    setTimelineSnapshotByThreadId((previous) => {
      const currentSnapshot = previous[selectedThreadId] ?? [];
      const nextTimeline = mergeTimelineItems(currentSnapshot, activeTimeline.items);
      if (nextTimeline === currentSnapshot) {
        return previous;
      }

      return {
        ...previous,
        [selectedThreadId]: nextTimeline,
      };
    });
  }, [activeTimeline.items, isNewThread, selectedThreadId]);

  React.useEffect(() => {
    if (isNewThread || !selectedThreadId || effectiveIsPrompting) {
      return;
    }

    const lastMessage = getLatestTimelineMessage(effectiveTimeline);
    if (!lastMessage) {
      return;
    }

    const previousPreview = syncedPreviewByThreadRef.current[selectedThreadId];
    if (previousPreview === lastMessage.text) {
      return;
    }

    syncedPreviewByThreadRef.current[selectedThreadId] = lastMessage.text;
    updateThreadFromMessage(selectedThreadId, lastMessage.text, {
      allowAutoTitle: false,
      touchUpdatedAt: false,
    });
  }, [
    effectiveIsPrompting,
    effectiveTimeline,
    isNewThread,
    selectedThreadId,
    updateThreadFromMessage,
  ]);

  const threadIndicatorById = React.useMemo(() => {
    const indicators: Record<string, 'running' | 'completed'> = {};

    for (const [threadId, isPrompting] of Object.entries(threadPromptingById)) {
      if (!isPrompting || !threadById.has(threadId)) {
        continue;
      }

      indicators[threadId] = 'running';
    }

    for (const threadId of completedThreadIds) {
      if (!threadById.has(threadId) || indicators[threadId]) {
        continue;
      }

      indicators[threadId] = 'completed';
    }

    return indicators;
  }, [completedThreadIds, threadById, threadPromptingById]);

  const handleComposerSubmit = React.useCallback(
    async (text: string, attachments: AcpPromptAttachment[]) => {
      const trimmedText = text.trim();

      if (!trimmedText) {
        return;
      }

      if (!selectedThreadId) {
        setStatusText('Open or create a thread first');
        return;
      }

      if (effectiveIsPrompting) {
        const nextPrompt: QueuedPrompt = {
          id: `queued-${Date.now()}-${Math.random().toString(16).slice(2, 9)}`,
          threadId: selectedThreadId,
          text: trimmedText,
          attachments,
        };

        setQueuedPromptsByThread((previous) => {
          const currentQueue = previous[selectedThreadId] ?? [];
          return {
            ...previous,
            [selectedThreadId]: [...currentQueue, nextPrompt],
          };
        });
        setStatusText('Added message to queue');
        return;
      }

      await sendPromptToThread(selectedThreadId, trimmedText, attachments);
    },
    [
      effectiveIsPrompting,
      selectedThreadId,
      sendPromptToThread,
    ],
  );

  React.useEffect(() => {
    if (!isSettingsOpen) {
      return;
    }

    setIsWebBrowserOpen(false);
    closeFileTree();
    setIsTerminalOpen(false);
  }, [closeFileTree, isSettingsOpen]);

  React.useEffect(() => {
    const savedCommand = window.localStorage.getItem(RUN_CONFIGURATION_COMMAND_KEY);
    if (savedCommand) {
      setRunConfigurationCommand(savedCommand);
    }
  }, []);

  const handleSaveAndRun = React.useCallback((command: string) => {
    const trimmed = command.trim();
    if (!trimmed) {
      return;
    }

    setRunConfigurationCommand(trimmed);
    window.localStorage.setItem(RUN_CONFIGURATION_COMMAND_KEY, trimmed);
    setIsRunConfigurationOpen(false);
    setIsTerminalOpen(true);
    setRunRequest({
      id: Date.now(),
      command: trimmed,
    });
    setStatusText(`Running: ${trimmed}`);
  }, []);

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      const isMod = event.metaKey || event.ctrlKey;
      if (isMod && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setIsCommandPaletteOpen((previous) => !previous);
        lastShiftTapAtRef.current = 0;
        return;
      }

      if (event.key !== 'Shift') {
        lastShiftTapAtRef.current = 0;
      }
    };

    const handleKeyUp = (event: KeyboardEvent): void => {
      if (event.key !== 'Shift') {
        return;
      }

      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }

      const now = Date.now();
      if (now - lastShiftTapAtRef.current <= 350) {
        setIsCommandPaletteOpen(true);
        lastShiftTapAtRef.current = 0;
        return;
      }

      lastShiftTapAtRef.current = now;
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  const commandPaletteItems = React.useMemo<CommandPaletteItem[]>(() => {
    const workspaceItems: CommandPaletteItem[] = recentWorkspaces.map((workspace) => ({
      id: `workspace-${workspace.id}`,
      section: 'Workspace',
      title: `Switch to ${workspace.name}`,
      subtitle: workspace.path,
      keywords: 'workspace recent switch',
      icon: 'folder',
      onSelect: () => {
        selectWorkspace(workspace.id);
        setStatusText(`Workspace ${workspace.name}`);
      },
    }));

    const threadItems: CommandPaletteItem[] = threadGroups.flatMap((group) =>
      group.threads.map((thread) => ({
        id: `thread-${thread.id}`,
        section: 'Threads',
        title: thread.title,
        subtitle: `${group.label} - ${thread.preview}`,
        keywords: `${thread.title} ${thread.preview} ${group.label}`,
        icon: 'thread',
        onSelect: () => {
          selectThread(thread.id);
          setStatusText(`Thread ${thread.title}`);
        },
      })),
    );

    const fileItems: CommandPaletteItem[] = files.slice(0, 40).map((file) => ({
      id: `file-${file}`,
      section: 'Files',
      title: file,
      subtitle: 'Open in review panel',
      keywords: `file review ${file}`,
      icon: 'folder',
      onSelect: () => {
        void openFile(file);
      },
    }));

    return [
      {
        id: 'action-open-folder',
        section: 'Actions',
        title: 'Open folder',
        subtitle: 'Add workspace to recent list',
        keywords: 'open folder workspace',
        icon: 'folder',
        onSelect: () => {
          void handleOpenFolder();
        },
      },
      {
        id: 'action-open-file-tree',
        section: 'Actions',
        title: 'Browse files',
        subtitle: 'Open workspace file tree',
        keywords: 'files tree review',
        icon: 'folder',
        onSelect: () => {
          void openFileTree();
        },
      },
      ...workspaceItems,
      ...threadItems,
      ...fileItems,
    ];
  }, [
    files,
    handleOpenFolder,
    openFile,
    openFileTree,
    recentWorkspaces,
    selectThread,
    selectWorkspace,
    threadGroups,
  ]);

  const removeQueuedPrompt = React.useCallback(
    (queueId: string) => {
      if (!selectedThreadId) {
        return;
      }

      setQueuedPromptsByThread((previous) => {
        const queue = previous[selectedThreadId];
        if (!queue) {
          return previous;
        }

        const nextQueue = queue.filter((item) => item.id !== queueId);
        const next = { ...previous };
        if (nextQueue.length === 0) {
          delete next[selectedThreadId];
        } else {
          next[selectedThreadId] = nextQueue;
        }

        return next;
      });

      if (blockedQueuedPromptIdRef.current === queueId) {
        blockedQueuedPromptIdRef.current = null;
      }
    },
    [selectedThreadId],
  );

  const reorderQueuedPrompt = React.useCallback(
    (sourceQueueId: string, targetQueueId: string) => {
      if (!selectedThreadId || !sourceQueueId || !targetQueueId || sourceQueueId === targetQueueId) {
        return;
      }

      setQueuedPromptsByThread((previous) => {
        const queue = previous[selectedThreadId];
        if (!queue) {
          return previous;
        }

        const sourceIndex = queue.findIndex((item) => item.id === sourceQueueId);
        const targetIndex = queue.findIndex((item) => item.id === targetQueueId);
        if (sourceIndex < 0 || targetIndex < 0) {
          return previous;
        }

        const nextQueue = [...queue];
        const [movedItem] = nextQueue.splice(sourceIndex, 1);
        if (!movedItem) {
          return previous;
        }

        nextQueue.splice(targetIndex, 0, movedItem);
        return {
          ...previous,
          [selectedThreadId]: nextQueue,
        };
      });

      blockedQueuedPromptIdRef.current = null;
    },
    [selectedThreadId],
  );

  const steerQueuedPrompt = React.useCallback(
    (queueId: string) => {
      const currentThreadId = selectedThreadId;
      if (!currentThreadId) {
        return;
      }

      const queue = queuedPromptsByThread[currentThreadId];
      if (!queue || queue.length === 0) {
        return;
      }

      const targetIndex = queue.findIndex((item) => item.id === queueId);
      if (targetIndex < 0) {
        return;
      }

      const targetPrompt = queue[targetIndex];
      if (!targetPrompt) {
        return;
      }

      blockedQueuedPromptIdRef.current = null;

      if (effectiveIsPrompting) {
        setQueuedPromptsByThread((previous) => {
          const currentQueue = previous[currentThreadId];
          if (!currentQueue) {
            return previous;
          }

          const currentTargetIndex = currentQueue.findIndex((item) => item.id === queueId);
          if (currentTargetIndex < 0) {
            return previous;
          }

          const currentTarget = currentQueue[currentTargetIndex];
          if (!currentTarget) {
            return previous;
          }

          return {
            ...previous,
            [currentThreadId]: [
              currentTarget,
              ...currentQueue.filter((item) => item.id !== queueId),
            ],
          };
        });

        void cancelPrompt()
          .then(() => {
            setStatusText('Steering with queued message');
          })
          .catch(() => {
            setStatusText('Could not steer current response');
          });
        return;
      }

      setQueuedPromptsByThread((previous) => {
        const currentQueue = previous[currentThreadId];
        if (!currentQueue) {
          return previous;
        }

        const nextQueue = currentQueue.filter((item) => item.id !== queueId);
        const next = { ...previous };
        if (nextQueue.length === 0) {
          delete next[currentThreadId];
        } else {
          next[currentThreadId] = nextQueue;
        }
        return next;
      });

      dispatchingQueuedPromptRef.current = true;

      void (async () => {
        const sent = await sendPromptToThread(
          targetPrompt.threadId,
          targetPrompt.text,
          targetPrompt.attachments,
        );

        if (!sent) {
          setQueuedPromptsByThread((previous) => {
            const nextQueue = previous[currentThreadId] ?? [];
            return {
              ...previous,
              [currentThreadId]: [
                targetPrompt,
                ...nextQueue.filter((item) => item.id !== targetPrompt.id),
              ],
            };
          });
          return;
        }

        setStatusText('Sent queued message');
      })().finally(() => {
        dispatchingQueuedPromptRef.current = false;
      });
    },
    [
      cancelPrompt,
      effectiveIsPrompting,
      queuedPromptsByThread,
      selectedThreadId,
      sendPromptToThread,
    ],
  );

  React.useEffect(() => {
    if (!selectedThreadId || effectiveIsPrompting || queuedPrompts.length === 0) {
      return;
    }

    const nextPrompt = queuedPrompts[0];
    if (
      dispatchingQueuedPromptRef.current ||
      blockedQueuedPromptIdRef.current === nextPrompt.id
    ) {
      return;
    }

    dispatchingQueuedPromptRef.current = true;

    void (async () => {
      const sent = await sendPromptToThread(
        nextPrompt.threadId,
        nextPrompt.text,
        nextPrompt.attachments,
      );

      if (sent) {
        blockedQueuedPromptIdRef.current = null;
        setQueuedPromptsByThread((previous) => {
          const queue = previous[selectedThreadId];
          if (!queue || queue.length === 0 || queue[0]?.id !== nextPrompt.id) {
            return previous;
          }

          const remaining = queue.slice(1);
          const next = { ...previous };
          if (remaining.length === 0) {
            delete next[selectedThreadId];
          } else {
            next[selectedThreadId] = remaining;
          }

          return next;
        });
        return;
      }

      blockedQueuedPromptIdRef.current = nextPrompt.id;
    })().finally(() => {
      dispatchingQueuedPromptRef.current = false;
    });
  }, [effectiveIsPrompting, queuedPrompts, selectedThreadId, sendPromptToThread]);

  const handleRenameThreadFromMenu = React.useCallback(() => {
    openRenameThreadDialog(selectedThreadId);
  }, [openRenameThreadDialog, selectedThreadId]);

  const handleOpenWorkspaceInFinder = React.useCallback(async () => {
    if (!selectedThreadWorkspace?.path) {
      return;
    }

    try {
      await window.desktop.workspaceRevealFile({
        absolutePath: selectedThreadWorkspace.path,
      });
      setStatusText(`Opened ${selectedThreadWorkspace.name} in Finder`);
    } catch {
      setStatusText('Could not open workspace in Finder');
    }
  }, [selectedThreadWorkspace]);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-transparent text-stone-700 antialiased">
      <header className="z-30 h-12 shrink-0">
        <div className="drag-region flex h-full min-w-0">
          <div
            className={cn(
              'shrink-0 overflow-hidden bg-[rgba(249,250,252,0.26)] backdrop-blur-[30px] backdrop-saturate-150',
              !isResizing && 'transition-[width] duration-200 ease-out',
            )}
            style={{ width: activeSidebarWidth }}
          >
            <div className="no-drag flex h-full items-center justify-between px-2">
              <div className={cn('flex items-center', navigationZoneClass)}>
                <button
                  type="button"
                  aria-label="Collapse sidebar"
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md text-stone-500 transition-colors hover:bg-stone-200/55 hover:text-stone-700"
                  onClick={toggleCollapsed}
                >
                  <PanelLeftClose className="h-4 w-4" />
                </button>
              </div>

              {shouldShowUpdateButton ? (
                <button
                  type="button"
                  className={cn(
                    'inline-flex h-6 items-center rounded-full px-2.5 text-[11px] font-semibold transition-colors',
                    'bg-blue-500 text-white hover:bg-blue-600',
                    'disabled:cursor-not-allowed disabled:opacity-65',
                  )}
                  onClick={() => {
                    void handleUpdateAction();
                  }}
                  disabled={isUpdateButtonDisabled}
                  title={updaterState?.message || 'Update available'}
                >
                  {updateButtonLabel}
                </button>
              ) : null}
            </div>
          </div>

          <div
            className={cn(
              'flex min-w-0 flex-1 items-center gap-2 bg-[#fdfdff] pr-3',
              !isCollapsed && 'pl-3',
            )}
          >
            {isCollapsed && (
              <div className={cn('no-drag flex h-full items-center', navigationZoneClass)}>
                <button
                  type="button"
                  aria-label="Expand sidebar"
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md text-stone-500 transition-colors hover:bg-stone-200/55 hover:text-stone-700"
                  onClick={toggleCollapsed}
                >
                  <PanelLeftOpen className="h-4 w-4" />
                </button>
              </div>
            )}

            {!isSettingsOpen ? (
              <div className="min-w-0 flex flex-1 items-center gap-2">
                <p className="truncate text-[13px] font-semibold text-stone-900">{headerTitle}</p>
                {selectedThreadWorkspace?.path ? (
                  <TooltipProvider delayDuration={180}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          className={cn(
                            'no-drag truncate text-[13px] text-stone-600 max-[860px]:hidden',
                            'transition-colors hover:text-stone-800',
                          )}
                          onClick={() => {
                            void handleOpenWorkspaceInFinder();
                          }}
                        >
                          {headerSubtitle}
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>{selectedThreadWorkspace.path}</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                ) : (
                  <p
                    className="truncate text-[13px] text-stone-600 max-[860px]:hidden"
                    title={`${headerSubtitle} · ${statusText}`}
                  >
                    {headerSubtitle}
                  </p>
                )}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      aria-label="Thread options"
                      className="no-drag inline-flex h-7 w-7 items-center justify-center rounded-xl text-stone-500 transition-colors hover:bg-stone-200/65 hover:text-stone-700 max-[980px]:hidden"
                    >
                      <Ellipsis className="h-3.5 w-3.5" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-56">
                    <DropdownMenuItem onSelect={handleRenameThreadFromMenu}>
                      Rename thread
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ) : (
              <div className="min-w-0 flex-1" />
            )}

            {!isSettingsOpen ? (
              <ToolbarActions
                onOpenFileTree={handleToggleFileTree}
                isFileTreeOpen={isFileTreeOpen}
                onToggleFilesView={toggleReviewPanelVisibility}
                isFilesViewOpen={isReviewPanelVisible}
                openFilesCount={reviewFiles.length}
                onOpenCommitDialog={() => {
                  setIsCommitDialogOpen(true);
                }}
                onOpenRunConfiguration={() => {
                  setIsRunConfigurationOpen(true);
                }}
                onOpenWebBrowser={() => {
                  setIsWebBrowserOpen((previous) => !previous);
                }}
                isWebBrowserOpen={isWebBrowserOpen}
                onToggleTerminal={() => setIsTerminalOpen((previous) => !previous)}
                isTerminalOpen={isTerminalOpen}
              />
            ) : null}
          </div>
        </div>
      </header>

      {isSettingsOpen ? (
        <main className="min-h-0 flex-1 overflow-hidden bg-transparent">
          <SettingsLayout
            onBack={() => {
              setIsSettingsOpen(false);
            }}
            sidebarWidth={activeSidebarWidth}
            isResizing={isResizing}
            showResizeHandle={!isCollapsed}
            onStartResizing={startResizing}
          />
        </main>
      ) : (
        <div className="flex min-h-0 flex-1">
          <div
            className={cn(
              'relative shrink-0 overflow-hidden',
              !isResizing && 'transition-[width] duration-200 ease-out',
            )}
            style={{ width: activeSidebarWidth }}
          >
            <Sidebar
              width={sidebarWidth}
              isResizing={isResizing}
              selectedThreadId={selectedThreadId}
              isSettingsOpen={isSettingsOpen}
              groups={threadGroups}
              threadIndicatorById={threadIndicatorById}
              onSelectThread={(threadId) => {
                setIsSettingsOpen(false);
                setCompletedThreadIds((previous) => {
                  if (!previous.has(threadId)) {
                    return previous;
                  }

                  const next = new Set(previous);
                  next.delete(threadId);
                  return next;
                });
                selectThread(threadId);
              }}
              onCreateThread={handleCreateThread}
              onOpenFolder={() => {
                void handleOpenFolder();
              }}
              onOpenCommandPalette={handleOpenCommandPalette}
              onCreateThreadInGroup={handleCreateThreadInGroup}
              onRenameGroup={handleRenameGroup}
              onRemoveGroup={handleRemoveGroup}
              onRenameThread={(threadId) => {
                openRenameThreadDialog(threadId);
              }}
              onRemoveThread={(threadId, currentTitle) => {
                handleRemoveThread(threadId, currentTitle);
              }}
              onOpenSettings={() => {
                setIsSettingsOpen(true);
              }}
            />
          </div>

          {!isCollapsed && (
            <button
              type="button"
              aria-label="Resize sidebar"
              className="no-drag relative w-0 cursor-col-resize"
              onPointerDown={() => startResizing()}
            >
              <span className="absolute inset-y-0 -left-3 w-6" />
            </button>
          )}

          <main className="relative flex-1 overflow-hidden bg-[#fdfdff]">
            <div className="flex h-full min-w-0">
              <FileTreeDialog
                open={isFileTreeOpen}
                side="left"
                files={files}
                loading={isLoadingTree}
                workspaceName={workspaceName}
                activeFilePath={activeReviewFilePath}
                onOpenFile={(path) => {
                  void openFile(path);
                }}
              />

              <div className="flex min-w-0 flex-1 flex-col">
                <div ref={reviewPanelContainerRef} className="min-h-0 flex flex-1">
                  {isReviewPanelOpen ? (
                    <div
                      className={cn(
                        'relative min-w-0 shrink-0 border-r border-stone-200/80 bg-[#fdfdff]',
                        'transition-[width] duration-150 ease-out',
                        isReviewPanelResizing && 'transition-none',
                      )}
                      style={{ width: reviewPanelWidth }}
                    >
                      <button
                        type="button"
                        aria-label="Resize file view"
                        className="no-drag group absolute inset-y-0 right-0 z-10 w-2 translate-x-1 cursor-col-resize"
                        onPointerDown={startReviewPanelResizing}
                      >
                        <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors group-hover:bg-stone-300/80" />
                      </button>
                      <ReviewPanel
                        open={isReviewPanelOpen}
                        loading={isLoadingFile}
                        tabs={reviewFiles.map((file) => file.relativePath)}
                        activeFilePath={activeReviewFilePath}
                        content={activeReviewFile?.content ?? ''}
                        fileContentByPath={Object.fromEntries(
                          reviewFiles.map((file) => [file.relativePath, file.content]),
                        )}
                        onSelectTab={setActiveReviewFile}
                        onCloseTab={closeReviewFile}
                        onReorderTabs={reorderReviewFiles}
                      />
                    </div>
                  ) : null}

                  <div className="min-w-0 flex flex-1 flex-col">
                    <div className="mx-auto flex h-full w-full max-w-[830px] flex-col px-6 pb-3 pt-2">
                      <Transcript
                        threadId={selectedThreadId}
                        workspaceName={workspaceName}
                        projects={workspaces.map((workspace) => ({
                          id: workspace.id,
                          name: workspace.name,
                          path: workspace.path,
                        }))}
                        selectedProjectId={landingSelectedProjectId}
                        timeline={effectiveTimeline}
                        isNewThread={isNewThread}
                        isThinking={effectiveIsPrompting}
                        pendingPermission={effectivePendingPermission}
                        onSelectProject={(workspaceId) => {
                          selectWorkspace(workspaceId);
                        }}
                        onAddProject={() => {
                          void handleOpenFolder();
                        }}
                        onResolvePermission={(requestId, optionId) => {
                          void resolvePermission(requestId, {
                            outcome: 'selected',
                            optionId,
                          });
                        }}
                        onCancelPermission={(requestId) => {
                          void resolvePermission(requestId, {
                            outcome: 'cancelled',
                          });
                          void cancelPrompt();
                        }}
                        onOpenFile={(path) => {
                          void openFile(path);
                        }}
                        onOpenLink={handleOpenWebLink}
                        onSelectSuggestion={handleSelectLandingSuggestion}
                      />
                      {connectingStatusMessage ? (
                        <div className="mb-3 no-drag flex items-center gap-2 rounded-xl border border-sky-300/80 bg-sky-50/80 px-3 py-2 text-sky-900">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          <p className="text-[12px]">{connectingStatusMessage}</p>
                        </div>
                      ) : null}
                      {isAgentAuthRequired || isAgentAuthLaunching ? (
                        <div className="mb-3 no-drag rounded-xl border border-amber-300/70 bg-amber-50/80 px-3 py-2">
                          <p className="text-[12px] text-amber-900">
                            {agentAuthMessage ??
                              'Authentication is required before sending prompts.'}
                          </p>
                          <div className="mt-2 flex items-center gap-2">
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-7 border-amber-400/80 bg-amber-100/70 px-2.5 text-[11px] text-amber-900 hover:bg-amber-100"
                              onClick={() => {
                                void startAgentAuthentication();
                              }}
                              disabled={isAgentAuthLaunching}
                            >
                              {isAgentAuthLaunching
                                ? 'Opening login…'
                                : 'Authenticate agent'}
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-[11px] text-amber-900 hover:bg-amber-100/70"
                              onClick={() => {
                                setIsAgentAuthRequired(false);
                                setAgentAuthMessage(null);
                              }}
                              disabled={isAgentAuthLaunching}
                            >
                              Dismiss
                            </Button>
                          </div>
                        </div>
                      ) : null}
                      <Composer
                        workspacePath={workspacePath}
                        disabled={isComposerDisabled}
                        disabledMessage={composerDisabledMessage}
                        isPrompting={effectiveIsPrompting}
                        queuedPrompts={queuedPrompts.map((item) => ({
                          id: item.id,
                          text: item.text,
                        }))}
                        onSteerQueuedPrompt={steerQueuedPrompt}
                        onRemoveQueuedPrompt={removeQueuedPrompt}
                        onReorderQueuedPrompt={reorderQueuedPrompt}
                        agentPreset={agentPreset}
                        codexAgentConfig={codexAgentConfig}
                        claudeAgentConfig={claudeAgentConfig}
                        customAgentConfig={customAgentConfig}
                        onSelectAgentPreset={handleSelectAgentPreset}
                        onSaveAgentConfig={saveAgentConfig}
                        onSubmit={handleComposerSubmit}
                        sessionControls={effectiveSessionControls}
                        onSetSessionMode={setSessionMode}
                        onSetSessionModel={setSessionModel}
                        onSetSessionConfigOption={setSessionConfigOption}
                        onCancel={cancelPrompt}
                        prefillRequest={composerPrefillRequest}
                      />
                    </div>
                  </div>
                </div>
                <TerminalPanel
                  open={isTerminalOpen}
                  cwd={workspacePath}
                  runRequest={runRequest}
                  onRequestClose={() => setIsTerminalOpen(false)}
                />
              </div>

              <WebBrowserPanel open={isWebBrowserOpen} openRequest={browserOpenRequest} />
            </div>
          </main>
        </div>
      )}

      <CommandPalette
        open={isCommandPaletteOpen}
        onOpenChange={setIsCommandPaletteOpen}
        items={commandPaletteItems}
      />

      <RunConfigurationDialog
        open={isRunConfigurationOpen}
        command={runConfigurationCommand}
        onOpenChange={setIsRunConfigurationOpen}
        onSaveAndRun={handleSaveAndRun}
      />

      <CommitDialog
        open={isCommitDialogOpen}
        branchName="main"
        changesSummary="-"
        onOpenChange={setIsCommitDialogOpen}
        onContinue={({ includeUnstaged, message, nextStep }) => {
          setIsCommitDialogOpen(false);
          const summary = message ? `Commit queued: ${message}` : 'Commit queued';
          const suffix =
            nextStep === 'commit'
              ? ''
              : nextStep === 'commit-and-push'
                ? ' + push'
                : ' + PR';
          setStatusText(
            `${summary}${includeUnstaged ? ' (include unstaged)' : ''}${suffix}`.trim(),
          );
        }}
      />

      <RenameThreadDialog
        open={Boolean(threadRenameTarget)}
        initialTitle={threadRenameTarget?.initialTitle ?? ''}
        onOpenChange={(open) => {
          if (!open) {
            setThreadRenameTarget(null);
          }
        }}
        onSave={handleSaveRenamedThread}
      />

      <div className="pointer-events-none fixed bottom-4 right-4 z-[200] flex w-[min(420px,calc(100vw-2rem))] flex-col gap-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className="pointer-events-auto rounded-xl border border-rose-200 bg-white/95 px-3 py-2 shadow-lg backdrop-blur"
          >
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-[12px] font-semibold text-rose-700">{toast.title}</p>
                <p className="mt-0.5 whitespace-pre-wrap break-words text-[12px] leading-5 text-stone-700">
                  {toast.message}
                </p>
              </div>
              <button
                type="button"
                className="no-drag inline-flex h-5 w-5 items-center justify-center rounded text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-700"
                onClick={() => removeToast(toast.id)}
                aria-label="Dismiss notification"
              >
                ×
              </button>
            </div>
          </div>
        ))}
      </div>

    </div>
  );
};
