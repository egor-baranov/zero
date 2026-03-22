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
  AcpConnectionState,
  AcpCustomAgentConfig,
  AcpAuthenticateResult,
  AcpSessionConfigControl,
  AcpSessionConfigSelectValue,
  AcpSessionControls,
  AcpPromptAttachment,
  AcpPermissionDecision,
  AcpPermissionRequestEvent,
  AcpRendererEvent,
  AcpSetSessionConfigOptionRequest,
  AcpSessionNewResult,
} from '@shared/types/acp';

const THREAD_SESSION_KEY_PREFIX = 'zeroade.acp.thread-sessions.v2';
const THREAD_ATTACHMENT_HISTORY_KEY_PREFIX = 'zeroade.acp.thread-attachments.v1';
const AGENT_PRESET_KEY = 'zeroade.acp.agent-preset.v1';
const CUSTOM_AGENT_CONFIG_KEY = 'zeroade.acp.custom-agent-config.v1';
const CODEX_AGENT_CONFIG_KEY = 'zeroade.acp.codex-agent-config.v1';
const CLAUDE_AGENT_CONFIG_KEY = 'zeroade.acp.claude-agent-config.v1';
const MAX_ATTACHMENT_HISTORY_PER_THREAD = 200;
const SUPPRESS_UPDATED_AT_AFTER_LOAD_MS = 5_000;

export type AcpAgentPreset = 'mock' | 'codex' | 'claude' | 'custom';

type ThreadSessionMap = Record<string, string>;
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

