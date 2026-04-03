import * as React from 'react';
import type {
  PlanEntry,
  SessionConfigOption,
  SessionUpdate,
  ToolCallStatus,
} from '@agentclientprotocol/sdk';
import { readStoredMcpServers, toAcpMcpServers } from '@renderer/store/mcp-servers';
import type {
  AcpAgentConfig,
  AcpAvailableCommand,
  AcpConnectionState,
  AcpCustomAgentConfig,
  AcpAuthenticateResult,
  AcpPromptAudioContent,
  AcpSessionConfigControl,
  AcpSessionConfigSelectValue,
  AcpSessionControls,
  AcpPromptCapabilities,
  AcpPromptAttachment,
  AcpPermissionDecision,
  AcpPermissionRequestEvent,
  AcpRendererEvent,
  AcpSetSessionConfigOptionRequest,
  AcpSessionNewResult,
} from '@shared/types/acp';

const THREAD_SESSION_KEY = 'zeroade.acp.thread-sessions.v3';
const LEGACY_THREAD_SESSION_KEY_PREFIX = 'zeroade.acp.thread-sessions.v2';
const THREAD_ATTACHMENT_HISTORY_KEY = 'zeroade.acp.thread-attachments.v2';
const LEGACY_THREAD_ATTACHMENT_HISTORY_KEY_PREFIX = 'zeroade.acp.thread-attachments.v1';
const THREAD_AGENT_SELECTION_KEY = 'zeroade.acp.thread-agent-selections.v1';
const AGENT_PRESET_KEY = 'zeroade.acp.agent-preset.v1';
const CUSTOM_AGENT_CONFIG_KEY = 'zeroade.acp.custom-agent-config.v1';
const CODEX_AGENT_CONFIG_KEY = 'zeroade.acp.codex-agent-config.v1';
const CLAUDE_AGENT_CONFIG_KEY = 'zeroade.acp.claude-agent-config.v1';
const MAX_ATTACHMENT_HISTORY_PER_THREAD = 200;
const SUPPRESS_UPDATED_AT_AFTER_LOAD_MS = 5_000;
const DEFAULT_PROMPT_CAPABILITIES: AcpPromptCapabilities = {
  audio: false,
};
const FILE_MUTATION_TOOL_KIND_TOKENS = [
  'edit',
  'write',
  'create',
  'delete',
  'remove',
  'rename',
  'move',
  'patch',
  'replace',
] as const;

const normalizeAvailableCommandName = (name: string): string =>
  name.trim().replace(/^\/+/, '');

const normalizeAvailableCommands = (
  commands: AcpAvailableCommand[],
): AcpAvailableCommand[] => {
  const byName = new Map<string, AcpAvailableCommand>();

  for (const command of commands) {
    const normalizedName = normalizeAvailableCommandName(command.name);
    const lookupKey = normalizedName.toLowerCase();
    if (!normalizedName || byName.has(lookupKey)) {
      continue;
    }

    byName.set(lookupKey, {
      ...command,
      name: normalizedName,
      description: command.description?.trim() ?? '',
      input:
        command.input?.hint?.trim()
          ? {
              ...command.input,
              hint: command.input.hint.trim(),
            }
          : null,
    });
  }

  return Array.from(byName.values()).sort((left, right) =>
    left.name.localeCompare(right.name),
  );
};

const areAvailableCommandsEqual = (
  left: AcpAvailableCommand[],
  right: AcpAvailableCommand[],
): boolean => {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((command, index) => {
    const other = right[index];
    return (
      command.name === other.name &&
      command.description === other.description &&
      (command.input?.hint ?? '') === (other.input?.hint ?? '')
    );
  });
};

export type AcpAgentPreset = 'mock' | 'codex' | 'claude' | 'custom';

type ThreadSessionMap = Record<string, string>;
export interface ThreadAgentSelection {
  preset: AcpAgentPreset;
  customConfig?: AcpCustomAgentConfig;
}
type ThreadAgentSelectionMap = Record<string, ThreadAgentSelection>;
interface PersistedThreadAttachmentEntry {
  text: string;
  attachments: AcpPromptAttachment[];
}
type ThreadAttachmentHistoryMap = Record<string, PersistedThreadAttachmentEntry[]>;

interface TimelineItemBase {
  id: string;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface TimelineToolCallFileState {
  exists: boolean;
  content: string | null;
}

export interface TimelineToolCallLocationSnapshots {
  before?: TimelineToolCallFileState;
  after?: TimelineToolCallFileState;
}

export type TimelineItem =
  | (TimelineItemBase & {
      kind: 'user-message';
      text: string;
      attachments?: AcpPromptAttachment[];
      hasAudio?: boolean;
    })
  | (TimelineItemBase & {
      kind: 'assistant-message';
      text: string;
      noticeKind?: 'agent-change';
      iconUrl?: string | null;
    })
  | (TimelineItemBase & {
      kind: 'plan';
      entries: PlanEntry[];
    })
  | (TimelineItemBase & {
      kind: 'tool-call';
      toolCallId: string;
      title: string;
      status: ToolCallStatus | 'unknown';
      toolKind: string;
      locations: string[];
      rawInput?: string;
      rawOutput?: string;
      fileSnapshotsByLocation?: Record<string, TimelineToolCallLocationSnapshots>;
    });

interface SessionTimeline {
  items: TimelineItem[];
  isPrompting: boolean;
  stopReason?: string;
}

interface UseAcpResult {
  connectionState: AcpConnectionState;
  connectionMessage: string | null;
  agentName: string;
  promptCapabilities: AcpPromptCapabilities;
  agentPreset: AcpAgentPreset;
  defaultAgentPreset: AcpAgentPreset;
  codexAgentConfig: AcpCustomAgentConfig | null;
  claudeAgentConfig: AcpCustomAgentConfig | null;
  customAgentConfig: AcpCustomAgentConfig | null;
  defaultCustomAgentConfig: AcpCustomAgentConfig | null;
  loadSessionSupported: boolean;
  activeSessionId: string | null;
  activeSessionThreadId: string | null;
  activeTimeline: SessionTimeline;
  threadPromptingById: Record<string, boolean>;
  threadAgentSelectionById: ThreadAgentSelectionMap;
  threadSessionTitleById: Record<string, string>;
  threadSessionUpdatedAtById: Record<string, number>;
  activeSessionControls: AcpSessionControls | null;
  activeAvailableCommands: AcpAvailableCommand[];
  pendingPermission: AcpPermissionRequestEvent | null;
  setAgentPreset: (preset: AcpAgentPreset) => void;
  setThreadAgentSelection: (threadId: string, selection: ThreadAgentSelection) => void;
  saveAgentConfig: (
    preset: 'codex' | 'claude' | 'custom',
    config: AcpCustomAgentConfig,
  ) => void;
  ensureSessionForThread: (threadId: string, cwd: string) => Promise<void>;
  sendPrompt: (
    text: string,
    attachments?: AcpPromptAttachment[],
    audio?: AcpPromptAudioContent | null,
  ) => Promise<void>;
  setSessionMode: (modeId: string) => Promise<void>;
  setSessionModel: (modelId: string) => Promise<void>;
  setSessionConfigOption: (
    request: Omit<AcpSetSessionConfigOptionRequest, 'sessionId'>,
  ) => Promise<void>;
  cancelPrompt: () => Promise<void>;
  resolvePermission: (
    requestId: string,
    decision: AcpPermissionDecision,
  ) => Promise<void>;
  authenticate: (cwd: string) => Promise<AcpAuthenticateResult>;
  invalidateThreadSession: (threadId: string) => void;
}

const getLegacyThreadSessionKey = (preset: AcpAgentPreset): string =>
  `${LEGACY_THREAD_SESSION_KEY_PREFIX}.${preset}`;

const getLegacyThreadAttachmentHistoryKey = (preset: AcpAgentPreset): string =>
  `${LEGACY_THREAD_ATTACHMENT_HISTORY_KEY_PREFIX}.${preset}`;

const parseThreadSessionMap = (raw: string | null): ThreadSessionMap => {
  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw) as ThreadSessionMap;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

const readThreadSessionMap = (preferredPreset: AcpAgentPreset): ThreadSessionMap => {
  const current = parseThreadSessionMap(window.localStorage.getItem(THREAD_SESSION_KEY));
  if (Object.keys(current).length > 0) {
    return current;
  }

  const presets: AcpAgentPreset[] = ['mock', 'codex', 'claude', 'custom'];
  const orderedPresets = [
    ...presets.filter((preset) => preset !== preferredPreset),
    preferredPreset,
  ];

  const merged: ThreadSessionMap = {};
  for (const preset of orderedPresets) {
    Object.assign(
      merged,
      parseThreadSessionMap(window.localStorage.getItem(getLegacyThreadSessionKey(preset))),
    );
  }

  return merged;
};

const parseThreadAttachmentHistoryMap = (raw: string | null): ThreadAttachmentHistoryMap => {
  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null) {
      return {};
    }

    const result: ThreadAttachmentHistoryMap = {};

    for (const [threadId, value] of Object.entries(parsed)) {
      if (!Array.isArray(value) || threadId.trim().length === 0) {
        continue;
      }

      const entries = value
        .map((entry) => {
          if (typeof entry !== 'object' || entry === null) {
            return null;
          }

          const rawText =
            'text' in entry && typeof entry.text === 'string' ? entry.text.trim() : '';
          const rawAttachments =
            'attachments' in entry && Array.isArray(entry.attachments)
              ? (entry.attachments as AcpPromptAttachment[])
              : [];
          const attachments = normalizePromptAttachments(rawAttachments);

          if (!rawText || attachments.length === 0) {
            return null;
          }

          return {
            text: rawText,
            attachments,
          };
        })
        .filter(
          (entry): entry is PersistedThreadAttachmentEntry => entry !== null,
        );

      if (entries.length > 0) {
        result[threadId] = entries.slice(-MAX_ATTACHMENT_HISTORY_PER_THREAD);
      }
    }

