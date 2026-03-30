import * as React from 'react';
import {
  Bot,
  ArrowUp,
  Check,
  ChevronDown,
  Ellipsis,
  ExternalLink,
  FileText,
  GitBranch,
  GripVertical,
  Laptop,
  Loader2,
  ListTodo,
  Mic,
  Pencil,
  Plus,
  Search,
  Shield,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import { AutosizeTextarea } from '@renderer/components/ui/autosize-textarea';
import { Button } from '@renderer/components/ui/button';
import { Dialog, DialogContent } from '@renderer/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@renderer/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@renderer/components/ui/tooltip';
import { Avatar, AvatarFallback, AvatarImage } from '@renderer/components/ui/avatar';
import { cn } from '@renderer/lib/cn';
import type {
  AcpCustomAgentConfig,
  AcpPromptAudioContent,
  AcpPromptAttachment,
  AcpPromptCapabilities,
  AcpSessionConfigControl,
  AcpSessionControls,
  AcpSetSessionConfigOptionRequest,
} from '@shared/types/acp';
import type { WorkspaceGitStatusResult } from '@shared/types/workspace';
import type { AcpAgentPreset } from '@renderer/store/use-acp';

interface ComposerProps {
  workspacePath: string;
  disabled?: boolean;
  disabledMessage?: string | null;
  isPrompting?: boolean;
  prefillRequest?: {
    id: number;
    text: string;
  } | null;
  queuedPrompts?: QueuedComposerPrompt[];
  onSteerQueuedPrompt?: (queueId: string) => void;
  onRemoveQueuedPrompt?: (queueId: string) => void;
  onReorderQueuedPrompt?: (sourceQueueId: string, targetQueueId: string) => void;
  agentPreset: AcpAgentPreset;
  codexAgentConfig: AcpCustomAgentConfig | null;
  claudeAgentConfig: AcpCustomAgentConfig | null;
  customAgentConfig: AcpCustomAgentConfig | null;
  onSelectAgentPreset: (selection: AgentPresetSelection) => void;
  onSaveAgentConfig: (
    preset: 'codex' | 'claude' | 'custom',
    config: AcpCustomAgentConfig,
  ) => void;
  onSubmit: (
    value: string,
    attachments: AcpPromptAttachment[],
    audio?: AcpPromptAudioContent | null,
  ) => Promise<void>;
  promptCapabilities: AcpPromptCapabilities;
  sessionControls: AcpSessionControls | null;
  onSetSessionMode: (modeId: string) => Promise<void>;
  onSetSessionModel: (modelId: string) => Promise<void>;
  onSetSessionConfigOption: (
    request: Omit<AcpSetSessionConfigOptionRequest, 'sessionId'>,
  ) => Promise<void>;
  onShowErrorToast?: (title: string, message: string) => void;
  onCancel: () => Promise<void>;
  onOpenCommitDialog: () => void;
}

interface ComposerAttachment {
  absolutePath: string;
  displayPath: string;
  relativePath?: string;
}

interface ComposerControlOption {
  id: string;
  label: string;
  description?: string | null;
}

interface ComposerControlSelect {
  key: string;
  label: string;
  valueLabel: string;
  options: ComposerControlOption[];
  onSelect: (id: string) => void;
}

interface ComposerModeControl {
  currentId: string;
  valueLabel: string;
  options: ComposerControlOption[];
  onSelect: (id: string) => void;
}

interface QueuedComposerPrompt {
  id: string;
  text: string;
}

interface BranchSummary {
  available: boolean;
  currentBranch: string | null;
  branches: string[];
  localBranches: string[];
  remoteBranches: string[];
  uncommittedFiles: number;
  additions: number;
  deletions: number;
}

interface StoredCustomAgentEntry {
  id: string;
  label: string;
  config: AcpCustomAgentConfig;
  registryAgentId?: string;
}

interface CustomAgentOption {
  id: string;
  label: string;
  iconUrl: string | null;
  config: AcpCustomAgentConfig;
  registryAgentId?: string;
}

export interface AgentPresetSelection {
  preset: AcpAgentPreset;
  label: string;
  iconUrl: string | null;
  customConfig?: AcpCustomAgentConfig;
  customAgentId?: string;
}

interface RegistryLauncherDistribution {
  package: string;
  args?: string[];
  env?: Record<string, string>;
}

interface RegistryBinaryDistributionTarget {
  archive?: string;
  cmd?: string;
  args?: string[];
}

interface RegistryAgent {
  id: string;
  name: string;
  version?: string;
  description?: string;
  repository?: string;
  icon?: string;
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
  source: 'npx' | 'uvx' | 'binary' | 'manual';
  autoConfigurable: boolean;
  preview: string;
}

const ACP_REGISTRY_URL =
  'https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json';
const CUSTOM_AGENT_LIBRARY_KEY = 'zeroade.acp.custom-agent-library.v1';
const ACTIVE_CUSTOM_AGENT_ID_KEY = 'zeroade.acp.custom-agent-active-id.v1';

const MODE_WORD_PATTERN = /(^|[^a-z0-9])mode([^a-z0-9]|$)/;

const toModeControlHaystack = (control: AcpSessionConfigControl): string => {
  const base = `${control.id} ${control.name} ${control.category ?? ''}`.toLowerCase();

  if (control.type !== 'select') {
    return base;
  }

  const optionText = control.options
    .map((option) => `${option.id} ${option.name} ${option.description ?? ''}`)
    .join(' ')
    .toLowerCase();

  return `${base} ${optionText}`;
};

const scoreModeControl = (control: AcpSessionConfigControl): number => {
  const haystack = toModeControlHaystack(control);
  const category = control.category?.toLowerCase() ?? '';
  let score = 0;

  if (category === 'mode') {
    score += 100;
  }

  if (MODE_WORD_PATTERN.test(haystack)) {
    score += 20;
  }

  if (haystack.includes('sandbox')) {
    score += 50;
  }

  if (haystack.includes('approval')) {
    score += 35;
  }

  if (haystack.includes('permission')) {
    score += 30;
  }

  if (haystack.includes('access')) {
    score += 25;
  }

  if (haystack.includes('danger-full-access') || haystack.includes('full access')) {
    score += 60;
  }

  if (haystack.includes('workspace-write') || haystack.includes('workspace write')) {
    score += 40;
  }

  if (haystack.includes('read-only') || haystack.includes('read only')) {
    score += 35;
  }

  if (haystack.includes('restricted')) {
    score += 20;
  }

  return score;
};

const isLikelyModeControl = (control: AcpSessionConfigControl): boolean => {
  return scoreModeControl(control) > 0;
};

const getLikelyModeControl = (
  controls: AcpSessionConfigControl[],
): AcpSessionConfigControl | null => {
  const explicitModeControl =
    controls.find((control) => control.category?.toLowerCase() === 'mode') ?? null;
  if (explicitModeControl) {
    return explicitModeControl;
  }

  let bestControl: AcpSessionConfigControl | null = null;
  let bestScore = 0;

  for (const control of controls) {
    const score = scoreModeControl(control);
    if (score <= bestScore) {
      continue;
    }

    bestScore = score;
    bestControl = control;
  }

  return bestControl;
};

const hasVoiceCaptureSupport = (): boolean =>
  typeof MediaRecorder !== 'undefined' &&
  typeof window.navigator.mediaDevices?.getUserMedia === 'function';

const VOICE_VISUALIZER_DEFAULT_BAR_COUNT = 96;
const VOICE_VISUALIZER_MIN_BAR_COUNT = 40;
const VOICE_VISUALIZER_MAX_BAR_COUNT = 240;
const VOICE_VISUALIZER_BAR_WIDTH_PX = 3;
const VOICE_VISUALIZER_BAR_GAP_PX = 2;
const VOICE_VISUALIZER_IDLE_LEVEL = 0.02;
const createIdleVoiceVisualizerBars = (count: number): number[] =>
  Array.from(
    { length: Math.max(1, count) },
    () => VOICE_VISUALIZER_IDLE_LEVEL,
);

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const calculateVoiceVisualizerBarCount = (width: number): number => {
  if (!Number.isFinite(width) || width <= 0) {
    return VOICE_VISUALIZER_DEFAULT_BAR_COUNT;
  }

  const pitch = VOICE_VISUALIZER_BAR_WIDTH_PX + VOICE_VISUALIZER_BAR_GAP_PX;
  return clamp(
    Math.floor((width + VOICE_VISUALIZER_BAR_GAP_PX) / pitch),
    VOICE_VISUALIZER_MIN_BAR_COUNT,
    VOICE_VISUALIZER_MAX_BAR_COUNT,
  );
};

const formatVoiceRecordingDuration = (durationMs: number): string => {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
};

const sampleVoiceVisualizerLevel = (frequencyData: Uint8Array): number => {
  if (frequencyData.length === 0) {
    return VOICE_VISUALIZER_IDLE_LEVEL;
  }

  const focusStart = Math.floor(frequencyData.length * 0.08);
  const focusEnd = Math.max(focusStart + 1, Math.floor(frequencyData.length * 0.7));

  let peak = 0;
  let total = 0;
  let count = 0;
  for (let index = focusStart; index < focusEnd; index += 1) {
    const value = frequencyData[index] ?? 0;
    peak = Math.max(peak, value);
    total += value;
    count += 1;
  }

  const average = total / Math.max(1, count);
  const combined = average * 0.55 + peak * 0.45;
  return Math.max(
    VOICE_VISUALIZER_IDLE_LEVEL,
    Math.min(1, Math.pow(combined / 255, 0.85)),
  );
};

const getAudioContextConstructor = (): typeof AudioContext | null => {
  const audioContextConstructor =
    window.AudioContext ??
    (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

  return audioContextConstructor ?? null;
};

const getPreferredVoiceMimeType = (): string => {
  if (typeof MediaRecorder === 'undefined') {
    return '';
  }

  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
  ];

  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? '';
};

const blobToBase64 = async (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onerror = () => {
      reject(new Error('Unable to read recorded audio.'));
    };
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('Unable to read recorded audio.'));
        return;
      }

      const separatorIndex = reader.result.indexOf(',');
      resolve(separatorIndex >= 0 ? reader.result.slice(separatorIndex + 1) : reader.result);
    };

    reader.readAsDataURL(blob);
  });

