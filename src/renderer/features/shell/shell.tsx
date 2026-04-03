import * as React from 'react';
import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ChevronDown,
  Ellipsis,
  ExternalLink,
  Folder,
  Loader2,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  RefreshCw,
  X,
} from 'lucide-react';
import { Sidebar } from '@renderer/features/sidebar/sidebar';
import { Composer, type AgentPresetSelection } from '@renderer/features/composer/composer';
import { Transcript } from '@renderer/features/transcript/transcript';
import { ToolbarActions } from '@renderer/features/toolbar/toolbar-actions';
import { RunConfigurationDialog } from '@renderer/features/toolbar/run-configuration-dialog';
import { RenameThreadDialog } from '@renderer/features/shell/rename-thread-dialog';
import { WorkspaceCreationView } from '@renderer/features/shell/workspace-creation-view';
import { WorkspaceSessionsBoard } from '@renderer/features/shell/workspace-sessions-board';
import {
  CommandPalette,
  type CommandPaletteItem,
} from '@renderer/features/command-palette/command-palette';
import { TerminalPanel } from '@renderer/features/terminal/terminal-panel';
import { CommitPanel } from '@renderer/features/workspace/commit-panel';
import { FileTreeDialog } from '@renderer/features/workspace/file-tree-dialog';
import { BrowserPushPanel } from '@renderer/features/workspace/browser-push-panel';
import { ReviewPanel } from '@renderer/features/workspace/review-panel';
import { WebBrowserPanel } from '@renderer/features/workspace/web-browser-panel';
import { SettingsLayout } from '@renderer/features/settings/settings-layout';
import { Dialog, DialogContent } from '@renderer/components/ui/dialog';
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
import {
  appendStoredNotification,
  onStoredNotificationsChanged,
  readStoredNotifications,
  writeStoredNotifications,
  type AppNotificationItem,
} from '@renderer/store/browser-pushes';
import { changeEditorFontSizePreference } from '@renderer/store/ui-preferences';
import { useSidebarWidth } from '@renderer/store/use-sidebar-width';
import { useRunConfigurations } from '@renderer/store/use-run-configurations';
import { useShellState, type ThreadBoardStatus } from '@renderer/store/use-shell-state';
import { useAcp, type ThreadAgentSelection, type TimelineItem } from '@renderer/store/use-acp';
import { useWorkspaceReview } from '@renderer/store/use-workspace-review';
import type {
  AcpCustomAgentConfig,
  AcpPromptAudioContent,
  AcpPromptAttachment,
  AcpTerminalAuthLaunchSpec,
} from '@shared/types/acp';
import type { WorkspaceSearchTextMatch } from '@shared/types/workspace';
import type { UpdaterState } from '@shared/types/updater';
import zeroLogo from '@renderer/assets/zero-logo.png';

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
const getAttachmentLabel = (attachment: AcpPromptAttachment): string =>
  attachment.displayPath?.trim() ||
  attachment.relativePath?.trim() ||
  getFolderName(attachment.absolutePath);
const toPromptPreviewText = (
  text: string,
  attachments: AcpPromptAttachment[],
  hasAudio: boolean,
): string => {
  const normalizedText = normalizeMessageText(text);
  if (normalizedText) {
    return normalizedText;
  }

  if (attachments.length > 0) {
    return attachments.length === 1
      ? `Attached ${getAttachmentLabel(attachments[0])}`
      : `Attached ${attachments.length} files`;
  }

  return hasAudio ? VOICE_PROMPT_PREVIEW_TEXT : '';
};
const TITLEBAR_ICON_BUTTON_CLASS =
  'no-drag inline-flex h-6 min-h-6 w-6 min-w-6 shrink-0 items-center justify-center rounded-md p-0 text-stone-600 transition-colors hover:bg-white/55 hover:text-stone-700';
const TITLEBAR_ICON_CLASS = 'h-3.5 w-3.5';
const TIMELINE_SNAPSHOT_STORAGE_KEY = 'zeroade.shell.timeline-snapshots.v1';
const EXTERNAL_LINK_SCHEME_PATTERN = /^[a-z][a-z\d+\-.]*:/i;
const WINDOWS_ABSOLUTE_PATH_PATTERN = /^[a-zA-Z]:\//;

const isHTMLElement = (value: unknown): value is HTMLElement =>
  typeof HTMLElement !== 'undefined' && value instanceof HTMLElement;

const isMonacoEditorKeyboardContext = (target: EventTarget | null): boolean => {
  const element = isHTMLElement(target)
    ? target
    : isHTMLElement(document.activeElement)
      ? document.activeElement
      : null;

  return element?.closest('.monaco-editor') !== null;
};

const isEditorFontZoomInKey = (event: KeyboardEvent): boolean =>
  event.key === '+' || event.key === '=' || event.code === 'NumpadAdd';

const isEditorFontZoomOutKey = (event: KeyboardEvent): boolean =>
  event.key === '-' || event.key === '_' || event.code === 'NumpadSubtract';

const normalizeTranscriptFileHref = (href: string): string => {
  const trimmed = href.trim();
  if (trimmed.toLowerCase().startsWith('file://')) {
    try {
      const parsed = new URL(trimmed);
      const decodedPath = decodeURIComponent(parsed.pathname);
      const windowsPath = /^\/[a-zA-Z]:\//.test(decodedPath) ? decodedPath.slice(1) : decodedPath;
      return windowsPath.replace(/#L\d+(?:C\d+)?$/i, '').replace(/:\d+(?::\d+)?$/, '');
    } catch {
      return trimmed;
    }
  }

  return trimmed.replace(/#L\d+(?:C\d+)?$/i, '').replace(/:\d+(?::\d+)?$/, '');
};

const looksLikeWorkspaceFileLink = (href: string): boolean => {
  const normalized = normalizeTranscriptFileHref(href);

  return (
    normalized.startsWith('/workspace/') ||
    normalized.startsWith('/') ||
    WINDOWS_ABSOLUTE_PATH_PATTERN.test(normalized) ||
    normalized.startsWith('./') ||
    normalized.startsWith('../') ||
    normalized.includes('/')
  );
};

interface RunTerminalRequest {
  id: number;
  configurationId: string;
  configurationName: string;
  command: string;
}

interface InterruptTerminalRequest {
  id: number;
}

interface ActiveRunExecution {
  configurationId: string;
  configurationName: string;
}

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
): TimelineItem => {
  const nowMs = Date.now();

  return {
    kind: 'assistant-message',
    id: `assistant-system-${nowMs}-${Math.random().toString(36).slice(2, 8)}`,
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
    text,
    noticeKind: options?.noticeKind,
    iconUrl: options?.iconUrl ?? null,
  };
};

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

const isLocalTimelineNotice = (
  item: TimelineItem,
): item is TimelineItem & { kind: 'assistant-message' } =>
  item.kind === 'assistant-message' && item.noticeKind === 'agent-change';

const retainLocalTimelineNotices = (timeline: TimelineItem[]): TimelineItem[] =>
  timeline.filter(isLocalTimelineNotice);

const arePromptAttachmentsEqual = (
  left: AcpPromptAttachment[] | undefined,
  right: AcpPromptAttachment[] | undefined,
): boolean => {
  const leftEntries = left ?? [];
  const rightEntries = right ?? [];

  if (leftEntries.length !== rightEntries.length) {
    return false;
  }

  return leftEntries.every((entry, index) => {
    const other = rightEntries[index];
    return (
      entry.absolutePath === other.absolutePath &&
      (entry.relativePath ?? '') === (other.relativePath ?? '') &&
      (entry.displayPath ?? '') === (other.displayPath ?? '') &&
      (entry.mimeType ?? '') === (other.mimeType ?? '')
    );
  });
};

const areTimelineItemsEquivalent = (left: TimelineItem, right: TimelineItem): boolean => {
  if (left.kind !== right.kind) {
    return false;
  }

  if (left.kind === 'user-message' && right.kind === 'user-message') {
    return (
      normalizeMessageText(left.text) === normalizeMessageText(right.text) &&
      arePromptAttachmentsEqual(left.attachments, right.attachments) &&
      Boolean(left.hasAudio) === Boolean(right.hasAudio)
    );
  }

  if (left.kind === 'assistant-message' && right.kind === 'assistant-message') {
    return (
      normalizeMessageText(left.text) === normalizeMessageText(right.text) &&
      (left.noticeKind ?? null) === (right.noticeKind ?? null) &&
      (left.iconUrl ?? null) === (right.iconUrl ?? null)
    );
  }

  if (left.kind === 'tool-call' && right.kind === 'tool-call') {
    return left.toolCallId === right.toolCallId;
  }

  if (left.kind === 'plan' && right.kind === 'plan') {
    return JSON.stringify(left.entries) === JSON.stringify(right.entries);
  }

  return false;
};

const reconcileTimelineItemTimestamps = (
  sessionTimeline: TimelineItem[],
  persistedTimeline: TimelineItem[],
): TimelineItem[] => {
  const persistedComparableItems = persistedTimeline.filter((item) => !isLocalTimelineNotice(item));
  if (sessionTimeline.length === 0 || persistedComparableItems.length === 0) {
    return sessionTimeline;
  }

  let searchStartIndex = 0;
  let changed = false;

  const reconciledItems = sessionTimeline.map((item) => {
    for (let index = searchStartIndex; index < persistedComparableItems.length; index += 1) {
      const persistedItem = persistedComparableItems[index];
      if (!areTimelineItemsEquivalent(item, persistedItem)) {
        continue;
      }

      searchStartIndex = index + 1;
      if (
        item.createdAtMs === persistedItem.createdAtMs &&
        item.updatedAtMs === persistedItem.updatedAtMs
      ) {
        return item;
      }

      changed = true;
      return {
        ...item,
        createdAtMs: persistedItem.createdAtMs,
        updatedAtMs: persistedItem.updatedAtMs,
      };
    }

    return item;
  });

  return changed ? reconciledItems : sessionTimeline;
};

const buildThreadTimelineFromSession = (
  sessionTimeline: TimelineItem[],
  persistedTimeline: TimelineItem[],
): TimelineItem[] => {
  const reconciledTimeline = reconcileTimelineItemTimestamps(
    sessionTimeline,
    persistedTimeline,
  );
  const retainedLocalNotices = retainLocalTimelineNotices(persistedTimeline);
  if (retainedLocalNotices.length === 0) {
    return reconciledTimeline;
  }

  return mergeTimelineItems(reconciledTimeline, retainedLocalNotices);
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
  audio?: AcpPromptAudioContent | null;
}

interface RenameThreadTarget {
  threadId: string;
  initialTitle: string;
}

interface ShellToast {
  id: number;
  title: string;
  message: string;
  tone: 'error' | 'info';
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const normalizePersistedAttachment = (value: unknown): AcpPromptAttachment | null => {
  if (!isRecord(value)) {
    return null;
  }

  const absolutePath =
    typeof value.absolutePath === 'string' ? value.absolutePath.trim() : '';
  if (!absolutePath) {
    return null;
  }

  return {
    absolutePath,
    relativePath:
      typeof value.relativePath === 'string' && value.relativePath.trim().length > 0
        ? value.relativePath.trim()
        : undefined,
    displayPath:
      typeof value.displayPath === 'string' && value.displayPath.trim().length > 0
        ? value.displayPath.trim()
        : undefined,
    mimeType:
      typeof value.mimeType === 'string' && value.mimeType.trim().length > 0
        ? value.mimeType.trim()
        : undefined,
  };
};

const normalizePersistedTimelineItem = (value: unknown): TimelineItem | null => {
  if (!isRecord(value)) {
    return null;
  }

  const id = typeof value.id === 'string' ? value.id.trim() : '';
  const kind = typeof value.kind === 'string' ? value.kind : '';
  if (!id || !kind) {
    return null;
  }

  const createdAtMs =
    typeof value.createdAtMs === 'number' && Number.isFinite(value.createdAtMs)
      ? value.createdAtMs
      : Date.now();
  const updatedAtMs =
    typeof value.updatedAtMs === 'number' && Number.isFinite(value.updatedAtMs)
      ? value.updatedAtMs
      : createdAtMs;

  const base = {
    id,
    createdAtMs,
    updatedAtMs,
  };

  if (kind === 'user-message') {
    const text = typeof value.text === 'string' ? value.text : '';
    const attachments = Array.isArray(value.attachments)
      ? value.attachments
          .map((attachment) => normalizePersistedAttachment(attachment))
          .filter((attachment): attachment is AcpPromptAttachment => attachment !== null)
      : [];

    return {
      ...base,
      kind,
      text,
      attachments: attachments.length > 0 ? attachments : undefined,
      hasAudio: value.hasAudio === true || undefined,
    };
  }

  if (kind === 'assistant-message') {
    return {
      ...base,
      kind,
      text: typeof value.text === 'string' ? value.text : '',
      noticeKind: value.noticeKind === 'agent-change' ? 'agent-change' : undefined,
      iconUrl:
        typeof value.iconUrl === 'string' || value.iconUrl === null
          ? value.iconUrl
          : undefined,
    };
  }

  if (kind === 'plan') {
    return {
      ...base,
      kind,
      entries: Array.isArray(value.entries) ? value.entries : [],
    };
  }

  if (kind === 'tool-call') {
    const toolCallId =
      typeof value.toolCallId === 'string' ? value.toolCallId.trim() : '';
    if (!toolCallId) {
      return null;
    }

    return {
      ...base,
      kind,
      toolCallId,
      title: typeof value.title === 'string' ? value.title : 'Tool call',
      status: typeof value.status === 'string' ? value.status : 'unknown',
      toolKind: typeof value.toolKind === 'string' ? value.toolKind : 'other',
      locations: Array.isArray(value.locations)
        ? value.locations.filter((location): location is string => typeof location === 'string')
        : [],
      rawInput: typeof value.rawInput === 'string' ? value.rawInput : undefined,
      rawOutput: typeof value.rawOutput === 'string' ? value.rawOutput : undefined,
    };
  }

  return null;
};

const readPersistedTimelineSnapshots = (): Record<string, TimelineItem[]> => {
  const raw = window.localStorage.getItem(TIMELINE_SNAPSHOT_STORAGE_KEY);
  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) {
      return {};
    }

    const snapshots: Record<string, TimelineItem[]> = {};

    for (const [threadId, value] of Object.entries(parsed)) {
      if (!Array.isArray(value) || threadId.trim().length === 0) {
        continue;
      }

      const items = value
        .map((item) => normalizePersistedTimelineItem(item))
        .filter((item): item is TimelineItem => item !== null);

      if (items.length > 0) {
        snapshots[threadId] = items;
      }
    }

    return snapshots;
  } catch {
    return {};
  }
};

interface RegistryLauncherDistribution {
  package: string;
  args?: string[];
  env?: Record<string, string>;
}

interface RegistryBinaryDistributionTarget {
  cmd?: string;
  args?: string[];
}

interface RegistryAgentCatalogEntry {
  id: string;
  name: string;
  iconUrl: string | null;
  version?: string;
  description?: string;
  repository?: string;
  distribution?: {
    npx?: RegistryLauncherDistribution;
    uvx?: RegistryLauncherDistribution;
    binary?: Record<string, RegistryBinaryDistributionTarget>;
  };
}