    return result;
  } catch {
    return {};
  }
};

const readThreadAttachmentHistoryMap = (
  preferredPreset: AcpAgentPreset,
): ThreadAttachmentHistoryMap => {
  const current = parseThreadAttachmentHistoryMap(
    window.localStorage.getItem(THREAD_ATTACHMENT_HISTORY_KEY),
  );
  if (Object.keys(current).length > 0) {
    return current;
  }

  const presets: AcpAgentPreset[] = ['mock', 'codex', 'claude', 'custom'];
  const orderedPresets = [
    ...presets.filter((preset) => preset !== preferredPreset),
    preferredPreset,
  ];

  const merged: ThreadAttachmentHistoryMap = {};
  for (const preset of orderedPresets) {
    Object.assign(
      merged,
      parseThreadAttachmentHistoryMap(
        window.localStorage.getItem(getLegacyThreadAttachmentHistoryKey(preset)),
      ),
    );
  }

  return merged;
};

const readAgentPreset = (): AcpAgentPreset => {
  const raw = window.localStorage.getItem(AGENT_PRESET_KEY);
  if (raw === 'custom' || raw === 'codex' || raw === 'claude') {
    return raw;
  }

  return 'mock';
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const parseEnvMap = (value: unknown): Record<string, string> | undefined => {
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

const readAgentConfig = (storageKey: string): AcpCustomAgentConfig | null => {
  const raw = window.localStorage.getItem(storageKey);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) {
      return null;
    }

    const command = typeof parsed.command === 'string' ? parsed.command.trim() : '';
    const args = Array.isArray(parsed.args)
      ? parsed.args.filter((arg): arg is string => typeof arg === 'string')
      : [];
    const cwd = typeof parsed.cwd === 'string' && parsed.cwd.trim().length > 0
      ? parsed.cwd.trim()
      : undefined;
    const env = parseEnvMap(parsed.env);

    if (!command) {
      return null;
    }

    return {
      command,
      args,
      cwd,
      env,
    };
  } catch {
    return null;
  }
};

const readCustomAgentConfig = (): AcpCustomAgentConfig | null =>
  readAgentConfig(CUSTOM_AGENT_CONFIG_KEY);

const readCodexAgentConfig = (): AcpCustomAgentConfig | null =>
  readAgentConfig(CODEX_AGENT_CONFIG_KEY);

const readClaudeAgentConfig = (): AcpCustomAgentConfig | null =>
  readAgentConfig(CLAUDE_AGENT_CONFIG_KEY);

const normalizeAgentConfig = (config: AcpCustomAgentConfig): AcpCustomAgentConfig | null => {
  const command = config.command.trim();
  if (!command) {
    return null;
  }

  return {
    command,
    args: config.args.filter((arg) => arg.trim().length > 0),
    cwd: config.cwd?.trim() || undefined,
    env: config.env,
  };
};

const normalizeThreadAgentSelection = (value: unknown): ThreadAgentSelection | null => {
  if (!isRecord(value)) {
    return null;
  }

  const preset = typeof value.preset === 'string' ? value.preset : '';
  if (preset !== 'mock' && preset !== 'codex' && preset !== 'claude' && preset !== 'custom') {
    return null;
  }

  const normalizedCustomConfig =
    'customConfig' in value ? normalizeAgentConfig(value.customConfig as AcpCustomAgentConfig) : null;

  if (preset === 'custom') {
    return normalizedCustomConfig
      ? {
          preset,
          customConfig: normalizedCustomConfig,
        }
      : {
          preset,
        };
  }

  return {
    preset,
  };
};

const toThreadAgentSelectionSignature = (selection: ThreadAgentSelection | null): string =>
  JSON.stringify({
    preset: selection?.preset ?? 'mock',
    customConfig: selection?.customConfig
      ? normalizeAgentConfig(selection.customConfig)
      : null,
  });

const readThreadAgentSelectionMap = (preferredPreset: AcpAgentPreset): ThreadAgentSelectionMap => {
  const raw = window.localStorage.getItem(THREAD_AGENT_SELECTION_KEY);
  if (!raw) {
    const presets: AcpAgentPreset[] = ['mock', 'codex', 'claude', 'custom'];
    const orderedPresets = [
      ...presets.filter((preset) => preset !== preferredPreset),
      preferredPreset,
    ];
    const migrated: ThreadAgentSelectionMap = {};
    const legacyCustomConfig = readCustomAgentConfig();

    for (const preset of orderedPresets) {
      const legacyThreadMap = parseThreadSessionMap(
        window.localStorage.getItem(getLegacyThreadSessionKey(preset)),
      );

      for (const threadId of Object.keys(legacyThreadMap)) {
        migrated[threadId] =
          preset === 'custom'
            ? {
                preset,
                ...(legacyCustomConfig ? { customConfig: legacyCustomConfig } : {}),
              }
            : {
                preset,
              };
      }
    }

    return migrated;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) {
      return {};
    }

    const result: ThreadAgentSelectionMap = {};
    for (const [threadId, value] of Object.entries(parsed)) {
      const normalizedThreadId = threadId.trim();
      if (!normalizedThreadId) {
        continue;
      }

      const normalizedSelection = normalizeThreadAgentSelection(value);
      if (!normalizedSelection) {
        continue;
      }

      result[normalizedThreadId] = normalizedSelection;
    }

    return result;
  } catch {
    return {};
  }
};

const toAgentConfigSignature = (agent: AcpAgentConfig | null): string => {
  if (!agent) {
    return 'none';
  }

  if (agent.kind === 'mock') {
    return 'mock';
  }

  if (agent.kind === 'custom') {
    return JSON.stringify({
      kind: 'custom',
      command: agent.command,
      args: agent.args,
      cwd: agent.cwd ?? '',
      env: agent.env ?? {},
    });
  }

  return JSON.stringify({
    kind: agent.kind,
    config: agent.config ?? null,
  });
};

const toConfigSelectValues = (
  options:
    | Array<{
        name: string;
        value: string;
        description?: string | null;
      }>
    | Array<{
        name: string;
        group: string;
        options: Array<{
          name: string;
          value: string;
          description?: string | null;
        }>;
      }>,
): AcpSessionConfigSelectValue[] => {
  const values: AcpSessionConfigSelectValue[] = [];

  for (const option of options) {
    if ('group' in option) {
      for (const nested of option.options) {
        values.push({
          id: nested.value,
          name: nested.name,
          description: nested.description ?? null,
          group: option.name,
        });
      }
      continue;
    }

    values.push({
      id: option.value,
      name: option.name,
      description: option.description ?? null,
    });
  }

  return values;
};

const toConfigControls = (
  options: SessionConfigOption[] | null | undefined,
): AcpSessionConfigControl[] => {
  const controls: AcpSessionConfigControl[] = [];

  for (const option of options ?? []) {
    const base = {
      id: option.id,
      name: option.name,
      description: option.description ?? null,
      category: option.category ?? null,
    };

    if (option.type === 'boolean') {
      controls.push({
        ...base,
        type: 'boolean',
        currentValue: option.currentValue,
      });
      continue;
    }

    controls.push({
      ...base,
      type: 'select',
      currentValue: option.currentValue,
      options: toConfigSelectValues(option.options),
    });
  }

  return controls;
};

const withUpdatedConfigControlValue = (
  controls: AcpSessionConfigControl[],
  request: AcpSetSessionConfigOptionRequest,
): AcpSessionConfigControl[] =>
  controls.map((control) => {
    if (control.id !== request.configId) {
      return control;
    }

    if (request.type === 'boolean' && control.type === 'boolean') {
      return {
        ...control,
        currentValue: request.value,
      };
    }

    if (request.type === 'select' && control.type === 'select') {
      return {
        ...control,
        currentValue: request.value,
      };
    }

    return control;
  });

const mergeConfigControls = (
  previous: AcpSessionConfigControl[],
  incoming: AcpSessionConfigControl[],
): AcpSessionConfigControl[] => {
  if (incoming.length === 0) {
    return [];
  }

  if (previous.length === 0) {
    return incoming;
  }

  const incomingById = new Map(incoming.map((control) => [control.id, control]));
  const merged = previous.map((control) => incomingById.get(control.id) ?? control);
  const existingIds = new Set(previous.map((control) => control.id));

  for (const control of incoming) {
    if (existingIds.has(control.id)) {
      continue;
    }

    merged.push(control);
  }

  return merged;
};

const withSessionControlsFromUpdate = (
  currentControls: AcpSessionControls | undefined,
  update: SessionUpdate,
): AcpSessionControls | undefined => {
  if (update.sessionUpdate === 'current_mode_update') {
    if (!currentControls) {
      return undefined;
    }

    if (!currentControls.modeState) {
      return currentControls;
    }

    return {
      ...currentControls,
      modeState: {
        ...currentControls.modeState,
        currentModeId: update.modeId,
      },
    };
  }

  if (update.sessionUpdate === 'config_option_update') {
    const nextConfigControls = toConfigControls(update.configOptions);

    const nextControls: AcpSessionControls = {
      ...(currentControls ?? { configControls: [] }),
      configControls: currentControls
        ? mergeConfigControls(currentControls.configControls, nextConfigControls)
        : nextConfigControls,
    };

    return nextControls;
  }

  return currentControls;
};