const normalizePromptAudioContent = (
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

const mergeDictationText = (seed: string, dictated: string): string => {
  const normalizedDictated = dictated.replace(/\s+/g, ' ').trim();
  if (!normalizedDictated) {
    return seed;
  }

  const trimmedSeed = seed.replace(/\s+$/g, '');
  if (!trimmedSeed) {
    return normalizedDictated;
  }

  return `${trimmedSeed} ${normalizedDictated}`;
};

const FATAL_VOICE_START_ERROR_NAMES = new Set([
  'NotAllowedError',
  'PermissionDeniedError',
  'NotFoundError',
  'DevicesNotFoundError',
]);

const isFatalVoiceStartError = (error: unknown): boolean => {
  if (typeof error !== 'object' || error === null) {
    return false;
  }

  const maybeName = 'name' in error ? error.name : undefined;
  return typeof maybeName === 'string' && FATAL_VOICE_START_ERROR_NAMES.has(maybeName);
};

const toVoiceStartErrorMessage = (error: unknown): string => {
  if (typeof error !== 'object' || error === null) {
    return 'Unable to start voice input.';
  }

  const maybeName = 'name' in error ? error.name : undefined;
  if (typeof maybeName !== 'string') {
    return 'Unable to start voice input.';
  }

  if (maybeName === 'NotAllowedError' || maybeName === 'PermissionDeniedError') {
    return 'Microphone access is blocked.';
  }

  if (maybeName === 'NotFoundError' || maybeName === 'DevicesNotFoundError') {
    return 'No microphone was found.';
  }

  if (maybeName === 'NotReadableError' || maybeName === 'TrackStartError') {
    return 'Microphone is unavailable right now.';
  }

  return 'Unable to start voice input.';
};

const getVoiceInputUnavailableMessage = (): string => {
  if (!hasVoiceCaptureSupport()) {
    return 'Microphone capture is unavailable in this environment.';
  }

  return 'Voice input is unavailable in this environment.';
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

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

const toCustomAgentConfigFromUnknown = (value: unknown): AcpCustomAgentConfig | null => {
  if (!isRecord(value)) {
    return null;
  }

  const command = typeof value.command === 'string' ? value.command.trim() : '';
  if (!command) {
    return null;
  }

  const args = Array.isArray(value.args)
    ? value.args.filter(
        (entry): entry is string => typeof entry === 'string' && entry.trim().length > 0,
      )
    : [];
  const cwd =
    typeof value.cwd === 'string' && value.cwd.trim().length > 0
      ? value.cwd.trim()
      : undefined;
  const env = toStringRecord(value.env);

  return {
    command,
    args,
    cwd,
    env,
  };
};

const parseRegistryAgents = (payload: unknown): RegistryAgent[] => {
  if (!isRecord(payload) || !Array.isArray(payload.agents)) {
    return [];
  }

  const parsed: RegistryAgent[] = [];

  for (const entry of payload.agents) {
    if (!isRecord(entry)) {
      continue;
    }

    const id = typeof entry.id === 'string' ? entry.id.trim() : '';
    const name = typeof entry.name === 'string' ? entry.name.trim() : '';
    if (!id || !name) {
      continue;
    }

    const distribution = isRecord(entry.distribution) ? entry.distribution : undefined;
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

    const agent: RegistryAgent = {
      id,
      name,
      version: typeof entry.version === 'string' ? entry.version.trim() : undefined,
      description:
        typeof entry.description === 'string' ? entry.description.trim() : undefined,
      repository:
        typeof entry.repository === 'string' ? entry.repository.trim() : undefined,
      icon: typeof entry.icon === 'string' ? entry.icon.trim() : undefined,
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
    };

    parsed.push(agent);
  }

  parsed.sort((left, right) => left.name.localeCompare(right.name));

  return parsed;
};

const toCommandPreview = (command: string, args: string[]): string => {
  if (args.length === 0) {
    return command;
  }

  return `${command} ${args.join(' ')}`;
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

const toExecutableCommand = (rawCommand: string): string => {
  const trimmed = rawCommand.trim();
  if (!trimmed) {
    return '';
  }

  if (/^[.][\\/]/.test(trimmed)) {
    const withoutPrefix = trimmed.replace(/^[.][\\/]+/, '');
    const segments = withoutPrefix.split(/[\\/]/).filter(Boolean);
    return segments.at(-1) ?? withoutPrefix;
  }

  return trimmed;
};

const isLikelyRunnableCommand = (value: string): boolean => {
  if (!value) {
    return false;
  }

  // Allow executable names, absolute paths, and explicit relative paths (./foo).
  if (/^[.]{1,2}[\\/]/.test(value)) {
    return true;
  }

  const hasPathSeparator = /[\\/]/.test(value);
  const looksAbsolute = /^([A-Za-z]:[\\/]|\/)/.test(value);
  return !hasPathSeparator || looksAbsolute;
};

const toNormalizedCommandToken = (value: string): string =>
  toExecutableCommand(value)
    .split(/[\\/]/)
    .filter(Boolean)
    .at(-1)
    ?.replace(/\.exe$/i, '')
    .toLowerCase() ?? '';

const toNormalizedArgsList = (args: string[]): string[] =>
  args.map((entry) => entry.trim()).filter((entry) => entry.length > 0);

const isArgsPrefixCompatible = (left: string[], right: string[]): boolean => {
  if (left.length === 0 || right.length === 0) {
    return true;
  }

  const shorter = left.length <= right.length ? left : right;
  const longer = left.length <= right.length ? right : left;
  return shorter.every((entry, index) => longer[index] === entry);
};

const KNOWN_CUSTOM_AGENT_LABEL_BY_COMMAND: Record<string, string> = {
  opencode: 'OpenCode',
};

const toKnownCustomAgentLabel = (command: string | undefined): string | null => {
  if (!command) {
    return null;
  }

  const token = toNormalizedCommandToken(command);
  if (!token) {
    return null;
  }

  return KNOWN_CUSTOM_AGENT_LABEL_BY_COMMAND[token] ?? null;
};

const normalizeCustomAgentConfig = (
  config: AcpCustomAgentConfig,
): AcpCustomAgentConfig | null =>
  toCustomAgentConfigFromUnknown(config);

const toCustomAgentConfigSignature = (config: AcpCustomAgentConfig): string =>
  JSON.stringify({
    command: config.command.trim(),
    args: config.args.map((entry) => entry.trim()).filter((entry) => entry.length > 0),
    cwd: config.cwd?.trim() ?? '',
    env: Object.entries(config.env ?? {})
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => [key, value]),
  });

const readStoredCustomAgents = (): StoredCustomAgentEntry[] => {
  const raw = window.localStorage.getItem(CUSTOM_AGENT_LIBRARY_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    const entries: StoredCustomAgentEntry[] = [];
    for (const item of parsed) {
      if (!isRecord(item)) {
        continue;
      }

      const id = typeof item.id === 'string' ? item.id.trim() : '';
      const label = typeof item.label === 'string' ? item.label.trim() : '';
      const config = toCustomAgentConfigFromUnknown(item.config);
      if (!id || !config) {
        continue;
      }

      entries.push({
        id,
        label: label || id,
        config,
        registryAgentId:
          typeof item.registryAgentId === 'string' && item.registryAgentId.trim().length > 0
            ? item.registryAgentId.trim()
            : undefined,
      });
    }

    return entries;
  } catch {
    return [];
  }
};

const readStoredActiveCustomAgentId = (): string | null => {
  const raw = window.localStorage.getItem(ACTIVE_CUSTOM_AGENT_ID_KEY);
  if (!raw) {
    return null;
  }

  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const nextStoredCustomAgentId = (): string =>
  `custom-agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const toDefaultCustomAgentLabel = (config: AcpCustomAgentConfig): string => {
  const knownLabel = toKnownCustomAgentLabel(config.command);
  if (knownLabel) {
    return knownLabel;
  }

  const executableCommand = toExecutableCommand(config.command);
  const commandBaseName = executableCommand.split(/[\\/]/).filter(Boolean).at(-1);
  return commandBaseName ?? 'Added agent';
};

const toRegistryLaunchTemplate = (
  agent: RegistryAgent,
  platform: NodeJS.Platform,
): RegistryLaunchTemplate => {
  const npxDistribution = agent.distribution?.npx;
  if (npxDistribution?.package) {
    const args = ['-y', npxDistribution.package, ...(npxDistribution.args ?? [])];
    return {
      command: 'npx',
      args,
      env: npxDistribution.env,
      source: 'npx',
      autoConfigurable: true,
      preview: toCommandPreview('npx', args),
    };
  }

  const uvxDistribution = agent.distribution?.uvx;
  if (uvxDistribution?.package) {
    const args = [uvxDistribution.package, ...(uvxDistribution.args ?? [])];
    return {
      command: 'uvx',
      args,
      env: uvxDistribution.env,
      source: 'uvx',
      autoConfigurable: true,
      preview: toCommandPreview('uvx', args),
    };
  }

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

  if (binaryCommand) {
    return {
      command: binaryCommand,
      args: binaryArgs,
      source: 'binary',
      autoConfigurable: isLikelyRunnableCommand(binaryCommand),
      preview: toCommandPreview(binaryCommand, binaryArgs),
    };
  }

  return {
    command: '',
    args: [],
    source: 'manual',
    autoConfigurable: false,
    preview: 'Manual setup required',
  };
};

const matchesRegistryTemplate = (
  agent: RegistryAgent,
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
    toNormalizedCommandToken(template.command) === toNormalizedCommandToken(configCommand);
  if (!commandMatches) {
    return false;
  }

  const templateArgs = toNormalizedArgsList(template.args);
  const configArgs = toNormalizedArgsList(config.args ?? []);
  return isArgsPrefixCompatible(templateArgs, configArgs);
};

const DEFAULT_BRANCH_SUMMARY: BranchSummary = {
  available: false,
  currentBranch: null,
  branches: [],
  localBranches: [],
  remoteBranches: [],
  uncommittedFiles: 0,
  additions: 0,
  deletions: 0,
};

const toBranchSummary = (result: WorkspaceGitStatusResult): BranchSummary => ({
  available: result.available,
  currentBranch: result.currentBranch,
  branches: result.branches,
  localBranches: result.localBranches,
  remoteBranches: result.remoteBranches,
  uncommittedFiles: result.uncommittedFiles,
  additions: result.additions,
  deletions: result.deletions,
});

const formatFileCount = (count: number): string => `${count.toLocaleString()} file${count === 1 ? '' : 's'}`;

export const Composer = ({
  workspacePath,
  disabled = false,
  disabledMessage = null,
  isPrompting = false,
  prefillRequest = null,
  queuedPrompts = [],
  onSteerQueuedPrompt,
  onRemoveQueuedPrompt,
  onReorderQueuedPrompt,
  agentPreset,
  codexAgentConfig,
  claudeAgentConfig,
  customAgentConfig,
  onSelectAgentPreset,
  onSaveAgentConfig,
  onSubmit,
  promptCapabilities,
  sessionControls,
  onSetSessionMode,
  onSetSessionModel,
  onSetSessionConfigOption,
  onShowErrorToast,
  onCancel,
  onOpenCommitDialog,
}: ComposerProps): JSX.Element => {
  const currentPlatform = window.desktop?.platform ?? 'darwin';
  const [message, setMessage] = React.useState('');
  const [attachments, setAttachments] = React.useState<ComposerAttachment[]>([]);
  const [isAgentMenuOpen, setIsAgentMenuOpen] = React.useState(false);
  const [isAgentDialogOpen, setIsAgentDialogOpen] = React.useState(false);
  const [isRegistryDialogOpen, setIsRegistryDialogOpen] = React.useState(false);
  const [isRegistryLoading, setIsRegistryLoading] = React.useState(false);
  const [registryError, setRegistryError] = React.useState<string | null>(null);
  const [registryAgents, setRegistryAgents] = React.useState<RegistryAgent[]>([]);
  const [storedCustomAgents, setStoredCustomAgents] = React.useState<StoredCustomAgentEntry[]>(
    () => readStoredCustomAgents(),
  );
  const [activeCustomAgentId, setActiveCustomAgentId] = React.useState<string | null>(() =>
    readStoredActiveCustomAgentId(),
  );
  const [isBranchMenuOpen, setIsBranchMenuOpen] = React.useState(false);
  const [branchSearch, setBranchSearch] = React.useState('');
  const [branchSummary, setBranchSummary] = React.useState<BranchSummary>(
    DEFAULT_BRANCH_SUMMARY,
  );
  const [branchError, setBranchError] = React.useState<string | null>(null);
  const [isBranchLoading, setIsBranchLoading] = React.useState(false);
  const [isBranchUpdating, setIsBranchUpdating] = React.useState(false);
  const [editingAgentPreset, setEditingAgentPreset] = React.useState<
    'codex' | 'claude' | 'custom'
  >('custom');
  const [editingCustomAgentId, setEditingCustomAgentId] =
    React.useState<string>('new');
  const [isDropTargetActive, setIsDropTargetActive] = React.useState(false);
  const [customCommand, setCustomCommand] = React.useState(
    customAgentConfig?.command ?? '',
  );
  const [customArgs, setCustomArgs] = React.useState(
    customAgentConfig?.args.join(' ') ?? '',
  );
  const [customCwd, setCustomCwd] = React.useState(customAgentConfig?.cwd ?? '');
  const [customEnv, setCustomEnv] = React.useState(
    customAgentConfig?.env
      ? Object.entries(customAgentConfig.env)
          .map(([key, value]) => `${key}=${value}`)
          .join('\n')
      : '',
  );
  const [isDictating, setIsDictating] = React.useState(false);
  const [isVoiceProcessing, setIsVoiceProcessing] = React.useState(false);
  const [isDictationModeEnabled, setIsDictationModeEnabled] = React.useState(false);
  const [voiceError, setVoiceError] = React.useState<string | null>(null);
  const [pendingVoicePrompt, setPendingVoicePrompt] =
    React.useState<AcpPromptAudioContent | null>(null);
  const [recordingDurationMs, setRecordingDurationMs] = React.useState(0);
  const [voiceVisualizerBars, setVoiceVisualizerBars] = React.useState<number[]>(
    () => createIdleVoiceVisualizerBars(VOICE_VISUALIZER_DEFAULT_BAR_COUNT),
  );
  const [draggingQueuedPromptId, setDraggingQueuedPromptId] = React.useState<string | null>(null);
  const [dragOverQueuedPromptId, setDragOverQueuedPromptId] = React.useState<string | null>(null);
  const messageInputRef = React.useRef<HTMLTextAreaElement | null>(null);
  const mediaRecorderRef = React.useRef<MediaRecorder | null>(null);
  const mediaStreamRef = React.useRef<MediaStream | null>(null);
  const recordedVoiceChunksRef = React.useRef<Blob[]>([]);
  const shouldTranscribeOnStopRef = React.useRef(true);
  const submitAfterDictationRef = React.useRef(false);
  const dictationModeEnabledRef = React.useRef(false);
  const shortcutDictationActiveRef = React.useRef(false);
  const toggleDictationActiveRef = React.useRef(false);
  const lastAppliedPrefillRequestIdRef = React.useRef<number | null>(null);
  const audioContextRef = React.useRef<AudioContext | null>(null);
  const analyserRef = React.useRef<AnalyserNode | null>(null);
  const analyserSourceRef = React.useRef<MediaStreamAudioSourceNode | null>(null);
  const analyserDataRef = React.useRef<Uint8Array | null>(null);
  const voiceMeterIntervalRef = React.useRef<number | null>(null);
  const recordingStartedAtRef = React.useRef<number | null>(null);
  const voiceVisualizerTrackRef = React.useRef<HTMLDivElement | null>(null);
  const voiceVisualizerBarCountRef = React.useRef(VOICE_VISUALIZER_DEFAULT_BAR_COUNT);
  const previousVoiceErrorRef = React.useRef<string | null>(null);

  const canSend = !disabled && (message.trim().length > 0 || pendingVoicePrompt !== null);

  const setDictationModeEnabled = React.useCallback((enabled: boolean): void => {
    dictationModeEnabledRef.current = enabled;
    setIsDictationModeEnabled(enabled);
  }, []);

  React.useEffect(() => {
    if (!prefillRequest) {
      return;
    }

    if (lastAppliedPrefillRequestIdRef.current === prefillRequest.id) {
      return;
    }

    lastAppliedPrefillRequestIdRef.current = prefillRequest.id;
    setMessage(prefillRequest.text);

    window.requestAnimationFrame(() => {
      const textarea = messageInputRef.current;
      if (!textarea || textarea.disabled) {
        return;
      }

      textarea.focus();
      const cursorPosition = prefillRequest.text.length;
      textarea.setSelectionRange(cursorPosition, cursorPosition);
    });
  }, [prefillRequest]);

  const hasWorkspace = workspacePath.trim().length > 0 && workspacePath !== '/';
  const isVoiceInputSupported = React.useMemo(
    () => hasVoiceCaptureSupport(),
    [],
  );
  const supportsAcpAudioPrompt = promptCapabilities.audio === true;
  const isVoiceRecordingSurfaceVisible = isDictationModeEnabled || isVoiceProcessing;
  const voiceInputUnavailableMessage = React.useMemo(
    () => getVoiceInputUnavailableMessage(),
    [],
  );
  const codexRegistryAgent = React.useMemo(
    () => registryAgents.find((agent) => agent.id === 'codex-acp') ?? null,
    [registryAgents],
  );
  const claudeRegistryAgent = React.useMemo(
    () => registryAgents.find((agent) => agent.id === 'claude-acp') ?? null,
    [registryAgents],
  );
  const customRegistryAgent = React.useMemo(
    () =>
      registryAgents.find((agent) =>
        matchesRegistryTemplate(agent, customAgentConfig, currentPlatform),
      ) ?? null,
    [currentPlatform, customAgentConfig, registryAgents],
  );
  const customAgentOptions = React.useMemo<CustomAgentOption[]>(() => {
    return storedCustomAgents
      .map((entry) => {
        const normalizedConfig = normalizeCustomAgentConfig(entry.config);
        if (!normalizedConfig) {
          return null;
        }

        const registryMatch =
          registryAgents.find((agent) =>
            matchesRegistryTemplate(agent, normalizedConfig, currentPlatform),
          ) ?? null;
        const knownLabel = toKnownCustomAgentLabel(normalizedConfig.command);
        const executableCommand = toExecutableCommand(normalizedConfig.command);
        const commandBaseName = executableCommand.split(/[\\/]/).filter(Boolean).at(-1);
        const fallbackLabel = knownLabel ?? commandBaseName ?? 'Added agent';
        const storedLabel = entry.label.trim();

        return {
          id: entry.id,
          label: registryMatch?.name ?? (storedLabel || fallbackLabel),
          iconUrl: registryMatch?.icon ?? null,
          config: normalizedConfig,
          registryAgentId: registryMatch?.id ?? entry.registryAgentId,
        };
      })
      .filter((entry): entry is CustomAgentOption => entry !== null);
  }, [currentPlatform, registryAgents, storedCustomAgents]);
  const activeCustomConfigSignature = React.useMemo(
    () => (customAgentConfig ? toCustomAgentConfigSignature(customAgentConfig) : null),
    [customAgentConfig],
  );
  const activeCustomAgentOption = React.useMemo(() => {
    if (!activeCustomConfigSignature) {
      return null;
    }

    return (
      customAgentOptions.find(
        (entry) =>
          toCustomAgentConfigSignature(entry.config) === activeCustomConfigSignature,
      ) ?? null
    );
  }, [activeCustomConfigSignature, customAgentOptions]);
  const activeAgentIconUrl =
    agentPreset === 'codex'
      ? (codexRegistryAgent?.icon ?? null)
      : agentPreset === 'claude'
        ? (claudeRegistryAgent?.icon ?? null)
        : agentPreset === 'custom'
          ? (activeCustomAgentOption?.iconUrl ?? customRegistryAgent?.icon ?? null)
        : null;
  const branchLabel = branchSummary.currentBranch ?? (branchSummary.available ? 'detached' : 'No repo');
  const normalizedBranchSearch = branchSearch.trim().toLowerCase();
  const filteredLocalBranches = React.useMemo(
    () =>
      branchSummary.localBranches.filter((branch) =>
        branch.toLowerCase().includes(normalizedBranchSearch),
      ),
    [branchSummary.localBranches, normalizedBranchSearch],
  );
  const filteredRemoteBranches = React.useMemo(
    () =>
      branchSummary.remoteBranches.filter((branch) =>
        branch.toLowerCase().includes(normalizedBranchSearch),
      ),
    [branchSummary.remoteBranches, normalizedBranchSearch],
  );
  const createBranchCandidate = branchSearch.trim();
  const createBranchExists = branchSummary.localBranches.some(
    (branch) => branch.toLowerCase() === createBranchCandidate.toLowerCase(),
  );
  const canCreateBranch = createBranchCandidate.length > 0 && !createBranchExists;

  const loadBranchSummary = React.useCallback(async (): Promise<void> => {
    if (!hasWorkspace) {
      setBranchSummary(DEFAULT_BRANCH_SUMMARY);
      setBranchError(null);
      setIsBranchLoading(false);
      return;
    }

    setIsBranchLoading(true);
    setBranchError(null);

    try {
      const result = await window.desktop.workspaceGitStatus({
        workspacePath,
      });

      setBranchSummary(toBranchSummary(result));
      if (!result.available) {
        setBranchError('Current project is not a git repository.');
      }
    } catch (error: unknown) {
      const rawMessage = error instanceof Error ? error.message : '';
      const isIntegrationMismatch =
        rawMessage.includes('No handler registered') || rawMessage.includes('is not a function');

      setBranchSummary(DEFAULT_BRANCH_SUMMARY);
      setBranchError(
        isIntegrationMismatch
          ? 'Git integration updated. Restart the app once.'
          : 'Unable to load branches.',
      );
    } finally {
      setIsBranchLoading(false);
    }
  }, [hasWorkspace, workspacePath]);

  const checkoutBranch = React.useCallback(
    async (branchName: string): Promise<void> => {
      if (!hasWorkspace || !branchSummary.available || isBranchUpdating) {
        return;
      }

      const targetBranch = branchName.trim();
      if (!targetBranch || targetBranch === branchSummary.currentBranch) {
        return;
      }

      setIsBranchUpdating(true);
      setBranchError(null);

      try {
        const result = await window.desktop.workspaceGitCheckoutBranch({
          workspacePath,
          branchName: targetBranch,
        });

        if (!result.ok) {
          setBranchError(result.error ?? `Failed to checkout "${targetBranch}".`);
          return;
        }

        await loadBranchSummary();
        setIsBranchMenuOpen(false);
        setBranchSearch('');
      } catch {
        setBranchError(`Failed to checkout "${targetBranch}".`);
      } finally {
        setIsBranchUpdating(false);
      }
    },
    [
      branchSummary.available,
      branchSummary.currentBranch,
      hasWorkspace,
      isBranchUpdating,
      loadBranchSummary,
      workspacePath,
    ],
  );

  const createAndCheckoutBranch = React.useCallback(
    async (rawBranchName: string): Promise<void> => {
      if (!hasWorkspace || !branchSummary.available || isBranchUpdating) {
        return;
      }

      const nextBranchName = rawBranchName.trim();
      if (!nextBranchName) {
        return;
      }

      setIsBranchUpdating(true);
      setBranchError(null);

      try {
        const result = await window.desktop.workspaceGitCreateBranch({
          workspacePath,
          branchName: nextBranchName,
        });

        if (!result.ok) {
          setBranchError(result.error ?? `Failed to create "${nextBranchName}".`);
          return;
        }

        await loadBranchSummary();
        setIsBranchMenuOpen(false);
        setBranchSearch('');
      } catch {
        setBranchError(`Failed to create "${nextBranchName}".`);
      } finally {
        setIsBranchUpdating(false);
      }
    },
    [branchSummary.available, hasWorkspace, isBranchUpdating, loadBranchSummary, workspacePath],
  );

  const handleCreateBranch = React.useCallback(() => {
    const typedName = createBranchCandidate.trim();
    if (typedName.length > 0) {
      void createAndCheckoutBranch(typedName);
      return;
    }

    const prompted = window.prompt('Create and checkout new branch', '');
    if (prompted === null) {
      return;
    }

    const promptedName = prompted.trim();
    if (!promptedName) {
      return;
    }

    void createAndCheckoutBranch(promptedName);
  }, [createAndCheckoutBranch, createBranchCandidate]);

  const loadRegistryAgents = React.useCallback(async (): Promise<void> => {
    setIsRegistryLoading(true);
    setRegistryError(null);

    try {
      const response = await fetch(ACP_REGISTRY_URL, {
        method: 'GET',
        cache: 'no-store',
      });

      if (!response.ok) {
        throw new Error(`Registry request failed with ${response.status}`);
      }

      const payload = (await response.json()) as unknown;
      const nextAgents = parseRegistryAgents(payload);
      if (nextAgents.length === 0) {
        throw new Error('Registry returned no agents');
      }

      setRegistryAgents(nextAgents);
    } catch {
      setRegistryError('Unable to load ACP registry right now.');
    } finally {
      setIsRegistryLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (supportsAcpAudioPrompt || pendingVoicePrompt === null) {
      return;
    }

    setPendingVoicePrompt(null);
    setVoiceError('Voice prompt cleared because the active agent does not accept audio input.');
  }, [pendingVoicePrompt, supportsAcpAudioPrompt]);

  React.useEffect(() => {
    if (!voiceError) {
      previousVoiceErrorRef.current = null;
      return;
    }

    if (previousVoiceErrorRef.current === voiceError) {
      return;
    }

    previousVoiceErrorRef.current = voiceError;
    onShowErrorToast?.('Voice input', voiceError);
  }, [onShowErrorToast, voiceError]);

  React.useEffect(() => {
    if (!isVoiceRecordingSurfaceVisible) {
      return;
    }

    const track = voiceVisualizerTrackRef.current;
    if (!track) {
      return;
    }

    const syncVoiceVisualizerWidth = (): void => {
      const nextCount = calculateVoiceVisualizerBarCount(track.clientWidth);
      voiceVisualizerBarCountRef.current = nextCount;
      setVoiceVisualizerBars((current) => {
        if (current.length === nextCount) {
          return current;
        }

        const recent = current.slice(-nextCount);
        if (recent.length === nextCount) {
          return recent;
        }

        return createIdleVoiceVisualizerBars(nextCount - recent.length).concat(recent);
      });
    };

    syncVoiceVisualizerWidth();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', syncVoiceVisualizerWidth);
      return () => {
        window.removeEventListener('resize', syncVoiceVisualizerWidth);
      };
    }

    const resizeObserver = new ResizeObserver(() => {
      syncVoiceVisualizerWidth();
    });
    resizeObserver.observe(track);

    return () => {
      resizeObserver.disconnect();
    };
  }, [isVoiceRecordingSurfaceVisible]);

  const releaseVoiceMeter = React.useCallback(() => {
    if (voiceMeterIntervalRef.current !== null) {
      window.clearInterval(voiceMeterIntervalRef.current);
      voiceMeterIntervalRef.current = null;
    }

    analyserSourceRef.current?.disconnect();
    analyserSourceRef.current = null;

    analyserRef.current?.disconnect();
    analyserRef.current = null;
    analyserDataRef.current = null;

    const audioContext = audioContextRef.current;
    audioContextRef.current = null;
    if (audioContext) {
      void audioContext.close().catch(() => undefined);
    }

    recordingStartedAtRef.current = null;
    setRecordingDurationMs(0);
    setVoiceVisualizerBars(createIdleVoiceVisualizerBars(voiceVisualizerBarCountRef.current));
  }, []);

  const startVoiceMeter = React.useCallback((stream: MediaStream): void => {
    releaseVoiceMeter();

    recordingStartedAtRef.current = window.performance.now();
    setRecordingDurationMs(0);
    setVoiceVisualizerBars(createIdleVoiceVisualizerBars(voiceVisualizerBarCountRef.current));

    const AudioContextConstructor = getAudioContextConstructor();
    if (!AudioContextConstructor) {
      voiceMeterIntervalRef.current = window.setInterval(() => {
        if (recordingStartedAtRef.current === null) {
          return;
        }

        setRecordingDurationMs(window.performance.now() - recordingStartedAtRef.current);
      }, 100);
      return;
    }

    try {
      const audioContext = new AudioContextConstructor();
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 128;
      analyser.smoothingTimeConstant = 0.84;

      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);

      audioContextRef.current = audioContext;
      analyserRef.current = analyser;
      analyserSourceRef.current = source;
      analyserDataRef.current = new Uint8Array(analyser.frequencyBinCount);

      if (audioContext.state === 'suspended') {
        void audioContext.resume().catch(() => undefined);
      }

      voiceMeterIntervalRef.current = window.setInterval(() => {
        if (recordingStartedAtRef.current !== null) {
          setRecordingDurationMs(window.performance.now() - recordingStartedAtRef.current);
        }

        const currentAnalyser = analyserRef.current;
        const currentData = analyserDataRef.current;
        if (!currentAnalyser || !currentData) {
          return;
        }

        currentAnalyser.getByteFrequencyData(currentData);
        const nextLevel = sampleVoiceVisualizerLevel(currentData);
        setVoiceVisualizerBars((current) =>
          current.slice(1).concat(
            Math.max(
              nextLevel,
              (current[current.length - 1] ?? VOICE_VISUALIZER_IDLE_LEVEL) * 0.72,
            ),
          ),
        );
      }, 60);
    } catch {
      voiceMeterIntervalRef.current = window.setInterval(() => {
        if (recordingStartedAtRef.current === null) {
          return;
        }

        setRecordingDurationMs(window.performance.now() - recordingStartedAtRef.current);
      }, 100);
    }
  }, [releaseVoiceMeter]);

  const releaseVoiceCapture = React.useCallback(() => {
    releaseVoiceMeter();
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
    mediaRecorderRef.current = null;
  }, [releaseVoiceMeter]);

  const processRecordedAudio = React.useCallback(
    async (audioBlob: Blob): Promise<void> => {
      try {
        const audioBase64 = await blobToBase64(audioBlob);
        const audioContent = normalizePromptAudioContent({
          data: audioBase64,
          mimeType: audioBlob.type || 'audio/webm',
        });

        if (!audioContent) {
          setVoiceError('Voice input failed. Try again.');
          return;
        }

        if (supportsAcpAudioPrompt) {
          setPendingVoicePrompt(audioContent);
          setVoiceError(null);
          return;
        }

        const result = await window.desktop.voiceTranscribe({
          audioBase64: audioContent.data,
          mimeType: audioContent.mimeType,
        });

        if (!result.ok) {
          setVoiceError(result.error ?? 'Voice input failed. Try again.');
          return;
        }

        setVoiceError(null);
        setMessage((current) => mergeDictationText(current, result.text));
      } catch {
        setVoiceError('Voice input failed. Try again.');
      } finally {
        setIsVoiceProcessing(false);
      }
    },
    [supportsAcpAudioPrompt],
  );

  const stopDictation = React.useCallback(
    ({ discard = false }: { discard?: boolean } = {}) => {
      shouldTranscribeOnStopRef.current = !discard;
      setDictationModeEnabled(false);

      const recorder = mediaRecorderRef.current;
      if (!recorder) {
        setIsDictating(false);
        releaseVoiceCapture();
        return;
      }

      if (recorder.state === 'inactive') {
        setIsDictating(false);
        releaseVoiceCapture();
        return;
      }

      try {
        recorder.stop();
      } catch {
        setIsDictating(false);
        releaseVoiceCapture();
      }
    },
    [releaseVoiceCapture, setDictationModeEnabled],
  );

  const startDictation = React.useCallback(async (): Promise<boolean> => {
    if (disabled || isPrompting || !isVoiceInputSupported || isVoiceProcessing) {
      return false;
    }

    if (mediaRecorderRef.current) {
      return true;
    }

    setVoiceError(null);
    shouldTranscribeOnStopRef.current = true;

    let stream: MediaStream;
    try {
      stream = await window.navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (error: unknown) {
      if (isFatalVoiceStartError(error)) {
        toggleDictationActiveRef.current = false;
        shortcutDictationActiveRef.current = false;
        setDictationModeEnabled(false);
      }
      setVoiceError(toVoiceStartErrorMessage(error));
      return false;
    }

    try {
      const preferredMimeType = getPreferredVoiceMimeType();
      const recorder = preferredMimeType
        ? new MediaRecorder(stream, { mimeType: preferredMimeType })
        : new MediaRecorder(stream);

      mediaStreamRef.current = stream;
      mediaRecorderRef.current = recorder;
      recordedVoiceChunksRef.current = [];
      startVoiceMeter(stream);

      recorder.onstart = () => {
        setIsDictating(true);
      };
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          recordedVoiceChunksRef.current.push(event.data);
        }
      };
      recorder.onerror = () => {
        recordedVoiceChunksRef.current = [];
        setIsDictating(false);
        setDictationModeEnabled(false);
        setVoiceError('Voice recording failed. Try again.');
        releaseVoiceCapture();
      };
      recorder.onstop = () => {
        const shouldTranscribe = shouldTranscribeOnStopRef.current;
        shouldTranscribeOnStopRef.current = true;

        const recordedChunks = recordedVoiceChunksRef.current;
        recordedVoiceChunksRef.current = [];
        const mimeType = recorder.mimeType || preferredMimeType || 'audio/webm';

        setIsDictating(false);
        releaseVoiceCapture();

        if (!shouldTranscribe) {
          return;
        }

        if (recordedChunks.length === 0) {
          setVoiceError('No audio was captured.');
          return;
        }

        setIsVoiceProcessing(true);
        void processRecordedAudio(new Blob(recordedChunks, { type: mimeType }));
      };

      recorder.start(250);
      return true;
    } catch {
      stream.getTracks().forEach((track) => track.stop());
      releaseVoiceCapture();
      setVoiceError(voiceInputUnavailableMessage);
      return false;
    }
  }, [
    disabled,
    isPrompting,
    isVoiceInputSupported,
    isVoiceProcessing,
    processRecordedAudio,
    releaseVoiceCapture,
    startVoiceMeter,
    setDictationModeEnabled,
    voiceInputUnavailableMessage,
  ]);

  const beginDictation = React.useCallback(
    (source: 'toggle' | 'shortcut') => {
      submitAfterDictationRef.current = false;
      toggleDictationActiveRef.current = source === 'toggle';
      shortcutDictationActiveRef.current = source === 'shortcut';
      setDictationModeEnabled(true);
      void startDictation().then((started) => {
        if (started) {
          return;
        }

        toggleDictationActiveRef.current = false;
        shortcutDictationActiveRef.current = false;
        setDictationModeEnabled(false);
      });
    },
    [setDictationModeEnabled, startDictation],
  );

  const endDictation = React.useCallback(
    ({ discard = false }: { discard?: boolean } = {}) => {
      submitAfterDictationRef.current = false;
      toggleDictationActiveRef.current = false;
      shortcutDictationActiveRef.current = false;
      setDictationModeEnabled(false);
      stopDictation({ discard });
    },
    [setDictationModeEnabled, stopDictation],
  );

  React.useEffect(() => {
    return () => {
      endDictation({ discard: true });
    };
  }, [endDictation]);

  React.useEffect(() => {
    if (!disabled && !isPrompting) {
      return;
    }

    endDictation({ discard: true });
  }, [disabled, endDictation, isPrompting]);

  React.useEffect(() => {
    if (!isVoiceInputSupported) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (
        event.repeat ||
        event.key.toLowerCase() !== 'm' ||
        !event.ctrlKey ||
        event.metaKey ||
        event.altKey
      ) {
        return;
      }

      event.preventDefault();
      if (isDictationModeEnabled) {
        endDictation();
        return;
      }

      if (disabled || isVoiceProcessing) {
        return;
      }

      beginDictation('shortcut');
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [
    beginDictation,
    disabled,
    endDictation,
    isDictationModeEnabled,
    isVoiceInputSupported,
    isVoiceProcessing,
  ]);

  React.useEffect(() => {
    void loadRegistryAgents();
  }, [loadRegistryAgents]);

  React.useEffect(() => {
    void loadBranchSummary();
  }, [loadBranchSummary]);

  React.useEffect(() => {
    if (!isBranchMenuOpen) {
      setBranchSearch('');
      return;
    }

    void loadBranchSummary();
  }, [isBranchMenuOpen, loadBranchSummary]);

  React.useEffect(() => {
    setAttachments([]);
  }, [workspacePath]);

  React.useEffect(() => {
    const serialized = JSON.stringify(storedCustomAgents);
    if (storedCustomAgents.length === 0) {
      window.localStorage.removeItem(CUSTOM_AGENT_LIBRARY_KEY);
      return;
    }

    window.localStorage.setItem(CUSTOM_AGENT_LIBRARY_KEY, serialized);
  }, [storedCustomAgents]);

  React.useEffect(() => {
    if (!activeCustomAgentId) {
      window.localStorage.removeItem(ACTIVE_CUSTOM_AGENT_ID_KEY);
      return;
    }

    window.localStorage.setItem(ACTIVE_CUSTOM_AGENT_ID_KEY, activeCustomAgentId);
  }, [activeCustomAgentId]);

  React.useEffect(() => {
    if (!activeCustomAgentId) {
      return;
    }

    if (storedCustomAgents.some((entry) => entry.id === activeCustomAgentId)) {
      return;
    }

    setActiveCustomAgentId(storedCustomAgents[0]?.id ?? null);
  }, [activeCustomAgentId, storedCustomAgents]);

  React.useEffect(() => {
    if (!customAgentConfig) {
      return;
    }

    const normalizedConfig = normalizeCustomAgentConfig(customAgentConfig);
    if (!normalizedConfig) {
      return;
    }

    const currentSignature = toCustomAgentConfigSignature(normalizedConfig);
    const existing = storedCustomAgents.find(
      (entry) =>
        toCustomAgentConfigSignature(entry.config) === currentSignature,
    );
    if (existing) {
      if (activeCustomAgentId !== existing.id) {
        setActiveCustomAgentId(existing.id);
      }
      return;
    }

    const nextEntry: StoredCustomAgentEntry = {
      id: nextStoredCustomAgentId(),
      label: toDefaultCustomAgentLabel(normalizedConfig),
      config: normalizedConfig,
    };

    setStoredCustomAgents((previous) => [...previous, nextEntry]);
    setActiveCustomAgentId(nextEntry.id);
  }, [activeCustomAgentId, customAgentConfig, storedCustomAgents]);

  React.useEffect(() => {
    if (!isAgentDialogOpen) {
      return;
    }

    const customEntry = storedCustomAgents.find(
      (entry) => entry.id === editingCustomAgentId,
    );
    const presetConfig =
      editingAgentPreset === 'codex'
        ? codexAgentConfig
        : editingAgentPreset === 'claude'
          ? claudeAgentConfig
          : editingCustomAgentId === 'new'
            ? null
            : customEntry?.config ?? customAgentConfig;

    const fallbackCommand =
      editingAgentPreset === 'codex'
        ? 'codex-acp'
        : editingAgentPreset === 'claude'
          ? 'claude-agent-acp'
          : '';
    const initialConfig = presetConfig ?? { command: fallbackCommand, args: [] };

    setCustomCommand(initialConfig.command ?? '');
    setCustomArgs((initialConfig.args ?? []).join(' '));
    setCustomCwd(initialConfig.cwd ?? '');
    setCustomEnv(
      initialConfig.env
        ? Object.entries(initialConfig.env)
            .map(([key, value]) => `${key}=${value}`)
            .join('\n')
        : '',
    );
  }, [
    claudeAgentConfig,
    codexAgentConfig,
    customAgentConfig,
    editingCustomAgentId,
    editingAgentPreset,
    isAgentDialogOpen,
    storedCustomAgents,
  ]);

  React.useEffect(() => {
    if (!customAgentConfig || !customRegistryAgent) {
      return;
    }

    const template = toRegistryLaunchTemplate(customRegistryAgent, currentPlatform);
    if (!template.autoConfigurable) {
      return;
    }

    const currentCommand = customAgentConfig.command.trim();
    const commandMatches =
      toNormalizedCommandToken(template.command) === toNormalizedCommandToken(currentCommand);
    if (!commandMatches) {
      return;
    }

    const templateIsRelative = /^[.]{1,2}[\\/]/.test(template.command);
    const currentIsRelative = /^[.]{1,2}[\\/]/.test(currentCommand);
    const nextCommand =
      templateIsRelative && !currentIsRelative ? template.command : currentCommand;
    const nextArgs =
      (customAgentConfig.args?.length ?? 0) === 0 && template.args.length > 0
        ? template.args
        : customAgentConfig.args;

    if (nextCommand === currentCommand && nextArgs === customAgentConfig.args) {
      return;
    }

    onSaveAgentConfig('custom', {
      ...customAgentConfig,
      command: nextCommand,
      args: nextArgs,
    });
  }, [currentPlatform, customAgentConfig, customRegistryAgent, onSaveAgentConfig]);

  const mergeAttachments = React.useCallback((nextItems: ComposerAttachment[]) => {
    if (nextItems.length === 0) {
      return;
    }

    setAttachments((previous) => {
      const byPath = new Map(previous.map((item) => [item.absolutePath, item]));
      for (const item of nextItems) {
        byPath.set(item.absolutePath, item);
      }
      return Array.from(byPath.values());
    });
  }, []);

  const removeAttachment = React.useCallback((absolutePath: string) => {
    setAttachments((previous) =>
      previous.filter((item) => item.absolutePath !== absolutePath),
    );
  }, []);

  const resolveAttachmentFromAbsolutePath = React.useCallback(
    (absolutePath: string): ComposerAttachment | null => {
      const trimmedPath = absolutePath.trim();
      if (!trimmedPath) {
        return null;
      }

      const workspaceRoot = normalizePath(workspacePath);
      const normalizedPath = normalizePath(trimmedPath);

      if (
        workspaceRoot &&
        normalizedPath.startsWith(`${workspaceRoot}/`) &&
        normalizedPath.length > workspaceRoot.length + 1
      ) {
        return {
          absolutePath: trimmedPath,
          relativePath: normalizedPath.slice(workspaceRoot.length + 1),
          displayPath: normalizedPath.slice(workspaceRoot.length + 1),
        };
      }

      return {
        absolutePath: trimmedPath,
        displayPath: getFileName(trimmedPath),
      };
    },
    [workspacePath],
  );

  const handleAddAttachmentPaths = React.useCallback(
    (paths: string[]) => {
      const next = paths
        .map((item) => resolveAttachmentFromAbsolutePath(item))
        .filter((item): item is ComposerAttachment => item !== null);

      mergeAttachments(next);
    },
    [mergeAttachments, resolveAttachmentFromAbsolutePath],
  );

  const handlePickAttachment = React.useCallback(async () => {
    if (!hasWorkspace) {
      return;
    }

    const result = await window.desktop.openAttachmentFile({ workspacePath });
    if (result.canceled) {
      return;
    }

    if (!result.absolutePath) {
      return;
    }

    const nextAttachment = resolveAttachmentFromAbsolutePath(result.absolutePath);
    if (!nextAttachment) {
      return;
    }

    mergeAttachments([
      {
        ...nextAttachment,
        relativePath: result.relativePath ?? nextAttachment.relativePath,
        displayPath: result.relativePath ?? nextAttachment.displayPath,
      },
    ]);
  }, [
    hasWorkspace,
    mergeAttachments,
    resolveAttachmentFromAbsolutePath,
    workspacePath,
  ]);

  const handleSubmit = React.useCallback(async () => {
    const trimmed = message.trim();
    const normalizedAudio = normalizePromptAudioContent(pendingVoicePrompt);
    if ((!trimmed && !normalizedAudio) || disabled) {
      return;
    }

    const promptAttachments: AcpPromptAttachment[] = attachments.map((attachment) => ({
      absolutePath: attachment.absolutePath,
      relativePath: attachment.relativePath,
      displayPath: attachment.displayPath,
    }));

    setMessage('');
    setAttachments([]);
    setPendingVoicePrompt(null);
    await onSubmit(trimmed, promptAttachments, normalizedAudio);
  }, [attachments, disabled, message, onSubmit, pendingVoicePrompt]);

  React.useEffect(() => {
    if (!submitAfterDictationRef.current || isDictationModeEnabled || isVoiceProcessing) {
      return;
    }

    const normalizedAudio = normalizePromptAudioContent(pendingVoicePrompt);
    if (!message.trim() && !normalizedAudio) {
      submitAfterDictationRef.current = false;
      return;
    }

    submitAfterDictationRef.current = false;
    void handleSubmit();
  }, [
    handleSubmit,
    isDictationModeEnabled,
    isVoiceProcessing,
    message,
    pendingVoicePrompt,
  ]);

  const customAgentById = React.useMemo(
    () => new Map(customAgentOptions.map((entry) => [entry.id, entry])),
    [customAgentOptions],
  );

  const activateCustomAgent = React.useCallback(
    (agentOption: CustomAgentOption) => {
      setActiveCustomAgentId(agentOption.id);
      onSelectAgentPreset({
        preset: 'custom',
        label: agentOption.label,
        iconUrl: agentOption.iconUrl,
        customConfig: agentOption.config,
        customAgentId: agentOption.id,
      });
    },
    [onSelectAgentPreset],
  );

  const handleSaveAgentConfig = React.useCallback(() => {
    const command = customCommand.trim();
    if (!command) {
      return;
    }

    const parsedConfig = normalizeCustomAgentConfig({
      command,
      args: parseArgs(customArgs),
      cwd: customCwd.trim() || undefined,
      env: parseEnv(customEnv),
    });
    if (!parsedConfig) {
      return;
    }

    if (editingAgentPreset !== 'custom') {
      onSaveAgentConfig(editingAgentPreset, parsedConfig);
      setIsAgentDialogOpen(false);
      return;
    }

    const editingOption =
      editingCustomAgentId !== 'new'
        ? customAgentById.get(editingCustomAgentId) ?? null
        : null;
    const matchingRegistryAgent =
      registryAgents.find((agent) =>
        matchesRegistryTemplate(agent, parsedConfig, currentPlatform),
      ) ?? null;
    const existingByRegistry =
      matchingRegistryAgent
        ? storedCustomAgents.find(
            (entry) => entry.registryAgentId === matchingRegistryAgent.id,
          ) ?? null
        : null;
    const existingBySignature =
      storedCustomAgents.find(
        (entry) =>
          toCustomAgentConfigSignature(entry.config) ===
          toCustomAgentConfigSignature(parsedConfig),
      ) ?? null;

    const targetId =
      editingOption?.id ??
      existingByRegistry?.id ??
      existingBySignature?.id ??
      nextStoredCustomAgentId();
    const nextEntry: StoredCustomAgentEntry = {
      id: targetId,
      label:
        matchingRegistryAgent?.name ??
        editingOption?.label ??
        toDefaultCustomAgentLabel(parsedConfig),
      config: parsedConfig,
      registryAgentId: matchingRegistryAgent?.id ?? editingOption?.registryAgentId,
    };

    setStoredCustomAgents((previous) => {
      const hasTarget = previous.some((entry) => entry.id === targetId);
      if (!hasTarget) {
        return [...previous, nextEntry];
      }

      return previous.map((entry) => (entry.id === targetId ? nextEntry : entry));
    });
    setActiveCustomAgentId(targetId);
    onSelectAgentPreset({
      preset: 'custom',
      label: nextEntry.label,
      iconUrl: matchingRegistryAgent?.icon ?? editingOption?.iconUrl ?? null,
      customConfig: parsedConfig,
      customAgentId: targetId,
    });
    setIsAgentDialogOpen(false);
  }, [
    currentPlatform,
    customAgentById,
    customArgs,
    customCommand,
    customCwd,
    customEnv,
    editingAgentPreset,
    editingCustomAgentId,
    onSaveAgentConfig,
    onSelectAgentPreset,
    registryAgents,
    storedCustomAgents,
  ]);

  const openAgentConfigEditor = React.useCallback(
    (preset: 'codex' | 'claude' | 'custom', customAgentId?: string) => {
      setIsAgentMenuOpen(false);
      setEditingAgentPreset(preset);
      setEditingCustomAgentId(
        preset === 'custom' ? customAgentId ?? activeCustomAgentId ?? 'new' : 'new',
      );
      window.setTimeout(() => {
        setIsAgentDialogOpen(true);
      }, 0);
    },
    [activeCustomAgentId],
  );

  const handleRemoveCustomAgent = React.useCallback(
    (agentId: string) => {
      const targetAgent = customAgentById.get(agentId) ?? null;
      if (!targetAgent) {
        return;
      }

      const remainingAgents = customAgentOptions.filter((entry) => entry.id !== agentId);
      const nextActiveAgent = remainingAgents[0] ?? null;

      setStoredCustomAgents((previous) => previous.filter((entry) => entry.id !== agentId));

      if (editingAgentPreset === 'custom' && editingCustomAgentId === agentId) {
        setEditingCustomAgentId(nextActiveAgent?.id ?? 'new');
      }

      if (activeCustomAgentId === agentId) {
        setActiveCustomAgentId(nextActiveAgent?.id ?? null);
      }

      if (agentPreset !== 'custom' || activeCustomAgentId !== agentId) {
        return;
      }

      if (nextActiveAgent) {
        onSelectAgentPreset({
          preset: 'custom',
          label: nextActiveAgent.label,
          iconUrl: nextActiveAgent.iconUrl,
          customConfig: nextActiveAgent.config,
          customAgentId: nextActiveAgent.id,
        });
        return;
      }

      onSelectAgentPreset({
        preset: 'codex',
        label: 'Codex',
        iconUrl: codexRegistryAgent?.icon ?? null,
      });
    },
    [
      activeCustomAgentId,
      agentPreset,
      codexRegistryAgent,
      customAgentById,
      customAgentOptions,
      editingAgentPreset,
      editingCustomAgentId,
      onSelectAgentPreset,
    ],
  );

  const handleOpenRegistryDialog = React.useCallback(() => {
    setIsAgentMenuOpen(false);
    setIsRegistryDialogOpen(true);

    if (registryAgents.length === 0 && !isRegistryLoading) {
      void loadRegistryAgents();
    }
  }, [isRegistryLoading, loadRegistryAgents, registryAgents.length]);

  const handleUseRegistryAgentTemplate = React.useCallback((agent: RegistryAgent) => {
    const launchTemplate = toRegistryLaunchTemplate(agent, currentPlatform);
    if (!launchTemplate.autoConfigurable) {
      return;
    }

    const parsedConfig = normalizeCustomAgentConfig({
      command: launchTemplate.command,
      args: launchTemplate.args,
      env: launchTemplate.env,
    });
    if (!parsedConfig) {
      return;
    }

    const existingByRegistry =
      storedCustomAgents.find((entry) => entry.registryAgentId === agent.id) ?? null;
    const existingBySignature =
      storedCustomAgents.find(
        (entry) =>
          toCustomAgentConfigSignature(entry.config) ===
          toCustomAgentConfigSignature(parsedConfig),
      ) ?? null;
    const targetId =
      existingByRegistry?.id ?? existingBySignature?.id ?? `registry-${agent.id}`;
    const nextEntry: StoredCustomAgentEntry = {
      id: targetId,
      label: agent.name,
      config: parsedConfig,
      registryAgentId: agent.id,
    };

    setStoredCustomAgents((previous) => {
      const hasTarget = previous.some((entry) => entry.id === targetId);
      if (!hasTarget) {
        return [...previous, nextEntry];
      }

      return previous.map((entry) => (entry.id === targetId ? nextEntry : entry));
    });
    setActiveCustomAgentId(targetId);
    onSelectAgentPreset({
      preset: 'custom',
      label: nextEntry.label,
      iconUrl: agent.icon ?? null,
      customConfig: parsedConfig,
      customAgentId: targetId,
    });
    setIsRegistryDialogOpen(false);
    setIsAgentMenuOpen(false);
  }, [currentPlatform, onSelectAgentPreset, storedCustomAgents]);

  const customCommandName = React.useMemo(() => {
    if (!customAgentConfig) {
      return undefined;
    }

    return toDefaultCustomAgentLabel(customAgentConfig);
  }, [customAgentConfig]);
  const customAgentLabel =
    activeCustomAgentOption?.label ??
    customRegistryAgent?.name ??
    customCommandName ??
    'Added agent';
  const agentLabel =
    agentPreset === 'custom'
      ? customAgentLabel
      : agentPreset === 'codex'
        ? 'Codex'
        : agentPreset === 'claude'
          ? 'Claude Code'
          : 'Select...';

  const controlSelects = React.useMemo<ComposerControlSelect[]>(() => {
    if (!sessionControls) {
      return [];
    }

    const findConfigByCategory = (category: string): AcpSessionConfigControl | null =>
      sessionControls.configControls.find((control) => control.category === category) ?? null;

    const toConfigValueLabel = (control: AcpSessionConfigControl): string => {
      if (control.type === 'boolean') {
        return control.currentValue ? 'Enabled' : 'Disabled';
      }

      return (
        control.options.find((option) => option.id === control.currentValue)?.name ??
        control.currentValue
      );
    };

    const toConfigOptions = (
      control: AcpSessionConfigControl,
    ): ComposerControlOption[] => {
      if (control.type === 'boolean') {
        return [
          { id: 'true', label: 'Enabled' },
          { id: 'false', label: 'Disabled' },
        ];
      }

      return control.options.map((option) => ({
        id: option.id,
        label: option.name,
        description: option.description ?? null,
      }));
    };

    const toConfigOnSelect =
      (control: AcpSessionConfigControl): ComposerControlSelect['onSelect'] =>
      (nextId: string) => {
        if (control.type === 'boolean') {
          const nextValue = nextId === 'true';
          if (nextValue === control.currentValue) {
            return;
          }

          void onSetSessionConfigOption({
            configId: control.id,
            type: 'boolean',
            value: nextValue,
          }).catch(() => undefined);
          return;
        }

        if (nextId === control.currentValue) {
          return;
        }

        void onSetSessionConfigOption({
          configId: control.id,
          type: 'select',
          value: nextId,
        }).catch(() => undefined);
      };

    const modelConfig = findConfigByCategory('model');
    const thoughtConfig = findConfigByCategory('thought_level');
    const modeConfig = getLikelyModeControl(sessionControls.configControls);

    const usedConfigIds = new Set<string>();
    const selects: ComposerControlSelect[] = [];

    if (modelConfig) {
      usedConfigIds.add(modelConfig.id);
      selects.push({
        key: `config-${modelConfig.id}`,
        label: 'Model',
        valueLabel: toConfigValueLabel(modelConfig),
        options: toConfigOptions(modelConfig),
        onSelect: toConfigOnSelect(modelConfig),
      });
    } else if (sessionControls.modelState?.options.length) {
      selects.push({
        key: 'model-state',
        label: 'Model',
        valueLabel:
          sessionControls.modelState.options.find(
            (option) => option.id === sessionControls.modelState?.currentModelId,
          )?.name ?? sessionControls.modelState.currentModelId,
        options: sessionControls.modelState.options.map((option) => ({
          id: option.id,
          label: option.name,
          description: option.description ?? null,
        })),
        onSelect: (nextId: string) => {
          if (nextId === sessionControls.modelState?.currentModelId) {
            return;
          }

          void onSetSessionModel(nextId).catch(() => undefined);
        },
      });
    }

    if (thoughtConfig) {
      usedConfigIds.add(thoughtConfig.id);
      selects.push({
        key: `config-${thoughtConfig.id}`,
        label: 'Reasoning',
        valueLabel: toConfigValueLabel(thoughtConfig),
        options: toConfigOptions(thoughtConfig),
        onSelect: toConfigOnSelect(thoughtConfig),
      });
    }

    if (modeConfig) {
      usedConfigIds.add(modeConfig.id);
    }

    const additionalControls = sessionControls.configControls.filter((control) => {
      if (usedConfigIds.has(control.id)) {
        return false;
      }

      if (
        control.category === 'model' ||
        control.category === 'thought_level' ||
        isLikelyModeControl(control)
      ) {
        return false;
      }

      return true;
    });

    for (const control of additionalControls) {
      if (selects.length >= 4) {
        break;
      }

      selects.push({
        key: `config-${control.id}`,
        label: control.name,
        valueLabel: toConfigValueLabel(control),
        options: toConfigOptions(control),
        onSelect: toConfigOnSelect(control),
      });
    }

    return selects;
  }, [onSetSessionConfigOption, onSetSessionModel, sessionControls]);

  const sessionModeControl = React.useMemo<ComposerModeControl | null>(() => {
    if (!sessionControls) {
      return null;
    }

    if (sessionControls.modeState?.options.length) {
      return {
        currentId: sessionControls.modeState.currentModeId,
        valueLabel:
          sessionControls.modeState.options.find(
            (option) => option.id === sessionControls.modeState?.currentModeId,
          )?.name ?? sessionControls.modeState.currentModeId,
        options: sessionControls.modeState.options.map((option) => ({
          id: option.id,
          label: option.name,
          description: option.description ?? null,
        })),
        onSelect: (nextId: string) => {
          if (nextId === sessionControls.modeState?.currentModeId) {
            return;
          }

          void onSetSessionMode(nextId).catch(() => undefined);
        },
      };
    }

    const modeConfig = getLikelyModeControl(sessionControls.configControls);
    if (!modeConfig) {
      return null;
    }

    if (modeConfig.type === 'select') {
      return {
        currentId: modeConfig.currentValue,
        valueLabel:
          modeConfig.options.find((option) => option.id === modeConfig.currentValue)?.name ??
          modeConfig.currentValue,
        options: modeConfig.options.map((option) => ({
          id: option.id,
          label: option.name,
          description: option.description ?? null,
        })),
        onSelect: (nextId: string) => {
          if (nextId === modeConfig.currentValue) {
            return;
          }

          void onSetSessionConfigOption({
            configId: modeConfig.id,
            type: 'select',
            value: nextId,
          }).catch(() => undefined);
        },
      };
    }

    return {
      currentId: modeConfig.currentValue ? 'enabled' : 'disabled',
      valueLabel: modeConfig.currentValue ? 'Full Access' : 'Restricted',
      options: [
        {
          id: 'enabled',
          label: 'Full Access',
          description: 'Allow unrestricted actions.',
        },
        {
          id: 'disabled',
          label: 'Restricted',
          description: 'Require approval or sandbox limits.',
        },
      ],
      onSelect: (nextId: string) => {
        const nextValue = nextId === 'enabled';
        if (nextValue === modeConfig.currentValue) {
          return;
        }

        void onSetSessionConfigOption({
          configId: modeConfig.id,
          type: 'boolean',
          value: nextValue,
        }).catch(() => undefined);
      },
    };
  }, [onSetSessionConfigOption, onSetSessionMode, sessionControls]);

  const isFullAccessMode = Boolean(
    sessionModeControl &&
      (sessionModeControl.valueLabel.toLowerCase().includes('full') ||
        sessionModeControl.currentId.toLowerCase().includes('full')),
  );
  const clearPendingVoicePrompt = React.useCallback(() => {
    setPendingVoicePrompt(null);
  }, []);
  const composerPlaceholder = disabled
    ? disabledMessage ?? 'ACP is unavailable. Reconnect to start chatting…'
    : 'Ask anything';
  const voiceInputTooltipText = !isVoiceInputSupported
    ? voiceInputUnavailableMessage
    : isVoiceProcessing
      ? supportsAcpAudioPrompt
        ? 'Preparing voice prompt...'
        : 'Transcribing voice input...'
      : voiceError ??
        (pendingVoicePrompt
          ? 'Voice prompt ready. Send it or remove it.'
          : isDictationModeEnabled
            ? isDictating
              ? 'Recording... click to stop'
              : 'Starting voice input... click to stop'
            : supportsAcpAudioPrompt
              ? 'Click to record a voice prompt or toggle with Ctrl+M'
              : 'Click to toggle dictation or toggle with Ctrl+M');
  const isVoiceInputDisabled = disabled || !isVoiceInputSupported || isVoiceProcessing;

  const clearQueuedPromptDragState = React.useCallback(() => {
    setDraggingQueuedPromptId(null);
    setDragOverQueuedPromptId(null);
  }, []);

  const handleQueuedPromptDragStart = React.useCallback(
    (event: React.DragEvent<HTMLButtonElement>, queueId: string) => {
      if (!onReorderQueuedPrompt) {
        event.preventDefault();
        return;
      }

      setDraggingQueuedPromptId(queueId);
      setDragOverQueuedPromptId(queueId);
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', queueId);
    },
    [onReorderQueuedPrompt],
  );

  const handleQueuedPromptDragOver = React.useCallback(
    (event: React.DragEvent<HTMLDivElement>, targetQueueId: string) => {
      if (!onReorderQueuedPrompt || !draggingQueuedPromptId) {
        return;
      }

      if (draggingQueuedPromptId === targetQueueId) {
        return;
      }

      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      setDragOverQueuedPromptId(targetQueueId);
    },
    [draggingQueuedPromptId, onReorderQueuedPrompt],
  );

  const handleQueuedPromptDrop = React.useCallback(
    (event: React.DragEvent<HTMLDivElement>, targetQueueId: string) => {
      if (!onReorderQueuedPrompt) {
        return;
      }

      event.preventDefault();
      const sourceQueueId =
        draggingQueuedPromptId || event.dataTransfer.getData('text/plain');

      if (!sourceQueueId || sourceQueueId === targetQueueId) {
        clearQueuedPromptDragState();
        return;
      }

      onReorderQueuedPrompt(sourceQueueId, targetQueueId);
      clearQueuedPromptDragState();
    },
    [clearQueuedPromptDragState, draggingQueuedPromptId, onReorderQueuedPrompt],
  );

  const handleDropDataTransfer = React.useCallback(
    (dataTransfer: DataTransfer) => {
      const droppedPaths = extractFilePathsFromDataTransfer(dataTransfer);
      if (droppedPaths.length === 0) {
        return;
      }

      handleAddAttachmentPaths(droppedPaths);
    },
    [handleAddAttachmentPaths],
  );

  return (
    <div
      className="pb-0 pt-0"
      onPaste={(event) => {
        const pastedPaths = extractFilePathsFromClipboard(event.clipboardData);
        if (pastedPaths.length === 0) {
          return;
        }

        event.preventDefault();
        handleAddAttachmentPaths(pastedPaths);
      }}
    >
      <div
        className={cn(
          'overflow-hidden rounded-[21px] border border-stone-200/80 bg-white/95 transition-colors',
          isDropTargetActive && 'border-stone-400 bg-stone-50/90',
        )}
        onDragEnter={(event) => {
          if (dataTransferHasFiles(event.dataTransfer)) {
            event.preventDefault();
            setIsDropTargetActive(true);
          }
        }}
        onDragOver={(event) => {
          if (dataTransferHasFiles(event.dataTransfer)) {
            event.preventDefault();
            event.dataTransfer.dropEffect = 'copy';
          }
        }}
        onDragLeave={(event) => {
          if (event.currentTarget === event.target) {
            setIsDropTargetActive(false);
          }
        }}
        onDrop={(event) => {
          event.preventDefault();
          setIsDropTargetActive(false);
          handleDropDataTransfer(event.dataTransfer);
        }}
      >
        {attachments.length > 0 || pendingVoicePrompt ? (
          <div className="flex flex-wrap gap-2 px-3 pb-0.5 pt-2.5">
            {pendingVoicePrompt ? (
              <button
                type="button"
                className="no-drag inline-flex h-8 max-w-full items-center gap-1.5 rounded-full border border-stone-200 bg-white px-2.5 text-[12px] font-medium text-stone-800 transition-colors hover:bg-stone-50"
                onClick={clearPendingVoicePrompt}
                title="Remove voice prompt"
              >
                <Mic className="h-3.5 w-3.5 shrink-0 text-stone-500" />
                <span className="truncate">Voice prompt ready</span>
                <X className="h-3 w-3 shrink-0 text-stone-500" />
              </button>
            ) : null}
            {attachments.map((attachment) => (
              <button
                key={attachment.absolutePath}
                type="button"
                className="no-drag inline-flex h-8 max-w-full items-center gap-1.5 rounded-full border border-stone-200 bg-white px-2.5 text-[12px] font-medium text-stone-800 transition-colors hover:bg-stone-50"
                onClick={() => removeAttachment(attachment.absolutePath)}
                title="Remove attachment"
              >
                <FileText className="h-3.5 w-3.5 shrink-0 text-stone-500" />
                <span className="truncate">{attachment.displayPath}</span>
                <X className="h-3 w-3 shrink-0 text-stone-500" />
              </button>
            ))}
          </div>
        ) : null}

        {queuedPrompts.length > 0 ? (
          <div className="space-y-1.5 px-2 pb-1 pt-2">
            {queuedPrompts.map((item) => (
              <div
                key={item.id}
                className={cn(
                  'flex items-center gap-2 rounded-xl border border-stone-200 bg-stone-50/80 px-2.5 py-1.5',
                  draggingQueuedPromptId &&
                    dragOverQueuedPromptId === item.id &&
                    draggingQueuedPromptId !== item.id &&
                    'border-stone-400 bg-stone-100/80',
                )}
                onDragOver={(event) => handleQueuedPromptDragOver(event, item.id)}
                onDrop={(event) => handleQueuedPromptDrop(event, item.id)}
              >
                <button
                  type="button"
                  className={cn(
                    'no-drag group/queue-handle inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-stone-500 transition-colors',
                    onReorderQueuedPrompt
                      ? 'cursor-grab hover:bg-stone-200 active:cursor-grabbing'
                      : 'cursor-default',
                  )}
                  aria-label="Drag to reorder queued message"
                  draggable={Boolean(onReorderQueuedPrompt)}
                  onDragStart={(event) => handleQueuedPromptDragStart(event, item.id)}
                  onDragEnd={clearQueuedPromptDragState}
                >
                  <ListTodo
                    className={cn(
                      'h-3.5 w-3.5',
                      onReorderQueuedPrompt && 'group-hover/queue-handle:hidden',
                    )}
                  />
                  {onReorderQueuedPrompt ? (
                    <GripVertical className="hidden h-3.5 w-3.5 group-hover/queue-handle:block" />
                  ) : null}
                </button>
                <p className="line-clamp-1 min-w-0 flex-1 text-[14px] text-stone-600">
                  {item.text}
                </p>
                <button
                  type="button"
                  className={cn(
                    'no-drag inline-flex rounded-full bg-stone-200 px-2 py-0.5 text-[11px] font-medium text-stone-800 transition-colors',
                    'hover:bg-stone-300 disabled:cursor-default disabled:opacity-60',
                  )}
                  disabled={!onSteerQueuedPrompt}
                  onClick={() => {
                    onSteerQueuedPrompt?.(item.id);
                  }}
                >
                  Steer
                </button>
                <button
                  type="button"
                  className={cn(
                    'no-drag inline-flex h-6 w-6 items-center justify-center rounded-md text-stone-500 transition-colors',
                    'hover:bg-stone-200 hover:text-stone-700 disabled:opacity-50',
                  )}
                  aria-label="Remove queued message"
                  disabled={!onRemoveQueuedPrompt}
                  onClick={() => {
                    onRemoveQueuedPrompt?.(item.id);
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
                <span className="inline-flex h-6 w-6 items-center justify-center rounded-md text-stone-500">
                  <Ellipsis className="h-3.5 w-3.5" />
                </span>
              </div>
            ))}
          </div>
        ) : null}

        <div className="px-3 pb-0 pt-2.5">
          <AutosizeTextarea
            ref={messageInputRef}
            minRows={1}
            maxRows={8}
            placeholder={composerPlaceholder}
            value={message}
            disabled={disabled}
            className="text-[15px] leading-6 text-stone-700 placeholder:text-stone-400"
            onChange={(event) => setMessage(event.target.value)}
            onDragOver={(event) => {
              if (!dataTransferHasFiles(event.dataTransfer)) {
                return;
              }

              event.preventDefault();
              event.dataTransfer.dropEffect = 'copy';
              setIsDropTargetActive(true);
            }}
            onDrop={(event) => {
              if (!dataTransferHasFiles(event.dataTransfer)) {
                return;
              }

              event.preventDefault();
              event.stopPropagation();
              setIsDropTargetActive(false);
              handleDropDataTransfer(event.dataTransfer);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void handleSubmit();
              }
            }}
          />
        </div>

        {isVoiceRecordingSurfaceVisible ? (
          <div className="flex h-10 items-center gap-1.5 px-2 pb-1 pt-0">
            <Button
              size="icon"
              variant="ghost"
              className="composer-tone-hover h-8 w-8 shrink-0 rounded-full text-stone-500 focus-visible:ring-0"
              aria-label="Add attachment"
              disabled={!hasWorkspace}
              onClick={() => {
                void handlePickAttachment();
              }}
            >
              <Plus className="h-4 w-4" />
            </Button>

            <div className="relative flex h-10 flex-1 items-center overflow-hidden px-1">
              <div className="absolute inset-x-1 top-1/2 border-t border-dashed border-stone-400/70" />
              <div
                ref={voiceVisualizerTrackRef}
                className="relative z-10 flex h-full w-full items-center overflow-hidden"
                style={{ gap: `${VOICE_VISUALIZER_BAR_GAP_PX}px` }}
              >
                {voiceVisualizerBars.map((bar, index) => (
                  <span
                    key={index}
                    className={cn(
                      'shrink-0 rounded-full bg-stone-900 transition-[height,opacity] duration-75 ease-out',
                      !isDictating && 'bg-stone-500/80',
                    )}
                    style={{
                      width: `${VOICE_VISUALIZER_BAR_WIDTH_PX}px`,
                      height: `${Math.round(2 + bar * 24)}px`,
                      opacity: isDictating ? 0.96 : 0.62,
                    }}
                  />
                ))}
              </div>
            </div>

            <span className="w-10 shrink-0 text-right text-[13px] font-medium tabular-nums text-stone-600">
              {formatVoiceRecordingDuration(recordingDurationMs)}
            </span>

            {isDictationModeEnabled ? (
              <Button
                size="icon"
                variant="ghost"
                className="h-[26px] w-[26px] shrink-0 rounded-full bg-stone-200/90 text-stone-900 hover:bg-stone-300 focus-visible:ring-0"
                aria-label="Stop voice input"
                onClick={() => {
                  endDictation();
                }}
              >
                <Square className="h-3 w-3 fill-current" />
              </Button>
            ) : (
              <span className="inline-flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full bg-stone-200/60 text-stone-500">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              </span>
            )}

            <Button
              size="icon"
              variant="primary"
              className={cn(
                'h-[26px] w-[26px] shrink-0 rounded-full bg-stone-900 text-white hover:bg-stone-800 focus-visible:ring-0',
                (isVoiceProcessing || (!isDictationModeEnabled && !canSend)) && 'opacity-75',
              )}
              aria-label={isDictationModeEnabled ? 'Stop and send' : 'Send'}
              disabled={isVoiceProcessing || (!isDictationModeEnabled && !canSend)}
              onClick={() => {
                if (isDictationModeEnabled) {
                  submitAfterDictationRef.current = true;
                  toggleDictationActiveRef.current = false;
                  shortcutDictationActiveRef.current = false;
                  setDictationModeEnabled(false);
                  stopDictation();
                  return;
                }

                void handleSubmit();
              }}
            >
              <ArrowUp className="h-3.5 w-3.5" />
            </Button>
          </div>
        ) : (
          <div className="flex h-10 items-center gap-1.5 px-2 pb-1 pt-0">
            <Button
              size="icon"
              variant="ghost"
              className="composer-tone-hover h-8 w-8 rounded-full text-stone-500 focus-visible:ring-0"
              aria-label="Add attachment"
              disabled={!hasWorkspace}
              onClick={() => {
                void handlePickAttachment();
              }}
            >
              <Plus className="h-4 w-4" />
            </Button>

            {controlSelects.map((controlSelect) => (
              <ComposerSelect
                key={controlSelect.key}
                label={controlSelect.valueLabel}
                options={controlSelect.options}
                onSelect={controlSelect.onSelect}
                ariaLabel={`Select ${controlSelect.label}`}
              />
            ))}

            <div className="ml-auto flex items-center gap-1.5">
              <TooltipProvider delayDuration={180}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex">
                      <Button
                        size="icon"
                        variant="ghost"
                        className={cn(
                          'composer-tone-hover h-8 w-8 rounded-full text-stone-500 focus-visible:ring-0',
                          isVoiceInputDisabled && 'pointer-events-none',
                          isDictationModeEnabled &&
                            'composer-tone-active bg-stone-200/80 text-stone-800',
                        )}
                        aria-label={
                          isVoiceProcessing
                            ? supportsAcpAudioPrompt
                              ? 'Preparing voice prompt'
                              : 'Transcribing voice input'
                            : isDictationModeEnabled
                              ? 'Stop voice input'
                              : 'Voice input'
                        }
                        disabled={isVoiceInputDisabled}
                        onClick={() => {
                          if (isDictationModeEnabled) {
                            endDictation();
                            return;
                          }

                          beginDictation('toggle');
                        }}
                      >
                        {isVoiceProcessing ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Mic className="h-4 w-4" />
                        )}
                      </Button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>{voiceInputTooltipText}</TooltipContent>
                </Tooltip>
              </TooltipProvider>

              {isPrompting ? (
                <Button
                  size="icon"
                  variant="primary"
                  className="h-[26px] w-[26px] rounded-full bg-stone-900 text-white hover:bg-stone-800 focus-visible:ring-0"
                  aria-label="Cancel"
                  onClick={() => {
                    void onCancel();
                  }}
                >
                  <Square className="h-3.5 w-3.5 fill-current" />
                </Button>
              ) : (
                <Button
                  size="icon"
                  variant="primary"
                  className={cn(
                    'h-[26px] w-[26px] rounded-full bg-stone-900 text-white hover:bg-stone-800 focus-visible:ring-0',
                    !canSend && 'opacity-75',
                  )}
                  aria-label="Send"
                  disabled={!canSend}
                  onClick={() => {
                    void handleSubmit();
                  }}
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="mt-1 flex items-center justify-between px-3 text-[13px]">
        <div className="flex items-center gap-3">
          <DropdownMenu open={isAgentMenuOpen} onOpenChange={setIsAgentMenuOpen}>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="composer-tone-hover no-drag inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-stone-600 transition-colors hover:bg-stone-100 hover:text-stone-800"
              >
                {activeAgentIconUrl ? (
                  <AgentRegistryIcon
                    iconUrl={activeAgentIconUrl}
                    label={agentLabel}
                    className="h-3.5 w-3.5 rounded-[4px]"
                  />
                ) : (
                  <Laptop className="h-3.5 w-3.5" />
                )}
                {agentLabel}
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-[240px]">
              <DropdownMenuItem
                className="group/item"
                onClick={() =>
                  onSelectAgentPreset({
                    preset: 'codex',
                    label: 'Codex',
                    iconUrl: codexRegistryAgent?.icon ?? null,
                  })
                }
              >
                <span className="flex flex-1 items-center justify-between gap-3">
                  <span className="inline-flex items-center gap-1.5">
                    <AgentRegistryIcon
                      iconUrl={codexRegistryAgent?.icon ?? null}
                      label="Codex"
                      className="h-4 w-4 rounded-[5px]"
                    />
                    <span>Codex</span>
                  </span>
                  <button
                    type="button"
                    className="no-drag inline-flex h-5 w-5 items-center justify-center rounded-md text-stone-400 opacity-0 transition-opacity hover:bg-stone-200 hover:text-stone-700 group-hover/item:opacity-100 group-data-[highlighted]:opacity-100"
                    title="Edit Codex configuration"
                    aria-label="Edit Codex configuration"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      openAgentConfigEditor('codex');
                    }}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                </span>
              </DropdownMenuItem>
              <DropdownMenuItem
                className="group/item"
                onClick={() =>
                  onSelectAgentPreset({
                    preset: 'claude',
                    label: 'Claude Code',
                    iconUrl: claudeRegistryAgent?.icon ?? null,
                  })
                }
              >
                <span className="flex flex-1 items-center justify-between gap-3">
                  <span className="inline-flex items-center gap-1.5">
                    <AgentRegistryIcon
                      iconUrl={claudeRegistryAgent?.icon ?? null}
                      label="Claude"
                      className="h-4 w-4 rounded-[5px]"
                    />
                    <span>Claude Code</span>
                  </span>
                  <button
                    type="button"
                    className="no-drag inline-flex h-5 w-5 items-center justify-center rounded-md text-stone-400 opacity-0 transition-opacity hover:bg-stone-200 hover:text-stone-700 group-hover/item:opacity-100 group-data-[highlighted]:opacity-100"
                    title="Edit Claude Code configuration"
                    aria-label="Edit Claude Code configuration"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      openAgentConfigEditor('claude');
                    }}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                </span>
              </DropdownMenuItem>
              {customAgentOptions.map((entry) => (
                <DropdownMenuItem
                  key={entry.id}
                  className="group/item"
                  onClick={() => activateCustomAgent(entry)}
                >
                  <span className="flex min-w-0 flex-1 items-center justify-between gap-3">
                    <span className="inline-flex min-w-0 items-center gap-1.5">
                      <AgentRegistryIcon
                        iconUrl={entry.iconUrl}
                        label={entry.label}
                        className="h-4 w-4 rounded-[5px]"
                      />
                      <span className="truncate">{entry.label}</span>
                    </span>
                    <span className="inline-flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        className="no-drag inline-flex h-5 w-5 items-center justify-center rounded-md text-stone-400 opacity-0 transition-opacity hover:bg-stone-200 hover:text-stone-700 group-hover/item:opacity-100 group-data-[highlighted]:opacity-100"
                        title="Edit custom agent configuration"
                        aria-label="Edit custom agent configuration"
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          openAgentConfigEditor('custom', entry.id);
                        }}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        className="no-drag inline-flex h-5 w-5 items-center justify-center rounded-md text-stone-400 opacity-0 transition-opacity hover:bg-rose-100 hover:text-rose-700 group-hover/item:opacity-100 group-data-[highlighted]:opacity-100"
                        title="Remove agent"
                        aria-label={`Remove ${entry.label}`}
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          handleRemoveCustomAgent(entry.id);
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </span>
                  </span>
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={handleOpenRegistryDialog}
              >
                Add from registry
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  openAgentConfigEditor('custom', 'new');
                }}
              >
                Add ACP agent
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {sessionModeControl ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    'composer-tone-hover no-drag inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 transition-colors',
                    isFullAccessMode
                      ? 'text-orange-600 hover:bg-orange-50 hover:text-orange-700'
                      : 'text-stone-600 hover:bg-stone-100 hover:text-stone-800',
                  )}
                >
                  <Shield className="h-3.5 w-3.5" />
                  {sessionModeControl.valueLabel}
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-[220px]">
                {sessionModeControl.options.map((option) => (
                  <DropdownMenuCheckboxItem
                    key={option.id}
                    checked={option.id === sessionModeControl.currentId}
                    onSelect={(event) => {
                      event.preventDefault();
                      sessionModeControl.onSelect(option.id);
                    }}
                  >
                    {option.label}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>

        <div className="flex items-center gap-3">
          <DropdownMenu open={isBranchMenuOpen} onOpenChange={setIsBranchMenuOpen}>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                disabled={!hasWorkspace}
                className={cn(
                  'composer-tone-hover no-drag inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 transition-colors',
                  hasWorkspace
                    ? 'text-stone-600 hover:bg-stone-100 hover:text-stone-800'
                    : 'cursor-not-allowed text-stone-400',
                )}
              >
                <GitBranch className="h-3.5 w-3.5" />
                <span className="max-w-[120px] truncate">{branchLabel}</span>
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[360px] p-2">
              <div className="rounded-lg bg-stone-100/90 px-2 py-1.5">
                <div className="flex items-center gap-2 text-stone-500">
                  <Search className="h-3.5 w-3.5" />
                  <input
                    value={branchSearch}
                    onChange={(event) => setBranchSearch(event.target.value)}
                    onKeyDown={(event) => {
                      event.stopPropagation();
                      if (event.key !== 'Enter') {
                        return;
                      }

                      event.preventDefault();
                      const typedBranch = branchSearch.trim();
                      if (!typedBranch || isBranchUpdating) {
                        return;
                      }

                      const existingBranch = branchSummary.localBranches.find(
                        (branch) => branch.toLowerCase() === typedBranch.toLowerCase(),
                      );

                      if (existingBranch) {
                        void checkoutBranch(existingBranch);
                        return;
                      }

                      void createAndCheckoutBranch(typedBranch);
                    }}
                    placeholder="Search branches"
                    className="h-5 w-full bg-transparent text-[13px] text-stone-700 placeholder:text-stone-400 focus:outline-none"
                  />
                </div>
              </div>

              <DropdownMenuLabel className="pb-1.5 pt-2 text-[12px] text-stone-500">
                Branches
              </DropdownMenuLabel>

              <div className="max-h-[260px] space-y-0.5 overflow-y-auto">
                {isBranchLoading ? (
                  <div className="flex h-16 items-center justify-center gap-2 rounded-md text-[12px] text-stone-500">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Loading branches...
                  </div>
                ) : !branchSummary.available ? (
                  <div className="rounded-md px-3 py-2 text-[12px] text-stone-500">
                    {branchError ?? 'Current project is not a git repository.'}
                  </div>
                ) : filteredLocalBranches.length === 0 && filteredRemoteBranches.length === 0 ? (
                  <div className="rounded-md px-3 py-2 text-[12px] text-stone-500">No branches found.</div>
                ) : (
                  <div>
                    {filteredLocalBranches.length > 0 ? (
                      <div className="px-3 py-1.5 text-[11px] font-medium text-stone-500">
                        Local
                      </div>
                    ) : null}

                    {filteredLocalBranches.map((branch) => {
                      const isCurrentBranch = branchSummary.currentBranch === branch;

                      return (
                        <button
                          key={`local-${branch}`}
                          type="button"
                          disabled={isBranchUpdating}
                          className={cn(
                            'no-drag flex w-full items-start justify-between gap-2 rounded-xl px-2.5 py-1.5 text-left text-[13px] transition-colors',
                            isBranchUpdating
                              ? 'cursor-not-allowed text-stone-400'
                              : isCurrentBranch
                                ? 'bg-stone-100/80 text-stone-900'
                                : 'text-stone-700 hover:bg-stone-100/80',
                          )}
                          onClick={() => {
                            void checkoutBranch(branch);
                          }}
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <GitBranch className="h-3.5 w-3.5 shrink-0 text-stone-500" />
                              <span className="truncate">{branch}</span>
                            </div>
                            {isCurrentBranch ? (
                              <p className="mt-1 pl-[22px] text-[11px] text-stone-500">
                                Uncommitted: {formatFileCount(branchSummary.uncommittedFiles)}{' '}
                                <span className="text-emerald-600">
                                  +{branchSummary.additions.toLocaleString()}
                                </span>{' '}
                                <span className="text-rose-600">
                                  -{branchSummary.deletions.toLocaleString()}
                                </span>
                              </p>
                            ) : null}
                          </div>
                          {isCurrentBranch ? <Check className="mt-0.5 h-4 w-4 shrink-0" /> : null}
                        </button>
                      );
                    })}

                    {filteredRemoteBranches.length > 0 ? (
                      <div className="px-3 py-1.5 text-[11px] font-medium text-stone-500">
                        Remote
                      </div>
                    ) : null}

                    {filteredRemoteBranches.map((branch) => (
                      <div
                        key={`remote-${branch}`}
                        className="flex items-center gap-2 rounded-xl px-2.5 py-1.5 text-[13px] text-stone-500 transition-colors hover:bg-stone-100/80"
                      >
                        <GitBranch className="h-3.5 w-3.5 shrink-0 text-stone-400" />
                        <span className="truncate">{branch}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {branchError && branchSummary.available ? (
                <p className="px-1 pt-2 text-[11px] text-rose-600">{branchError}</p>
              ) : null}

              <DropdownMenuSeparator className="my-2" />

              <button
                type="button"
                className={cn(
                  'no-drag flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors',
                  'text-stone-700 hover:bg-stone-100',
                )}
                onClick={() => {
                  setIsBranchMenuOpen(false);
                  onOpenCommitDialog();
                }}
              >
                <GitBranch className="h-4 w-4" />
                Commit changes...
              </button>

              <button
                type="button"
                disabled={!branchSummary.available || isBranchUpdating}
                className={cn(
                  'no-drag flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors',
                  branchSummary.available && !isBranchUpdating
                    ? 'text-stone-700 hover:bg-stone-100'
                    : 'cursor-not-allowed text-stone-400',
                )}
                onClick={handleCreateBranch}
              >
                <Plus className="h-4 w-4" />
                {canCreateBranch
                  ? `Create and checkout "${createBranchCandidate}"`
                  : 'Create and checkout new branch...'}
              </button>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <Dialog open={isAgentDialogOpen} onOpenChange={setIsAgentDialogOpen}>
        <DialogContent className="max-w-[520px] rounded-[20px] p-0">
          <div className="px-4 pb-4 pt-4">
            <div className="mb-3 inline-flex h-9 w-9 items-center justify-center rounded-[10px] bg-stone-100 text-stone-900">
              <Bot className="h-4 w-4" />
            </div>

            <h2 className="text-[24px] font-semibold leading-none tracking-[-0.015em] text-stone-900">
              ACP configurations
            </h2>
            <p className="mt-2 text-[13px] leading-[1.35] text-stone-500">
              View and edit adapter launch settings for each ACP agent.
            </p>
            <a
              href="https://agentclientprotocol.com/get-started/introduction"
              target="_blank"
              rel="noreferrer"
              className="mt-1.5 inline-block text-[12px] text-stone-500 underline-offset-2 hover:text-stone-700 hover:underline"
            >
              ACP configuration guide
            </a>

            <div className="mt-4 space-y-3">
              <label className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-stone-500">
                Agent
                <select
                  value={editingAgentPreset}
                  onChange={(event) => {
                    const nextPreset = event.target.value as 'codex' | 'claude' | 'custom';
                    setEditingAgentPreset(nextPreset);
                    if (nextPreset === 'custom') {
                      setEditingCustomAgentId(activeCustomAgentId ?? customAgentOptions[0]?.id ?? 'new');
                      return;
                    }

                    setEditingCustomAgentId('new');
                  }}
                  className="no-drag mt-1.5 h-9 w-full rounded-[10px] border border-stone-300 bg-white px-3 text-[13px] text-stone-800 focus:outline-none"
                >
                  <option value="codex">Codex</option>
                  <option value="claude">Claude Code</option>
                  <option value="custom">Added ACP agent</option>
                </select>
              </label>

              {editingAgentPreset === 'custom' ? (
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-stone-500">
                    Custom Agent
                    <select
                      value={editingCustomAgentId}
                      onChange={(event) => setEditingCustomAgentId(event.target.value)}
                      className="no-drag mt-1.5 h-9 w-full rounded-[10px] border border-stone-300 bg-white px-3 text-[13px] text-stone-800 focus:outline-none"
                    >
                      {customAgentOptions.map((entry) => (
                        <option key={entry.id} value={entry.id}>
                          {entry.label}
                        </option>
                      ))}
                      <option value="new">Create new custom agent</option>
                    </select>
                  </label>
                  {editingCustomAgentId !== 'new' ? (
                    <button
                      type="button"
                      className="no-drag mt-1.5 text-[12px] text-rose-700 transition-colors hover:text-rose-800"
                      onClick={() => handleRemoveCustomAgent(editingCustomAgentId)}
                    >
                      Remove selected custom agent
                    </button>
                  ) : null}
                </div>
              ) : null}

              <label className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-stone-500">
                Command
                <input
                  value={customCommand}
                  onChange={(event) => setCustomCommand(event.target.value)}
                  placeholder="npx"
                  className="no-drag mt-1.5 h-9 w-full rounded-[10px] border border-stone-300 bg-white px-3 text-[13px] text-stone-800 placeholder:text-stone-400 focus:outline-none"
                />
              </label>

              <label className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-stone-500">
                Arguments
                <input
                  value={customArgs}
                  onChange={(event) => setCustomArgs(event.target.value)}
                  placeholder="-y your-agent --transport stdio"
                  className="no-drag mt-1.5 h-9 w-full rounded-[10px] border border-stone-300 bg-white px-3 text-[13px] text-stone-800 placeholder:text-stone-400 focus:outline-none"
                />
              </label>

              <label className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-stone-500">
                Working directory (optional)
                <input
                  value={customCwd}
                  onChange={(event) => setCustomCwd(event.target.value)}
                  placeholder={workspacePath}
                  className="no-drag mt-1.5 h-9 w-full rounded-[10px] border border-stone-300 bg-white px-3 text-[13px] text-stone-800 placeholder:text-stone-400 focus:outline-none"
                />
              </label>

              <label className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-stone-500">
                Environment (optional)
                <textarea
                  value={customEnv}
                  onChange={(event) => setCustomEnv(event.target.value)}
                  placeholder={'API_KEY=...\nDEBUG=1'}
                  spellCheck={false}
                  className="no-drag mt-1.5 h-[86px] w-full resize-none rounded-[10px] border border-stone-300 bg-white px-3 py-2 font-mono text-[12px] leading-[1.45] text-stone-800 placeholder:text-stone-400 focus:outline-none"
                />
              </label>
            </div>

            <div className="mt-4 flex items-center justify-end gap-2">
              <Button
                variant="ghost"
                className="h-9 rounded-[11px] px-3 text-[13px]"
                onClick={() => setIsAgentDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button
                className="h-9 rounded-[11px] bg-stone-700 px-4 text-[13px] font-semibold text-white hover:bg-stone-800 disabled:bg-stone-300"
                disabled={customCommand.trim().length === 0}
                onClick={handleSaveAgentConfig}
              >
                {editingAgentPreset === 'custom' ? 'Apply and connect' : 'Apply configuration'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={isRegistryDialogOpen} onOpenChange={setIsRegistryDialogOpen}>
        <DialogContent className="max-w-[980px] rounded-[28px] p-0">
          <div className="px-5 pb-5 pt-5">
            <h2 className="text-[24px] font-semibold leading-none tracking-[-0.015em] text-stone-900">
              Add from registry
            </h2>
            <p className="mt-2 text-[13px] leading-[1.35] text-stone-500">
              Pick an ACP agent template and add it with one click.
            </p>
            {isRegistryLoading ? (
              <div className="mt-4 flex h-[240px] items-center justify-center gap-2 text-[13px] text-stone-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading registry agents...
              </div>
            ) : registryError ? (
              <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50/50 px-3 py-3">
                <p className="text-[13px] text-rose-700">{registryError}</p>
                <Button
                  variant="ghost"
                  className="mt-2 h-8 rounded-[10px] px-3 text-[12px]"
                  onClick={() => {
                    void loadRegistryAgents();
                  }}
                >
                  Retry
                </Button>
              </div>
            ) : (
              <div className="mt-5 grid max-h-[500px] grid-cols-1 gap-3 overflow-y-auto pr-1 sm:grid-cols-2">
                {registryAgents.map((agent) => {
                  const launchTemplate = toRegistryLaunchTemplate(agent, currentPlatform);
                  const canAutoConfigure = launchTemplate.autoConfigurable;
                  const addAgent = (): void => {
                    if (!canAutoConfigure) {
                      return;
                    }

                    handleUseRegistryAgentTemplate(agent);
                  };

                  return (
                    <div
                      key={agent.id}
                      role={canAutoConfigure ? 'button' : undefined}
                      tabIndex={canAutoConfigure ? 0 : -1}
                      className={cn(
                        'group relative flex min-h-[132px] h-full flex-col rounded-[28px] bg-stone-100/95 px-5 py-4 text-left',
                        'text-stone-700 transition-[background-color,transform] duration-150',
                        canAutoConfigure && 'cursor-pointer hover:bg-stone-200/90',
                        !canAutoConfigure && 'cursor-not-allowed opacity-60',
                      )}
                      onClick={addAgent}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          addAgent();
                        }
                      }}
                    >
                      <div className="flex items-start gap-3 pr-10">
                        <AgentRegistryIcon
                          iconUrl={agent.icon ?? null}
                          label={agent.name}
                          className="h-10 w-10 rounded-2xl"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[17px] font-semibold leading-tight tracking-[-0.015em] text-current">
                            {agent.name}
                          </p>
                          <p className="mt-1 truncate text-[12px] text-stone-500">
                            {agent.id}
                            {agent.version ? ` · v${agent.version}` : ''}
                          </p>
                        </div>
                      </div>

                      {agent.repository ? (
                        <button
                          type="button"
                          aria-label={`Open repository ${agent.repository}`}
                          className="absolute right-4 top-4 inline-flex h-8 w-8 items-center justify-center rounded-xl text-stone-500 transition-colors hover:bg-white/70 hover:text-stone-800"
                          onClick={(event) => {
                            event.stopPropagation();
                            handleOpenWebLink(agent.repository ?? '');
                          }}
                        >
                          <ExternalLink className="h-4 w-4" />
                        </button>
                      ) : null}

                      <p className="mt-3 line-clamp-2 text-[14px] leading-[1.45] text-stone-600">
                        {agent.description ?? 'No description provided.'}
                      </p>

                      {!canAutoConfigure ? (
                        <p className="mt-auto pt-3 text-[11px] font-medium text-amber-700">
                          {launchTemplate.preview}
                        </p>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

const getFileName = (path: string): string => {
  const normalized = path.replaceAll('\\', '/');
  const segments = normalized.split('/').filter(Boolean);
  return segments.at(-1) ?? path;
};

const normalizePath = (value: string): string => value.replaceAll('\\', '/').replace(/\/+$/, '');

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

    // Preserve Windows drive-letter paths from file:///C:/...
    if (/^\/[a-z]:\//i.test(decodedPathname)) {
      return decodedPathname.slice(1);
    }

    return decodedPathname;
  } catch {
    return '';
  }
};

const extractPathsFromUriList = (value: string): string[] =>
  value
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .map((line) => {
      if (!line.startsWith('file://')) {
        return '';
      }

      return decodeFileUriPath(line);
    })
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

const dataTransferHasFiles = (dataTransfer: DataTransfer): boolean => {
  const contains = (dataTransfer.types as unknown as { contains?: (token: string) => boolean })
    .contains;
  if (typeof contains === 'function' && contains.call(dataTransfer.types, 'Files')) {
    return true;
  }

  return dataTransfer.files.length > 0 || Array.from(dataTransfer.types).includes('Files');
};

const resolveAbsolutePathFromFile = (file: File): string => {
  const fileWithPath = file as File & { path?: string };
  if (typeof fileWithPath.path === 'string' && fileWithPath.path.trim().length > 0) {
    return fileWithPath.path.trim();
  }

  const resolvedPath = window.desktop.getPathForFile(file)?.trim() ?? '';
  return resolvedPath;
};

const extractFilePathsFromDataTransfer = (dataTransfer: DataTransfer): string[] => {
  const paths = new Set<string>();

  for (const file of Array.from(dataTransfer.files)) {
    const absolutePath = resolveAbsolutePathFromFile(file);
    if (absolutePath.length > 0) {
      paths.add(absolutePath);
    }
  }

  for (const item of Array.from(dataTransfer.items)) {
    if (item.kind !== 'file') {
      continue;
    }

    const file = item.getAsFile();
    if (!file) {
      continue;
    }

    const absolutePath = resolveAbsolutePathFromFile(file);
    if (absolutePath.length > 0) {
      paths.add(absolutePath);
    }
  }

  const uriList = dataTransfer.getData('text/uri-list');
  for (const path of extractPathsFromUriList(uriList)) {
    paths.add(path);
  }

  const plainText = dataTransfer.getData('text/plain');
  if (plainText.includes('file://')) {
    for (const path of extractPathsFromUriList(plainText)) {
      paths.add(path);
    }
  }

  return Array.from(paths);
};

const extractFilePathsFromClipboard = (clipboard: DataTransfer): string[] =>
  extractFilePathsFromDataTransfer(clipboard);

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

  if (!entries.length) {
    return undefined;
  }

  return Object.fromEntries(entries);
};

interface AgentRegistryIconProps {
  iconUrl: string | null;
  label: string;
  className?: string;
}

const AgentRegistryIcon = ({
  iconUrl,
  label,
  className,
}: AgentRegistryIconProps): JSX.Element => {
  const fallbackLabel = label.trim().charAt(0).toUpperCase() || '?';

  return (
    <Avatar className={cn('h-4 w-4 rounded-[6px] bg-stone-100', className)}>
      {iconUrl ? (
        <AvatarImage
          src={iconUrl}
          alt={`${label} icon`}
          className="zeroade-agent-icon-image h-full w-full object-cover"
        />
      ) : null}
      <AvatarFallback className="rounded-[6px] bg-stone-200 text-[9px] font-semibold uppercase text-stone-600">
        {fallbackLabel}
      </AvatarFallback>
    </Avatar>
  );
};

interface ComposerSelectProps {
  label: string;
  options: ComposerControlOption[];
  ariaLabel: string;
  onSelect: (value: string) => void;
}

const ComposerSelect = ({
  label,
  options,
  onSelect,
  ariaLabel,
}: ComposerSelectProps): JSX.Element => {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="composer-tone-hover composer-select-trigger h-7 rounded-full bg-transparent px-2 text-[11px] text-stone-600 hover:bg-stone-100/80 focus-visible:ring-0"
          aria-label={ariaLabel}
        >
          {label}
          <ChevronDown className="ml-1 h-3.5 w-3.5 text-stone-500" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {options.map((option) => (
          <DropdownMenuItem key={option.id} onClick={() => onSelect(option.id)}>
            {option.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