interface RegistryLaunchTemplate {
  command: string;
  args: string[];
  env?: Record<string, string>;
  autoConfigurable: boolean;
}

interface ThreadAgentBadge {
  label: string;
  iconUrl: string | null;
}

const TOAST_LIFETIME_MS = 7_000;
const ACP_REGISTRY_URL =
  'https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json';
const WELCOME_CUSTOM_AGENT_ID = '__custom__';
const VOICE_PROMPT_PREVIEW_TEXT = '[Voice prompt]';
const AGENT_CHANGED_MESSAGE_PREFIX = 'agent changed to ';
const KNOWN_CUSTOM_AGENT_LABEL_BY_COMMAND: Record<string, string> = {
  opencode: 'OpenCode',
};
const REVIEW_PANEL_WIDTH_KEY = 'zeroade.review-panel.width.v1';
const REVIEW_PANEL_WIDTH_DEFAULT = 560;
const REVIEW_PANEL_WIDTH_MIN = 320;
const REVIEW_PANEL_WIDTH_MAX = 980;
const REVIEW_PANEL_CHAT_MIN_WIDTH = 420;
const WORKSPACE_BOARD_THREAD_PANEL_WIDTH_KEY = 'zeroade.workspace-board-thread-panel.width.v1';
const WORKSPACE_BOARD_THREAD_PANEL_WIDTH_DEFAULT = 560;
const WORKSPACE_BOARD_THREAD_PANEL_WIDTH_MIN = 360;
const WORKSPACE_BOARD_THREAD_PANEL_WIDTH_MAX = 980;
const WORKSPACE_BOARD_MAIN_MIN_WIDTH = 640;
const ANSI_ESCAPE_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'gi');
const LOOSE_ANSI_PATTERN = /\[(?:\d{1,3}(?:;\d{1,3})*)m/gi;

const toStringRecord = (value: unknown): Record<string, string> | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }

  const entries = Object.entries(value).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string',
  );
  if (entries.length === 0) {
    return undefined;
  }

  return Object.fromEntries(entries);
};

const parseRegistryAgents = (payload: unknown): RegistryAgentCatalogEntry[] => {
  if (
    !isRecord(payload) ||
    !Array.isArray((payload as { agents?: unknown[] }).agents)
  ) {
    return [];
  }

  const entries: RegistryAgentCatalogEntry[] = [];
  for (const item of (payload as { agents: unknown[] }).agents) {
    if (!isRecord(item)) {
      continue;
    }

    const id = typeof item.id === 'string' ? item.id.trim() : '';
    const name = typeof item.name === 'string' ? item.name.trim() : '';
    if (!id || !name) {
      continue;
    }

    const distribution = isRecord(item.distribution) ? item.distribution : undefined;
    const rawNpx = distribution && isRecord(distribution.npx) ? distribution.npx : undefined;
    const rawUvx = distribution && isRecord(distribution.uvx) ? distribution.uvx : undefined;
    const rawBinary =
      distribution && isRecord(distribution.binary) ? distribution.binary : undefined;

    const npxPackage = rawNpx && typeof rawNpx.package === 'string'
      ? rawNpx.package.trim()
      : '';
    const uvxPackage = rawUvx && typeof rawUvx.package === 'string'
      ? rawUvx.package.trim()
      : '';

    entries.push({
      id,
      name,
      iconUrl:
        typeof item.icon === 'string' && item.icon.trim().length > 0 ? item.icon.trim() : null,
      version: typeof item.version === 'string' ? item.version.trim() : undefined,
      description: typeof item.description === 'string' ? item.description.trim() : undefined,
      repository: typeof item.repository === 'string' ? item.repository.trim() : undefined,
      distribution: {
        npx: npxPackage
          ? {
              package: npxPackage,
              args: Array.isArray(rawNpx?.args)
                ? rawNpx.args.filter(
                    (arg): arg is string => typeof arg === 'string' && arg.trim().length > 0,
                  )
                : [],
              env: toStringRecord(rawNpx?.env),
            }
          : undefined,
        uvx: uvxPackage
          ? {
              package: uvxPackage,
              args: Array.isArray(rawUvx?.args)
                ? rawUvx.args.filter(
                    (arg): arg is string => typeof arg === 'string' && arg.trim().length > 0,
                  )
                : [],
              env: toStringRecord(rawUvx?.env),
            }
          : undefined,
        binary: rawBinary as Record<string, RegistryBinaryDistributionTarget> | undefined,
      },
    });
  }

  entries.sort((left, right) => left.name.localeCompare(right.name));

  return entries;
};

const toBinaryKeyCandidates = (platform: NodeJS.Platform): string[] => {
  if (platform === 'darwin') {
    return ['darwin-aarch64', 'darwin-x86_64', 'darwin'];
  }

  if (platform === 'win32') {
    return ['windows-x86_64', 'windows-aarch64', 'windows'];
  }

  if (platform === 'linux') {
    return ['linux-x86_64', 'linux-aarch64', 'linux'];
  }

  return [];
};

const isBuiltInClaudeRegistryAgentId = (agentId: string): boolean =>
  agentId === 'claude-acp' || agentId === 'claude-agent-acp';

const shouldPreferRegistryBinaryTemplate = (agentId: string): boolean =>
  agentId === 'codex-acp' || isBuiltInClaudeRegistryAgentId(agentId);

const toExecutableCommand = (value: string): string =>
  value.trim().split(/[\\/]/).filter(Boolean).at(-1)?.replace(/\.exe$/i, '').toLowerCase() ?? '';

const toNormalizedArgsList = (args: string[]): string[] =>
  args.map((entry) => entry.trim()).filter((entry) => entry.length > 0);

const toKnownCustomAgentLabel = (command: string | undefined): string | null => {
  if (!command) {
    return null;
  }

  const token = toExecutableCommand(command);
  if (!token) {
    return null;
  }

  return KNOWN_CUSTOM_AGENT_LABEL_BY_COMMAND[token] ?? null;
};

const toDefaultCustomAgentLabel = (config: AcpCustomAgentConfig): string => {
  const knownLabel = toKnownCustomAgentLabel(config.command);
  if (knownLabel) {
    return knownLabel;
  }

  const executableCommand = toExecutableCommand(config.command);
  const commandBaseName = executableCommand.split(/[\\/]/).filter(Boolean).at(-1);
  return commandBaseName ?? 'Added agent';
};

const parseAgentChangedLabel = (value: string): string | null => {
  const normalized = normalizeMessageText(value).replace(/[.]+$/, '');
  if (!normalized.toLowerCase().startsWith(AGENT_CHANGED_MESSAGE_PREFIX)) {
    return null;
  }

  const label = normalized.slice(AGENT_CHANGED_MESSAGE_PREFIX.length).trim();
  return label.length > 0 ? label : null;
};

const getThreadAgentBadgeFromTimeline = (timeline: TimelineItem[]): ThreadAgentBadge | null => {
  for (let index = timeline.length - 1; index >= 0; index -= 1) {
    const item = timeline[index];
    if (item.kind !== 'assistant-message') {
      continue;
    }

    const label = parseAgentChangedLabel(item.text);
    if (item.noticeKind !== 'agent-change' && !label) {
      continue;
    }

    return {
      label: label ?? 'Agent',
      iconUrl: item.iconUrl ?? null,
    };
  }

  return null;
};

const isArgsPrefixCompatible = (left: string[], right: string[]): boolean => {
  if (left.length === 0 || right.length === 0) {
    return true;
  }

  const shorter = left.length <= right.length ? left : right;
  const longer = left.length <= right.length ? right : left;
  return shorter.every((entry, index) => longer[index] === entry);
};

const toRegistryLaunchTemplate = (
  agent: RegistryAgentCatalogEntry,
  platform: NodeJS.Platform,
): RegistryLaunchTemplate => {
  const binaryDistribution = agent.distribution?.binary ?? {};
  const binaryCandidates = toBinaryKeyCandidates(platform)
    .map((key) => binaryDistribution[key])
    .filter((target): target is RegistryBinaryDistributionTarget => Boolean(target));
  const binaryFallback = Object.values(binaryDistribution).filter(
    (target): target is RegistryBinaryDistributionTarget =>
      typeof target?.cmd === 'string' && target.cmd.trim().length > 0,
  );
  const binaryTarget = [...binaryCandidates, ...binaryFallback].find(
    (target) => typeof target.cmd === 'string' && target.cmd.trim().length > 0,
  );

  const binaryCommand =
    binaryTarget && typeof binaryTarget.cmd === 'string'
      ? binaryTarget.cmd.trim()
      : '';
  const binaryArgs = Array.isArray(binaryTarget?.args)
    ? binaryTarget.args.filter(
        (entry): entry is string => typeof entry === 'string' && entry.trim().length > 0,
      )
    : [];

  if (shouldPreferRegistryBinaryTemplate(agent.id) && binaryCommand) {
    return {
      command: binaryCommand,
      args: binaryArgs,
      autoConfigurable: true,
    };
  }

  const npxDistribution = agent.distribution?.npx;
  if (npxDistribution?.package) {
    return {
      command: 'npx',
      args: ['-y', npxDistribution.package, ...(npxDistribution.args ?? [])],
      env: npxDistribution.env,
      autoConfigurable: true,
    };
  }

  const uvxDistribution = agent.distribution?.uvx;
  if (uvxDistribution?.package) {
    return {
      command: 'uvx',
      args: [uvxDistribution.package, ...(uvxDistribution.args ?? [])],
      env: uvxDistribution.env,
      autoConfigurable: true,
    };
  }

  if (binaryCommand) {
    return {
      command: binaryCommand,
      args: binaryArgs,
      autoConfigurable: true,
    };
  }

  return {
    command: '',
    args: [],
    autoConfigurable: false,
  };
};

const matchesRegistryTemplate = (
  agent: RegistryAgentCatalogEntry,
  config: AcpCustomAgentConfig | null,
  platform: NodeJS.Platform,
): boolean => {
  if (!config) {
    return false;
  }

  const template = toRegistryLaunchTemplate(agent, platform);
  if (!template.autoConfigurable || !template.command) {
    return false;
  }

  const configCommand = config.command?.trim() ?? '';
  if (!configCommand) {
    return false;
  }

  const commandMatches =
    toExecutableCommand(template.command) === toExecutableCommand(configCommand);
  if (!commandMatches) {
    return false;
  }

  const templateArgs = toNormalizedArgsList(template.args);
  const configArgs = toNormalizedArgsList(config.args ?? []);
  return isArgsPrefixCompatible(templateArgs, configArgs);
};

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

const clampWorkspaceBoardThreadPanelWidth = (value: number, availableWidth: number): number => {
  const dynamicMax = Math.max(
    WORKSPACE_BOARD_THREAD_PANEL_WIDTH_MIN,
    Math.min(
      WORKSPACE_BOARD_THREAD_PANEL_WIDTH_MAX,
      availableWidth - WORKSPACE_BOARD_MAIN_MIN_WIDTH,
    ),
  );

  return Math.min(Math.max(value, WORKSPACE_BOARD_THREAD_PANEL_WIDTH_MIN), dynamicMax);
};

const readStoredWorkspaceBoardThreadPanelWidth = (): number => {
  const raw = window.localStorage.getItem(WORKSPACE_BOARD_THREAD_PANEL_WIDTH_KEY);
  if (!raw) {
    return WORKSPACE_BOARD_THREAD_PANEL_WIDTH_DEFAULT;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    return WORKSPACE_BOARD_THREAD_PANEL_WIDTH_DEFAULT;
  }

  return Math.min(
    Math.max(parsed, WORKSPACE_BOARD_THREAD_PANEL_WIDTH_MIN),
    WORKSPACE_BOARD_THREAD_PANEL_WIDTH_MAX,
  );
};

const toCleanErrorText = (value: string): string =>
  value
    .replace(/^Error invoking remote method '[^']+':\s*/i, '')
    .replace(ANSI_ESCAPE_PATTERN, '')
    .replace(LOOSE_ANSI_PATTERN, '')
    .replace(/\s+/g, ' ')
    .trim();

const parseArgs = (value: string): string[] => {
  const matches = value.trim().match(/(?:[^\s"]+|"[^"]*")+/g);
  if (!matches) {
    return [];
  }

  return matches
    .map((token) => token.replace(/^"(.*)"$/, '$1').trim())
    .filter((token) => token.length > 0);
};

const parseEnv = (value: string): Record<string, string> | undefined => {
  const lines = value
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    return undefined;
  }

  const entries: Array<[string, string]> = [];
  for (const line of lines) {
    const separatorIndex = line.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const envValue = line.slice(separatorIndex + 1);
    if (!key) {
      continue;
    }

    entries.push([key, envValue]);
  }

  if (entries.length === 0) {
    return undefined;
  }

  return Object.fromEntries(entries);
};

const toErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  return String(error);
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });

const isAuthenticationRequiredMessage = (value: string): boolean => {
  const normalized = value.toLowerCase();
  return (
    normalized.includes('authentication required') ||
    normalized.includes('please run') ||
    normalized.includes('call authenticate(') ||
    normalized.includes('authenticate agent')
  );
};