const defaultTimeline = (): SessionTimeline => ({
  items: [],
  isPrompting: false,
});

const isFileMutationToolKind = (toolKind: string): boolean => {
  const normalizedToolKind = toolKind.trim().toLowerCase();
  return FILE_MUTATION_TOOL_KIND_TOKENS.some((token) => normalizedToolKind.includes(token));
};

const isMissingWorkspaceFileError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  return (
    message.includes('ENOENT') ||
    normalized.includes('no such file') ||
    normalized.includes('path is not a file')
  );
};

const areFileSnapshotStatesEqual = (
  left: TimelineToolCallFileState | undefined,
  right: TimelineToolCallFileState | undefined,
): boolean =>
  left?.exists === right?.exists &&
  left?.content === right?.content;

const readWorkspaceFileSnapshot = async (
  workspacePath: string,
  filePath: string,
): Promise<TimelineToolCallFileState> => {
  try {
    const result = await window.desktop.workspaceReadFile({
      workspacePath,
      filePath,
    });

    return {
      exists: true,
      content: result.content,
    };
  } catch (error) {
    if (isMissingWorkspaceFileError(error)) {
      return {
        exists: false,
        content: null,
      };
    }

    throw error;
  }
};

const withToolCallFileSnapshots = (
  items: TimelineItem[],
  toolCallId: string,
  snapshotsByLocation: Record<string, TimelineToolCallFileState>,
  phase: 'before' | 'after',
): TimelineItem[] => {
  const index = items.findIndex(
    (item) => item.kind === 'tool-call' && item.toolCallId === toolCallId,
  );
  if (index < 0) {
    return items;
  }

  const existing = items[index];
  if (existing.kind !== 'tool-call') {
    return items;
  }

  let changed = false;
  const nextSnapshotsByLocation = { ...(existing.fileSnapshotsByLocation ?? {}) };

  for (const [locationPath, snapshot] of Object.entries(snapshotsByLocation)) {
    const existingEntry = nextSnapshotsByLocation[locationPath] ?? {};
    const nextEntry =
      phase === 'before'
        ? { ...existingEntry, before: existingEntry.before ?? snapshot }
        : { ...existingEntry, after: snapshot };

    if (
      areFileSnapshotStatesEqual(existingEntry.before, nextEntry.before) &&
      areFileSnapshotStatesEqual(existingEntry.after, nextEntry.after)
    ) {
      continue;
    }

    nextSnapshotsByLocation[locationPath] = nextEntry;
    changed = true;
  }

  if (!changed) {
    return items;
  }

  const nextToolItem: TimelineItem = {
    ...existing,
    fileSnapshotsByLocation: nextSnapshotsByLocation,
  };

  return [...items.slice(0, index), nextToolItem, ...items.slice(index + 1)];
};

const nextId = (prefix: string): string =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const normalizeMessageForMatching = (value: string): string =>
  value.replace(/\s+/g, ' ').trim().toLowerCase();

const toErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  return String(error);
};

const isAuthenticationRequiredError = (error: unknown): boolean => {
  const normalized = toErrorMessage(error).toLowerCase();
  return (
    normalized.includes('authentication required') ||
    normalized.includes('please run') ||
    normalized.includes('call authenticate(')
  );
};

const matchesHistoryMessage = (incomingText: string, historyText: string): boolean => {
  const normalizedIncoming = normalizeMessageForMatching(incomingText);
  const normalizedHistory = normalizeMessageForMatching(historyText);

  if (!normalizedIncoming || !normalizedHistory) {
    return false;
  }

  return (
    normalizedIncoming === normalizedHistory ||
    normalizedIncoming.startsWith(`${normalizedHistory}@`) ||
    normalizedIncoming.startsWith(`${normalizedHistory} @`)
  );
};

const decodeFileUriPath = (value: string): string => {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'file:') {
      return '';
    }

    const decodedPathname = decodeURIComponent(parsed.pathname);
    if (parsed.hostname) {
      return `//${parsed.hostname}${decodedPathname}`;
    }

    if (/^\/[a-z]:\//i.test(decodedPathname)) {
      return decodedPathname.slice(1);
    }

    return decodedPathname;
  } catch {
    return '';
  }
};

const normalizePromptAttachments = (
  attachments: AcpPromptAttachment[] | undefined,
): AcpPromptAttachment[] =>
  Array.isArray(attachments)
    ? attachments
        .map((attachment) => {
          const absolutePath = attachment.absolutePath.trim();
          if (!absolutePath) {
            return null;
          }

          return {
            absolutePath,
            relativePath: attachment.relativePath?.trim() || undefined,
            displayPath: attachment.displayPath?.trim() || undefined,
            mimeType: attachment.mimeType?.trim() || undefined,
          };
        })
        .filter((attachment): attachment is AcpPromptAttachment => attachment !== null)
    : [];

const normalizePromptAudio = (
  audio: AcpPromptAudioContent | null | undefined,
): AcpPromptAudioContent | null => {
  if (!audio) {
    return null;
  }

  const data = audio.data.trim();
  const mimeType = audio.mimeType.trim();
  if (!data || !mimeType) {
    return null;
  }

  return {
    data,
    mimeType,
  };
};

const mergePromptAttachments = (
  current: AcpPromptAttachment[] | undefined,
  incoming: AcpPromptAttachment[] | undefined,
): AcpPromptAttachment[] | undefined => {
  const merged = new Map<string, AcpPromptAttachment>();

  for (const attachment of normalizePromptAttachments(current)) {
    merged.set(attachment.absolutePath, attachment);
  }

  for (const attachment of normalizePromptAttachments(incoming)) {
    merged.set(attachment.absolutePath, attachment);
  }

  const values = Array.from(merged.values());
  return values.length > 0 ? values : undefined;
};

const areAttachmentListsEqual = (
  left: AcpPromptAttachment[] | undefined,
  right: AcpPromptAttachment[] | undefined,
): boolean => {
  const normalizedLeft = normalizePromptAttachments(left);
  const normalizedRight = normalizePromptAttachments(right);
  if (normalizedLeft.length !== normalizedRight.length) {
    return false;
  }

  for (let index = 0; index < normalizedLeft.length; index += 1) {
    const leftAttachment = normalizedLeft[index];
    const rightAttachment = normalizedRight[index];

    if (
      leftAttachment.absolutePath !== rightAttachment.absolutePath ||
      leftAttachment.relativePath !== rightAttachment.relativePath ||
      leftAttachment.displayPath !== rightAttachment.displayPath ||
      leftAttachment.mimeType !== rightAttachment.mimeType
    ) {
      return false;
    }
  }

  return true;
};

const extractAttachmentFromUserChunk = (
  update: Extract<SessionUpdate, { sessionUpdate: 'user_message_chunk' }>,
): AcpPromptAttachment[] => {
  if (update.content.type !== 'resource_link') {
    return [];
  }

  const absolutePath = decodeFileUriPath(update.content.uri).trim();
  if (!absolutePath) {
    return [];
  }

  return [
    {
      absolutePath,
      displayPath:
        update.content.title?.trim() || update.content.name?.trim() || undefined,
      mimeType: update.content.mimeType?.trim() || undefined,
    },
  ];
};

const INLINE_COMMAND_RESULT_PATTERN =
  /<command-name>([\s\S]*?)<\/command-name>\s*<command-message>([\s\S]*?)<\/command-message>\s*<command-args>([\s\S]*?)<\/command-args>\s*<local-command-stdout>([\s\S]*?)<\/local-command-stdout>/gi;

const normalizeInlineCommandField = (value: string): string =>
  value
    .replace(/\r\n?/g, '\n')
    .replace(/\s+/g, ' ')
    .trim();

const toInlineCommandResultText = (
  commandName: string,
  commandMessage: string,
  commandArgs: string,
  commandStdout: string,
): string => {
  const isModelCommand = commandName === '/model' || commandMessage === 'model';
  if (isModelCommand) {
    const modelMatch = commandStdout.match(/^set model to\s+(.+?)[.]?$/i);
    const modelLabel = modelMatch?.[1]?.trim() || commandArgs;
    if (modelLabel.length > 0) {
      return `Model changed to ${modelLabel}.`;
    }
    return 'Model changed.';
  }

  if (commandStdout.length > 0) {
    return commandStdout;
  }

  return '';
};

const normalizeInlineCommandResultTags = (text: string): string => {
  if (!text.includes('<command-name>') || !text.includes('</local-command-stdout>')) {
    return text;
  }

  return text.replace(
    INLINE_COMMAND_RESULT_PATTERN,
    (_full, rawCommandName, rawCommandMessage, rawCommandArgs, rawCommandStdout) => {
      const commandName = normalizeInlineCommandField(rawCommandName).toLowerCase();
      const commandMessage = normalizeInlineCommandField(rawCommandMessage).toLowerCase();
      const commandArgs = normalizeInlineCommandField(rawCommandArgs);
      const commandStdout = normalizeInlineCommandField(rawCommandStdout);
      const inlineResult = toInlineCommandResultText(
        commandName,
        commandMessage,
        commandArgs,
        commandStdout,
      );

      return inlineResult.length > 0 ? `${inlineResult} ` : '';
    },
  );
};

const contentToText = (update: SessionUpdate): string => {
  if (
    (update.sessionUpdate === 'agent_message_chunk' ||
      update.sessionUpdate === 'user_message_chunk' ||
      update.sessionUpdate === 'agent_thought_chunk') &&
    update.content.type === 'text'
  ) {
    return normalizeInlineCommandResultTags(update.content.text);
  }

  if (
    update.sessionUpdate === 'agent_message_chunk' ||
    update.sessionUpdate === 'user_message_chunk' ||
    update.sessionUpdate === 'agent_thought_chunk'
  ) {
    if (update.content.type === 'resource_link') {
      return '';
    }
    return `[${update.content.type}]`;
  }

  return '';
};