export type TimelineItem =
  | (TimelineItemBase & {
      kind: 'user-message';
      text: string;
      attachments?: AcpPromptAttachment[];
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
  agentPreset: AcpAgentPreset;
  codexAgentConfig: AcpCustomAgentConfig | null;
  claudeAgentConfig: AcpCustomAgentConfig | null;
  customAgentConfig: AcpCustomAgentConfig | null;
  loadSessionSupported: boolean;
  activeSessionId: string | null;
  activeTimeline: SessionTimeline;
  threadPromptingById: Record<string, boolean>;
  threadSessionTitleById: Record<string, string>;
  threadSessionUpdatedAtById: Record<string, number>;
  activeSessionControls: AcpSessionControls | null;
  pendingPermission: AcpPermissionRequestEvent | null;
  setAgentPreset: (preset: AcpAgentPreset, options?: { resetThreadId?: string }) => void;
  saveAgentConfig: (
    preset: 'codex' | 'claude' | 'custom',
    config: AcpCustomAgentConfig,
    options?: { resetThreadId?: string },
  ) => void;
  ensureSessionForThread: (threadId: string, cwd: string) => Promise<void>;
  sendPrompt: (text: string, attachments?: AcpPromptAttachment[]) => Promise<void>;
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

const getThreadSessionKey = (preset: AcpAgentPreset): string =>
  `${THREAD_SESSION_KEY_PREFIX}.${preset}`;

const getThreadAttachmentHistoryKey = (preset: AcpAgentPreset): string =>
  `${THREAD_ATTACHMENT_HISTORY_KEY_PREFIX}.${preset}`;

const readThreadSessionMap = (preset: AcpAgentPreset): ThreadSessionMap => {
  const raw = window.localStorage.getItem(getThreadSessionKey(preset));
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

const readThreadAttachmentHistoryMap = (preset: AcpAgentPreset): ThreadAttachmentHistoryMap => {
  const raw = window.localStorage.getItem(getThreadAttachmentHistoryKey(preset));
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

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

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

const stripInlineAttachmentMentions = (
  text: string,
  attachments: AcpPromptAttachment[] | undefined,
): string => {
  if (!attachments || attachments.length === 0 || text.length === 0) {
    return text;
  }

  let strippedText = text;

  for (const attachment of attachments) {
    const candidates = [
      attachment.displayPath?.trim(),
      attachment.relativePath?.trim(),
      attachment.absolutePath.replaceAll('\\', '/').split('/').filter(Boolean).at(-1),
    ].filter((candidate): candidate is string => Boolean(candidate));

    for (const candidate of candidates) {
      const mentionPattern = new RegExp(`\\s*@${escapeRegExp(candidate)}`, 'gi');
      strippedText = strippedText.replace(mentionPattern, '');
    }
  }

  return strippedText;
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
): TimelineItem[] => {
  const nowMs = Date.now();
  const normalizedAttachments =
    role === 'user-message' ? normalizePromptAttachments(attachments) : [];

  if (text.length === 0 && normalizedAttachments.length === 0) {
    return items;
  }

  const last = items[items.length - 1];
  if (last && last.kind === role) {
    if (role === 'user-message') {
      const mergedAttachments = mergePromptAttachments(
        last.attachments,
        normalizedAttachments,
      );
      const mergedText = stripInlineAttachmentMentions(
        `${last.text}${text}`,
        mergedAttachments,
      );

      const mergedUserMessage: TimelineItem = {
        ...last,
        text: mergedText,
        attachments: mergedAttachments,
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

  if (text.trim().length === 0 && normalizedAttachments.length === 0) {
    return items;
  }

  if (role === 'user-message') {
    const mergedAttachments = mergePromptAttachments(undefined, normalizedAttachments);
    const normalizedText = stripInlineAttachmentMentions(text, mergedAttachments);

    return [
      ...items,
      {
        kind: role,
        id: nextId('user'),
        createdAtMs: nowMs,
        updatedAtMs: nowMs,
        text: normalizedText,
        attachments: mergedAttachments,
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

export const useAcp = (): UseAcpResult => {
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
  const [connectionState, setConnectionState] =
    React.useState<AcpConnectionState>('disconnected');
  const [connectionMessage, setConnectionMessage] = React.useState<string | null>(null);
  const [agentName, setAgentName] = React.useState('ACP Agent');
  const [agentPreset, setAgentPresetState] = React.useState<AcpAgentPreset>(() =>
    initialAgentPreset,
  );
  const [codexAgentConfig, setCodexAgentConfig] =
    React.useState<AcpCustomAgentConfig | null>(() => readCodexAgentConfig());
  const [claudeAgentConfig, setClaudeAgentConfig] =
    React.useState<AcpCustomAgentConfig | null>(() => readClaudeAgentConfig());
  const [customAgentConfig, setCustomAgentConfig] =
    React.useState<AcpCustomAgentConfig | null>(() => readCustomAgentConfig());
  const [loadSessionSupported, setLoadSessionSupported] = React.useState(false);
  const [pendingPermissions, setPendingPermissions] = React.useState<
    AcpPermissionRequestEvent[]
  >([]);

  const initializePromiseRef = React.useRef<Promise<void> | null>(null);
  const isInitializedRef = React.useRef(false);
  const loadSessionSupportedRef = React.useRef(false);
  const hydratedSessionIdsRef = React.useRef<Set<string>>(new Set());
  const loadingSessionIdsRef = React.useRef<Set<string>>(new Set());
  const recencyEligibleSessionIdsRef = React.useRef<Set<string>>(new Set());
  const suppressUpdatedAtUntilBySessionIdRef = React.useRef<Record<string, number>>({});
  const threadSessionMapRef = React.useRef<ThreadSessionMap>(threadSessionMap);
  const threadAttachmentHistoryMapRef =
    React.useRef<ThreadAttachmentHistoryMap>(threadAttachmentHistoryMap);
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

  React.useEffect(() => {
    window.localStorage.setItem(
      getThreadSessionKey(agentPreset),
      JSON.stringify(threadSessionMap),
    );
  }, [agentPreset, threadSessionMap]);

  React.useEffect(() => {
    window.localStorage.setItem(
      getThreadAttachmentHistoryKey(agentPreset),
      JSON.stringify(threadAttachmentHistoryMap),
    );
  }, [agentPreset, threadAttachmentHistoryMap]);

  React.useEffect(() => {
    threadSessionMapRef.current = threadSessionMap;
  }, [threadSessionMap]);

  React.useEffect(() => {
    threadAttachmentHistoryMapRef.current = threadAttachmentHistoryMap;
  }, [threadAttachmentHistoryMap]);

  React.useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

  React.useEffect(() => {
    window.localStorage.setItem(AGENT_PRESET_KEY, agentPreset);
  }, [agentPreset]);

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
        setSessionTimelines((previous) => {
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
        return;
      }

      if (event.type === 'permission-request') {
        setPendingPermissions((previous) => [...previous, event]);
        return;
      }

      if (event.type === 'connection-state') {
        setConnectionState(event.state);
        setConnectionMessage(event.message ?? null);
      }
    });

    return unsubscribe;
  }, []);

  const resetRuntimeState = React.useCallback(() => {
    initializePromiseRef.current = null;
    isInitializedRef.current = false;
    loadSessionSupportedRef.current = false;
    loadingSessionIdsRef.current.clear();
    recencyEligibleSessionIdsRef.current.clear();
    suppressUpdatedAtUntilBySessionIdRef.current = {};
    attachmentReplayCursorBySessionIdRef.current = {};
    setConnectionState('disconnected');
    setConnectionMessage(null);
    setLoadSessionSupported(false);
    setAgentName('ACP Agent');
    setActiveSessionIdSafely(null);
    setPendingPermissions([]);
    setSessionTitleBySessionId({});
    setSessionUpdatedAtBySessionId({});
    setSessionControlsBySessionId({});
    hydratedSessionIdsRef.current.clear();
  }, [setActiveSessionIdSafely]);

  const setAgentPreset = React.useCallback(
    (preset: AcpAgentPreset, options?: { resetThreadId?: string }) => {
      if (preset === agentPreset) {
        return;
      }

      const nextThreadSessionMap = readThreadSessionMap(preset);
      const resetThreadId = options?.resetThreadId?.trim();
      if (resetThreadId && resetThreadId in nextThreadSessionMap) {
        delete nextThreadSessionMap[resetThreadId];
      }
      const nextThreadAttachmentHistoryMap = readThreadAttachmentHistoryMap(preset);
      setAgentPresetState(preset);
      threadSessionMapRef.current = nextThreadSessionMap;
      threadAttachmentHistoryMapRef.current = nextThreadAttachmentHistoryMap;
      setThreadSessionMap(nextThreadSessionMap);
      setThreadAttachmentHistoryMap(nextThreadAttachmentHistoryMap);
      resetRuntimeState();
    },
    [agentPreset, resetRuntimeState],
  );

  const saveAgentConfig = React.useCallback(
    (
      preset: 'codex' | 'claude' | 'custom',
      config: AcpCustomAgentConfig,
      options?: { resetThreadId?: string },
    ) => {
      const nextConfig = normalizeAgentConfig(config);
      if (!nextConfig) {
        return;
      }

      if (preset === 'custom') {
        const nextThreadSessionMap = readThreadSessionMap('custom');
        const resetThreadId = options?.resetThreadId?.trim();
        if (resetThreadId && resetThreadId in nextThreadSessionMap) {
          delete nextThreadSessionMap[resetThreadId];
        }
        const nextThreadAttachmentHistoryMap = readThreadAttachmentHistoryMap('custom');
        setCustomAgentConfig(nextConfig);
        setAgentPresetState('custom');
        threadSessionMapRef.current = nextThreadSessionMap;
        threadAttachmentHistoryMapRef.current = nextThreadAttachmentHistoryMap;
        setThreadSessionMap(nextThreadSessionMap);
        setThreadAttachmentHistoryMap(nextThreadAttachmentHistoryMap);
        resetRuntimeState();
        return;
      }

      if (preset === 'codex') {
        setCodexAgentConfig(nextConfig);
      } else {
        setClaudeAgentConfig(nextConfig);
      }

      if (agentPreset === preset) {
        resetRuntimeState();
      }
    },
    [agentPreset, resetRuntimeState],
  );

  const getCurrentAgentConfig = React.useCallback((): AcpAgentConfig | null => {
    if (agentPreset === 'custom') {
      if (!customAgentConfig?.command.trim()) {
        return null;
      }

      return {
        kind: 'custom',
        command: customAgentConfig.command,
        args: customAgentConfig.args,
        cwd: customAgentConfig.cwd,
        env: customAgentConfig.env,
      };
    }

    if (agentPreset === 'codex') {
      return {
        kind: 'codex',
        config: codexAgentConfig ?? undefined,
      };
    }

    if (agentPreset === 'claude') {
      return {
        kind: 'claude',
        config: claudeAgentConfig ?? undefined,
      };
    }

    return {
      kind: 'mock',
    };
  }, [agentPreset, claudeAgentConfig, codexAgentConfig, customAgentConfig]);

  const initialize = React.useCallback(async (cwd: string): Promise<boolean> => {
    if (isInitializedRef.current) {
      return true;
    }

    if (!initializePromiseRef.current) {
      initializePromiseRef.current = (async () => {
        try {
          const agent = getCurrentAgentConfig();
          if (!agent) {
            setConnectionState('error');
            setLoadSessionSupported(false);
            loadSessionSupportedRef.current = false;
            isInitializedRef.current = false;
            initializePromiseRef.current = null;
            return;
          }

          setConnectionState('connecting');
          const result = await window.desktop.acpInitialize({ cwd, agent });

          setAgentName(result.agentName);
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
          setLoadSessionSupported(false);
          loadSessionSupportedRef.current = false;
          isInitializedRef.current = false;
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
    setSessionTimelines((previous) => {
      if (previous[sessionId]) {
        return previous;
      }

      return {
        ...previous,
        [sessionId]: defaultTimeline(),
      };
    });
  }, []);

  const ensureSessionForThread = React.useCallback(
    async (threadId: string, cwd: string): Promise<void> => {
      const normalizedThreadId = threadId.trim();
      const normalizedCwd = cwd.trim();
      const initialized = await initialize(normalizedCwd);
      if (!initialized) {
        return;
      }
      if (!normalizedCwd) {
        return;
      }
      const loadSupported = loadSessionSupportedRef.current;

      if (!normalizedThreadId) {
        if (activeSessionIdRef.current) {
          ensureTimelineExists(activeSessionIdRef.current);
          return;
        }

        let created: AcpSessionNewResult;
        try {
          created = await window.desktop.acpSessionNew({
            cwd: normalizedCwd,
            agent: getCurrentAgentConfig() ?? undefined,
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
              agent: getCurrentAgentConfig() ?? undefined,
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
              agent: getCurrentAgentConfig() ?? undefined,
              mcpServers: getCurrentMcpServers(),
            });

            if (result.loaded) {
              hydratedSessionIdsRef.current.add(existingSessionId);
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
        } else {
          setActiveSessionIdSafely(existingSessionId);
          ensureTimelineExists(existingSessionId);
          return;
        }

        if (activeSessionIdRef.current === existingSessionId) {
          setActiveSessionIdSafely(null);
        }

        setSessionTimelines((previous) => {
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
      }

      let created: AcpSessionNewResult;
      try {
        created = await window.desktop.acpSessionNew({
          cwd: normalizedCwd,
          agent: getCurrentAgentConfig() ?? undefined,
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
            agent: getCurrentAgentConfig() ?? undefined,
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
      getCurrentAgentConfig,
      getCurrentMcpServers,
      initialize,
      setActiveSessionIdSafely,
      threadSessionMap,
    ],
  );

  const setSessionPrompting = React.useCallback((sessionId: string, isPrompting: boolean) => {
    setSessionTimelines((previous) => {
      const current = previous[sessionId] ?? defaultTimeline();
      return {
        ...previous,
        [sessionId]: {
          ...current,
          isPrompting,
        },
      };
    });
  }, []);

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
    async (text: string, attachments: AcpPromptAttachment[] = []): Promise<void> => {
      const sessionId = activeSessionIdRef.current;
      const trimmed = text.trim();
      const normalizedAttachments = normalizePromptAttachments(attachments);

      if (!sessionId || trimmed.length === 0) {
        return;
      }

      recencyEligibleSessionIdsRef.current.add(sessionId);
      rememberThreadAttachmentHistory(sessionId, trimmed, normalizedAttachments);

      setSessionTimelines((previous) => {
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
            ),
          },
        };
      });

      try {
        const result = await window.desktop.acpPrompt({
          sessionId,
          text: trimmed,
          attachments: normalizedAttachments,
        });

        setSessionTimelines((previous) => {
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
        agent: getCurrentAgentConfig() ?? undefined,
      }),
    [getCurrentAgentConfig],
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

      if (activeSessionIdRef.current === sessionId) {
        setActiveSessionIdSafely(null);
      }

      setSessionTimelines((previous) => {
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
    },
    [setActiveSessionIdSafely],
  );

  const pendingPermission = pendingPermissions[0] ?? null;

  const activeTimeline = React.useMemo(() => {
    if (!activeSessionId) {
      return defaultTimeline();
    }

    return sessionTimelines[activeSessionId] ?? defaultTimeline();
  }, [activeSessionId, sessionTimelines]);

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

  return {
    connectionState,
    connectionMessage,
    agentName,
    agentPreset,
    codexAgentConfig,
    claudeAgentConfig,
    customAgentConfig,
    loadSessionSupported,
    activeSessionId,
    activeTimeline,
    threadPromptingById,
    threadSessionTitleById,
    threadSessionUpdatedAtById,
    activeSessionControls,
    pendingPermission,
    setAgentPreset,
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