const quotePosixShellArg = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`;

const toPosixShellCommand = (command: string, args: string[]): string =>
  [command, ...args].map((entry) => quotePosixShellArg(entry)).join(' ');

const toPosixShellCommandWithEnv = (
  command: string,
  args: string[],
  env: Record<string, string>,
): string => {
  const envEntries = Object.entries(env).filter(
    ([key]) => key.trim().length > 0 && /^[A-Za-z_][A-Za-z0-9_]*$/.test(key),
  );
  if (envEntries.length === 0) {
    return toPosixShellCommand(command, args);
  }

  const envPrefix = envEntries
    .map(([key, value]) => `${key}=${quotePosixShellArg(value)}`)
    .join(' ');
  return `${envPrefix} ${toPosixShellCommand(command, args)}`;
};

const toWindowsShellArg = (value: string): string =>
  /\s|"/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

const toTerminalLaunchCommand = (
  launchSpec: AcpTerminalAuthLaunchSpec,
  platform: NodeJS.Platform,
): string => {
  if (platform === 'win32') {
    const command = [launchSpec.command, ...launchSpec.args].map(toWindowsShellArg).join(' ');
    const envCommands = Object.entries(launchSpec.env)
      .filter(([key]) => key.trim().length > 0)
      .map(([key, value]) => `set "${key}=${value.replace(/"/g, '""')}"`);
    return [
      `cd /d "${launchSpec.cwd.replace(/"/g, '""')}"`,
      ...envCommands,
      command,
    ]
      .filter((entry) => entry.trim().length > 0)
      .join(' && ');
  }

  const shellCommand = toPosixShellCommandWithEnv(
    launchSpec.command,
    launchSpec.args,
    launchSpec.env,
  );
  return `cd ${quotePosixShellArg(launchSpec.cwd)} && ${shellCommand}`;
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
    projects,
    recentProjects,
    workspaces,
    threadGroups,
    selectedThread,
    selectedWorkspace,
    selectedProject,
    selectedThreadId,
    selectedWorkspaceId,
    selectedProjectId,
    selectThread,
    clearThreadSelection,
    selectWorkspace,
    selectProject,
    createThread,
    setThreadProject,
    moveThreadInBoard,
    updateThreadFromMessage,
    applyAutoThreadTitle,
    renameThread,
    removeThread,
    reorderProjects,
    reorderThreads,
    createWorkspace,
    openWorkspaceFromPath,
    addProjectToWorkspace,
  } = useShellState();

  const {
    connectionState,
    connectionMessage,
    agentName,
    promptCapabilities,
    agentPreset,
    defaultAgentPreset,
    codexAgentConfig,
    claudeAgentConfig,
    customAgentConfig,
    defaultCustomAgentConfig,
    activeSessionThreadId,
    activeTimeline,
    threadPromptingById,
    threadAgentSelectionById,
    threadSessionTitleById,
    activeSessionControls,
    activeAvailableCommands,
    pendingPermission,
    setAgentPreset,
    setThreadAgentSelection,
    saveAgentConfig,
    ensureSessionForThread,
    sendPrompt,
    authenticate,
    setSessionMode,
    setSessionModel,
    setSessionConfigOption,
    cancelPrompt,
    resolvePermission,
  } = useAcp(selectedThreadId);

  const [statusText, setStatusText] = React.useState('Shell ready');
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = React.useState(false);
  const [isFileSearchOpen, setIsFileSearchOpen] = React.useState(false);
  const [fileSearchQuery, setFileSearchQuery] = React.useState('');
  const [fileSearchItems, setFileSearchItems] = React.useState<CommandPaletteItem[]>([]);
  const [isFileSearchLoading, setIsFileSearchLoading] = React.useState(false);
  const [isTerminalOpen, setIsTerminalOpen] = React.useState(false);
  const [isRunConfigurationOpen, setIsRunConfigurationOpen] = React.useState(false);
  const [isCommitPanelOpen, setIsCommitPanelOpen] = React.useState(false);
  const [isWebBrowserOpen, setIsWebBrowserOpen] = React.useState(false);
  const [browserOpenRequest, setBrowserOpenRequest] = React.useState<BrowserOpenRequest | null>(null);
  const [browserPushItems, setBrowserPushItems] = React.useState<AppNotificationItem[]>(() =>
    readStoredNotifications(),
  );
  const [isBrowserPushPanelOpen, setIsBrowserPushPanelOpen] = React.useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = React.useState(false);
  const [isCreatingWorkspace, setIsCreatingWorkspace] = React.useState(false);
  const [isWorkspaceBoardOpen, setIsWorkspaceBoardOpen] = React.useState(false);
  const [isWorkspaceBoardThreadPanelOpen, setIsWorkspaceBoardThreadPanelOpen] =
    React.useState(false);
  const [workspaceDraftName, setWorkspaceDraftName] = React.useState('');
  const [workspaceDraftPaths, setWorkspaceDraftPaths] = React.useState<string[]>([]);
  const [isPickingWorkspaceProject, setIsPickingWorkspaceProject] = React.useState(false);
  const [threadRenameTarget, setThreadRenameTarget] =
    React.useState<RenameThreadTarget | null>(null);
  const [completedThreadIds, setCompletedThreadIds] = React.useState<Set<string>>(
    () => new Set(),
  );
  const [runRequest, setRunRequest] = React.useState<RunTerminalRequest | null>(null);
  const [interruptRequest, setInterruptRequest] =
    React.useState<InterruptTerminalRequest | null>(null);
  const [activeRunExecution, setActiveRunExecution] =
    React.useState<ActiveRunExecution | null>(null);
  const [queuedPromptsByThread, setQueuedPromptsByThread] = React.useState<
    Record<string, QueuedPrompt[]>
  >({});
  const [timelineSnapshotByThreadId, setTimelineSnapshotByThreadId] = React.useState<
    Record<string, TimelineItem[]>
  >(() => readPersistedTimelineSnapshots());
  const [toasts, setToasts] = React.useState<ShellToast[]>([]);
  const [updaterState, setUpdaterState] = React.useState<UpdaterState | null>(null);
  const [isUpdateActionPending, setIsUpdateActionPending] = React.useState(false);
  const [isAgentAuthRequired, setIsAgentAuthRequired] = React.useState(false);
  const [isAgentAuthLaunching, setIsAgentAuthLaunching] = React.useState(false);
  const [agentAuthMessage, setAgentAuthMessage] = React.useState<string | null>(null);
  const [reviewRevealLocation, setReviewRevealLocation] = React.useState<{
    requestId: number;
    relativePath: string;
    lineNumber: number;
    column: number;
  } | null>(null);
  const [agentSelectionEpoch, setAgentSelectionEpoch] = React.useState(0);
  const [composerPrefillRequest, setComposerPrefillRequest] = React.useState<{
    id: number;
    text: string;
  } | null>(null);
  const [reviewPanelWidth, setReviewPanelWidth] = React.useState<number>(() =>
    readStoredReviewPanelWidth(),
  );
  const [isReviewPanelResizing, setIsReviewPanelResizing] = React.useState(false);
  const [workspaceBoardThreadPanelWidth, setWorkspaceBoardThreadPanelWidth] =
    React.useState<number>(() => readStoredWorkspaceBoardThreadPanelWidth());
  const [isWorkspaceBoardThreadPanelResizing, setIsWorkspaceBoardThreadPanelResizing] =
    React.useState(false);
  const [welcomeProjectPath, setWelcomeProjectPath] = React.useState('');
  const [welcomeSelectedAgentId, setWelcomeSelectedAgentId] = React.useState<string | null>(null);
  const [isWelcomeStarting, setIsWelcomeStarting] = React.useState(false);
  const [isWelcomeAgentMenuExpanded, setIsWelcomeAgentMenuExpanded] = React.useState(false);
  const [isWelcomeCustomAgentDialogOpen, setIsWelcomeCustomAgentDialogOpen] =
    React.useState(false);
  const [welcomeCustomCommand, setWelcomeCustomCommand] = React.useState(
    customAgentConfig?.command ?? '',
  );
  const [welcomeCustomArgs, setWelcomeCustomArgs] = React.useState(
    customAgentConfig?.args.join(' ') ?? '',
  );
  const [threadNavigationHistory, setThreadNavigationHistory] = React.useState<{
    entries: string[];
    index: number;
  }>({
    entries: [],
    index: -1,
  });
  const [welcomeCustomCwd, setWelcomeCustomCwd] = React.useState(
    customAgentConfig?.cwd ?? '',
  );
  const [welcomeCustomEnv, setWelcomeCustomEnv] = React.useState(
    customAgentConfig?.env
      ? Object.entries(customAgentConfig.env)
          .map(([key, value]) => `${key}=${value}`)
          .join('\n')
      : '',
  );
  const [welcomeRegistryAgents, setWelcomeRegistryAgents] = React.useState<
    RegistryAgentCatalogEntry[]
  >([]);
  const lastShiftTapAtRef = React.useRef(0);
  const fileSearchRequestIdRef = React.useRef(0);
  const dispatchingQueuedPromptRef = React.useRef(false);
  const blockedQueuedPromptIdRef = React.useRef<string | null>(null);
  const previousThreadPromptingByIdRef = React.useRef<Record<string, boolean>>({});
  const appliedSessionTitleByThreadRef = React.useRef<Record<string, string>>({});
  const syncedPreviewByThreadRef = React.useRef<Record<string, string>>({});
  const authRecheckEpochRef = React.useRef(0);
  const pendingComposerSubmitRef = React.useRef<{
    text: string;
    attachments: AcpPromptAttachment[];
    audio?: AcpPromptAudioContent | null;
  } | null>(null);
  const connectionErrorToastRef = React.useRef('');
  const toastTimeoutByIdRef = React.useRef<Record<number, number>>({});
  const composerPrefillIdRef = React.useRef(0);
  const reviewPanelResizeActiveRef = React.useRef(false);
  const reviewPanelContainerRef = React.useRef<HTMLDivElement | null>(null);
  const workspaceBoardThreadPanelResizeActiveRef = React.useRef(false);
  const workspaceBoardPanelContainerRef = React.useRef<HTMLDivElement | null>(null);
  const pendingWelcomeStartPathRef = React.useRef<string | null>(null);
  const pendingThreadNavigationIndexRef = React.useRef<number | null>(null);
  const threadNavigationHistoryRef = React.useRef(threadNavigationHistory);
  const fileSearchRevealRequestIdRef = React.useRef(0);
  const fileSearchPreviewEpochRef = React.useRef(0);

  const platform = window.desktop?.platform ?? 'darwin';
  const navigationZoneClass =
    platform === 'darwin' ? 'w-[150px] pl-[82px] pr-2' : 'w-12 px-2';

  const selectedThreadProject = React.useMemo(() => {
    if (!selectedThread) {
      return selectedProject;
    }

    return (
      projects.find((project) => project.id === selectedThread.projectId) ??
      selectedProject
    );
  }, [projects, selectedProject, selectedThread]);

  const visibleProjects = React.useMemo(
    () => {
      if (!selectedWorkspace) {
        return projects;
      }

      const projectById = new Map(projects.map((project) => [project.id, project]));
      return selectedWorkspace.projectIds.flatMap((projectId) => {
        const project = projectById.get(projectId);
        return project ? [project] : [];
      });
    },
    [projects, selectedWorkspace],
  );
  const visibleThreadGroupByProjectId = React.useMemo(
    () => new Map(threadGroups.map((group) => [group.projectId, group])),
    [threadGroups],
  );
  const visibleThreadGroups = React.useMemo(
    () =>
      visibleProjects.map((project) => {
        const group = visibleThreadGroupByProjectId.get(project.id);

        return {
          id: group?.id ?? `group-${project.id}`,
          label: project.name,
          projectId: project.id,
          path: project.path,
          threads: (group?.threads ?? []).filter(
            (thread) => thread.workspaceId === selectedWorkspaceId,
          ),
        };
      }),
    [selectedWorkspaceId, visibleProjects, visibleThreadGroupByProjectId],
  );

  React.useEffect(() => {
    if (isWorkspaceBoardOpen) {
      return;
    }

    setIsWorkspaceBoardThreadPanelOpen(false);
  }, [isWorkspaceBoardOpen]);

  React.useEffect(() => {
    if (selectedThreadId) {
      return;
    }

    setIsWorkspaceBoardThreadPanelOpen(false);
  }, [selectedThreadId]);

  const sessionWorkspacePath =
    selectedThreadProject?.path ?? selectedProject?.path ?? visibleProjects[0]?.path ?? '';
  const workspacePath = sessionWorkspacePath || '/';
  const {
    configurations: runConfigurations,
    selectedConfigurationId: selectedRunConfigurationId,
    selectedConfiguration: selectedRunConfiguration,
    saveConfiguration: saveRunConfiguration,
    deleteConfiguration: deleteRunConfiguration,
    selectConfiguration: selectRunConfiguration,
    touchConfiguration: touchRunConfiguration,
  } = useRunConfigurations(workspacePath);

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
    refreshFileTree,
    closeFileTree,
    toggleReviewPanelVisibility,
    openFile,
    openDiff,
    setActiveReviewFile,
    closeReviewFile,
    reorderReviewFiles,
    refreshReviewPath,
  } = useWorkspaceReview(workspacePath);
  const focusedReviewRelativePath = activeReviewFile?.relativePath ?? null;
  const knownThreadIds = React.useMemo(
    () => [
      ...threadGroups.flatMap((group) => group.threads.map((thread) => thread.id)),
      ...(selectedThread ? [selectedThread.id] : []),
    ],
    [selectedThread, threadGroups],
  );

  const ensureSessionForThreadRef = React.useRef(ensureSessionForThread);

  React.useEffect(() => {
    ensureSessionForThreadRef.current = ensureSessionForThread;
  }, [ensureSessionForThread]);

  React.useEffect(() => {
    threadNavigationHistoryRef.current = threadNavigationHistory;
  }, [threadNavigationHistory]);

  React.useEffect(() => {
    const knownThreadIdSet = new Set(knownThreadIds);

    setThreadNavigationHistory((previous) => {
      if (previous.entries.length === 0) {
        return previous;
      }

      const nextEntries = previous.entries.filter((threadId) => knownThreadIdSet.has(threadId));
      const nextIndex =
        nextEntries.length === 0 ? -1 : Math.min(previous.index, nextEntries.length - 1);

      if (nextEntries.length === previous.entries.length && nextIndex === previous.index) {
        return previous;
      }

      pendingThreadNavigationIndexRef.current = null;
      return {
        entries: nextEntries,
        index: nextIndex,
      };
    });
  }, [knownThreadIds]);

  React.useEffect(() => {
    if (!selectedThreadId) {
      return;
    }

    setThreadNavigationHistory((previous) => {
      const pendingIndex = pendingThreadNavigationIndexRef.current;
      if (pendingIndex !== null) {
        pendingThreadNavigationIndexRef.current = null;

        if (previous.entries[pendingIndex] === selectedThreadId) {
          return previous.index === pendingIndex
            ? previous
            : {
                ...previous,
                index: pendingIndex,
              };
        }
      }

      if (previous.entries[previous.index] === selectedThreadId) {
        return previous;
      }

      const nextEntries = [...previous.entries.slice(0, previous.index + 1), selectedThreadId];
      return {
        entries: nextEntries,
        index: nextEntries.length - 1,
      };
    });
  }, [selectedThreadId]);

  React.useEffect(() => {
    authRecheckEpochRef.current += 1;
    if (!sessionWorkspacePath) {
      return;
    }

    let cancelled = false;

    void ensureSessionForThreadRef.current(selectedThreadId, sessionWorkspacePath)
      .then(() => {
        if (cancelled) {
          return;
        }

        setIsAgentAuthRequired(false);
        setAgentAuthMessage(null);
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        const cleanedError = toCleanErrorText(toErrorMessage(error));
        if (!isAuthenticationRequiredMessage(cleanedError)) {
          // Keep the shell interactive even if ACP startup fails.
          return;
        }

        setIsAgentAuthRequired(true);
        setAgentAuthMessage(cleanedError || 'Authentication required. Use Authenticate agent.');
        setStatusText('Authentication required');
      });

    return () => {
      cancelled = true;
    };
  }, [agentPreset, agentSelectionEpoch, selectedThreadId, sessionWorkspacePath]);

  const beginAgentAuthCompletionCheck = React.useCallback(() => {
    if (!sessionWorkspacePath) {
      return;
    }

    authRecheckEpochRef.current += 1;
    const checkEpoch = authRecheckEpochRef.current;

    void (async () => {
      for (let attempt = 0; attempt < 180; attempt += 1) {
        if (checkEpoch !== authRecheckEpochRef.current) {
          return;
        }

        if (attempt > 0) {
          await sleep(1000);
          if (checkEpoch !== authRecheckEpochRef.current) {
            return;
          }
        }

        try {
          await ensureSessionForThreadRef.current(selectedThreadId, sessionWorkspacePath);
          if (checkEpoch !== authRecheckEpochRef.current) {
            return;
          }

          setIsAgentAuthRequired(false);
          setAgentAuthMessage(null);
          setStatusText('Agent authenticated');
          return;
        } catch (error) {
          const cleanedError = toCleanErrorText(toErrorMessage(error));
          if (!isAuthenticationRequiredMessage(cleanedError)) {
            if (checkEpoch !== authRecheckEpochRef.current) {
              return;
            }

            setStatusText('Agent authentication check failed');
            return;
          }
        }
      }
    })();
  }, [selectedThreadId, sessionWorkspacePath]);

  React.useEffect(() => {
    let cancelled = false;

    const loadRegistryIcons = async (): Promise<void> => {
      try {
        const response = await fetch(ACP_REGISTRY_URL, {
          method: 'GET',
          cache: 'no-store',
        });
        if (!response.ok) {
          return;
        }

        const payload = (await response.json()) as unknown;
        const entries = parseRegistryAgents(payload);
        if (cancelled || entries.length === 0) {
          return;
        }

        setWelcomeRegistryAgents(entries);
      } catch {
        // Welcome agent cards keep fallback labels when registry icons fail.
      }
    };

    void loadRegistryIcons();

    return () => {
      cancelled = true;
    };
  }, []);

  React.useEffect(() => {
    return onStoredNotificationsChanged(() => {
      setBrowserPushItems(readStoredNotifications());
    });
  }, []);

  React.useEffect(() => {
    if (!isBrowserPushPanelOpen) {
      return;
    }

    const nextItems = browserPushItems.map((item) =>
      item.read ? item : { ...item, read: true },
    );
    const hasChanges = nextItems.some((item, index) => item !== browserPushItems[index]);
    if (!hasChanges) {
      return;
    }

    writeStoredNotifications(nextItems);
    setBrowserPushItems(nextItems);
  }, [browserPushItems, isBrowserPushPanelOpen]);

  React.useEffect(() => {
    if (!isSettingsOpen) {
      return;
    }

    setIsBrowserPushPanelOpen(false);
  }, [isSettingsOpen]);

  React.useEffect(() => {
    if (isWelcomeCustomAgentDialogOpen) {
      return;
    }

    setWelcomeCustomCommand(customAgentConfig?.command ?? '');
    setWelcomeCustomArgs(customAgentConfig?.args.join(' ') ?? '');
    setWelcomeCustomCwd(customAgentConfig?.cwd ?? '');
    setWelcomeCustomEnv(
      customAgentConfig?.env
        ? Object.entries(customAgentConfig.env)
            .map(([key, value]) => `${key}=${value}`)
            .join('\n')
      : '',
    );
  }, [customAgentConfig, isWelcomeCustomAgentDialogOpen]);

  React.useEffect(() => {
    if (welcomeProjectPath.trim().length === 0) {
      setIsWelcomeAgentMenuExpanded(false);
      return;
    }

    if (!welcomeSelectedAgentId) {
      setIsWelcomeAgentMenuExpanded(true);
    }
  }, [welcomeProjectPath, welcomeSelectedAgentId]);

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

  const pushToast = React.useCallback(
    (title: string, message: string, tone: 'error' | 'info') => {
      const cleanedMessage = toCleanErrorText(message);
      if (!cleanedMessage) {
        return;
      }

      const hasDuplicateToast = toasts.some(
        (toast) =>
          toast.title === title && toast.message === cleanedMessage && toast.tone === tone,
      );
      if (hasDuplicateToast) {
        return;
      }

      const toastId = Date.now() + Math.floor(Math.random() * 1000);
      setToasts((previous) =>
        [
          ...previous,
          {
            id: toastId,
            title,
            message: cleanedMessage,
            tone,
          },
        ].slice(-4),
      );

      appendStoredNotification({
        id: `app-notification-${toastId}`,
        title,
        body: cleanedMessage,
        url: null,
        origin: 'Zero',
        source: 'app',
        kind: 'app',
        severity: tone === 'error' ? 'error' : 'info',
        createdAtMs: Date.now(),
        read: false,
      });

      toastTimeoutByIdRef.current[toastId] = window.setTimeout(() => {
        removeToast(toastId);
      }, TOAST_LIFETIME_MS);
    },
    [removeToast, toasts],
  );

  const pushErrorToast = React.useCallback(
    (title: string, message: string) => {
      pushToast(title, message, 'error');
    },
    [pushToast],
  );

  const pushInfoToast = React.useCallback(
    (title: string, message: string) => {
      pushToast(title, message, 'info');
    },
    [pushToast],
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
      if (result.requiresUserAction && result.terminalLaunchSpec) {
        const authLabel = result.methodName?.trim() || 'Agent';
        setIsTerminalOpen(true);
        setRunRequest({
          id: Date.now(),
          configurationId: `agent-auth-${result.methodId ?? 'unknown'}`,
          configurationName: `${authLabel} authentication`,
          command: toTerminalLaunchCommand(result.terminalLaunchSpec, platform),
        });
        beginAgentAuthCompletionCheck();
      }
      setStatusText(
        result.requiresUserAction
          ? 'Complete authentication in built-in terminal'
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
  }, [
    authenticate,
    beginAgentAuthCompletionCheck,
    isAgentAuthLaunching,
    platform,
    pushErrorToast,
    workspacePath,
  ]);

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

  const stopWorkspaceBoardThreadPanelResizing = React.useCallback(() => {
    if (!workspaceBoardThreadPanelResizeActiveRef.current) {
      return;
    }

    workspaceBoardThreadPanelResizeActiveRef.current = false;
    setIsWorkspaceBoardThreadPanelResizing(false);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, []);

  React.useEffect(() => {
    const handlePointerMove = (event: PointerEvent): void => {
      if (!workspaceBoardThreadPanelResizeActiveRef.current) {
        return;
      }

      const bounds = workspaceBoardPanelContainerRef.current?.getBoundingClientRect();
      if (!bounds) {
        return;
      }

      const nextWidth = clampWorkspaceBoardThreadPanelWidth(bounds.right - event.clientX, bounds.width);
      setWorkspaceBoardThreadPanelWidth(nextWidth);
      window.localStorage.setItem(WORKSPACE_BOARD_THREAD_PANEL_WIDTH_KEY, String(nextWidth));
    };

    const stopResizing = (): void => {
      stopWorkspaceBoardThreadPanelResizing();
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
      stopWorkspaceBoardThreadPanelResizing();
    };
  }, [stopWorkspaceBoardThreadPanelResizing]);

  React.useEffect(() => {
    if (!isWorkspaceBoardOpen || !isWorkspaceBoardThreadPanelOpen || !selectedThreadId) {
      return;
    }

    const clampToAvailableSpace = (): void => {
      const bounds = workspaceBoardPanelContainerRef.current?.getBoundingClientRect();
      if (!bounds) {
        return;
      }

      setWorkspaceBoardThreadPanelWidth((previous) => {
        const next = clampWorkspaceBoardThreadPanelWidth(previous, bounds.width);
        if (next !== previous) {
          window.localStorage.setItem(WORKSPACE_BOARD_THREAD_PANEL_WIDTH_KEY, String(next));
        }
        return next;
      });
    };

    clampToAvailableSpace();
    window.addEventListener('resize', clampToAvailableSpace);

    return () => {
      window.removeEventListener('resize', clampToAvailableSpace);
    };
  }, [isWorkspaceBoardOpen, isWorkspaceBoardThreadPanelOpen, selectedThreadId]);

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

  const shouldShowUpdateButton = Boolean(
    updaterState?.isPackaged && updaterState?.isConfigured,
  );

  const isUpdateButtonDisabled =
    updaterState?.status === 'checking' ||
    updaterState?.status === 'available' ||
    updaterState?.status === 'downloading';

  const handleUpdateAction = React.useCallback(async () => {
    setIsUpdateActionPending(true);
    const isInstallAction = updaterState?.status === 'downloaded';
    if (!isInstallAction) {
      setStatusText('Checking for updates…');
    }

    try {
      const actionPromise = isInstallAction
        ? window.desktop.updaterInstallDownloadedUpdate()
        : window.desktop.updaterCheckForUpdates();
      const minimumSpinnerDelayPromise = new Promise<void>((resolve) => {
        window.setTimeout(resolve, 450);
      });
      const [result] = await Promise.all([actionPromise, minimumSpinnerDelayPromise]);

      setStatusText(result.message);
      if (!result.ok) {
        pushErrorToast('Update', result.message);
      } else if (!isInstallAction) {
        pushInfoToast('Update', result.message);
      }
    } catch {
      const fallbackMessage = 'Update action failed.';
      setStatusText(fallbackMessage);
      pushErrorToast('Update', fallbackMessage);
    } finally {
      setIsUpdateActionPending(false);
    }
  }, [pushErrorToast, pushInfoToast, setStatusText, updaterState?.status]);

  const isUpdateIconSpinning =
    isUpdateActionPending ||
    updaterState?.status === 'checking' ||
    updaterState?.status === 'available' ||
    updaterState?.status === 'downloading';

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

  const startWorkspaceBoardThreadPanelResizing = React.useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      workspaceBoardThreadPanelResizeActiveRef.current = true;
      setIsWorkspaceBoardThreadPanelResizing(true);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    },
    [],
  );

  const handleOpenCommandPalette = React.useCallback(() => {
    setIsFileSearchOpen(false);
    setIsCommandPaletteOpen(true);
  }, []);

  const pickProjectPath = React.useCallback(async (): Promise<string | null> => {
    const result = await window.desktop.openFolder();
    if (result.canceled || !result.path) {
      return null;
    }

    return result.path;
  }, []);

  const handleOpenFolder = React.useCallback(async () => {
    const projectPath = await pickProjectPath();
    if (!projectPath) {
      setStatusText('Open canceled');
      return;
    }

    setIsCreatingWorkspace(false);
    openWorkspaceFromPath(projectPath);
    setStatusText(`Opened ${getFolderName(projectPath)}`);
  }, [openWorkspaceFromPath, pickProjectPath]);

  const handleAddProjectToScope = React.useCallback(async () => {
    const projectPath = await pickProjectPath();
    if (!projectPath) {
      return;
    }

    if (selectedWorkspaceId) {
      const project = addProjectToWorkspace(selectedWorkspaceId, projectPath);
      if (!project) {
        setStatusText('Could not add project');
        return;
      }

      setStatusText(`Added ${project.name} to ${selectedWorkspace?.name ?? 'workspace'}`);
      return;
    }

    openWorkspaceFromPath(projectPath);
    setStatusText(`Opened ${getFolderName(projectPath)}`);
  }, [
    addProjectToWorkspace,
    openWorkspaceFromPath,
    pickProjectPath,
    selectedWorkspace,
    selectedWorkspaceId,
  ]);

  const closeWorkspaceCreation = React.useCallback(() => {
    setIsCreatingWorkspace(false);
    setWorkspaceDraftName('');
    setWorkspaceDraftPaths([]);
    setIsPickingWorkspaceProject(false);
  }, []);

  const handleOpenWorkspaceBoard = React.useCallback(() => {
    setIsSettingsOpen(false);
    closeWorkspaceCreation();
    setIsWorkspaceBoardOpen(true);
    setIsWorkspaceBoardThreadPanelOpen(false);
  }, [closeWorkspaceCreation]);

  const handleAddProjectToWorkspaceDraft = React.useCallback(async () => {
    setIsPickingWorkspaceProject(true);

    try {
      const nextPath = await pickProjectPath();
      const normalizedPath = nextPath ? normalizeFolderPath(nextPath) : '';
      if (!normalizedPath) {
        return;
      }

      setWorkspaceDraftPaths((previous) =>
        previous.includes(normalizedPath) ? previous : [...previous, normalizedPath],
      );
      setWorkspaceDraftName((previous) => previous || getFolderName(normalizedPath));
    } finally {
      setIsPickingWorkspaceProject(false);
    }
  }, [pickProjectPath]);

  const handleCreateThreadInGroup = React.useCallback(
    (projectId: string) => {
      const project = projects.find((item) => item.id === projectId);
      setIsCreatingWorkspace(false);
      setIsWorkspaceBoardOpen(false);
      createThread({
        workspaceId: selectedWorkspaceId,
        projectId,
      });
      setIsSettingsOpen(false);
      setStatusText(`New chat in ${project?.name ?? 'project'}`);
    },
    [createThread, projects, selectedWorkspaceId],
  );

  const handleCreateThreadInWorkspaceBoard = React.useCallback(
    (projectId: string) => {
      const project = projects.find((item) => item.id === projectId);
      setIsCreatingWorkspace(false);
      setIsWorkspaceBoardOpen(true);
      setIsWorkspaceBoardThreadPanelOpen(true);
      setIsSettingsOpen(false);
      createThread({
        workspaceId: selectedWorkspaceId,
        projectId,
      });
      setStatusText(`New chat in ${project?.name ?? 'project'}`);
    },
    [createThread, projects, selectedWorkspaceId],
  );

  const handleCreateWorkspace = React.useCallback(() => {
    const initialProjectPath = selectedThreadProject?.path ?? selectedProject?.path ?? '';

    setIsSettingsOpen(false);
    setIsWorkspaceBoardOpen(false);
    setIsWorkspaceBoardThreadPanelOpen(false);
    setIsCreatingWorkspace(true);
    setWorkspaceDraftName('');
    setWorkspaceDraftPaths(initialProjectPath ? [initialProjectPath] : []);
    setIsPickingWorkspaceProject(false);
  }, [selectedProject?.path, selectedThreadProject?.path]);

  const handleSubmitWorkspace = React.useCallback(
    (input: {
      name: string;
      projectPaths: string[];
    }): boolean => {
      const createdWorkspace = createWorkspace(input);
      if (!createdWorkspace) {
        setStatusText('Name the workspace and choose at least one project');
        return false;
      }

      closeWorkspaceCreation();
      setStatusText(`Created workspace ${createdWorkspace.name}`);
      return true;
    },
    [closeWorkspaceCreation, createWorkspace],
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
    const threads = new Map<string, (typeof threadGroups)[number]['threads'][number]>();

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

  const clearCompletedThreadState = React.useCallback((threadId: string) => {
    setCompletedThreadIds((previous) => {
      if (!previous.has(threadId)) {
        return previous;
      }

      const next = new Set(previous);
      next.delete(threadId);
      return next;
    });
  }, []);

  const handleSelectThreadInWorkspaceBoard = React.useCallback(
    (threadId: string) => {
      if (threadId === selectedThreadId && isWorkspaceBoardThreadPanelOpen) {
        setIsWorkspaceBoardThreadPanelOpen(false);
        clearThreadSelection();
        return;
      }

      setIsCreatingWorkspace(false);
      setIsWorkspaceBoardOpen(true);
      setIsWorkspaceBoardThreadPanelOpen(true);
      setIsSettingsOpen(false);
      clearCompletedThreadState(threadId);
      selectThread(threadId);
    },
    [
      clearCompletedThreadState,
      clearThreadSelection,
      isWorkspaceBoardThreadPanelOpen,
      selectThread,
      selectedThreadId,
    ],
  );

  const handleSelectThread = React.useCallback(
    (threadId: string) => {
      setIsCreatingWorkspace(false);
      setIsWorkspaceBoardOpen(false);
      setIsWorkspaceBoardThreadPanelOpen(false);
      setIsSettingsOpen(false);
      clearCompletedThreadState(threadId);
      selectThread(threadId);
    },
    [clearCompletedThreadState, selectThread],
  );

  const canNavigateThreadBack = threadNavigationHistory.index > 0;
  const canNavigateThreadForward =
    threadNavigationHistory.index >= 0 &&
    threadNavigationHistory.index < threadNavigationHistory.entries.length - 1;

  const handleNavigateThreadHistory = React.useCallback(
    (direction: -1 | 1) => {
      const { entries, index } = threadNavigationHistoryRef.current;
      const nextIndex = index + direction;
      const nextThreadId = entries[nextIndex];
      if (!nextThreadId) {
        return;
      }

      pendingThreadNavigationIndexRef.current = nextIndex;
      setThreadNavigationHistory((previous) =>
        previous.index === nextIndex
          ? previous
          : {
              ...previous,
              index: nextIndex,
            },
      );
      if (isWorkspaceBoardOpen) {
        handleSelectThreadInWorkspaceBoard(nextThreadId);
      } else {
        handleSelectThread(nextThreadId);
      }
      setStatusText(`Thread ${threadById.get(nextThreadId)?.title ?? 'selected'}`);
    },
    [handleSelectThread, handleSelectThreadInWorkspaceBoard, isWorkspaceBoardOpen, threadById],
  );

  React.useEffect(() => {
    try {
      window.localStorage.setItem(
        TIMELINE_SNAPSHOT_STORAGE_KEY,
        JSON.stringify(timelineSnapshotByThreadId),
      );
    } catch {
      // Keep the shell usable even if transcript persistence hits storage limits.
    }
  }, [timelineSnapshotByThreadId]);

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

    setTimelineSnapshotByThreadId((previous) => {
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
    const projectId =
      selectedProjectId || visibleProjects[0]?.id || selectedThreadProject?.id || '';
    if (!projectId) {
      setStatusText('Open a project first');
      return;
    }

    handleCreateThreadInGroup(projectId);
  }, [handleCreateThreadInGroup, selectedProjectId, selectedThreadProject, visibleProjects]);

  const handleMoveThreadInWorkspaceBoard = React.useCallback(
    (input: {
      threadId: string;
      targetStatus: ThreadBoardStatus;
      targetThreadId?: string;
      placement?: 'before' | 'after';
    }) => {
      const { threadId, targetStatus, targetThreadId, placement = 'before' } = input;
      if (!threadId || !targetStatus) {
        return;
      }

      moveThreadInBoard(threadId, targetStatus, targetThreadId, placement);
    },
    [moveThreadInBoard],
  );

  const handleToggleFileTree = React.useCallback(() => {
    if (isFileTreeOpen) {
      closeFileTree();
      return;
    }

    setIsCommitPanelOpen(false);
    void openFileTree();
  }, [closeFileTree, isFileTreeOpen, openFileTree]);

  const handleOpenCommitPanel = React.useCallback(() => {
    closeFileTree();
    setIsCommitPanelOpen(true);
  }, [closeFileTree]);

  const handleCloseCommitPanel = React.useCallback(() => {
    setIsCommitPanelOpen(false);
  }, []);

  const unreadBrowserPushCount = React.useMemo(
    () => browserPushItems.reduce((count, item) => (item.read ? count : count + 1), 0),
    [browserPushItems],
  );

  const handleOpenWebLink = React.useCallback((url: string) => {
    setIsSettingsOpen(false);
    setIsWebBrowserOpen(true);
    setBrowserOpenRequest({
      id: Date.now() + Math.floor(Math.random() * 1000),
      url,
    });
  }, []);

  const handleOpenTranscriptLink = React.useCallback(
    async (href: string) => {
      const trimmedHref = href.trim();
      if (!trimmedHref) {
        return;
      }

      if (looksLikeWorkspaceFileLink(trimmedHref) || trimmedHref.toLowerCase().startsWith('file://')) {
        const normalizedPath = normalizeTranscriptFileHref(trimmedHref);

        try {
          await openFile(normalizedPath);
          return;
        } catch {
          setStatusText(`Could not open ${normalizedPath}`);
          return;
        }
      }

      if (EXTERNAL_LINK_SCHEME_PATTERN.test(trimmedHref)) {
        handleOpenWebLink(trimmedHref);
        return;
      }

      handleOpenWebLink(trimmedHref);
    },
    [handleOpenWebLink, openFile],
  );

  const handleOpenBrowserPushUrl = React.useCallback(
    (url: string) => {
      setIsBrowserPushPanelOpen(false);
      handleOpenWebLink(url);
    },
    [handleOpenWebLink],
  );

  const sendPromptToThread = React.useCallback(
    async (
      threadId: string,
      text: string,
      attachments: AcpPromptAttachment[],
      audio?: AcpPromptAudioContent | null,
    ): Promise<boolean> => {
      const thread = threadById.get(threadId);
      if (!thread) {
        setStatusText('Thread no longer exists');
        return false;
      }

      const targetProjectId = thread.projectId || selectedProjectId || visibleProjects[0]?.id || '';
      if (!targetProjectId) {
        setStatusText('Open a project first');
        return false;
      }

      const targetProject = projects.find((project) => project.id === targetProjectId);
      if (!targetProject) {
        setStatusText('Select a valid project first');
        return false;
      }

      const trimmedText = normalizeMessageText(text);
      const normalizedAudio =
        promptCapabilities.audio &&
        audio &&
        audio.data.trim().length > 0 &&
        audio.mimeType.trim().length > 0
          ? {
              data: audio.data.trim(),
              mimeType: audio.mimeType.trim(),
            }
          : null;
      if (!trimmedText && attachments.length === 0 && !normalizedAudio) {
        if (audio) {
          setStatusText('Current agent does not accept voice prompts');
        }
        return false;
      }
      const previewText = toPromptPreviewText(
        trimmedText,
        attachments,
        normalizedAudio !== null,
      );

      try {
        await ensureSessionForThreadRef.current(threadId, targetProject.path);
        updateThreadFromMessage(threadId, previewText);
        await sendPrompt(trimmedText, attachments, normalizedAudio);
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
      promptCapabilities.audio,
      projects,
      selectedProjectId,
      sendPrompt,
      threadById,
      updateThreadFromMessage,
      visibleProjects,
      pushErrorToast,
      isAgentAuthLaunching,
      startAgentAuthentication,
    ],
  );

  const threadTitle = selectedThread?.title ?? 'No thread selected';
  const isNewThread = Boolean(selectedThread?.isDraft);
  const fallbackTimeline = timelineSnapshotByThreadId[selectedThreadId] ?? [];
  const activeSessionBelongsToSelectedThread =
    selectedThreadId.trim().length > 0 && activeSessionThreadId === selectedThreadId;
  const effectiveTimeline = React.useMemo(() => {
    if (isNewThread) {
      return [];
    }

    if (!activeSessionBelongsToSelectedThread) {
      return fallbackTimeline;
    }

    if (activeTimeline.items.length === 0) {
      return fallbackTimeline;
    }

    return buildThreadTimelineFromSession(activeTimeline.items, fallbackTimeline);
  }, [
    activeSessionBelongsToSelectedThread,
    activeTimeline.items,
    fallbackTimeline,
    isNewThread,
  ]);
  const effectiveIsPrompting = isNewThread ? false : Boolean(threadPromptingById[selectedThreadId]);
  const effectivePendingPermission =
    isNewThread || !activeSessionBelongsToSelectedThread ? null : pendingPermission;
  const effectiveSessionControls =
    selectedThreadId.trim().length === 0
      ? activeSessionControls
      : activeSessionBelongsToSelectedThread
        ? activeSessionControls
        : null;
  const queuedPrompts = React.useMemo(
    () => queuedPromptsByThread[selectedThreadId] ?? [],
    [queuedPromptsByThread, selectedThreadId],
  );
  const landingSelectedProjectId =
    selectedThread?.projectId || selectedProjectId || visibleProjects[0]?.id || '';
  const workspaceName = selectedThreadProject?.name ?? selectedProject?.name ?? 'project';
  const headerTitle = isCreatingWorkspace
    ? 'New workspace'
    : isWorkspaceBoardOpen
      ? 'Workspace board'
      : threadTitle;
  const headerSubtitle = isCreatingWorkspace
    ? ''
    : isWorkspaceBoardOpen
      ? selectedWorkspace?.name ?? 'Select a workspace'
      : workspaceName;
  const isWorkspaceBoardThreadPanelVisible =
    isWorkspaceBoardOpen && isWorkspaceBoardThreadPanelOpen && Boolean(selectedThreadId);
  const workspaceBoardThreadPanelSubtitle =
    selectedThreadProject?.name ?? selectedProject?.name ?? '';

  const handleCloseWorkspaceBoardThreadPanel = React.useCallback(() => {
    setIsWorkspaceBoardThreadPanelOpen(false);
    clearThreadSelection();
  }, [clearThreadSelection]);

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
        setStatusText(`Connecting ${selection.label}`);
        setIsAgentAuthRequired(false);
        setIsAgentAuthLaunching(false);
        setAgentAuthMessage(null);
        setAgentSelectionEpoch((previous) => previous + 1);
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
      setAgentSelectionEpoch((previous) => previous + 1);
      if (selection.preset === 'custom' && selection.customConfig) {
        saveAgentConfig('custom', selection.customConfig);
      }

      if (selectedThreadId) {
        const nextThreadSelection: ThreadAgentSelection = {
          preset: selection.preset,
          ...(selection.preset === 'custom' && selection.customConfig
            ? { customConfig: selection.customConfig }
            : {}),
        };
        setThreadAgentSelection(selectedThreadId, nextThreadSelection);
        return;
      }

      setAgentPreset(selection.preset);
    },
    [
      agentPreset,
      customAgentConfig,
      effectiveTimeline,
      isNewThread,
      saveAgentConfig,
      selectedThreadId,
      setAgentPreset,
      setThreadAgentSelection,
      updateThreadFromMessage,
    ],
  );

  const handleSelectDefaultAgentPreset = React.useCallback(
    (selection: AgentPresetSelection) => {
      if (selection.preset === 'custom' && selection.customConfig) {
        saveAgentConfig('custom', selection.customConfig);
      }

      setAgentPreset(selection.preset);
      setStatusText(`Default agent set to ${selection.label}`);
    },
    [saveAgentConfig, setAgentPreset],
  );

  React.useEffect(() => {
    if (
      isNewThread ||
      !selectedThreadId ||
      !activeSessionBelongsToSelectedThread ||
      activeTimeline.items.length === 0
    ) {
      return;
    }

    setTimelineSnapshotByThreadId((previous) => {
      const currentSnapshot = previous[selectedThreadId] ?? [];
      const nextTimeline = buildThreadTimelineFromSession(
        activeTimeline.items,
        currentSnapshot,
      );
      if (nextTimeline === currentSnapshot) {
        return previous;
      }

      return {
        ...previous,
        [selectedThreadId]: nextTimeline,
      };
    });
  }, [
    activeSessionBelongsToSelectedThread,
    activeTimeline.items,
    isNewThread,
    selectedThreadId,
  ]);

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
    async (
      text: string,
      attachments: AcpPromptAttachment[],
      audio?: AcpPromptAudioContent | null,
    ) => {
      const trimmedText = text.trim();
      const normalizedAudio =
        audio && audio.data.trim().length > 0 && audio.mimeType.trim().length > 0
          ? {
              data: audio.data.trim(),
              mimeType: audio.mimeType.trim(),
            }
          : null;

      if (!trimmedText && attachments.length === 0 && !normalizedAudio) {
        return;
      }

      if (!selectedThreadId) {
        const projectId =
          selectedProjectId || visibleProjects[0]?.id || selectedThreadProject?.id || '';
        if (!projectId) {
          setStatusText('Open a project first');
          return;
        }

        pendingComposerSubmitRef.current = {
          text: trimmedText,
          attachments,
          audio: normalizedAudio,
        };
        createThread({
          workspaceId: selectedWorkspaceId,
          projectId,
        });
        setStatusText('Creating a new chat');
        return;
      }

      if (effectiveIsPrompting) {
        const nextPrompt: QueuedPrompt = {
          id: `queued-${Date.now()}-${Math.random().toString(16).slice(2, 9)}`,
          threadId: selectedThreadId,
          text: trimmedText,
          attachments,
          audio: normalizedAudio,
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

      await sendPromptToThread(selectedThreadId, trimmedText, attachments, normalizedAudio);
    },
    [
      createThread,
      effectiveIsPrompting,
      selectedWorkspaceId,
      selectedProjectId,
      selectedThreadId,
      selectedThreadProject,
      sendPromptToThread,
      visibleProjects,
    ],
  );

  React.useEffect(() => {
    if (!selectedThreadId) {
      return;
    }

    const pendingSubmit = pendingComposerSubmitRef.current;
    if (!pendingSubmit) {
      return;
    }

    if (!threadById.has(selectedThreadId)) {
      return;
    }

    pendingComposerSubmitRef.current = null;
    void sendPromptToThread(
      selectedThreadId,
      pendingSubmit.text,
      pendingSubmit.attachments,
      pendingSubmit.audio,
    );
  }, [selectedThreadId, sendPromptToThread, threadById]);

  React.useEffect(() => {
    if (!isSettingsOpen) {
      return;
    }

    setIsWebBrowserOpen(false);
    setIsCommitPanelOpen(false);
    closeFileTree();
    setIsTerminalOpen(false);
  }, [closeFileTree, isSettingsOpen]);

  const handleRunConfiguration = React.useCallback(
    (configurationId: string) => {
      const configuration = runConfigurations.find((item) => item.id === configurationId);
      if (!configuration) {
        setIsRunConfigurationOpen(true);
        return;
      }

      selectRunConfiguration(configuration.id);
      touchRunConfiguration(configuration.id);
      setIsRunConfigurationOpen(false);
      setIsTerminalOpen(true);
      setRunRequest({
        id: Date.now(),
        configurationId: configuration.id,
        configurationName: configuration.name,
        command: configuration.command,
      });
      setStatusText(`Running ${configuration.name}`);
    },
    [runConfigurations, selectRunConfiguration, touchRunConfiguration],
  );

  const handleRunSelectedConfiguration = React.useCallback(() => {
    if (!selectedRunConfiguration) {
      setIsRunConfigurationOpen(true);
      return;
    }

    handleRunConfiguration(selectedRunConfiguration.id);
  }, [handleRunConfiguration, selectedRunConfiguration]);

  const revealFileSearchMatch = React.useCallback(
    (match: WorkspaceSearchTextMatch, focusEditor: boolean): void => {
      fileSearchPreviewEpochRef.current += 1;
      const previewEpoch = fileSearchPreviewEpochRef.current;

      void (async () => {
        const matchingOpenFile = reviewFiles.find(
          (file) => file.kind === 'file' && file.relativePath === match.relativePath,
        );

        if (matchingOpenFile && isReviewPanelVisible) {
          setActiveReviewFile(matchingOpenFile.id);
        } else {
          await openFile(match.relativePath);
        }

        if (fileSearchPreviewEpochRef.current !== previewEpoch) {
          return;
        }

        fileSearchRevealRequestIdRef.current += 1;
        setReviewRevealLocation({
          requestId: fileSearchRevealRequestIdRef.current,
          relativePath: match.relativePath,
          lineNumber: match.lineNumber,
          column: match.column,
          focusEditor,
        });

        if (focusEditor) {
          setStatusText(`${match.relativePath} ${match.lineNumber}`);
        }
      })();
    },
    [isReviewPanelVisible, openFile, reviewFiles, setActiveReviewFile],
  );

  const handleInterruptRun = React.useCallback(() => {
    if (!activeRunExecution) {
      return;
    }

    setInterruptRequest({
      id: Date.now(),
    });
    setStatusText(`Interrupt sent to ${activeRunExecution.configurationName}`);
  }, [activeRunExecution]);

  const handleAdjustEditorFontSize = React.useCallback((delta: number) => {
    const nextEditorFontSize = changeEditorFontSizePreference(delta);
    setStatusText(`Editor font ${nextEditorFontSize}px`);
  }, []);

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      const isMod = event.metaKey || event.ctrlKey;
      if (
        isMod &&
        !event.altKey &&
        isMonacoEditorKeyboardContext(event.target) &&
        (isEditorFontZoomInKey(event) || isEditorFontZoomOutKey(event))
      ) {
        event.preventDefault();
        handleAdjustEditorFontSize(isEditorFontZoomInKey(event) ? 1 : -1);
        lastShiftTapAtRef.current = 0;
        return;
      }

      if (isMod && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setIsFileSearchOpen(false);
        setIsCommandPaletteOpen((previous) => !previous);
        lastShiftTapAtRef.current = 0;
        return;
      }

      if (isMod && event.shiftKey && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        setIsCommandPaletteOpen(false);
        setIsFileSearchOpen((previous) => !previous);
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
  }, [handleAdjustEditorFontSize]);

  const commandPaletteItems = React.useMemo<CommandPaletteItem[]>(() => {
    const workspaceItems: CommandPaletteItem[] = [
      {
        id: 'workspace-none',
        section: 'Workspace',
        title: 'No workspace',
        subtitle: 'Create chats outside any workspace',
        keywords: 'workspace none unassigned',
        icon: 'folder',
        onSelect: () => {
          setIsCreatingWorkspace(false);
          selectWorkspace('');
          setStatusText('No workspace');
        },
      },
      ...workspaces.map((workspace) => ({
        id: `workspace-${workspace.id}`,
        section: 'Workspace',
        title: `Switch to ${workspace.name}`,
        subtitle: `${workspace.projectIds.length} project${workspace.projectIds.length === 1 ? '' : 's'}`,
        keywords: `workspace ${workspace.name}`,
        icon: 'folder' as const,
        onSelect: () => {
          setIsCreatingWorkspace(false);
          selectWorkspace(workspace.id);
          setStatusText(`Workspace ${workspace.name}`);
        },
      })),
    ];

    const projectItems: CommandPaletteItem[] = recentProjects.map((project) => ({
      id: `project-${project.id}`,
      section: 'Projects',
      title: `Switch to ${project.name}`,
      subtitle: project.path,
      keywords: `project ${project.name} ${project.path}`,
      icon: 'folder',
      onSelect: () => {
        setIsCreatingWorkspace(false);
        selectProject(project.id);
        setStatusText(`Project ${project.name}`);
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
          handleSelectThread(thread.id);
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
        id: 'action-create-workspace',
        section: 'Actions',
        title: 'Create workspace',
        subtitle: 'Group multiple projects together',
        keywords: 'create workspace',
        icon: 'folder',
        onSelect: () => {
          handleCreateWorkspace();
        },
      },
      {
        id: 'action-open-folder',
        section: 'Actions',
        title: 'Open project',
        subtitle: 'Add a project to the library',
        keywords: 'open project folder',
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
          setIsCommitPanelOpen(false);
          void openFileTree();
        },
      },
      ...workspaceItems,
      ...projectItems,
      ...threadItems,
      ...fileItems,
    ];
  }, [
    files,
    handleCreateWorkspace,
    handleOpenFolder,
    openFile,
    openFileTree,
    recentProjects,
    setIsCommitPanelOpen,
    handleSelectThread,
    selectProject,
    selectWorkspace,
    threadGroups,
    workspaces,
  ]);

  React.useEffect(() => {
    if (!isFileSearchOpen) {
      fileSearchPreviewEpochRef.current += 1;
      setFileSearchQuery('');
      setFileSearchItems([]);
      setIsFileSearchLoading(false);
      fileSearchRequestIdRef.current += 1;
      return;
    }

    const normalizedQuery = fileSearchQuery.trim();
    if (!normalizedQuery || !workspacePath || workspacePath === '/') {
      fileSearchPreviewEpochRef.current += 1;
      setFileSearchItems([]);
      setIsFileSearchLoading(false);
      fileSearchRequestIdRef.current += 1;
      return;
    }

    const requestId = fileSearchRequestIdRef.current + 1;
    fileSearchRequestIdRef.current = requestId;
    setIsFileSearchLoading(true);

    const timeoutId = window.setTimeout(() => {
      void (async () => {
        try {
          const result = await window.desktop.workspaceSearchText({
            workspacePath,
            query: normalizedQuery,
            maxResults: 80,
          });

          if (fileSearchRequestIdRef.current !== requestId) {
            return;
          }

          setFileSearchItems(
            result.matches.map((match) => ({
              id: `project-search-${match.relativePath}-${match.lineNumber}-${match.column}`,
              section: 'Files',
              title: match.preview || `${getFolderName(match.relativePath)} ${match.lineNumber}`,
              subtitle: `${match.relativePath} ${match.lineNumber}`,
              keywords: `${match.relativePath} ${match.preview}`,
              icon: 'file' as const,
              onSelect: () => {
                revealFileSearchMatch(match, true);
              },
            })),
          );
        } catch {
          if (fileSearchRequestIdRef.current !== requestId) {
            return;
          }

          setFileSearchItems([]);
        } finally {
          if (fileSearchRequestIdRef.current === requestId) {
            setIsFileSearchLoading(false);
          }
        }
      })();
    }, 120);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [fileSearchQuery, isFileSearchOpen, revealFileSearchMatch, workspacePath]);

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
          targetPrompt.audio,
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
        nextPrompt.audio,
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
    if (!selectedThreadProject?.path) {
      return;
    }

    try {
      await window.desktop.workspaceRevealFile({
        absolutePath: selectedThreadProject.path,
      });
      setStatusText(`Opened ${selectedThreadProject.name} in Finder`);
    } catch {
      setStatusText('Could not open project in Finder');
    }
  }, [selectedThreadProject]);

  const threadWorkspaceContent = (
    <>
      <Transcript
        threadId={selectedThreadId}
        workspaceName={workspaceName}
        workspacePath={workspacePath}
        projects={visibleProjects.map((project) => ({
          id: project.id,
          name: project.name,
          path: project.path,
        }))}
        selectedProjectId={landingSelectedProjectId}
        timeline={effectiveTimeline}
        isNewThread={isNewThread}
        isThinking={effectiveIsPrompting}
        pendingPermission={effectivePendingPermission}
        onSelectProject={(projectId) => {
          if (selectedThread?.isDraft) {
            setThreadProject(selectedThread.id, projectId);
            return;
          }

          selectProject(projectId);
        }}
        onAddProject={() => {
          void handleAddProjectToScope();
        }}
        onResolvePermission={(requestId, optionId) => {
          void resolvePermission(requestId, {
            outcome: 'selected',
            optionId,
          });
        }}
        onOpenFile={(path) => {
          void openFile(path);
        }}
        onOpenLink={(href) => {
          void handleOpenTranscriptLink(href);
        }}
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
            {agentAuthMessage ?? 'Authentication is required before sending prompts.'}
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
              {isAgentAuthLaunching ? 'Opening login…' : 'Authenticate agent'}
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
        promptCapabilities={promptCapabilities}
        sessionControls={effectiveSessionControls}
        availableCommands={activeAvailableCommands}
        onSetSessionMode={setSessionMode}
        onSetSessionModel={setSessionModel}
        onSetSessionConfigOption={setSessionConfigOption}
        onShowErrorToast={pushErrorToast}
        onCancel={cancelPrompt}
        onOpenCommitDialog={() => {
          handleOpenCommitPanel();
        }}
        prefillRequest={composerPrefillRequest}
      />
    </>
  );

  const hasProjects = projects.length > 0;
  const hasWelcomeProjectSelection = welcomeProjectPath.trim().length > 0;
  const hasWelcomeAgentSelection = welcomeSelectedAgentId !== null;
  const canStartWelcome = hasWelcomeAgentSelection && hasWelcomeProjectSelection;
  const welcomeProjectLabel = welcomeProjectPath ? welcomeProjectPath : 'Select a project';
  const codexRegistryAgent = React.useMemo(
    () => welcomeRegistryAgents.find((agent) => agent.id === 'codex-acp') ?? null,
    [welcomeRegistryAgents],
  );
  const claudeRegistryAgent = React.useMemo(
    () => welcomeRegistryAgents.find((agent) => isBuiltInClaudeRegistryAgentId(agent.id)) ?? null,
    [welcomeRegistryAgents],
  );
  const toAgentBadgeFromSelection = React.useCallback(
    (selection: ThreadAgentSelection | null | undefined): ThreadAgentBadge | null => {
      const preset = selection?.preset ?? 'mock';
      if (preset === 'codex') {
        return {
          label: 'Codex',
          iconUrl: codexRegistryAgent?.iconUrl ?? null,
        };
      }

      if (preset === 'claude') {
        return {
          label: 'Claude Code',
          iconUrl: claudeRegistryAgent?.iconUrl ?? null,
        };
      }

      if (preset === 'custom') {
        const resolvedCustomConfig = selection?.customConfig ?? customAgentConfig;
        const matchingRegistryAgent =
          welcomeRegistryAgents.find((agent) =>
            matchesRegistryTemplate(agent, resolvedCustomConfig, platform as NodeJS.Platform),
          ) ?? null;

        return {
          label:
            matchingRegistryAgent?.name ??
            (resolvedCustomConfig ? toDefaultCustomAgentLabel(resolvedCustomConfig) : 'Custom ACP'),
          iconUrl: matchingRegistryAgent?.iconUrl ?? null,
        };
      }

      return {
        label: agentName || 'Agent',
        iconUrl: null,
      };
    },
    [
      agentName,
      claudeRegistryAgent?.iconUrl,
      codexRegistryAgent?.iconUrl,
      customAgentConfig,
      platform,
      welcomeRegistryAgents,
    ],
  );
  const currentAgentBadge = React.useMemo<ThreadAgentBadge | null>(
    () =>
      toAgentBadgeFromSelection(
        agentPreset === 'custom'
          ? {
              preset: 'custom',
              ...(customAgentConfig ? { customConfig: customAgentConfig } : {}),
            }
          : {
              preset: agentPreset,
            },
      ),
    [agentPreset, customAgentConfig, toAgentBadgeFromSelection],
  );
  const threadAgentBadgeById = React.useMemo(() => {
    const badges: Record<string, ThreadAgentBadge> = {};

    for (const threadId of threadById.keys()) {
      const timeline =
        threadId === selectedThreadId
          ? effectiveTimeline
          : (timelineSnapshotByThreadId[threadId] ?? []);
      const resolvedBadge =
        getThreadAgentBadgeFromTimeline(timeline) ??
        toAgentBadgeFromSelection(threadAgentSelectionById[threadId]) ??
        currentAgentBadge;
      if (!resolvedBadge) {
        continue;
      }

      badges[threadId] = resolvedBadge;
    }

    return badges;
  }, [
    currentAgentBadge,
    effectiveTimeline,
    selectedThreadId,
    threadAgentSelectionById,
    threadById,
    timelineSnapshotByThreadId,
    toAgentBadgeFromSelection,
  ]);
  const welcomeAgentCards = React.useMemo<
    Array<{
      id: string;
      registryAgentId: string;
      preset: 'codex' | 'claude' | 'custom';
      label: string;
      iconUrl: string | null;
      version?: string;
      description?: string;
      repository?: string;
      launchPreview: string;
      disabled: boolean;
      isSelected: boolean;
    }>
  >(
    () =>
      welcomeRegistryAgents.map((agent) => {
        const launchTemplate = toRegistryLaunchTemplate(agent, platform as NodeJS.Platform);
        const isBuiltInCodex = agent.id === 'codex-acp';
        const isBuiltInClaude = isBuiltInClaudeRegistryAgentId(agent.id);
        const preset = isBuiltInCodex ? 'codex' : isBuiltInClaude ? 'claude' : 'custom';
        const launchPreview = launchTemplate.command
          ? `${launchTemplate.command}${
              launchTemplate.args.length > 0 ? ` ${launchTemplate.args.join(' ')}` : ''
            }`
          : 'Manual setup required';

        return {
          id: `welcome-registry-${agent.id}`,
          registryAgentId: agent.id,
          preset,
          label: agent.name,
          iconUrl: agent.iconUrl,
          version: agent.version,
          description: agent.description,
          repository: agent.repository,
          launchPreview,
          disabled: !launchTemplate.autoConfigurable || !launchTemplate.command,
          isSelected: welcomeSelectedAgentId === agent.id,
        };
      }),
    [platform, welcomeRegistryAgents, welcomeSelectedAgentId],
  );
  const selectedWelcomeAgentCard = React.useMemo(
    () =>
      welcomeSelectedAgentId && welcomeSelectedAgentId !== WELCOME_CUSTOM_AGENT_ID
        ? welcomeAgentCards.find((card) => card.registryAgentId === welcomeSelectedAgentId) ?? null
        : null,
    [welcomeAgentCards, welcomeSelectedAgentId],
  );
  const welcomeAgentLabel = selectedWelcomeAgentCard
    ? selectedWelcomeAgentCard.label
    : welcomeSelectedAgentId === WELCOME_CUSTOM_AGENT_ID
      ? 'Custom ACP'
      : 'Select an agent';

  const handleWelcomePickProject = React.useCallback(async () => {
    const projectPath = await pickProjectPath();
    if (!projectPath) {
      return;
    }

    setWelcomeProjectPath(projectPath);
    setStatusText(`Selected ${getFolderName(projectPath)}`);
  }, [pickProjectPath]);

  const handleWelcomeSelectAgent = React.useCallback(
    (preset: 'codex' | 'claude') => {
      if (preset === 'codex') {
        handleSelectAgentPreset({
          preset: 'codex',
          label: 'Codex',
          iconUrl: codexRegistryAgent?.iconUrl ?? null,
        });
        setWelcomeSelectedAgentId('codex-acp');
        setIsWelcomeAgentMenuExpanded(false);
        return;
      }

        handleSelectAgentPreset({
          preset: 'claude',
          label: 'Claude Code',
          iconUrl: claudeRegistryAgent?.iconUrl ?? null,
        });
      setWelcomeSelectedAgentId(claudeRegistryAgent?.id ?? 'claude-acp');
      setIsWelcomeAgentMenuExpanded(false);
    },
    [claudeRegistryAgent?.iconUrl, claudeRegistryAgent?.id, codexRegistryAgent?.iconUrl, handleSelectAgentPreset],
  );

  const handleWelcomeSelectRegistryAgent = React.useCallback(
    (registryAgentId: string) => {
      const registryAgent = welcomeRegistryAgents.find((agent) => agent.id === registryAgentId);
      if (!registryAgent) {
        return;
      }

      const launchTemplate = toRegistryLaunchTemplate(
        registryAgent,
        platform as NodeJS.Platform,
      );
      if (!launchTemplate.autoConfigurable || !launchTemplate.command) {
        setStatusText(`${registryAgent.name} needs manual configuration`);
        return;
      }

      handleSelectAgentPreset({
        preset: 'custom',
        label: registryAgent.name,
        iconUrl: registryAgent.iconUrl,
        customConfig: {
          command: launchTemplate.command,
          args: launchTemplate.args,
          env: launchTemplate.env,
        },
      });
      setWelcomeSelectedAgentId(registryAgent.id);
      setIsWelcomeAgentMenuExpanded(false);
    },
    [handleSelectAgentPreset, platform, welcomeRegistryAgents],
  );

  const handleWelcomeAddCustomAgent = React.useCallback(() => {
    setWelcomeCustomCommand(customAgentConfig?.command ?? '');
    setWelcomeCustomArgs(customAgentConfig?.args.join(' ') ?? '');
    setWelcomeCustomCwd(customAgentConfig?.cwd ?? '');
    setWelcomeCustomEnv(
      customAgentConfig?.env
        ? Object.entries(customAgentConfig.env)
            .map(([key, value]) => `${key}=${value}`)
            .join('\n')
        : '',
    );
    setIsWelcomeCustomAgentDialogOpen(true);
  }, [customAgentConfig]);

  const handleWelcomeSaveCustomAgent = React.useCallback(() => {
    const command = welcomeCustomCommand.trim();
    if (!command) {
      return;
    }

    const nextCustomConfig: AcpCustomAgentConfig = {
      command,
      args: parseArgs(welcomeCustomArgs),
      cwd: welcomeCustomCwd.trim() || undefined,
      env: parseEnv(welcomeCustomEnv),
    };

    handleSelectAgentPreset({
      preset: 'custom',
      label: 'Custom ACP',
      iconUrl: null,
      customConfig: nextCustomConfig,
    });
    const matchingRegistryAgent =
      welcomeRegistryAgents.find((agent) =>
        matchesRegistryTemplate(agent, nextCustomConfig, platform as NodeJS.Platform),
      ) ?? null;
    setWelcomeSelectedAgentId(matchingRegistryAgent?.id ?? WELCOME_CUSTOM_AGENT_ID);
    setIsWelcomeCustomAgentDialogOpen(false);
    setIsWelcomeAgentMenuExpanded(false);
  }, [
    handleSelectAgentPreset,
    platform,
    welcomeRegistryAgents,
    welcomeCustomArgs,
    welcomeCustomCommand,
    welcomeCustomCwd,
    welcomeCustomEnv,
  ]);

  const handleWelcomeStart = React.useCallback(() => {
    if (!canStartWelcome) {
      return;
    }

    pendingWelcomeStartPathRef.current = welcomeProjectPath;
    setIsWelcomeStarting(true);
    openWorkspaceFromPath(welcomeProjectPath);
    setStatusText(`Opening ${getFolderName(welcomeProjectPath)}`);
  }, [canStartWelcome, openWorkspaceFromPath, welcomeProjectPath]);

  React.useEffect(() => {
    const pendingPath = pendingWelcomeStartPathRef.current;
    if (!pendingPath) {
      return;
    }

    const project = projects.find((item) => item.path === pendingPath);
    if (!project) {
      return;
    }

    createThread({
      workspaceId: '',
      projectId: project.id,
    });
    pendingWelcomeStartPathRef.current = null;
    setIsWelcomeStarting(false);
    setWelcomeProjectPath('');
    setStatusText(`New chat in ${project.name}`);
  }, [createThread, projects]);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-transparent text-stone-700 antialiased">
      {hasProjects ? (
        <>
          <header className="z-30 h-11 shrink-0">
            <div className="drag-region flex h-full min-w-0">
              <div
                className={cn(
                  'zeroade-sidebar-shell-surface shrink-0 overflow-hidden border-r border-r-[var(--zeroade-shell-divider)]',
                  !isResizing && 'transition-[width] duration-200 ease-out',
                )}
                style={{ width: activeSidebarWidth }}
              >
                <div className="flex h-full items-center justify-between px-2">
                  <div className={cn('flex items-center gap-1', navigationZoneClass)}>
                    <button
                      type="button"
                      aria-label="Collapse sidebar"
                      className={TITLEBAR_ICON_BUTTON_CLASS}
                      onClick={toggleCollapsed}
                    >
                      <PanelLeftClose className={TITLEBAR_ICON_CLASS} />
                    </button>
                    <button
                      type="button"
                      aria-label="Previous thread"
                      title="Previous thread"
                      className={cn(
                        TITLEBAR_ICON_BUTTON_CLASS,
                        'disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-stone-500',
                      )}
                      onClick={() => handleNavigateThreadHistory(-1)}
                      disabled={!canNavigateThreadBack}
                    >
                      <ArrowLeft className={TITLEBAR_ICON_CLASS} />
                    </button>
                    <button
                      type="button"
                      aria-label="Next thread"
                      title="Next thread"
                      className={cn(
                        TITLEBAR_ICON_BUTTON_CLASS,
                        'disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-stone-500',
                      )}
                      onClick={() => handleNavigateThreadHistory(1)}
                      disabled={!canNavigateThreadForward}
                    >
                      <ArrowRight className={TITLEBAR_ICON_CLASS} />
                    </button>
                  </div>

                  {shouldShowUpdateButton ? (
                    <button
                      type="button"
                      className={cn(
                        TITLEBAR_ICON_BUTTON_CLASS,
                        'disabled:cursor-not-allowed disabled:opacity-65',
                      )}
                      onClick={() => {
                        void handleUpdateAction();
                      }}
                      disabled={isUpdateButtonDisabled}
                      title={updaterState?.message || 'Update available'}
                    >
                      <RefreshCw
                        className={cn(TITLEBAR_ICON_CLASS, isUpdateIconSpinning && 'animate-spin')}
                      />
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
                  <div className={cn('flex h-full items-center', navigationZoneClass)}>
                    <button
                      type="button"
                      aria-label="Expand sidebar"
                      className={TITLEBAR_ICON_BUTTON_CLASS}
                      onClick={toggleCollapsed}
                    >
                      <PanelLeftOpen className={TITLEBAR_ICON_CLASS} />
                    </button>
                  </div>
                )}

                {!isSettingsOpen ? (
                  <div className="min-w-0 flex flex-1 items-center gap-2">
                    <p className="truncate text-[13px] font-semibold text-stone-900">{headerTitle}</p>
                    {!isCreatingWorkspace && !isWorkspaceBoardOpen && selectedThreadProject?.path ? (
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
                          <TooltipContent>{selectedThreadProject.path}</TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    ) : (
                      headerSubtitle ? (
                        <p
                          className="truncate text-[13px] text-stone-600 max-[860px]:hidden"
                          title={`${headerSubtitle} · ${statusText}`}
                        >
                          {headerSubtitle}
                        </p>
                      ) : null
                    )}
                    {!isCreatingWorkspace && !isWorkspaceBoardOpen ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            aria-label="Thread options"
                            className="no-drag inline-flex h-7 w-7 items-center justify-center rounded-xl text-stone-500 transition-colors hover:bg-stone-200/45 hover:text-stone-700 max-[980px]:hidden"
                          >
                            <Ellipsis className="h-3.5 w-3.5" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start" className="w-56">
                          <DropdownMenuItem onSelect={handleRenameThreadFromMenu}>
                            Rename
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : null}
                  </div>
                ) : (
                  <div className="min-w-0 flex-1" />
                )}

                {!isSettingsOpen && !isWorkspaceBoardOpen ? (
                  <ToolbarActions
                    onOpenFileTree={handleToggleFileTree}
                    isFileTreeOpen={isFileTreeOpen}
                    onToggleFilesView={toggleReviewPanelVisibility}
                    isFilesViewOpen={isReviewPanelVisible}
                    openFilesCount={reviewFiles.length}
                    onOpenRunConfiguration={() => {
                      setIsRunConfigurationOpen(true);
                    }}
                    runConfigurations={runConfigurations}
                    selectedRunConfigurationId={selectedRunConfigurationId}
                    selectedRunConfigurationName={selectedRunConfiguration?.name ?? null}
                    isRunInProgress={Boolean(activeRunExecution)}
                    onSelectRunConfiguration={selectRunConfiguration}
                    onRunSelectedConfiguration={handleRunSelectedConfiguration}
                    onInterruptRun={handleInterruptRun}
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
                workspacePath={workspacePath}
                selectedWorkspaceId={selectedProjectId}
                recentWorkspaces={recentProjects}
                agentPreset={defaultAgentPreset}
                customAgentConfig={defaultCustomAgentConfig}
                onSelectWorkspace={selectProject}
                onOpenWorkspaceFromPath={openWorkspaceFromPath}
                onSelectAgentPreset={handleSelectDefaultAgentPreset}
                onSaveAgentConfig={saveAgentConfig}
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
                  selectedWorkspaceId={selectedWorkspaceId}
                  selectedProjectId={selectedProjectId}
                  isSettingsOpen={isSettingsOpen}
                  workspaces={workspaces}
                  groups={visibleThreadGroups}
                  threadIndicatorById={threadIndicatorById}
                  onSelectThread={(threadId) => {
                    handleSelectThread(threadId);
                  }}
                  onSelectWorkspace={(workspaceId) => {
                    setIsCreatingWorkspace(false);
                    selectWorkspace(workspaceId);
                  }}
                  onSelectProject={(projectId) => {
                    setIsCreatingWorkspace(false);
                    selectProject(projectId);
                  }}
                  onCreateThread={handleCreateThread}
                  onOpenFolder={() => {
                    void handleOpenFolder();
                  }}
                  onAddProjectToScope={() => {
                    void handleAddProjectToScope();
                  }}
                  onOpenCommandPalette={handleOpenCommandPalette}
                  onCreateWorkspace={handleCreateWorkspace}
                  onOpenWorkspaceBoard={handleOpenWorkspaceBoard}
                  onCreateThreadInGroup={handleCreateThreadInGroup}
                  onRenameThread={(threadId) => {
                    openRenameThreadDialog(threadId);
                  }}
                  onRemoveThread={(threadId, currentTitle) => {
                    handleRemoveThread(threadId, currentTitle);
                  }}
                  onReorderProject={reorderProjects}
                  onReorderThread={reorderThreads}
                  onOpenSettings={() => {
                    setIsCreatingWorkspace(false);
                    setIsWorkspaceBoardOpen(false);
                    setIsSettingsOpen(true);
                  }}
                  unreadPushCount={unreadBrowserPushCount}
                  isPushPanelOpen={isBrowserPushPanelOpen}
                  onTogglePushPanel={() => {
                    setIsBrowserPushPanelOpen((previous) => !previous);
                  }}
                  isWorkspaceBoardOpen={isWorkspaceBoardOpen}
                />
              </div>

              {!isCollapsed && (
                <button
                  type="button"
                  aria-label="Resize sidebar"
                  className="no-drag relative w-0 cursor-col-resize"
                  onPointerDown={() => startResizing()}
                >
                  <span className="absolute inset-y-0 -left-5 w-10" />
                </button>
              )}

              <main className="relative flex-1 overflow-hidden bg-[#fdfdff]">
                <div className="flex h-full min-w-0">
                  <FileTreeDialog
                    open={isFileTreeOpen}
                    side="left"
                    files={files}
                    loading={isLoadingTree}
                    workspacePath={workspacePath}
                    workspaceName={workspaceName}
                    activeFilePath={focusedReviewRelativePath}
                    onOpenFile={(path) => {
                      void openFile(path);
                    }}
                    onRefreshFiles={refreshFileTree}
                    onCollapse={closeFileTree}
                    onStatusText={setStatusText}
                  />

                  <CommitPanel
                    open={isCommitPanelOpen}
                    side="left"
                    workspacePath={workspacePath}
                    activeFilePath={focusedReviewRelativePath}
                    onOpenDiff={(path) => {
                      void openDiff(path);
                    }}
                    onRequestClose={handleCloseCommitPanel}
                    onCommitted={({ message, pushed }) => {
                      setStatusText(
                        pushed
                          ? `Committed and pushed: ${message}`
                          : `Committed: ${message}`,
                      );
                    }}
                  />

                  <div className="flex min-w-0 flex-1 flex-col">
                    <div ref={reviewPanelContainerRef} className="min-h-0 flex flex-1">
                      {isReviewPanelOpen ? (
                        <div
                          className={cn(
                            'relative min-w-0 shrink-0 border-r border-r-[var(--zeroade-shell-divider)] bg-[#fdfdff]',
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
                            workspacePath={workspacePath}
                            tabs={reviewFiles}
                            activeFilePath={activeReviewFilePath}
                            revealLocation={reviewRevealLocation}
                            onSelectTab={setActiveReviewFile}
                            onCloseTab={closeReviewFile}
                            onReorderTabs={reorderReviewFiles}
                            onRefreshPath={refreshReviewPath}
                            onStatusText={setStatusText}
                          />
                        </div>
                      ) : null}

                      <div className="min-w-0 flex flex-1 flex-col">
                        <div
                          className={cn(
                            'flex h-full w-full flex-col pb-1.5 pt-2',
                            isWorkspaceBoardOpen
                              ? 'max-w-none px-0'
                              : 'mx-auto max-w-[830px] px-6',
                          )}
                        >
                          {isCreatingWorkspace ? (
                            <WorkspaceCreationView
                              projects={projects}
                              name={workspaceDraftName}
                              selectedPaths={workspaceDraftPaths}
                              isPickingProject={isPickingWorkspaceProject}
                              onNameChange={setWorkspaceDraftName}
                              onToggleProjectPath={(projectPath) => {
                                setWorkspaceDraftPaths((previous) =>
                                  previous.includes(projectPath)
                                    ? previous.filter((path) => path !== projectPath)
                                    : [...previous, projectPath],
                                );
                              }}
                              onAddProject={() => {
                                void handleAddProjectToWorkspaceDraft();
                              }}
                              onSubmit={() => {
                                handleSubmitWorkspace({
                                  name: workspaceDraftName,
                                  projectPaths: workspaceDraftPaths,
                                });
                              }}
                            />
                          ) : isWorkspaceBoardOpen ? (
                            <div
                              ref={workspaceBoardPanelContainerRef}
                              className="min-h-0 flex flex-1"
                            >
                              <div className="min-w-0 flex-1">
                                <WorkspaceSessionsBoard
                                  hasWorkspaceSelected={Boolean(selectedWorkspaceId)}
                                  groups={visibleThreadGroups}
                                  selectedThreadId={selectedThreadId}
                                  threadAgentBadgeById={threadAgentBadgeById}
                                  threadIndicatorById={threadIndicatorById}
                                  onSelectThread={handleSelectThreadInWorkspaceBoard}
                                  onCreateThread={handleCreateThreadInWorkspaceBoard}
                                  onMoveThread={handleMoveThreadInWorkspaceBoard}
                                  onCreateWorkspace={handleCreateWorkspace}
                                />
                              </div>

                              <aside
                                style={{
                                  width: isWorkspaceBoardThreadPanelVisible
                                    ? workspaceBoardThreadPanelWidth
                                    : 0,
                                }}
                                className={cn(
                                  'relative h-full shrink-0 overflow-hidden border-l border-l-[var(--zeroade-shell-divider)] bg-[#fdfdfff2] backdrop-blur-xl transition-[width] duration-200 ease-out',
                                  isWorkspaceBoardThreadPanelResizing && 'transition-none',
                                  !isWorkspaceBoardThreadPanelVisible && 'border-l-0',
                                )}
                              >
                                <button
                                  type="button"
                                  aria-label="Resize thread panel"
                                  className={cn(
                                    'no-drag group absolute inset-y-0 left-0 z-10 w-4 cursor-col-resize',
                                    !isWorkspaceBoardThreadPanelVisible &&
                                      'pointer-events-none opacity-0',
                                  )}
                                  onPointerDown={startWorkspaceBoardThreadPanelResizing}
                                >
                                  <span className="absolute inset-y-0 left-0 w-px bg-transparent transition-colors group-hover:bg-stone-300/70" />
                                </button>

                                <div
                                  className={cn(
                                    'flex h-full w-full min-w-0 flex-col transition-opacity duration-150',
                                    isWorkspaceBoardThreadPanelVisible
                                      ? 'opacity-100'
                                      : 'pointer-events-none opacity-0',
                                  )}
                                >
                                  <div className="flex items-center justify-between gap-3 border-b border-b-[var(--zeroade-shell-divider)] px-4 py-3">
                                    <div className="min-w-0">
                                      <p className="truncate text-[13px] font-semibold text-stone-900">
                                        {threadTitle}
                                      </p>
                                      {workspaceBoardThreadPanelSubtitle ? (
                                        <p className="truncate text-[11px] text-stone-500">
                                          {workspaceBoardThreadPanelSubtitle}
                                        </p>
                                      ) : null}
                                    </div>

                                    <button
                                      type="button"
                                      aria-label="Close thread panel"
                                      className="no-drag inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px] text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-700"
                                      onClick={handleCloseWorkspaceBoardThreadPanel}
                                    >
                                      <X className="h-4 w-4" />
                                    </button>
                                  </div>

                                  <div className="min-h-0 flex flex-1 flex-col px-4 pb-3 pt-2">
                                    {threadWorkspaceContent}
                                  </div>
                                </div>
                              </aside>
                            </div>
                          ) : (
                            threadWorkspaceContent
                          )}
                        </div>
                      </div>
                    </div>
                    <TerminalPanel
                      open={isTerminalOpen}
                      cwd={workspacePath}
                      runRequest={runRequest}
                      interruptRequest={interruptRequest}
                      onExecutionStateChange={setActiveRunExecution}
                      onRequestClose={() => setIsTerminalOpen(false)}
                    />
                  </div>

                  <WebBrowserPanel
                    open={isWebBrowserOpen}
                    openRequest={browserOpenRequest}
                    onRequestClose={() => setIsWebBrowserOpen(false)}
                  />
                  <BrowserPushPanel
                    open={isBrowserPushPanelOpen}
                    items={browserPushItems}
                    onOpenUrl={handleOpenBrowserPushUrl}
                    onRequestClose={() => setIsBrowserPushPanelOpen(false)}
                  />
                </div>
              </main>
            </div>
          )}
        </>
      ) : (
        <main className="relative flex min-h-0 flex-1 bg-[#fdfdff]">
          <div className="drag-region absolute inset-x-0 top-0 h-11" />
          <div className="no-drag mx-auto flex h-full w-full max-w-[830px] flex-col items-center justify-center px-6 pb-4 pt-4">
            <div className="mt-5 flex flex-col items-center gap-0">
              <h1 className="text-[34px] font-semibold tracking-[-0.02em] text-stone-900">Set up</h1>
              <img src={zeroLogo} alt="Zero logo" className="h-24 w-auto object-contain" />
            </div>

            <div className="mt-7 w-full max-w-[760px]">
              <div
                className={cn(
                  'grid grid-cols-1 gap-2',
                  hasWelcomeProjectSelection
                    ? hasWelcomeAgentSelection
                      ? 'sm:grid-cols-[minmax(0,2.5fr)_minmax(0,1fr)_auto]'
                      : 'sm:grid-cols-[minmax(0,2.5fr)_minmax(0,1fr)]'
                    : 'sm:grid-cols-1',
                )}
              >
                <button
                  type="button"
                  className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-stone-100 px-3 text-[14px] font-medium text-stone-700 transition-colors hover:bg-stone-200"
                  onClick={() => {
                    void handleWelcomePickProject();
                  }}
                >
                  <Folder className="h-4 w-4 shrink-0" />
                  <span className="min-w-0 truncate">{welcomeProjectLabel}</span>
                </button>

                {hasWelcomeProjectSelection ? (
                  <button
                    type="button"
                    className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-stone-100 px-3 text-[14px] font-medium text-stone-700 transition-colors hover:bg-stone-200"
                    onClick={() => {
                      setIsWelcomeAgentMenuExpanded((previous) => !previous);
                    }}
                  >
                    {selectedWelcomeAgentCard?.iconUrl ? (
                      <img
                        src={selectedWelcomeAgentCard.iconUrl}
                        alt={`${welcomeAgentLabel} logo`}
                        className="zeroade-agent-icon-image h-4 w-4 shrink-0 object-contain"
                      />
                    ) : (
                      <Plus className="h-4 w-4 shrink-0" />
                    )}
                    <span className="min-w-0 truncate">{welcomeAgentLabel}</span>
                    <ChevronDown
                      className={cn(
                        'h-4 w-4 shrink-0 transition-transform duration-200',
                        isWelcomeAgentMenuExpanded && 'rotate-180',
                      )}
                    />
                  </button>
                ) : null}

                {hasWelcomeProjectSelection && hasWelcomeAgentSelection ? (
                  <Button
                    type="button"
                    size="md"
                    variant="primary"
                    className="h-11 w-11 rounded-full p-0"
                    disabled={!canStartWelcome || isWelcomeStarting}
                    onClick={handleWelcomeStart}
                    aria-label={isWelcomeStarting ? 'Applying setup' : 'Apply setup'}
                  >
                    {isWelcomeStarting ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <ArrowUp className="h-4 w-4" />
                    )}
                  </Button>
                ) : null}
              </div>

              <div
                className={cn(
                  'overflow-hidden transition-[max-height,opacity,transform,margin] duration-300 ease-out',
                  hasWelcomeProjectSelection && isWelcomeAgentMenuExpanded
                    ? 'mt-3 max-h-[760px] translate-y-0 opacity-100'
                    : 'mt-0 max-h-0 -translate-y-1 opacity-0 pointer-events-none',
                )}
              >
                <div className="h-[44vh] min-h-[220px] max-h-[520px] overflow-y-auto pr-1">
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {welcomeAgentCards.map((card) => {
                      const selectCard = (): void => {
                        if (card.disabled) {
                          return;
                        }

                        if (card.preset === 'codex' || card.preset === 'claude') {
                          handleWelcomeSelectAgent(card.preset);
                          return;
                        }

                        handleWelcomeSelectRegistryAgent(card.registryAgentId);
                      };

                      return (
                        <div
                          key={card.id}
                          role={card.disabled ? undefined : 'button'}
                          tabIndex={card.disabled ? -1 : 0}
                          className={cn(
                            'w-full rounded-2xl bg-stone-100 px-3 py-2 text-left transition-colors',
                            'text-stone-700 hover:bg-stone-200',
                            card.isSelected && 'bg-stone-300 text-stone-900',
                            card.disabled && 'cursor-not-allowed opacity-55 hover:bg-stone-100',
                          )}
                          onClick={selectCard}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              selectCard();
                            }
                          }}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="flex min-w-0 items-center gap-1.5">
                                {card.iconUrl ? (
                                  <img
                                    src={card.iconUrl}
                                    alt={`${card.label} logo`}
                                    className="zeroade-agent-icon-image h-4 w-4 shrink-0 object-contain"
                                  />
                                ) : null}
                                <p className="truncate text-[14px] font-semibold leading-tight text-current">
                                  {card.label}
                                </p>
                              </div>
                              <p className="mt-0.5 truncate text-[11px] text-stone-500">
                                {card.registryAgentId}
                                {card.version ? ` · v${card.version}` : ''}
                              </p>
                              {card.description ? (
                                <p className="mt-0.5 truncate text-[11px] leading-tight text-stone-600">
                                  {card.description}
                                </p>
                              ) : null}
                            </div>
                            {card.repository ? (
                              <TooltipProvider delayDuration={120}>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <button
                                      type="button"
                                      aria-label={`Open repository ${card.repository}`}
                                      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-stone-500 transition-colors hover:bg-stone-200/70 hover:text-stone-800"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        handleOpenWebLink(card.repository ?? '');
                                      }}
                                    >
                                      <ExternalLink className="h-3.5 w-3.5" />
                                    </button>
                                  </TooltipTrigger>
                                  <TooltipContent className="max-w-[280px] break-all text-[11px]">
                                    {card.repository}
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <Button
                  type="button"
                  variant="ghost"
                  className="mt-3 h-11 w-full justify-center rounded-2xl bg-stone-100 text-[14px] font-medium text-stone-700 hover:bg-stone-200"
                  onClick={handleWelcomeAddCustomAgent}
                >
                  <Plus className="mr-1.5 h-4 w-4" />
                  Add a Custom Agent...
                </Button>
              </div>
            </div>
          </div>
        </main>
      )}

      <CommandPalette
        open={isCommandPaletteOpen}
        onOpenChange={(open) => {
          if (open) {
            setIsFileSearchOpen(false);
          }
          setIsCommandPaletteOpen(open);
        }}
        items={commandPaletteItems}
      />

      <CommandPalette
        open={isFileSearchOpen}
        onOpenChange={(open) => {
          if (open) {
            setIsCommandPaletteOpen(false);
          }
          setIsFileSearchOpen(open);
        }}
        items={fileSearchItems}
        query={fileSearchQuery}
        onQueryChange={setFileSearchQuery}
        filterItems={false}
        loading={isFileSearchLoading}
        placeholder="Search project text"
        emptyMessage={
          !workspacePath || workspacePath === '/'
            ? 'Open a workspace to search project text'
            : fileSearchQuery.trim().length === 0
              ? 'Type to search project text'
              : 'No matching text results'
        }
        sectionOrder={['Files']}
      />

      <RunConfigurationDialog
        open={isRunConfigurationOpen}
        configurations={runConfigurations}
        selectedConfigurationId={selectedRunConfigurationId}
        onOpenChange={setIsRunConfigurationOpen}
        onSelectConfiguration={selectRunConfiguration}
        onSaveConfiguration={saveRunConfiguration}
        onDeleteConfiguration={deleteRunConfiguration}
      />

      <Dialog
        open={isWelcomeCustomAgentDialogOpen}
        onOpenChange={setIsWelcomeCustomAgentDialogOpen}
      >
        <DialogContent className="no-drag max-w-[520px] rounded-[20px] p-0">
          <div className="px-4 pb-4 pt-4">
            <h2 className="text-[24px] font-normal leading-none tracking-[-0.015em] text-stone-900">
              Custom ACP Agent
            </h2>
            <p className="mt-2 text-[13px] leading-[1.35] text-stone-500">
              Configure launch settings for a custom ACP agent.
            </p>

            <div className="mt-4 space-y-3">
              <label className="block text-[13px] font-medium text-stone-600">
                Command
                <input
                  value={welcomeCustomCommand}
                  onChange={(event) => setWelcomeCustomCommand(event.target.value)}
                  placeholder="npx"
                  className="no-drag mt-1.5 h-9 w-full rounded-[10px] border-0 bg-stone-100 px-3 text-[13px] font-normal text-stone-800 placeholder:text-stone-400 focus:outline-none"
                />
              </label>

              <label className="block text-[13px] font-medium text-stone-600">
                Arguments
                <input
                  value={welcomeCustomArgs}
                  onChange={(event) => setWelcomeCustomArgs(event.target.value)}
                  placeholder="-y your-agent --transport stdio"
                  className="no-drag mt-1.5 h-9 w-full rounded-[10px] border-0 bg-stone-100 px-3 text-[13px] font-normal text-stone-800 placeholder:text-stone-400 focus:outline-none"
                />
              </label>

              <label className="block text-[13px] font-medium text-stone-600">
                Working directory (optional)
                <input
                  value={welcomeCustomCwd}
                  onChange={(event) => setWelcomeCustomCwd(event.target.value)}
                  placeholder={welcomeProjectPath || '/path/to/workspace'}
                  className="no-drag mt-1.5 h-9 w-full rounded-[10px] border-0 bg-stone-100 px-3 text-[13px] font-normal text-stone-800 placeholder:text-stone-400 focus:outline-none"
                />
              </label>

              <label className="block text-[13px] font-medium text-stone-600">
                Environment (optional)
                <textarea
                  value={welcomeCustomEnv}
                  onChange={(event) => setWelcomeCustomEnv(event.target.value)}
                  placeholder={'API_KEY=...\nDEBUG=1'}
                  spellCheck={false}
                  className="no-drag mt-1.5 h-[86px] w-full resize-none rounded-[10px] border-0 bg-stone-100 px-3 py-2 font-mono text-[12px] font-normal leading-[1.45] text-stone-800 placeholder:text-stone-400 focus:outline-none"
                />
              </label>
            </div>

            <div className="mt-4 flex items-center justify-end gap-2">
              <Button
                variant="ghost"
                className="h-9 rounded-[11px] px-3 text-[13px]"
                onClick={() => {
                  setIsWelcomeCustomAgentDialogOpen(false);
                }}
              >
                Cancel
              </Button>
              <Button
                className="h-9 rounded-[11px] bg-stone-700 px-4 text-[13px] font-semibold text-white hover:bg-stone-800 disabled:bg-stone-300"
                disabled={welcomeCustomCommand.trim().length === 0}
                onClick={handleWelcomeSaveCustomAgent}
              >
                Apply and connect
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

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

      <div className="pointer-events-none fixed bottom-4 right-4 z-[200] flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={cn(
              'pointer-events-auto h-[84px] rounded-2xl border bg-white/95 px-3 py-3 shadow-lg backdrop-blur',
              toast.tone === 'error' ? 'border-rose-200' : 'border-stone-200',
            )}
          >
            <div className="flex h-full items-start gap-2">
              <div className="min-w-0 flex-1 overflow-hidden">
                <p
                  className={cn(
                    'line-clamp-1 text-[12px] font-semibold',
                    toast.tone === 'error' ? 'text-rose-700' : 'text-stone-800',
                  )}
                >
                  {toast.title}
                </p>
                <p className="mt-1 line-clamp-2 whitespace-pre-wrap break-words text-[12px] leading-5 text-stone-700">
                  {toast.message}
                </p>
              </div>
              <button
                type="button"
                className="no-drag inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-700"
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