const stringifyPayload = (value: unknown): string | undefined => {
  if (value === null || value === undefined) {
    return undefined;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const withMessageChunk = (
  items: TimelineItem[],
  role: 'user-message' | 'assistant-message',
  text: string,
  attachments?: AcpPromptAttachment[],
  hasAudio = false,
): TimelineItem[] => {
  const nowMs = Date.now();
  const normalizedAttachments =
    role === 'user-message' ? normalizePromptAttachments(attachments) : [];

  if (text.length === 0 && normalizedAttachments.length === 0 && !hasAudio) {
    return items;
  }

  const last = items[items.length - 1];
  if (last && last.kind === role) {
    if (role === 'user-message') {
      const mergedAttachments = mergePromptAttachments(
        last.attachments,
        normalizedAttachments,
      );
      const mergedHasAudio = Boolean(last.hasAudio || hasAudio);
      const mergedText = `${last.text}${text}`;

      const mergedUserMessage: TimelineItem = {
        ...last,
        text: mergedText,
        attachments: mergedAttachments,
        hasAudio: mergedHasAudio || undefined,
        updatedAtMs: nowMs,
      };
      return [...items.slice(0, -1), mergedUserMessage];
    }

    const mergedAssistantMessage: TimelineItem = {
      ...last,
      text: `${last.text}${text}`,
      updatedAtMs: nowMs,
    };
    return [...items.slice(0, -1), mergedAssistantMessage];
  }

  if (text.trim().length === 0 && normalizedAttachments.length === 0 && !hasAudio) {
    return items;
  }

  if (role === 'user-message') {
    const mergedAttachments = mergePromptAttachments(undefined, normalizedAttachments);

    return [
      ...items,
      {
        kind: role,
        id: nextId('user'),
        createdAtMs: nowMs,
        updatedAtMs: nowMs,
        text,
        attachments: mergedAttachments,
        hasAudio: hasAudio || undefined,
      },
    ];
  }

  return [
    ...items,
      {
        kind: role,
        id: nextId('assistant'),
        createdAtMs: nowMs,
        updatedAtMs: nowMs,
        text,
      },
    ];
};

const withToolCall = (
  items: TimelineItem[],
  update: SessionUpdate,
): TimelineItem[] => {
  const nowMs = Date.now();
  if (update.sessionUpdate !== 'tool_call' && update.sessionUpdate !== 'tool_call_update') {
    return items;
  }

  const toolCallId = update.toolCallId;
  const index = items.findIndex(
    (item) => item.kind === 'tool-call' && item.toolCallId === toolCallId,
  );

  const existing = index >= 0 ? items[index] : null;

  const nextToolItem: TimelineItem = {
    kind: 'tool-call',
    id: existing?.id ?? nextId('tool'),
    createdAtMs: existing?.createdAtMs ?? nowMs,
    updatedAtMs: nowMs,
    toolCallId,
    title:
      (update.title ??
        (existing && existing.kind === 'tool-call' ? existing.title : undefined) ??
        'Tool call') as string,
    status:
      (update.status ??
        (existing && existing.kind === 'tool-call' ? existing.status : 'unknown')) as
        | ToolCallStatus
        | 'unknown',
    toolKind:
      (update.kind ??
        (existing && existing.kind === 'tool-call' ? existing.toolKind : 'other')) as string,
    locations:
      (update.locations?.map((location) => location.path) ??
        (existing && existing.kind === 'tool-call' ? existing.locations : [])) as string[],
    rawInput:
      stringifyPayload(update.rawInput) ??
      (existing && existing.kind === 'tool-call' ? existing.rawInput : undefined),
    rawOutput:
      stringifyPayload(update.rawOutput) ??
      (existing && existing.kind === 'tool-call' ? existing.rawOutput : undefined),
    fileSnapshotsByLocation:
      existing && existing.kind === 'tool-call'
        ? existing.fileSnapshotsByLocation
        : undefined,
  };

  if (index >= 0) {
    return [...items.slice(0, index), nextToolItem, ...items.slice(index + 1)];
  }

  return [...items, nextToolItem];
};

const withPlan = (items: TimelineItem[], entries: PlanEntry[]): TimelineItem[] => {
  const nowMs = Date.now();
  const lastIndex = items.length - 1;
  const last = items[lastIndex];
  const planItem: TimelineItem = {
    kind: 'plan',
    id: last?.kind === 'plan' ? last.id : nextId('plan'),
    createdAtMs: last?.kind === 'plan' ? last.createdAtMs : nowMs,
    updatedAtMs: nowMs,
    entries,
  };

  if (last?.kind === 'plan') {
    return [...items.slice(0, -1), planItem];
  }

  return [...items, planItem];
};

const reduceTimeline = (
  timeline: SessionTimeline,
  update: SessionUpdate,
  options?: {
    userAttachments?: AcpPromptAttachment[];
    userTextOverride?: string;
  },
): SessionTimeline => {
  switch (update.sessionUpdate) {
    case 'agent_message_chunk': {
      return {
        ...timeline,
        items: withMessageChunk(timeline.items, 'assistant-message', contentToText(update)),
      };
    }

    case 'user_message_chunk': {
      return {
        ...timeline,
        items: withMessageChunk(
          timeline.items,
          'user-message',
          options?.userTextOverride ?? contentToText(update),
          options?.userAttachments,
        ),
      };
    }

    case 'tool_call':
    case 'tool_call_update': {
      return {
        ...timeline,
        items: withToolCall(timeline.items, update),
      };
    }

    case 'plan': {
      return {
        ...timeline,
        items: withPlan(timeline.items, update.entries),
      };
    }

    default:
      return timeline;
  }
};

export const useAcp = (selectedThreadId: string): UseAcpResult => {
  const initialAgentPreset = readAgentPreset();

  const [threadSessionMap, setThreadSessionMap] = React.useState<ThreadSessionMap>(() =>
    readThreadSessionMap(initialAgentPreset),
  );
  const [threadAttachmentHistoryMap, setThreadAttachmentHistoryMap] =
    React.useState<ThreadAttachmentHistoryMap>(() =>
      readThreadAttachmentHistoryMap(initialAgentPreset),
    );
  const [activeSessionId, setActiveSessionId] = React.useState<string | null>(null);
  const [sessionTimelines, setSessionTimelines] = React.useState<
    Record<string, SessionTimeline>
  >({});
  const [sessionTitleBySessionId, setSessionTitleBySessionId] = React.useState<
    Record<string, string>
  >({});
  const [sessionUpdatedAtBySessionId, setSessionUpdatedAtBySessionId] = React.useState<
    Record<string, number>
  >({});
  const [sessionControlsBySessionId, setSessionControlsBySessionId] = React.useState<
    Record<string, AcpSessionControls>
  >({});
  const [availableCommandsBySessionId, setAvailableCommandsBySessionId] = React.useState<
    Record<string, AcpAvailableCommand[]>
  >({});
  const [connectionState, setConnectionState] =
    React.useState<AcpConnectionState>('disconnected');
  const [connectionMessage, setConnectionMessage] = React.useState<string | null>(null);
  const [agentName, setAgentName] = React.useState('ACP Agent');
  const [promptCapabilities, setPromptCapabilities] = React.useState<AcpPromptCapabilities>(
    DEFAULT_PROMPT_CAPABILITIES,
  );
  const [defaultAgentPreset, setDefaultAgentPresetState] = React.useState<AcpAgentPreset>(() =>
    initialAgentPreset,
  );
  const [codexAgentConfig, setCodexAgentConfig] =
    React.useState<AcpCustomAgentConfig | null>(() => readCodexAgentConfig());
  const [claudeAgentConfig, setClaudeAgentConfig] =
    React.useState<AcpCustomAgentConfig | null>(() => readClaudeAgentConfig());
  const [customAgentConfig, setCustomAgentConfig] =
    React.useState<AcpCustomAgentConfig | null>(() => readCustomAgentConfig());
  const [threadAgentSelectionById, setThreadAgentSelectionById] =
    React.useState<ThreadAgentSelectionMap>(() => readThreadAgentSelectionMap(initialAgentPreset));
  const [loadSessionSupported, setLoadSessionSupported] = React.useState(false);
  const [pendingPermissions, setPendingPermissions] = React.useState<
    AcpPermissionRequestEvent[]
  >([]);

  const initializePromiseRef = React.useRef<Promise<void> | null>(null);
  const isInitializedRef = React.useRef(false);
  const initializedAgentSignatureRef = React.useRef<string | null>(null);
  const loadSessionSupportedRef = React.useRef(false);
  const hydratedSessionIdsRef = React.useRef<Set<string>>(new Set());
  const loadingSessionIdsRef = React.useRef<Set<string>>(new Set());
  const recencyEligibleSessionIdsRef = React.useRef<Set<string>>(new Set());
  const suppressUpdatedAtUntilBySessionIdRef = React.useRef<Record<string, number>>({});
  const threadSessionMapRef = React.useRef<ThreadSessionMap>(threadSessionMap);
  const threadAttachmentHistoryMapRef =
    React.useRef<ThreadAttachmentHistoryMap>(threadAttachmentHistoryMap);
  const sessionTimelinesRef = React.useRef<Record<string, SessionTimeline>>(sessionTimelines);
  const sessionCwdByIdRef = React.useRef<Record<string, string>>({});
  const activeSessionIdRef = React.useRef<string | null>(activeSessionId);
  const attachmentReplayCursorBySessionIdRef =
    React.useRef<Record<string, number>>({});
  const getCurrentMcpServers = React.useCallback(
    () => toAcpMcpServers(readStoredMcpServers()),
    [],
  );

  const setActiveSessionIdSafely = React.useCallback(
    (nextSessionId: string | null): void => {
      activeSessionIdRef.current = nextSessionId;
      setActiveSessionId(nextSessionId);
    },
    [],
  );

  const updateSessionTimelines = React.useCallback(
    (
      updater: (
        previous: Record<string, SessionTimeline>,
      ) => Record<string, SessionTimeline>,
    ): void => {
      setSessionTimelines((previous) => {
        const next = updater(previous);
        sessionTimelinesRef.current = next;
        return next;
      });
    },
    [],
  );

  const rememberSessionCwd = React.useCallback((sessionId: string, cwd: string): void => {
    const normalizedSessionId = sessionId.trim();
    const normalizedCwd = cwd.trim();
    if (!normalizedSessionId || !normalizedCwd) {
      return;
    }

    sessionCwdByIdRef.current[normalizedSessionId] = normalizedCwd;
  }, []);

  const captureToolCallSnapshots = React.useCallback(
    async (
      sessionId: string,
      toolCallId: string,
      phase: 'before' | 'after',
      toolCallItem: Extract<TimelineItem, { kind: 'tool-call' }>,
    ): Promise<void> => {
      if (!isFileMutationToolKind(toolCallItem.toolKind) || toolCallItem.locations.length === 0) {
        return;
      }

      const workspacePath = sessionCwdByIdRef.current[sessionId];
      if (!workspacePath) {
        return;
      }

      const entries = await Promise.all(
        toolCallItem.locations.map(async (locationPath) => {
          const normalizedLocationPath = locationPath.trim();
          if (!normalizedLocationPath) {
            return null;
          }

          try {
            return [
              normalizedLocationPath,
              await readWorkspaceFileSnapshot(workspacePath, normalizedLocationPath),
            ] as const;
          } catch {
            return null;
          }
        }),
      );

      const snapshotsByLocation = Object.fromEntries(
        entries.filter(
          (
            entry,
          ): entry is readonly [string, TimelineToolCallFileState] => entry !== null,
        ),
      );

      if (Object.keys(snapshotsByLocation).length === 0) {
        return;
      }

      updateSessionTimelines((previous) => {
        const current = previous[sessionId];
        if (!current) {
          return previous;
        }

        const nextItems = withToolCallFileSnapshots(
          current.items,
          toolCallId,
          snapshotsByLocation,
          phase,
        );
        if (nextItems === current.items) {
          return previous;
        }

        return {
          ...previous,
          [sessionId]: {
            ...current,
            items: nextItems,
          },
        };
      });
    },
    [updateSessionTimelines],
  );

  React.useEffect(() => {
    window.localStorage.setItem(THREAD_SESSION_KEY, JSON.stringify(threadSessionMap));
  }, [threadSessionMap]);

  React.useEffect(() => {
    window.localStorage.setItem(
      THREAD_ATTACHMENT_HISTORY_KEY,
      JSON.stringify(threadAttachmentHistoryMap),
    );
  }, [threadAttachmentHistoryMap]);

  React.useEffect(() => {
    threadSessionMapRef.current = threadSessionMap;
  }, [threadSessionMap]);

  React.useEffect(() => {
    threadAttachmentHistoryMapRef.current = threadAttachmentHistoryMap;
  }, [threadAttachmentHistoryMap]);

  React.useEffect(() => {
    sessionTimelinesRef.current = sessionTimelines;
  }, [sessionTimelines]);

  React.useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

  React.useEffect(() => {
    window.localStorage.setItem(AGENT_PRESET_KEY, defaultAgentPreset);
  }, [defaultAgentPreset]);

  React.useEffect(() => {
    window.localStorage.setItem(
      THREAD_AGENT_SELECTION_KEY,
      JSON.stringify(threadAgentSelectionById),
    );
  }, [threadAgentSelectionById]);

  React.useEffect(() => {
    if (!codexAgentConfig) {
      window.localStorage.removeItem(CODEX_AGENT_CONFIG_KEY);
      return;
    }

    window.localStorage.setItem(CODEX_AGENT_CONFIG_KEY, JSON.stringify(codexAgentConfig));
  }, [codexAgentConfig]);

  React.useEffect(() => {
    if (!claudeAgentConfig) {
      window.localStorage.removeItem(CLAUDE_AGENT_CONFIG_KEY);
      return;
    }

    window.localStorage.setItem(CLAUDE_AGENT_CONFIG_KEY, JSON.stringify(claudeAgentConfig));
  }, [claudeAgentConfig]);

  React.useEffect(() => {
    if (!customAgentConfig) {
      window.localStorage.removeItem(CUSTOM_AGENT_CONFIG_KEY);
      return;
    }

    window.localStorage.setItem(CUSTOM_AGENT_CONFIG_KEY, JSON.stringify(customAgentConfig));
  }, [customAgentConfig]);

  React.useEffect(() => {
    const unsubscribe = window.desktop.onAcpEvent((event: AcpRendererEvent) => {
      if (event.type === 'session-update') {
        hydratedSessionIdsRef.current.add(event.sessionId);
        let userAttachmentsFromHistoryOrChunk: AcpPromptAttachment[] | undefined;
        let userTextOverride: string | undefined;
        let nextToolCallItemForSnapshots: Extract<TimelineItem, { kind: 'tool-call' }> | null = null;

        if (event.update.sessionUpdate === 'user_message_chunk') {
          const directAttachments = extractAttachmentFromUserChunk(event.update);
          const chunkText = contentToText(event.update);
          const threadId = Object.entries(threadSessionMapRef.current).find(
            (entry) => entry[1] === event.sessionId,
          )?.[0];

          const historyEntries = threadId
            ? threadAttachmentHistoryMapRef.current[threadId] ?? []
            : [];
          const replayCursor = attachmentReplayCursorBySessionIdRef.current[event.sessionId] ?? 0;

          let matchedHistoryEntry: PersistedThreadAttachmentEntry | null = null;
          if (chunkText.trim().length > 0 && historyEntries.length > 0) {
            for (let index = replayCursor; index < historyEntries.length; index += 1) {
              const entry = historyEntries[index];
              if (!matchesHistoryMessage(chunkText, entry.text)) {
                continue;
              }

              matchedHistoryEntry = entry;
              attachmentReplayCursorBySessionIdRef.current[event.sessionId] = index + 1;
              break;
            }
          }

          userAttachmentsFromHistoryOrChunk = mergePromptAttachments(
            directAttachments,
            matchedHistoryEntry?.attachments,
          );
          if (matchedHistoryEntry) {
            userTextOverride = matchedHistoryEntry.text;
          }
        }

        if (
          (event.update.sessionUpdate === 'user_message_chunk' ||
            event.update.sessionUpdate === 'agent_message_chunk') &&
          recencyEligibleSessionIdsRef.current.has(event.sessionId) &&
          !loadingSessionIdsRef.current.has(event.sessionId)
        ) {
          const suppressUntil =
            suppressUpdatedAtUntilBySessionIdRef.current[event.sessionId] ?? 0;
          if (Date.now() >= suppressUntil) {
            setSessionUpdatedAtBySessionId((previous) => {
              const nowMs = Date.now();
              const previousValue = previous[event.sessionId];
              if (Number.isFinite(previousValue) && nowMs - previousValue < 500) {
                return previous;
              }

              return {
                ...previous,
                [event.sessionId]: nowMs,
              };
            });
          }
        }

        if (event.update.sessionUpdate === 'session_info_update') {
          if (Object.prototype.hasOwnProperty.call(event.update, 'title')) {
            const nextTitle = event.update.title?.trim();

            setSessionTitleBySessionId((previous) => {
              if (!nextTitle) {
                if (!(event.sessionId in previous)) {
                  return previous;
                }

                const next = { ...previous };
                delete next[event.sessionId];
                return next;
              }

              if (previous[event.sessionId] === nextTitle) {
                return previous;
              }

              return {
                ...previous,
                [event.sessionId]: nextTitle,
              };
            });
          }

          // Ignore session_info_update.updatedAt because some adapters bump it on focus/load.
          // Recency in UI is driven by actual message chunks only.
        }
        if (
          event.update.sessionUpdate === 'tool_call' ||
          event.update.sessionUpdate === 'tool_call_update'
        ) {
          const currentTimeline = sessionTimelinesRef.current[event.sessionId] ?? defaultTimeline();
          nextToolCallItemForSnapshots =
            withToolCall(currentTimeline.items, event.update).find(
              (item) =>
                item.kind === 'tool-call' &&
                item.toolCallId === event.update.toolCallId,
            ) ?? null;
        }

        updateSessionTimelines((previous) => {
          const current = previous[event.sessionId] ?? defaultTimeline();
          return {
            ...previous,
            [event.sessionId]: reduceTimeline(current, event.update, {
              userAttachments: userAttachmentsFromHistoryOrChunk,
              userTextOverride,
            }),
          };
        });
        setSessionControlsBySessionId((previous) => {
          const current = previous[event.sessionId];
          const updated = withSessionControlsFromUpdate(current, event.update);
          if (!updated) {
            return previous;
          }

          return {
            ...previous,
            [event.sessionId]: updated,
          };
        });
        if (event.update.sessionUpdate === 'available_commands_update') {
          const nextCommands = normalizeAvailableCommands(event.update.availableCommands);
          setAvailableCommandsBySessionId((previous) => {
            const current = previous[event.sessionId] ?? [];
            if (areAvailableCommandsEqual(current, nextCommands)) {
              return previous;
            }

            return {
              ...previous,
              [event.sessionId]: nextCommands,
            };
          });
        }

        if (
          nextToolCallItemForSnapshots &&
          event.update.sessionUpdate === 'tool_call'
        ) {
          void captureToolCallSnapshots(
            event.sessionId,
            nextToolCallItemForSnapshots.toolCallId,
            'before',
            nextToolCallItemForSnapshots,
          );
        }

        if (
          nextToolCallItemForSnapshots &&
          event.update.sessionUpdate === 'tool_call_update' &&
          (event.update.status === 'completed' || event.update.status === 'failed')
        ) {
          void captureToolCallSnapshots(
            event.sessionId,
            nextToolCallItemForSnapshots.toolCallId,
            'after',
            nextToolCallItemForSnapshots,
          );
        }
        return;
      }

      if (event.type === 'permission-request') {
        setPendingPermissions((previous) => [...previous, event]);
        return;
      }

      if (event.type === 'connection-state') {
        if (event.state === 'disconnected' || event.state === 'error') {
          isInitializedRef.current = false;
          initializePromiseRef.current = null;
          initializedAgentSignatureRef.current = null;
          loadSessionSupportedRef.current = false;
        }

        setConnectionState(event.state);
        setConnectionMessage(event.message ?? null);
      }
    });

    return unsubscribe;
  }, [captureToolCallSnapshots, updateSessionTimelines]);

  const resolveThreadAgentSelection = React.useCallback(
    (threadId?: string | null): ThreadAgentSelection | null => {
      const normalizedThreadId = threadId?.trim() ?? '';
      if (normalizedThreadId) {
        const storedSelection = threadAgentSelectionById[normalizedThreadId];
        if (storedSelection) {
          return storedSelection;
        }
      }

      if (defaultAgentPreset === 'custom') {
        return customAgentConfig
          ? {
              preset: 'custom',
              customConfig: customAgentConfig,
            }
          : {
              preset: 'custom',
            };
      }

      return {
        preset: defaultAgentPreset,
      };
    },
    [customAgentConfig, defaultAgentPreset, threadAgentSelectionById],
  );

  const getAgentConfigForSelection = React.useCallback(
    (selection: ThreadAgentSelection | null): AcpAgentConfig | null => {
      if (!selection || selection.preset === 'mock') {
        return {
          kind: 'mock',
        };
      }

      if (selection.preset === 'custom') {
        const resolvedConfig = selection.customConfig ?? customAgentConfig;
        if (!resolvedConfig?.command.trim()) {
          return null;
        }

        return {
          kind: 'custom',
          command: resolvedConfig.command,
          args: resolvedConfig.args,
          cwd: resolvedConfig.cwd,
          env: resolvedConfig.env,
        };
      }

      if (selection.preset === 'codex') {
        return {
          kind: 'codex',
          config: codexAgentConfig ?? undefined,
        };
      }

      return {
        kind: 'claude',
        config: claudeAgentConfig ?? undefined,
      };
    },
    [claudeAgentConfig, codexAgentConfig, customAgentConfig],
  );

  const getCurrentAgentConfig = React.useCallback(
    (threadId?: string | null): AcpAgentConfig | null =>
      getAgentConfigForSelection(resolveThreadAgentSelection(threadId)),
    [getAgentConfigForSelection, resolveThreadAgentSelection],
  );

  const setAgentPreset = React.useCallback(
    (preset: AcpAgentPreset) => {
      if (preset === defaultAgentPreset) {
        return;
      }

      setDefaultAgentPresetState(preset);
    },
    [defaultAgentPreset],
  );

  const saveAgentConfig = React.useCallback(
    (
      preset: 'codex' | 'claude' | 'custom',
      config: AcpCustomAgentConfig,
    ) => {
      const nextConfig = normalizeAgentConfig(config);
      if (!nextConfig) {
        return;
      }

      if (preset === 'custom') {
        setCustomAgentConfig(nextConfig);
        return;
      }

      if (preset === 'codex') {
        setCodexAgentConfig(nextConfig);
      } else {
        setClaudeAgentConfig(nextConfig);
      }
    },
    [],
  );

  const initialize = React.useCallback(async (cwd: string, threadId?: string): Promise<boolean> => {
    const requestedAgent = getCurrentAgentConfig(threadId);
    const requestedAgentSignature = toAgentConfigSignature(requestedAgent);

    if (
      isInitializedRef.current &&
      initializedAgentSignatureRef.current === requestedAgentSignature
    ) {
      return true;
    }

    if (initializedAgentSignatureRef.current !== requestedAgentSignature) {
      isInitializedRef.current = false;
      initializePromiseRef.current = null;
    }

    if (!initializePromiseRef.current) {
      initializePromiseRef.current = (async () => {
        try {
          const agent = getCurrentAgentConfig(threadId);
          const nextAgentSignature = toAgentConfigSignature(agent);
          if (!agent) {
            setConnectionState('error');
            setPromptCapabilities(DEFAULT_PROMPT_CAPABILITIES);
            setLoadSessionSupported(false);
            loadSessionSupportedRef.current = false;
            isInitializedRef.current = false;
            initializedAgentSignatureRef.current = null;
            initializePromiseRef.current = null;
            return;
          }

          setConnectionState('connecting');
          const result = await window.desktop.acpInitialize({ cwd, agent });

          setAgentName(result.agentName);
          setPromptCapabilities(result.promptCapabilities);
          setLoadSessionSupported(result.loadSessionSupported);
          loadSessionSupportedRef.current = result.loadSessionSupported;
          setConnectionState(result.connected ? 'ready' : 'error');
          if (result.connected) {
            setConnectionMessage(null);
          } else {
            setConnectionMessage(
              (previous) =>
                previous ??
                'ACP initialize failed. Check adapter auth/configuration.',
            );
          }
          isInitializedRef.current = result.connected;
          initializedAgentSignatureRef.current = result.connected ? nextAgentSignature : null;
          if (!result.connected) {
            initializePromiseRef.current = null;
          }
        } catch {
          setConnectionState('error');
          setConnectionMessage(
            (previous) =>
              previous ??
              'ACP initialize failed. Check adapter auth/configuration.',
          );
          setPromptCapabilities(DEFAULT_PROMPT_CAPABILITIES);
          setLoadSessionSupported(false);
          loadSessionSupportedRef.current = false;
          isInitializedRef.current = false;
          initializedAgentSignatureRef.current = null;
          initializePromiseRef.current = null;
          throw new Error('ACP initialize failed');
        }
      })();
    }

    try {
      await initializePromiseRef.current;
      return isInitializedRef.current;
    } catch {
      return false;
    }
  }, [getCurrentAgentConfig]);

  const ensureTimelineExists = React.useCallback((sessionId: string) => {
    updateSessionTimelines((previous) => {
      if (previous[sessionId]) {
        return previous;
      }

      return {
        ...previous,
        [sessionId]: defaultTimeline(),
      };
    });
  }, [updateSessionTimelines]);

  const ensureSessionForThread = React.useCallback(
    async (threadId: string, cwd: string): Promise<void> => {
      const normalizedThreadId = threadId.trim();
      const normalizedCwd = cwd.trim();
      const resolvedSelection = resolveThreadAgentSelection(normalizedThreadId);
      if (normalizedThreadId && !threadAgentSelectionById[normalizedThreadId] && resolvedSelection) {
        setThreadAgentSelectionById((previous) => {
          if (previous[normalizedThreadId]) {
            return previous;
          }

          return {
            ...previous,
            [normalizedThreadId]: resolvedSelection,
          };
        });
      }

      const currentAgentConfig = getAgentConfigForSelection(resolvedSelection) ?? undefined;
      const initialized = await initialize(normalizedCwd, normalizedThreadId);
      if (!initialized) {
        return;
      }
      if (!normalizedCwd) {
        return;
      }
      const loadSupported = loadSessionSupportedRef.current;

      if (!normalizedThreadId) {
        if (activeSessionIdRef.current) {
          rememberSessionCwd(activeSessionIdRef.current, normalizedCwd);
          ensureTimelineExists(activeSessionIdRef.current);
          return;
        }

        let created: AcpSessionNewResult;
        try {
          created = await window.desktop.acpSessionNew({
            cwd: normalizedCwd,
            agent: currentAgentConfig,
            mcpServers: getCurrentMcpServers(),
          });
        } catch (error) {
          if (isAuthenticationRequiredError(error)) {
            throw error instanceof Error ? error : new Error(toErrorMessage(error));
          }
          setConnectionState('error');
          setConnectionMessage('Failed to create ACP session.');
          throw error instanceof Error ? error : new Error('Failed to create ACP session.');
        }

        hydratedSessionIdsRef.current.add(created.sessionId);
        rememberSessionCwd(created.sessionId, normalizedCwd);
        recencyEligibleSessionIdsRef.current.delete(created.sessionId);
        if (created.controls) {
          setSessionControlsBySessionId((previous) => ({
            ...previous,
            [created.sessionId]: created.controls,
          }));
        } else if (loadSupported) {
          try {
            const loaded = await window.desktop.acpSessionLoad({
              sessionId: created.sessionId,
              cwd: normalizedCwd,
              agent: currentAgentConfig,
              mcpServers: getCurrentMcpServers(),
            });

            if (loaded.loaded && loaded.controls) {
              setSessionControlsBySessionId((previous) => ({
                ...previous,
                [created.sessionId]: loaded.controls,
              }));
            }
          } catch {
            // Controls can still arrive later via ACP session updates.
          }
        }
        setActiveSessionIdSafely(created.sessionId);
        ensureTimelineExists(created.sessionId);
        return;
      }

      const existingSessionId = threadSessionMap[normalizedThreadId];
      if (existingSessionId) {
        if (loadSupported) {
          if (hydratedSessionIdsRef.current.has(existingSessionId)) {
            rememberSessionCwd(existingSessionId, normalizedCwd);
            setActiveSessionIdSafely(existingSessionId);
            ensureTimelineExists(existingSessionId);
            return;
          }

          try {
            // Replayed history from load_session must not be treated as fresh activity.
            recencyEligibleSessionIdsRef.current.delete(existingSessionId);
            loadingSessionIdsRef.current.add(existingSessionId);
            suppressUpdatedAtUntilBySessionIdRef.current[existingSessionId] =
              Date.now() + SUPPRESS_UPDATED_AT_AFTER_LOAD_MS;
            const result = await window.desktop.acpSessionLoad({
              sessionId: existingSessionId,
              cwd: normalizedCwd,
              agent: currentAgentConfig,
              mcpServers: getCurrentMcpServers(),
            });

            if (result.loaded) {
              hydratedSessionIdsRef.current.add(existingSessionId);
              rememberSessionCwd(existingSessionId, normalizedCwd);
              if (result.controls) {
                setSessionControlsBySessionId((previous) => ({
                  ...previous,
                  [existingSessionId]: result.controls,
                }));
              }
              setActiveSessionIdSafely(existingSessionId);
              ensureTimelineExists(existingSessionId);
              return;
            }
          } catch (error) {
            if (isAuthenticationRequiredError(error)) {
              throw error instanceof Error ? error : new Error(toErrorMessage(error));
            }
            // The ACP adapter process was restarted and does not know this session anymore.
            // Drop the stale mapping and create a fresh session below.
          } finally {
            loadingSessionIdsRef.current.delete(existingSessionId);
          }

          setThreadSessionMap((previous) => {
            if (previous[normalizedThreadId] !== existingSessionId) {
              return previous;
            }

            const next = { ...previous };
            delete next[normalizedThreadId];
            threadSessionMapRef.current = next;
            return next;
          });
          hydratedSessionIdsRef.current.delete(existingSessionId);
          recencyEligibleSessionIdsRef.current.delete(existingSessionId);
          delete sessionCwdByIdRef.current[existingSessionId];
        } else {
          rememberSessionCwd(existingSessionId, normalizedCwd);
          setActiveSessionIdSafely(existingSessionId);
          ensureTimelineExists(existingSessionId);
          return;
        }

        if (activeSessionIdRef.current === existingSessionId) {
          setActiveSessionIdSafely(null);
        }

        updateSessionTimelines((previous) => {
          if (!(existingSessionId in previous)) {
            return previous;
          }

          const next = { ...previous };
          delete next[existingSessionId];
          return next;
        });
        setSessionTitleBySessionId((previous) => {
          if (!(existingSessionId in previous)) {
            return previous;
          }

          const next = { ...previous };
          delete next[existingSessionId];
          return next;
        });
        setSessionUpdatedAtBySessionId((previous) => {
          if (!(existingSessionId in previous)) {
            return previous;
          }

          const next = { ...previous };
          delete next[existingSessionId];
          return next;
        });
        setSessionControlsBySessionId((previous) => {
          if (!(existingSessionId in previous)) {
            return previous;
          }

          const next = { ...previous };
          delete next[existingSessionId];
          return next;
        });
        setAvailableCommandsBySessionId((previous) => {
          if (!(existingSessionId in previous)) {
            return previous;
          }

          const next = { ...previous };
          delete next[existingSessionId];
          return next;
        });
      }

      let created: AcpSessionNewResult;
      try {
        created = await window.desktop.acpSessionNew({
          cwd: normalizedCwd,
          agent: currentAgentConfig,
          mcpServers: getCurrentMcpServers(),
        });
      } catch (error) {
        if (isAuthenticationRequiredError(error)) {
          throw error instanceof Error ? error : new Error(toErrorMessage(error));
        }
        setConnectionState('error');
        setConnectionMessage('Failed to create ACP session.');
        throw error instanceof Error ? error : new Error('Failed to create ACP session.');
      }

      setThreadSessionMap((previous) => {
        const next = {
          ...previous,
          [normalizedThreadId]: created.sessionId,
        };
        threadSessionMapRef.current = next;
        return next;
      });

      hydratedSessionIdsRef.current.add(created.sessionId);
      rememberSessionCwd(created.sessionId, normalizedCwd);
      recencyEligibleSessionIdsRef.current.delete(created.sessionId);
      if (created.controls) {
        setSessionControlsBySessionId((previous) => ({
          ...previous,
          [created.sessionId]: created.controls,
        }));
      } else if (loadSupported) {
        try {
          const loaded = await window.desktop.acpSessionLoad({
            sessionId: created.sessionId,
            cwd: normalizedCwd,
            agent: currentAgentConfig,
            mcpServers: getCurrentMcpServers(),
          });

          if (loaded.loaded && loaded.controls) {
            setSessionControlsBySessionId((previous) => ({
              ...previous,
              [created.sessionId]: loaded.controls,
            }));
          }
        } catch {
          // Controls can still arrive later via ACP session updates.
        }
      }
      setActiveSessionIdSafely(created.sessionId);
      ensureTimelineExists(created.sessionId);
    },
    [
      ensureTimelineExists,
      getAgentConfigForSelection,
      getCurrentMcpServers,
      initialize,
      resolveThreadAgentSelection,
      rememberSessionCwd,
      setActiveSessionIdSafely,
      threadAgentSelectionById,
      threadSessionMap,
    ],
  );

  const setSessionPrompting = React.useCallback((sessionId: string, isPrompting: boolean) => {
    updateSessionTimelines((previous) => {
      const current = previous[sessionId] ?? defaultTimeline();
      return {
        ...previous,
        [sessionId]: {
          ...current,
          isPrompting,
        },
      };
    });
  }, [updateSessionTimelines]);

  const rememberThreadAttachmentHistory = React.useCallback(
    (sessionId: string, text: string, attachments: AcpPromptAttachment[]): void => {
      const normalizedText = text.trim();
      const normalizedAttachments = normalizePromptAttachments(attachments);
      if (normalizedText.length === 0 || normalizedAttachments.length === 0) {
        return;
      }

      const threadId = Object.entries(threadSessionMapRef.current).find(
        (entry) => entry[1] === sessionId,
      )?.[0];
      if (!threadId) {
        return;
      }

      setThreadAttachmentHistoryMap((previous) => {
        const existingHistory = previous[threadId] ?? [];
        const previousEntry = existingHistory[existingHistory.length - 1];
        if (
          previousEntry &&
          matchesHistoryMessage(normalizedText, previousEntry.text) &&
          areAttachmentListsEqual(previousEntry.attachments, normalizedAttachments)
        ) {
          return previous;
        }

        const nextHistory = [
          ...existingHistory,
          {
            text: normalizedText,
            attachments: normalizedAttachments,
          },
        ].slice(-MAX_ATTACHMENT_HISTORY_PER_THREAD);

        return {
          ...previous,
          [threadId]: nextHistory,
        };
      });
    },
    [],
  );

  const sendPrompt = React.useCallback(
    async (
      text: string,
      attachments: AcpPromptAttachment[] = [],
      audio?: AcpPromptAudioContent | null,
    ): Promise<void> => {
      const sessionId = activeSessionIdRef.current;
      const trimmed = text.trim();
      const normalizedAttachments = normalizePromptAttachments(attachments);
      const normalizedAudio = normalizePromptAudio(audio);
      const hasAudio = normalizedAudio !== null;

      if (
        !sessionId ||
        (trimmed.length === 0 && normalizedAttachments.length === 0 && !hasAudio)
      ) {
        return;
      }

      recencyEligibleSessionIdsRef.current.add(sessionId);
      if (trimmed.length > 0) {
        rememberThreadAttachmentHistory(sessionId, trimmed, normalizedAttachments);
      }

      updateSessionTimelines((previous) => {
        const current = previous[sessionId] ?? defaultTimeline();
        return {
          ...previous,
          [sessionId]: {
            ...current,
            isPrompting: true,
            items: withMessageChunk(
              current.items,
              'user-message',
              trimmed,
              normalizedAttachments,
              hasAudio,
            ),
          },
        };
      });

      try {
        const result = await window.desktop.acpPrompt({
          sessionId,
          text: trimmed,
          attachments: normalizedAttachments,
          audio: normalizedAudio,
        });

        updateSessionTimelines((previous) => {
          const current = previous[sessionId] ?? defaultTimeline();
          return {
            ...previous,
            [sessionId]: {
              ...current,
              isPrompting: false,
              stopReason: result.stopReason,
            },
          };
        });
      } catch (error) {
        setSessionPrompting(sessionId, false);
        if (error instanceof Error) {
          throw error;
        }

        if (typeof error === 'string') {
          throw new Error(error);
        }

        throw new Error('ACP prompt failed');
      }
    },
    [rememberThreadAttachmentHistory, setSessionPrompting],
  );

  const setSessionMode = React.useCallback(
    async (modeId: string): Promise<void> => {
      const sessionId = activeSessionId;
      if (!sessionId || modeId.trim().length === 0) {
        return;
      }

      await window.desktop.acpSessionSetMode({
        sessionId,
        modeId,
      });

      setSessionControlsBySessionId((previous) => {
        const current = previous[sessionId];
        if (!current?.modeState) {
          return previous;
        }

        return {
          ...previous,
          [sessionId]: {
            ...current,
            modeState: {
              ...current.modeState,
              currentModeId: modeId,
            },
          },
        };
      });
    },
    [activeSessionId],
  );

  const setSessionModel = React.useCallback(
    async (modelId: string): Promise<void> => {
      const sessionId = activeSessionId;
      if (!sessionId || modelId.trim().length === 0) {
        return;
      }

      await window.desktop.acpSessionSetModel({
        sessionId,
        modelId,
      });

      setSessionControlsBySessionId((previous) => {
        const current = previous[sessionId];
        if (!current?.modelState) {
          return previous;
        }

        return {
          ...previous,
          [sessionId]: {
            ...current,
            modelState: {
              ...current.modelState,
              currentModelId: modelId,
            },
          },
        };
      });
    },
    [activeSessionId],
  );

  const setSessionConfigOption = React.useCallback(
    async (
      request: Omit<AcpSetSessionConfigOptionRequest, 'sessionId'>,
    ): Promise<void> => {
      const sessionId = activeSessionId;
      if (!sessionId) {
        return;
      }

      const fullRequest: AcpSetSessionConfigOptionRequest = {
        ...request,
        sessionId,
      };

      const result = await window.desktop.acpSessionSetConfigOption(fullRequest);

      if (result.controls) {
        const nextControls = result.controls;
        setSessionControlsBySessionId((previous) => {
          const current = previous[sessionId];

          const mergedConfigControls = current
            ? mergeConfigControls(current.configControls, nextControls.configControls)
            : nextControls.configControls;

          return {
            ...previous,
            [sessionId]: {
              modeState: nextControls.modeState ?? current?.modeState,
              modelState: nextControls.modelState ?? current?.modelState,
              configControls: mergedConfigControls,
            },
          };
        });
        return;
      }

      setSessionControlsBySessionId((previous) => {
        const current = previous[sessionId];
        if (!current) {
          return previous;
        }

        return {
          ...previous,
          [sessionId]: {
            ...current,
            configControls: withUpdatedConfigControlValue(
              current.configControls,
              fullRequest,
            ),
          },
        };
      });
    },
    [activeSessionId],
  );

  const cancelPrompt = React.useCallback(async (): Promise<void> => {
    if (!activeSessionId) {
      return;
    }

    await window.desktop.acpCancel({
      sessionId: activeSessionId,
    });

    setSessionPrompting(activeSessionId, false);
  }, [activeSessionId, setSessionPrompting]);

  const resolvePermission = React.useCallback(
    async (requestId: string, decision: AcpPermissionDecision): Promise<void> => {
      await window.desktop.acpRespondPermission({ requestId, decision });

      setPendingPermissions((previous) =>
        previous.filter((item) => item.requestId !== requestId),
      );
    },
    [],
  );

  const authenticate = React.useCallback(
    async (cwd: string): Promise<AcpAuthenticateResult> =>
      window.desktop.acpAuthenticate({
        cwd,
        agent: getCurrentAgentConfig(selectedThreadId) ?? undefined,
      }),
    [getCurrentAgentConfig, selectedThreadId],
  );

  const invalidateThreadSession = React.useCallback(
    (threadId: string): void => {
      const sessionId = threadSessionMapRef.current[threadId];
      if (!sessionId) {
        return;
      }

      setThreadSessionMap((previous) => {
        if (!(threadId in previous)) {
          return previous;
        }

        const next = { ...previous };
        delete next[threadId];
        threadSessionMapRef.current = next;
        return next;
      });

      hydratedSessionIdsRef.current.delete(sessionId);
      loadingSessionIdsRef.current.delete(sessionId);
      recencyEligibleSessionIdsRef.current.delete(sessionId);
      delete suppressUpdatedAtUntilBySessionIdRef.current[sessionId];
      delete attachmentReplayCursorBySessionIdRef.current[sessionId];
      delete sessionCwdByIdRef.current[sessionId];

      if (activeSessionIdRef.current === sessionId) {
        setActiveSessionIdSafely(null);
      }

      updateSessionTimelines((previous) => {
        if (!(sessionId in previous)) {
          return previous;
        }

        const next = { ...previous };
        delete next[sessionId];
        return next;
      });

      setSessionTitleBySessionId((previous) => {
        if (!(sessionId in previous)) {
          return previous;
        }

        const next = { ...previous };
        delete next[sessionId];
        return next;
      });

      setSessionUpdatedAtBySessionId((previous) => {
        if (!(sessionId in previous)) {
          return previous;
        }

        const next = { ...previous };
        delete next[sessionId];
        return next;
      });

      setSessionControlsBySessionId((previous) => {
        if (!(sessionId in previous)) {
          return previous;
        }

        const next = { ...previous };
        delete next[sessionId];
        return next;
      });
      setAvailableCommandsBySessionId((previous) => {
        if (!(sessionId in previous)) {
          return previous;
        }

        const next = { ...previous };
        delete next[sessionId];
        return next;
      });
    },
    [setActiveSessionIdSafely],
  );

  const setThreadAgentSelection = React.useCallback(
    (threadId: string, selection: ThreadAgentSelection): void => {
      const normalizedThreadId = threadId.trim();
      if (!normalizedThreadId) {
        return;
      }

      const normalizedSelection = normalizeThreadAgentSelection(selection);
      if (!normalizedSelection) {
        return;
      }

      const currentSelection = threadAgentSelectionById[normalizedThreadId] ?? null;
      if (
        toThreadAgentSelectionSignature(currentSelection) ===
        toThreadAgentSelectionSignature(normalizedSelection)
      ) {
        return;
      }

      setThreadAgentSelectionById((previous) => ({
        ...previous,
        [normalizedThreadId]: normalizedSelection,
      }));
      invalidateThreadSession(normalizedThreadId);
    },
    [invalidateThreadSession, threadAgentSelectionById],
  );

  const currentThreadSelection = React.useMemo(
    () => resolveThreadAgentSelection(selectedThreadId),
    [resolveThreadAgentSelection, selectedThreadId],
  );
  const agentPreset = currentThreadSelection?.preset ?? defaultAgentPreset;
  const currentCustomAgentConfig = React.useMemo(() => {
    if (agentPreset !== 'custom') {
      return customAgentConfig;
    }

    return currentThreadSelection?.customConfig ?? customAgentConfig;
  }, [agentPreset, currentThreadSelection?.customConfig, customAgentConfig]);

  const pendingPermission = pendingPermissions[0] ?? null;

  const activeTimeline = React.useMemo(() => {
    if (!activeSessionId) {
      return defaultTimeline();
    }

    return sessionTimelines[activeSessionId] ?? defaultTimeline();
  }, [activeSessionId, sessionTimelines]);

  const activeSessionThreadId = React.useMemo(() => {
    if (!activeSessionId) {
      return null;
    }

    for (const [threadId, sessionId] of Object.entries(threadSessionMap)) {
      if (sessionId === activeSessionId) {
        return threadId;
      }
    }

    return null;
  }, [activeSessionId, threadSessionMap]);

  const threadPromptingById = React.useMemo(() => {
    const promptingById: Record<string, boolean> = {};

    for (const [threadId, sessionId] of Object.entries(threadSessionMap)) {
      promptingById[threadId] = Boolean(sessionTimelines[sessionId]?.isPrompting);
    }

    return promptingById;
  }, [sessionTimelines, threadSessionMap]);

  const threadSessionTitleById = React.useMemo(() => {
    const titleByThreadId: Record<string, string> = {};

    for (const [threadId, sessionId] of Object.entries(threadSessionMap)) {
      const title = sessionTitleBySessionId[sessionId];
      if (!title) {
        continue;
      }

      titleByThreadId[threadId] = title;
    }

    return titleByThreadId;
  }, [sessionTitleBySessionId, threadSessionMap]);

  const threadSessionUpdatedAtById = React.useMemo(() => {
    const updatedAtByThreadId: Record<string, number> = {};

    for (const [threadId, sessionId] of Object.entries(threadSessionMap)) {
      const updatedAtMs = sessionUpdatedAtBySessionId[sessionId];
      if (!Number.isFinite(updatedAtMs)) {
        continue;
      }

      updatedAtByThreadId[threadId] = updatedAtMs;
    }

    return updatedAtByThreadId;
  }, [sessionUpdatedAtBySessionId, threadSessionMap]);

  const activeSessionControls = React.useMemo(() => {
    if (!activeSessionId) {
      return null;
    }

    return sessionControlsBySessionId[activeSessionId] ?? null;
  }, [activeSessionId, sessionControlsBySessionId]);
  const activeAvailableCommands = React.useMemo(() => {
    if (!activeSessionId) {
      return [];
    }

    return availableCommandsBySessionId[activeSessionId] ?? [];
  }, [activeSessionId, availableCommandsBySessionId]);

  return {
    connectionState,
    connectionMessage,
    agentName,
    promptCapabilities,
    agentPreset,
    defaultAgentPreset,
    codexAgentConfig,
    claudeAgentConfig,
    customAgentConfig: currentCustomAgentConfig,
    defaultCustomAgentConfig: customAgentConfig,
    loadSessionSupported,
    activeSessionId,
    activeSessionThreadId,
    activeTimeline,
    threadPromptingById,
    threadAgentSelectionById,
    threadSessionTitleById,
    threadSessionUpdatedAtById,
    activeSessionControls,
    activeAvailableCommands,
    pendingPermission,
    setAgentPreset,
    setThreadAgentSelection,
    saveAgentConfig,
    ensureSessionForThread,
    sendPrompt,
    setSessionMode,
    setSessionModel,
    setSessionConfigOption,
    cancelPrompt,
    resolvePermission,
    authenticate,
    invalidateThreadSession,
  };
};
