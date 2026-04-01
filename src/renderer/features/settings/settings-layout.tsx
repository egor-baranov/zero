import * as React from 'react';
import {
  ArrowLeft,
  Bot,
  ChevronDown,
  Check,
  Copy,
  ExternalLink,
  FolderSearch,
  GitBranch,
  Languages,
  Loader2,
  Palette,
  Pencil,
  Plus,
  Plug,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { cn } from '@renderer/lib/cn';
import { Button } from '@renderer/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@renderer/components/ui/avatar';
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
  onStoredNotificationsChanged,
  readStoredNotifications,
  type AppNotificationItem,
} from '@renderer/store/browser-pushes';
import type { AcpAgentPreset } from '@renderer/store/use-acp';
import type { AgentPresetSelection } from '@renderer/features/composer/composer';
import type { WorkspaceRecord } from '@renderer/store/use-shell-state';
import { useRunConfigurations } from '@renderer/store/use-run-configurations';
import { toLanguagePresentation } from '@renderer/lib/code-language-icons';
import {
  applyUiPreferences,
  getCodeFontFamily,
  getEditorThemePresetDefaults,
  parseEditorThemeFromClipboard,
  parseEditorThemeFromIntellijIcls,
  readUiPreferences,
  serializeEditorThemeForClipboard,
  type AccentColorPreference,
  type CodeFontPreference,
  type EditorThemeEditorColors,
  type EditorThemeMode,
  type EditorThemePreset,
  type EditorThemeSettings,
  type EditorThemeSyntaxColors,
  type UiPreferences,
  writeAccentColorPreference,
  writeEditorFontSizePreference,
  writeEditorThemesPreference,
  writeMonochromeLanguageIconsPreference,
  writeThemePreference,
} from '@renderer/store/ui-preferences';
import { McpSettingsSection } from '@renderer/features/settings/mcp-settings-section';
import { RunConfigurationDialog } from '@renderer/features/toolbar/run-configuration-dialog';
import { resolveEditorThemeVisuals } from '@renderer/lib/monaco-theme';
import type { AcpCustomAgentConfig } from '@shared/types/acp';
import type {
  SkillsCatalogDetailResult,
  SkillsCatalogEntry,
  SkillsCatalogResult,
  SkillSummary,
  SkillsListResult,
} from '@shared/types/skills';
import type { LspManagedServerSource, LspServerCatalogEntry } from '@shared/types/lsp';
import type { WorkspaceGitStatusResult } from '@shared/types/workspace';

interface SettingsLayoutProps {
  onBack: () => void;
  sidebarWidth: number;
  isResizing: boolean;
  showResizeHandle: boolean;
  onStartResizing: () => void;
  workspacePath: string;
  selectedWorkspaceId: string;
  recentWorkspaces: WorkspaceRecord[];
  agentPreset: AcpAgentPreset;
  customAgentConfig: AcpCustomAgentConfig | null;
  onSelectWorkspace: (workspaceId: string) => void;
  onOpenWorkspaceFromPath: (folderPath: string) => void;
  onSelectAgentPreset: (selection: AgentPresetSelection) => void;
}

const sections = [
  { id: 'general', label: 'General', icon: SlidersHorizontal },
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'agents', label: 'Agents', icon: Bot },
  { id: 'skills', label: 'Skills', icon: Sparkles },
  { id: 'lsp', label: 'LSP', icon: Languages },
  { id: 'mcp', label: 'MCP servers', icon: Plug },
  { id: 'git', label: 'Git', icon: GitBranch },
] as const;

type SectionId = (typeof sections)[number]['id'];

interface AccentOption {
  value: AccentColorPreference;
  label: string;
  swatch: string;
}

interface EditorThemePresetOption {
  value: Exclude<EditorThemePreset, 'custom'>;
  label: string;
  badgeLightBackground: string;
  badgeLightForeground: string;
  badgeDarkBackground: string;
  badgeDarkForeground: string;
}

interface CodeFontOption {
  value: CodeFontPreference;
  label: string;
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

interface AgentEditorState {
  customAgentId: string | 'new';
  title: string;
  command: string;
  args: string;
  cwd: string;
  env: string;
}

const accentOptions: AccentOption[] = [
  { value: 'default', label: 'Default', swatch: '#a8a29e' },
  { value: 'orange', label: 'Orange', swatch: '#f97316' },
  { value: 'yellow', label: 'Yellow', swatch: '#eab308' },
  { value: 'green', label: 'Green', swatch: '#22c55e' },
  { value: 'blue', label: 'Blue', swatch: '#3b82f6' },
  { value: 'pink', label: 'Pink', swatch: '#ec4899' },
  { value: 'purple', label: 'Purple', swatch: '#a855f7' },
  { value: 'black', label: 'Black', swatch: '#171717' },
];

const editorThemePresetOptions: EditorThemePresetOption[] = [
  {
    value: 'absolutely',
    label: 'Absolutely',
    badgeLightBackground: '#fff0e8',
    badgeLightForeground: '#d9825b',
    badgeDarkBackground: '#2b1e18',
    badgeDarkForeground: '#ffb487',
  },
  {
    value: 'catppuccin',
    label: 'Catppuccin',
    badgeLightBackground: '#f0e6ff',
    badgeLightForeground: '#8b5cf6',
    badgeDarkBackground: '#302749',
    badgeDarkForeground: '#cba6f7',
  },
  {
    value: 'zero',
    label: 'Zero',
    badgeLightBackground: '#e7f0ff',
    badgeLightForeground: '#0169cc',
    badgeDarkBackground: '#101828',
    badgeDarkForeground: '#6cc6ff',
  },
  {
    value: 'everforest',
    label: 'Everforest',
    badgeLightBackground: '#f2f0d8',
    badgeLightForeground: '#8aaa4a',
    badgeDarkBackground: '#233229',
    badgeDarkForeground: '#a7c080',
  },
  {
    value: 'github',
    label: 'GitHub',
    badgeLightBackground: '#eef5ff',
    badgeLightForeground: '#0969da',
    badgeDarkBackground: '#0d1b2a',
    badgeDarkForeground: '#58a6ff',
  },
  {
    value: 'gruvbox',
    label: 'Gruvbox',
    badgeLightBackground: '#f8edbd',
    badgeLightForeground: '#458588',
    badgeDarkBackground: '#312a1c',
    badgeDarkForeground: '#fabd2f',
  },
  {
    value: 'linear',
    label: 'Linear',
    badgeLightBackground: '#f2f4ff',
    badgeLightForeground: '#5e6ad2',
    badgeDarkBackground: '#171b2d',
    badgeDarkForeground: '#9da7ff',
  },
  {
    value: 'notion',
    label: 'Notion',
    badgeLightBackground: '#f7f7f5',
    badgeLightForeground: '#3b3b3b',
    badgeDarkBackground: '#222222',
    badgeDarkForeground: '#f5f5f5',
  },
  {
    value: 'one',
    label: 'One',
    badgeLightBackground: '#eef2ff',
    badgeLightForeground: '#4f6df5',
    badgeDarkBackground: '#232834',
    badgeDarkForeground: '#61afef',
  },
  {
    value: 'paper',
    label: 'Paper',
    badgeLightBackground: '#eef4ff',
    badgeLightForeground: '#1d4ed8',
    badgeDarkBackground: '#1c2432',
    badgeDarkForeground: '#7cc7ff',
  },
  {
    value: 'graphite',
    label: 'Graphite',
    badgeLightBackground: '#eaf4f5',
    badgeLightForeground: '#0f766e',
    badgeDarkBackground: '#13262b',
    badgeDarkForeground: '#4fd1c5',
  },
];

const getEditorThemePresetOption = (
  value: EditorThemePreset,
): EditorThemePresetOption | null => {
  if (value === 'custom') {
    return null;
  }

  return editorThemePresetOptions.find((option) => option.value === value) ?? null;
};

const codeFontOptions: CodeFontOption[] = [
  { value: 'system', label: 'System Mono' },
  { value: 'sf-mono', label: 'SF Mono' },
  { value: 'jetbrains-mono', label: 'JetBrains Mono' },
  { value: 'fira-code', label: 'Fira Code' },
  { value: 'menlo', label: 'Menlo' },
];

const editorFontSizeOptions = Array.from({ length: 14 }, (_value, index) => 11 + index);

type SyntaxColorKey = keyof NonNullable<EditorThemeSyntaxColors>;
type EditorColorKey = keyof NonNullable<EditorThemeEditorColors>;

const editorThemeSyntaxColorOptions: Array<{ key: SyntaxColorKey; label: string }> = [
  { key: 'keyword', label: 'Keyword' },
  { key: 'function', label: 'Function' },
  { key: 'type', label: 'Type' },
  { key: 'interface', label: 'Interface' },
  { key: 'parameter', label: 'Parameter' },
  { key: 'property', label: 'Property' },
  { key: 'variable', label: 'Variable' },
  { key: 'string', label: 'String' },
  { key: 'number', label: 'Number' },
  { key: 'delimiter', label: 'Delimiter' },
  { key: 'operator', label: 'Operator' },
  { key: 'metadata', label: 'Metadata' },
  { key: 'comment', label: 'Comment' },
];

const editorThemeEditorColorOptions: Array<{ key: EditorColorKey; label: string }> = [
  { key: 'selectionBackground', label: 'Selection' },
  { key: 'lineHighlightBackground', label: 'Current line' },
  { key: 'cursor', label: 'Cursor' },
  { key: 'lineNumber', label: 'Line numbers' },
  { key: 'activeLineNumber', label: 'Active line number' },
  { key: 'indentGuide', label: 'Indent guides' },
  { key: 'activeIndentGuide', label: 'Active indent guide' },
  { key: 'bracketMatchBorder', label: 'Bracket match' },
];

const ACP_REGISTRY_URL =
  'https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json';
const CUSTOM_AGENT_LIBRARY_KEY = 'zeroade.acp.custom-agent-library.v1';
const ACTIVE_CUSTOM_AGENT_ID_KEY = 'zeroade.acp.custom-agent-active-id.v1';
const KNOWN_CUSTOM_AGENT_LABEL_BY_COMMAND: Record<string, string> = {
  opencode: 'OpenCode',
};

const getWindowBackgroundColor = (mode: EditorThemeMode): string =>
  mode === 'light' ? '#fdfdff' : '#101013';

const resolveInterfaceTheme = (theme: UiPreferences['theme']): EditorThemeMode => {
  if (theme === 'light' || theme === 'dark') {
    return theme;
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

const hexToRgba = (value: string, alpha: number): string => {
  const normalized = value.replace('#', '');
  const expanded =
    normalized.length === 3
      ? `${normalized[0]}${normalized[0]}${normalized[1]}${normalized[1]}${normalized[2]}${normalized[2]}`
      : normalized;
  const r = Number.parseInt(expanded.slice(0, 2), 16);
  const g = Number.parseInt(expanded.slice(2, 4), 16);
  const b = Number.parseInt(expanded.slice(4, 6), 16);

  return `rgba(${r}, ${g}, ${b}, ${Math.min(Math.max(alpha, 0), 1)})`;
};

const getFolderName = (folderPath: string): string =>
  folderPath.split(/[\\/]/).filter(Boolean).pop() ?? folderPath;

const truncateText = (value: string, maxLength = 68): string =>
  value.length <= maxLength ? value : `${value.slice(0, maxLength).trimEnd()}…`;

const toCountLabel = (value: number, singular: string, plural = `${singular}s`): string =>
  `${value.toLocaleString()} ${value === 1 ? singular : plural}`;

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

const normalizeCustomAgentConfig = (
  config: AcpCustomAgentConfig,
): AcpCustomAgentConfig | null => toCustomAgentConfigFromUnknown(config);

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

const toCustomAgentConfigSignature = (config: AcpCustomAgentConfig | null | undefined): string =>
  config
    ? JSON.stringify({
        command: config.command.trim(),
        args: config.args.map((entry) => entry.trim()).filter((entry) => entry.length > 0),
        cwd: config.cwd?.trim() ?? '',
        env: Object.entries(config.env ?? {})
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, value]) => [key, value]),
      })
    : '';

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

    const npxPackage =
      rawNpx && typeof rawNpx.package === 'string' ? rawNpx.package.trim() : '';
    const uvxPackage =
      rawUvx && typeof rawUvx.package === 'string' ? rawUvx.package.trim() : '';

    parsed.push({
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
    });
  }

  parsed.sort((left, right) => left.name.localeCompare(right.name));
  return parsed;
};

const joinCommandPreview = (command: string, args: string[]): string =>
  args.length === 0 ? command : `${command} ${args.join(' ')}`;

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

const isLikelyRunnableCommand = (value: string): boolean => {
  if (!value) {
    return false;
  }

  if (/^[.]{1,2}[\\/]/.test(value)) {
    return true;
  }

  const hasPathSeparator = /[\\/]/.test(value);
  const looksAbsolute = /^([A-Za-z]:[\\/]|\/)/.test(value);
  return !hasPathSeparator || looksAbsolute;
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
      preview: joinCommandPreview('npx', args),
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
      preview: joinCommandPreview('uvx', args),
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
    binaryTarget && typeof binaryTarget.cmd === 'string' ? binaryTarget.cmd.trim() : '';
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
      preview: joinCommandPreview(binaryCommand, binaryArgs),
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

  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
};

const toCommandPreview = (config: AcpCustomAgentConfig | null): string => {
  if (!config) {
    return 'No saved command.';
  }

  const preview = [config.command, ...config.args].filter(Boolean).join(' ').trim();
  return preview.length > 0 ? truncateText(preview) : 'No saved command.';
};

const summarizeBranches = (branches: string[]): string => {
  if (branches.length === 0) {
    return 'No branches detected.';
  }

  if (branches.length <= 3) {
    return branches.join(', ');
  }

  return `${branches.slice(0, 3).join(', ')} +${branches.length - 3} more`;
};

export const SettingsLayout = ({
  onBack,
  sidebarWidth,
  isResizing,
  showResizeHandle,
  onStartResizing,
  workspacePath,
  selectedWorkspaceId,
  recentWorkspaces,
  agentPreset,
  customAgentConfig,
  onSelectWorkspace,
  onOpenWorkspaceFromPath,
  onSelectAgentPreset,
}: SettingsLayoutProps): JSX.Element => {
  const [activeSection, setActiveSection] = React.useState<SectionId>(sections[0].id);
  const [uiPreferences, setUiPreferences] = React.useState<UiPreferences>(() => readUiPreferences());
  const [editorThemeFeedback, setEditorThemeFeedback] = React.useState<
    Record<EditorThemeMode, string | null>
  >({
    light: null,
    dark: null,
  });
  const [notifications, setNotifications] = React.useState<AppNotificationItem[]>(() =>
    readStoredNotifications(),
  );
  const [gitStatus, setGitStatus] = React.useState<WorkspaceGitStatusResult | null>(null);
  const [isGitStatusLoading, setIsGitStatusLoading] = React.useState(false);
  const [gitStatusError, setGitStatusError] = React.useState<string | null>(null);
  const themeFeedbackTimeoutsRef = React.useRef<Partial<Record<EditorThemeMode, number>>>({});
  const editorThemeImportFileInputRef = React.useRef<HTMLInputElement | null>(null);
  const editorThemeImportModeRef = React.useRef<EditorThemeMode | null>(null);
  const interfaceTheme = resolveInterfaceTheme(uiPreferences.theme);
  const sharedCodeFont =
    uiPreferences.editorThemes.light.codeFont === uiPreferences.editorThemes.dark.codeFont
      ? uiPreferences.editorThemes.light.codeFont
      : uiPreferences.editorThemes[interfaceTheme].codeFont;
  const sharedFontLigatures =
    uiPreferences.editorThemes.light.fontLigatures === uiPreferences.editorThemes.dark.fontLigatures
      ? uiPreferences.editorThemes.light.fontLigatures
      : uiPreferences.editorThemes[interfaceTheme].fontLigatures;

  const hasWorkspace = workspacePath.trim().length > 1 && workspacePath !== '/';
  const workspaceName = hasWorkspace ? getFolderName(workspacePath) : 'No workspace';
  const {
    configurations: runConfigurations,
    selectedConfigurationId,
    selectedConfiguration,
    saveConfiguration,
    deleteConfiguration,
    selectConfiguration,
  } = useRunConfigurations(hasWorkspace ? workspacePath : '');
  const [isRunConfigurationDialogOpen, setIsRunConfigurationDialogOpen] = React.useState(false);
  const unreadNotificationCount = notifications.filter((item) => !item.read).length;
  const latestNotification = notifications[0] ?? null;
  React.useEffect(() => {
    writeThemePreference(uiPreferences.theme);
    writeAccentColorPreference(uiPreferences.accentColor);
    writeMonochromeLanguageIconsPreference(uiPreferences.monochromeLanguageIcons);
    writeEditorFontSizePreference(uiPreferences.editorFontSize);
    writeEditorThemesPreference(uiPreferences.editorThemes);
    applyUiPreferences(uiPreferences);

    if (uiPreferences.theme !== 'system') {
      return;
    }

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (): void => {
      applyUiPreferences(uiPreferences);
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => {
      mediaQuery.removeEventListener('change', handleChange);
    };
  }, [uiPreferences]);

  React.useEffect(() => {
    setNotifications(readStoredNotifications());
    return onStoredNotificationsChanged(() => {
      setNotifications(readStoredNotifications());
    });
  }, []);

  const showEditorThemeFeedback = React.useCallback(
    (mode: EditorThemeMode, message: string): void => {
      const existingTimeout = themeFeedbackTimeoutsRef.current[mode];
      if (existingTimeout !== undefined) {
        window.clearTimeout(existingTimeout);
      }

      setEditorThemeFeedback((previous) => ({
        ...previous,
        [mode]: message,
      }));

      themeFeedbackTimeoutsRef.current[mode] = window.setTimeout(() => {
        setEditorThemeFeedback((previous) => ({
          ...previous,
          [mode]: null,
        }));
      }, 2400);
    },
    [],
  );

  React.useEffect(() => {
    return () => {
      for (const timeoutId of Object.values(themeFeedbackTimeoutsRef.current)) {
        if (timeoutId !== undefined) {
          window.clearTimeout(timeoutId);
        }
      }
    };
  }, []);

  React.useEffect(() => {
    if (activeSection !== 'git') {
      return;
    }

    if (!hasWorkspace) {
      setGitStatus(null);
      setGitStatusError(null);
      setIsGitStatusLoading(false);
      return;
    }

    let cancelled = false;
    const loadGitStatus = async (): Promise<void> => {
      setIsGitStatusLoading(true);
      setGitStatusError(null);

      try {
        const result = await window.desktop.workspaceGitStatus({ workspacePath });
        if (cancelled) {
          return;
        }

        setGitStatus(result);
      } catch (error) {
        if (cancelled) {
          return;
        }

        setGitStatus(null);
        setGitStatusError(error instanceof Error ? error.message : 'Could not load repository state.');
      } finally {
        if (!cancelled) {
          setIsGitStatusLoading(false);
        }
      }
    };

    void loadGitStatus();

    return () => {
      cancelled = true;
    };
  }, [activeSection, hasWorkspace, workspacePath]);

  const handleRevealProject = React.useCallback(async (): Promise<void> => {
    if (!hasWorkspace) {
      return;
    }

    try {
      await window.desktop.workspaceRevealFile({
        absolutePath: workspacePath,
      });
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Could not reveal project.');
    }
  }, [hasWorkspace, workspacePath]);

  const handleOpenProject = React.useCallback(async (): Promise<void> => {
    try {
      const result = await window.desktop.openFolder();
      if (!result.canceled && result.path) {
        onOpenWorkspaceFromPath(result.path);
      }
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Could not open project.');
    }
  }, [onOpenWorkspaceFromPath]);

  const switchProjectControl = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="rounded-[10px]">
          {workspaceName}
          <ChevronDown className="ml-1.5 h-3.5 w-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[280px]">
        <DropdownMenuLabel>Recent projects</DropdownMenuLabel>
        {recentWorkspaces.length > 0 ? (
          recentWorkspaces.map((workspace) => (
            <DropdownMenuCheckboxItem
              key={workspace.id}
              checked={workspace.id === selectedWorkspaceId}
              onCheckedChange={() => {
                onSelectWorkspace(workspace.id);
              }}
              className="items-start"
            >
              <div className="min-w-0">
                <div className="truncate text-[13px] font-medium">{workspace.name}</div>
                <div className="truncate text-[12px] text-stone-500">{workspace.path}</div>
              </div>
            </DropdownMenuCheckboxItem>
          ))
        ) : (
          <DropdownMenuItem disabled>No recent projects</DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => {
            void handleOpenProject();
          }}
        >
          <FolderSearch className="mr-2 h-3.5 w-3.5" />
          Open project…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const runConfigurationControl =
    hasWorkspace && runConfigurations.length > 0 ? (
      <div className="flex items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="rounded-[10px]">
              {selectedConfiguration?.name ?? 'Select run'}
              <ChevronDown className="ml-1.5 h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-[320px]">
            <DropdownMenuLabel>Run configurations</DropdownMenuLabel>
            {runConfigurations.map((configuration) => (
              <DropdownMenuCheckboxItem
                key={configuration.id}
                checked={configuration.id === selectedConfiguration?.id}
                onCheckedChange={() => {
                  selectConfiguration(configuration.id);
                }}
                className="items-start"
              >
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-medium">{configuration.name}</div>
                  <div className="truncate text-[12px] text-stone-500">{configuration.command}</div>
                </div>
              </DropdownMenuCheckboxItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => {
                setIsRunConfigurationDialogOpen(true);
              }}
            >
              Manage run configurations
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          size="sm"
          variant="ghost"
          className="rounded-[10px]"
          onClick={() => {
            setIsRunConfigurationDialogOpen(true);
          }}
        >
          Manage
        </Button>
      </div>
    ) : (
      <div className="flex items-center gap-2">
        <PillLabel>{selectedConfiguration?.name ?? 'None'}</PillLabel>
        {hasWorkspace ? (
          <Button
            size="sm"
            variant="ghost"
            className="rounded-[10px]"
            onClick={() => {
              setIsRunConfigurationDialogOpen(true);
            }}
          >
            Manage
          </Button>
        ) : null}
      </div>
    );

  const renderGeneralSection = (): JSX.Element => (
    <>
      <SectionGroup title="Project">
        <SettingsCard>
          <SettingRow
            title="Current project"
            description={hasWorkspace ? workspacePath : 'No project is open for this thread.'}
            control={
              hasWorkspace ? (
                <div className="flex items-center gap-2">
                  <PillLabel>{workspaceName}</PillLabel>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="rounded-[10px]"
                    onClick={() => {
                      void handleRevealProject();
                    }}
                  >
                    Reveal
                  </Button>
                </div>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-[10px]"
                  onClick={() => {
                    void handleOpenProject();
                  }}
                >
                  <FolderSearch className="mr-1.5 h-3.5 w-3.5" />
                  Open project
                </Button>
              )
            }
          />
          <SettingRow
            title="Switch project"
            description={
              recentWorkspaces.length > 0
                ? `Switch between ${toCountLabel(recentWorkspaces.length, 'recent project')} or open another folder.`
                : 'Open a project folder to add it to the recent project list.'
            }
            control={switchProjectControl}
          />
          <SettingRow
            title="Run configuration"
            description={
              selectedConfiguration
                ? truncateText(selectedConfiguration.command.replace(/\s+/g, ' '))
                : hasWorkspace
                  ? `No run configuration is selected for ${workspaceName}.`
                  : 'Open a project to load its saved run configurations.'
            }
            control={runConfigurationControl}
          />
        </SettingsCard>
      </SectionGroup>

      <RunConfigurationDialog
        open={isRunConfigurationDialogOpen}
        configurations={runConfigurations}
        selectedConfigurationId={selectedConfigurationId}
        onOpenChange={setIsRunConfigurationDialogOpen}
        onSelectConfiguration={selectConfiguration}
        onSaveConfiguration={saveConfiguration}
        onDeleteConfiguration={deleteConfiguration}
      />

      <VoiceSettingsSection />

      <SectionGroup title="Notifications">
        <SettingsCard>
          <SettingRow
            title="Unread notifications"
            description="Items that still need attention in the notifications panel."
            control={<PillLabel>{toCountLabel(unreadNotificationCount, 'item')}</PillLabel>}
          />
          <SettingRow
            title="Saved notifications"
            description="Notifications currently stored in local history."
            control={<PillLabel>{toCountLabel(notifications.length, 'notification')}</PillLabel>}
          />
          <SettingRow
            title="Latest notification"
            description={
              latestNotification
                ? `${latestNotification.title} · ${latestNotification.origin}`
                : 'No notifications have been stored yet.'
            }
            control={<PillLabel>{latestNotification ? latestNotification.kind : 'None'}</PillLabel>}
          />
        </SettingsCard>
      </SectionGroup>
    </>
  );

  const renderAgentsSection = (): JSX.Element => (
    <AgentsSettingsSection
      workspacePath={workspacePath}
      agentPreset={agentPreset}
      customAgentConfig={customAgentConfig}
      onSelectAgentPreset={onSelectAgentPreset}
    />
  );

  const renderSkillsSection = (): JSX.Element => (
    <SkillsSettingsSection mode={interfaceTheme} />
  );

  const renderLspSection = (): JSX.Element => (
    <LspSettingsSection mode={interfaceTheme} />
  );

  const updateSharedCodeFont = React.useCallback((codeFont: CodeFontPreference): void => {
    setUiPreferences((previous) => ({
      ...previous,
      editorThemes: {
        light: {
          ...previous.editorThemes.light,
          codeFont,
        },
        dark: {
          ...previous.editorThemes.dark,
          codeFont,
        },
      },
    }));
  }, []);

  const updateSharedFontLigatures = React.useCallback((fontLigatures: boolean): void => {
    setUiPreferences((previous) => ({
      ...previous,
      editorThemes: {
        light: {
          ...previous.editorThemes.light,
          fontLigatures,
        },
        dark: {
          ...previous.editorThemes.dark,
          fontLigatures,
        },
      },
    }));
  }, []);

  const updateEditorTheme = React.useCallback((
    mode: EditorThemeMode,
    updater: (theme: EditorThemeSettings) => EditorThemeSettings,
  ): void => {
    setUiPreferences((previous) => ({
      ...previous,
      editorThemes: {
        ...previous.editorThemes,
        [mode]: updater(previous.editorThemes[mode]),
      },
    }));
  }, []);

  const updateEditorThemeSyntaxColor = React.useCallback((
    mode: EditorThemeMode,
    key: SyntaxColorKey,
    value: string,
  ): void => {
    updateEditorTheme(mode, (theme) => ({
      ...theme,
      preset: 'custom',
      syntaxColors: {
        ...(theme.syntaxColors ?? {}),
        [key]: value,
      },
    }));
  }, [updateEditorTheme]);

  const updateEditorThemeEditorColor = React.useCallback((
    mode: EditorThemeMode,
    key: EditorColorKey,
    value: string,
  ): void => {
    updateEditorTheme(mode, (theme) => ({
      ...theme,
      preset: 'custom',
      editorColors: {
        ...(theme.editorColors ?? {}),
        [key]: value,
      },
    }));
  }, [updateEditorTheme]);

  const copyEditorTheme = React.useCallback(
    async (mode: EditorThemeMode): Promise<void> => {
      const serialized = serializeEditorThemeForClipboard(mode, uiPreferences.editorThemes[mode]);

      try {
        await navigator.clipboard.writeText(serialized);
        showEditorThemeFeedback(mode, 'Theme copied.');
      } catch {
        window.prompt('Copy theme', serialized);
        showEditorThemeFeedback(mode, 'Theme ready to copy.');
      }
    },
    [showEditorThemeFeedback, uiPreferences.editorThemes],
  );

  const parseImportedEditorTheme = React.useCallback((
    value: string,
    mode: EditorThemeMode,
  ): EditorThemeSettings => {
    try {
      return parseEditorThemeFromClipboard(value, mode);
    } catch (clipboardError) {
      try {
        return parseEditorThemeFromIntellijIcls(value, mode);
      } catch (iclsError) {
        if (value.trim().startsWith('<') && iclsError instanceof Error) {
          throw iclsError;
        }

        if (clipboardError instanceof Error) {
          throw clipboardError;
        }

        throw new Error('Theme format is not recognized.');
      }
    }
  }, []);

  const importEditorThemeFromClipboard = React.useCallback(
    async (mode: EditorThemeMode): Promise<void> => {
      let rawTheme = '';

      try {
        rawTheme = (await navigator.clipboard.readText()).trim();
      } catch {
        rawTheme = '';
      }

      if (rawTheme.length === 0) {
        const prompted = window.prompt('Paste theme', '');
        rawTheme = prompted?.trim() ?? '';
      }

      if (rawTheme.length === 0) {
        return;
      }

      try {
        const importedTheme = parseImportedEditorTheme(rawTheme, mode);
        updateEditorTheme(mode, () => ({
          ...importedTheme,
          codeFont: sharedCodeFont,
          fontLigatures: sharedFontLigatures,
        }));
        showEditorThemeFeedback(mode, 'Theme imported.');
      } catch (error) {
        window.alert(error instanceof Error ? error.message : 'Could not import theme.');
      }
    },
    [
      parseImportedEditorTheme,
      sharedCodeFont,
      sharedFontLigatures,
      showEditorThemeFeedback,
      updateEditorTheme,
    ],
  );

  const importEditorThemeFromFile = React.useCallback((mode: EditorThemeMode): void => {
    editorThemeImportModeRef.current = mode;
    if (editorThemeImportFileInputRef.current) {
      editorThemeImportFileInputRef.current.value = '';
      editorThemeImportFileInputRef.current.click();
    }
  }, []);

  const handleEditorThemeImportFile = React.useCallback((
    event: React.ChangeEvent<HTMLInputElement>,
  ): void => {
    const mode = editorThemeImportModeRef.current;
    const file = event.target.files?.[0] ?? null;
    event.target.value = '';

    if (!mode || !file) {
      return;
    }

    void (async () => {
      try {
        const rawTheme = (await file.text()).trim();

        if (rawTheme.length === 0) {
          return;
        }

        const importedTheme = parseImportedEditorTheme(rawTheme, mode);
        updateEditorTheme(mode, () => ({
          ...importedTheme,
          codeFont: sharedCodeFont,
          fontLigatures: sharedFontLigatures,
        }));
        showEditorThemeFeedback(mode, `Imported ${file.name}.`);
      } catch (error) {
        window.alert(error instanceof Error ? error.message : 'Could not import theme.');
      }
    })();
  }, [
    parseImportedEditorTheme,
    sharedCodeFont,
    sharedFontLigatures,
    showEditorThemeFeedback,
    updateEditorTheme,
  ]);

  const renderAppearanceSection = (): JSX.Element => (
    <>
      <input
        ref={editorThemeImportFileInputRef}
        type="file"
        accept=".icls,.xml,.json,.txt"
        className="hidden"
        onChange={handleEditorThemeImportFile}
      />
      <SectionGroup title="Theme">
        <SettingsCard>
          <SettingRow
            title="Theme"
            description="Use light, dark, or match your system."
            control={
              <div className="inline-flex items-center gap-1 rounded-full bg-stone-100 p-0.5">
                <SegmentChip
                  active={uiPreferences.theme === 'light'}
                  onClick={() => {
                    setUiPreferences((previous) => ({
                      ...previous,
                      theme: 'light',
                    }));
                  }}
                >
                  Light
                </SegmentChip>
                <SegmentChip
                  active={uiPreferences.theme === 'dark'}
                  onClick={() => {
                    setUiPreferences((previous) => ({
                      ...previous,
                      theme: 'dark',
                    }));
                  }}
                >
                  Dark
                </SegmentChip>
                <SegmentChip
                  active={uiPreferences.theme === 'system'}
                  onClick={() => {
                    setUiPreferences((previous) => ({
                      ...previous,
                      theme: 'system',
                    }));
                  }}
                >
                  System
                </SegmentChip>
              </div>
            }
          />
          <div>
            <EditorThemePreview
              lightTheme={uiPreferences.editorThemes.light}
              darkTheme={uiPreferences.editorThemes.dark}
            />
          </div>
        </SettingsCard>
      </SectionGroup>

      <SectionGroup title="Editor Themes">
        <div className="space-y-4">
          <EditorThemeCard
            appearanceMode={interfaceTheme}
            mode="light"
            theme={uiPreferences.editorThemes.light}
            statusMessage={editorThemeFeedback.light}
            onImportFromClipboard={() => {
              void importEditorThemeFromClipboard('light');
            }}
            onImportFromFile={() => {
              importEditorThemeFromFile('light');
            }}
            onCopyTheme={() => {
              void copyEditorTheme('light');
            }}
            onSelectPreset={(preset) => {
              updateEditorTheme('light', () => ({
                ...getEditorThemePresetDefaults('light', preset),
                codeFont: sharedCodeFont,
                fontLigatures: sharedFontLigatures,
              }));
            }}
            onAccentChange={(accent) => {
              updateEditorTheme('light', (theme) => ({
                ...theme,
                preset: 'custom',
                accent,
              }));
            }}
            onBackgroundChange={(background) => {
              updateEditorTheme('light', (theme) => ({
                ...theme,
                preset: 'custom',
                background,
              }));
            }}
            onMatchWindowBackground={() => {
              updateEditorTheme('light', (theme) => ({
                ...theme,
                preset: 'custom',
                background: getWindowBackgroundColor('light'),
              }));
            }}
            onForegroundChange={(foreground) => {
              updateEditorTheme('light', (theme) => ({
                ...theme,
                preset: 'custom',
                foreground,
              }));
            }}
            onSyntaxColorChange={(key, value) => {
              updateEditorThemeSyntaxColor('light', key, value);
            }}
            onEditorColorChange={(key, value) => {
              updateEditorThemeEditorColor('light', key, value);
            }}
          />
          <EditorThemeCard
            appearanceMode={interfaceTheme}
            mode="dark"
            theme={uiPreferences.editorThemes.dark}
            statusMessage={editorThemeFeedback.dark}
            onImportFromClipboard={() => {
              void importEditorThemeFromClipboard('dark');
            }}
            onImportFromFile={() => {
              importEditorThemeFromFile('dark');
            }}
            onCopyTheme={() => {
              void copyEditorTheme('dark');
            }}
            onSelectPreset={(preset) => {
              updateEditorTheme('dark', () => ({
                ...getEditorThemePresetDefaults('dark', preset),
                codeFont: sharedCodeFont,
                fontLigatures: sharedFontLigatures,
              }));
            }}
            onAccentChange={(accent) => {
              updateEditorTheme('dark', (theme) => ({
                ...theme,
                preset: 'custom',
                accent,
              }));
            }}
            onBackgroundChange={(background) => {
              updateEditorTheme('dark', (theme) => ({
                ...theme,
                preset: 'custom',
                background,
              }));
            }}
            onMatchWindowBackground={() => {
              updateEditorTheme('dark', (theme) => ({
                ...theme,
                preset: 'custom',
                background: getWindowBackgroundColor('dark'),
              }));
            }}
            onForegroundChange={(foreground) => {
              updateEditorTheme('dark', (theme) => ({
                ...theme,
                preset: 'custom',
                foreground,
              }));
            }}
            onSyntaxColorChange={(key, value) => {
              updateEditorThemeSyntaxColor('dark', key, value);
            }}
            onEditorColorChange={(key, value) => {
              updateEditorThemeEditorColor('dark', key, value);
            }}
          />
        </div>
      </SectionGroup>

      <SectionGroup title="Editor">
        <SettingsCard>
          <SettingRow
            title="Font size"
            description="Controls Monaco editor text size. You can also use Cmd/Ctrl + and Cmd/Ctrl - while an editor is focused."
            control={
              <EditorFontSizeSelect
                value={uiPreferences.editorFontSize}
                onSelect={(editorFontSize) => {
                  setUiPreferences((previous) => ({
                    ...previous,
                    editorFontSize,
                  }));
                }}
              />
            }
          />
          <SettingRow
            title="Code font"
            description="Controls the Monaco editor font family in both light and dark themes. Falls back if a font is not installed."
            control={<CodeFontSelect value={sharedCodeFont} onSelect={updateSharedCodeFont} />}
          />
          <SettingRow
            title="Font ligatures"
            description="Enables programming ligatures in Monaco editors for both light and dark themes."
            control={
              <SettingsSwitch
                checked={sharedFontLigatures}
                ariaLabel="Toggle editor font ligatures"
                onCheckedChange={updateSharedFontLigatures}
              />
            }
          />
        </SettingsCard>
      </SectionGroup>

      <SectionGroup title="Interface">
        <SettingsCard>
          <SettingRow
            title="Accent color"
            description="Choose the accent color for the app chrome and active controls."
            control={
              <AccentColorSelect
                value={uiPreferences.accentColor}
                onSelect={(accentColor) => {
                  setUiPreferences((previous) => ({
                    ...previous,
                    accentColor,
                  }));
                }}
              />
            }
          />
          <SettingRow
            title="Monochrome language icons"
            description="Keeps programming language and code file icons neutral across the app. Turn it off to show language colors."
            control={
              <SettingsSwitch
                checked={uiPreferences.monochromeLanguageIcons}
                ariaLabel="Toggle monochrome language icons"
                onCheckedChange={(monochromeLanguageIcons) => {
                  setUiPreferences((previous) => ({
                    ...previous,
                    monochromeLanguageIcons,
                  }));
                }}
              />
            }
          />
        </SettingsCard>
      </SectionGroup>
    </>
  );

  const renderMcpSection = (): JSX.Element => <McpSettingsSection />;

  const renderGitSection = (): JSX.Element => {
    if (!hasWorkspace) {
      return (
        <SectionGroup title="Repository">
          <SettingsCard>
            <SettingRow
              title="Workspace folder"
              description="Open a workspace to inspect repository status here."
              control={<PillLabel>Not opened</PillLabel>}
            />
          </SettingsCard>
        </SectionGroup>
      );
    }

    if (isGitStatusLoading) {
      return (
        <SectionGroup title="Repository">
          <SettingsCard>
            <SettingRow
              title="Repository status"
              description="Loading the current workspace repository details."
              control={<PillLabel>Loading…</PillLabel>}
            />
          </SettingsCard>
        </SectionGroup>
      );
    }

    if (gitStatusError) {
      return (
        <SectionGroup title="Repository">
          <SettingsCard>
            <SettingRow
              title="Repository status"
              description={gitStatusError}
              control={<PillLabel>Error</PillLabel>}
            />
          </SettingsCard>
        </SectionGroup>
      );
    }

    if (!gitStatus?.available) {
      return (
        <SectionGroup title="Repository">
          <SettingsCard>
            <SettingRow
              title="Repository"
              description="Current workspace is not a git repository."
              control={<PillLabel>No repo</PillLabel>}
            />
          </SettingsCard>
        </SectionGroup>
      );
    }

    return (
      <>
        <SectionGroup title="Repository">
          <SettingsCard>
            <SettingRow
              title="Current branch"
              description="The branch checked out for this workspace."
              control={<PillLabel>{gitStatus.currentBranch ?? 'Detached'}</PillLabel>}
            />
            <SettingRow
              title="Local branches"
              description={summarizeBranches(gitStatus.localBranches)}
              control={<PillLabel>{toCountLabel(gitStatus.localBranches.length, 'branch')}</PillLabel>}
            />
            <SettingRow
              title="Remote branches"
              description={summarizeBranches(gitStatus.remoteBranches)}
              control={<PillLabel>{toCountLabel(gitStatus.remoteBranches.length, 'branch')}</PillLabel>}
            />
          </SettingsCard>
        </SectionGroup>

        <SectionGroup title="Working tree">
          <SettingsCard>
            <SettingRow
              title="Changed files"
              description="Files with local modifications in the working tree."
              control={<PillLabel>{toCountLabel(gitStatus.uncommittedFiles, 'file')}</PillLabel>}
            />
            <SettingRow
              title="Added lines"
              description="Total added lines across current uncommitted changes."
              control={<PillLabel>{gitStatus.additions.toLocaleString()}</PillLabel>}
            />
            <SettingRow
              title="Deleted lines"
              description="Total deleted lines across current uncommitted changes."
              control={<PillLabel>{gitStatus.deletions.toLocaleString()}</PillLabel>}
            />
          </SettingsCard>
        </SectionGroup>
      </>
    );
  };

  const renderSectionContent = (): JSX.Element => {
    if (activeSection === 'general') {
      return renderGeneralSection();
    }

    if (activeSection === 'agents') {
      return renderAgentsSection();
    }

    if (activeSection === 'skills') {
      return renderSkillsSection();
    }

    if (activeSection === 'lsp') {
      return renderLspSection();
    }

    if (activeSection === 'appearance') {
      return renderAppearanceSection();
    }

    if (activeSection === 'mcp') {
      return renderMcpSection();
    }

    return renderGitSection();
  };

  return (
    <section className="flex h-full min-w-0 bg-transparent">
      <aside
        style={{ width: sidebarWidth }}
        className={cn(
          'shrink-0 overflow-hidden',
          !isResizing && 'transition-[width] duration-200 ease-out',
        )}
      >
        <div className="zeroade-sidebar-panel-surface flex h-full flex-col border-r border-r-[var(--zeroade-shell-divider)]">
          <div className="px-3 pt-2.5">
            <button
              type="button"
              className="zeroade-sidebar-hover-shadow zeroade-sidebar-hover-surface no-drag mb-0.5 flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-sm text-stone-600 transition-colors hover:text-stone-900"
              onClick={onBack}
            >
              <ArrowLeft className="h-4 w-4" />
              Back to app
            </button>
          </div>

          <div className="space-y-0.5 px-2.5 pt-2">
            {sections.map((section) => {
              const Icon = section.icon;
              const isActive = section.id === activeSection;

              return (
                <button
                  key={section.id}
                  type="button"
                  className={cn(
                    'zeroade-sidebar-hover-shadow zeroade-sidebar-hover-surface no-drag flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-left text-[13px] text-stone-600 transition-colors hover:text-stone-900',
                    isActive && 'zeroade-sidebar-active-surface text-stone-900',
                  )}
                  onClick={() => setActiveSection(section.id)}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {section.label}
                </button>
              );
            })}
          </div>
        </div>
      </aside>

      {showResizeHandle ? (
        <button
          type="button"
          aria-label="Resize settings sidebar"
          className="no-drag relative w-0 cursor-col-resize"
          onPointerDown={onStartResizing}
        >
          <span className="absolute inset-y-0 -left-5 w-10" />
        </button>
      ) : null}

      <div className="min-w-0 flex-1 overflow-y-auto bg-[#fdfdff]">
        <div className="mx-auto w-full max-w-[760px] px-6 pb-10 pt-7">
          <h2 className="text-[35px] font-semibold tracking-[-0.02em] text-stone-900">
            {sections.find((section) => section.id === activeSection)?.label ?? 'General'}
          </h2>

          <div className="mt-5">{renderSectionContent()}</div>
        </div>
      </div>
    </section>
  );
};

const toSettingsErrorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message.trim();
  }

  if (typeof error === 'string' && error.trim().length > 0) {
    return error.trim();
  }

  return fallback;
};

const toLspSourceLabel = (source: LspManagedServerSource): string => {
  if (source === 'managed') {
    return 'Managed';
  }

  if (source === 'development') {
    return 'Development';
  }

  if (source === 'system') {
    return 'System';
  }

  return 'Missing';
};

const LspServerLanguageIcons = ({
  mode,
  languages,
}: {
  mode: EditorThemeMode;
  languages: string[];
}): JSX.Element => {
  const normalizedLanguages = Array.from(
    new Set(languages.map((language) => language.trim().toLowerCase()).filter(Boolean)),
  );
  const visibleLanguages =
    normalizedLanguages.includes('typescript') && normalizedLanguages.includes('javascript')
      ? ['typescript']
      : normalizedLanguages.slice(0, 2);

  return (
    <div className="flex shrink-0 items-center">
      {visibleLanguages.map((language, index) => {
        const languagePresentation = toLanguagePresentation(language);
        const LanguageIcon = languagePresentation.Icon;

        return (
          <span
            key={language}
            title={languagePresentation.label}
            className={cn(
              'inline-flex h-8 w-8 items-center justify-center rounded-[10px] border text-[15px]',
              index > 0 && '-ml-1.5',
              mode === 'dark'
                ? 'border-stone-800 bg-stone-900 text-stone-100'
                : 'border-stone-200/80 bg-stone-100 text-stone-700',
            )}
          >
            <LanguageIcon className="h-4 w-4" />
          </span>
        );
      })}
    </div>
  );
};

const LspSettingsSection = ({ mode }: { mode: EditorThemeMode }): JSX.Element => {
  const [servers, setServers] = React.useState<LspServerCatalogEntry[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [searchQuery, setSearchQuery] = React.useState('');
  const [pendingServerId, setPendingServerId] = React.useState<string | null>(null);

  const loadServers = React.useCallback(async (): Promise<void> => {
    setIsLoading(true);
    setError(null);

    try {
      const result = await window.desktop.lspListServers();
      setServers(result.servers);
    } catch (loadError) {
      setError(toSettingsErrorMessage(loadError, 'Could not load language servers.'));
    } finally {
      setIsLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadServers();
  }, [loadServers]);

  const handleInstall = React.useCallback(async (server: LspServerCatalogEntry): Promise<void> => {
    setPendingServerId(server.id);

    try {
      await window.desktop.lspInstallServer({ serverId: server.id });
      await loadServers();
    } catch {
      // Keep the catalog stable and rely on button state instead of a separate summary card.
    } finally {
      setPendingServerId(null);
    }
  }, [loadServers]);

  const handleDelete = React.useCallback(async (server: LspServerCatalogEntry): Promise<void> => {
    setPendingServerId(server.id);

    try {
      await window.desktop.lspDeleteServer({ serverId: server.id });
      await loadServers();
    } catch {
      // Keep the catalog stable and rely on button state instead of a separate summary card.
    } finally {
      setPendingServerId(null);
    }
  }, [loadServers]);

  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const visibleServers = React.useMemo(
    () =>
      normalizedSearchQuery.length === 0
        ? servers
        : servers.filter((server) =>
            [
              server.name,
              server.description,
              server.detail ?? '',
              ...server.languages,
            ].some((value) => value.toLowerCase().includes(normalizedSearchQuery)),
          ),
    [normalizedSearchQuery, servers],
  );

  const toolbar = (
    <div className="flex items-center gap-2">
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 rounded-[10px]"
        onClick={() => {
          void loadServers();
        }}
        disabled={isLoading}
        aria-label="Reload language servers"
        title="Reload language servers"
      >
        {isLoading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <RefreshCw className="h-3.5 w-3.5" />
        )}
      </Button>
      <label className="inline-flex h-8 items-center gap-2 rounded-full border border-stone-200 bg-white pl-3 pr-3 text-[13px] text-stone-500">
        <Search className="h-3.5 w-3.5 shrink-0" />
        <input
          value={searchQuery}
          onChange={(event) => {
            setSearchQuery(event.target.value);
          }}
          placeholder="Search servers"
          className="w-[180px] bg-transparent text-stone-700 outline-none placeholder:text-stone-400"
          aria-label="Search language servers"
        />
      </label>
    </div>
  );

  return (
    <>
      <SectionGroup title="" action={toolbar}>
        <SettingsCard>
          {isLoading && servers.length === 0 ? (
            <SettingRow
              title="Loading language servers"
              description="Reading the available LSP catalog and install state."
              control={<PillLabel>Loading…</PillLabel>}
            />
          ) : error ? (
            <SettingRow
              title="Language servers unavailable"
              description={error}
              control={<PillLabel>Error</PillLabel>}
            />
          ) : visibleServers.length === 0 ? (
            <SettingRow
              title={normalizedSearchQuery ? 'No matching language servers' : 'No language servers'}
              description={
                normalizedSearchQuery
                  ? 'Try a different search query.'
                  : 'Zero does not have any language server definitions configured.'
              }
              control={<PillLabel>Empty</PillLabel>}
            />
          ) : (
            visibleServers.map((server) => (
              <LspServerSettingsRow
                key={server.id}
                mode={mode}
                server={server}
                isPending={pendingServerId === server.id}
                onInstall={() => {
                  void handleInstall(server);
                }}
                onDelete={() => {
                  void handleDelete(server);
                }}
              />
            ))
          )}
        </SettingsCard>
      </SectionGroup>
    </>
  );
};

const LspServerSettingsRow = ({
  mode,
  server,
  isPending,
  onInstall,
  onDelete,
}: {
  mode: EditorThemeMode;
  server: LspServerCatalogEntry;
  isPending: boolean;
  onInstall: () => void;
  onDelete: () => void;
}): JSX.Element => (
  <div className="flex items-center justify-between gap-4 border-b border-stone-200/75 px-3 py-3 last:border-b-0">
    <div className="flex min-w-0 items-start gap-3">
      <LspServerLanguageIcons mode={mode} languages={server.languages} />
      <div className="min-w-0">
        <p className="min-w-0 text-[14px] font-medium text-stone-800">{server.name}</p>
        <p className="mt-0.5 text-[12px] text-stone-500">
          {toLspSourceLabel(server.source)}
          {' · '}
          {server.installKind === 'manual'
            ? 'Manual install'
            : server.installKind === 'download'
              ? 'Managed download available'
              : 'Managed install available'}
        </p>
        <p className="mt-1 text-[13px] text-stone-500">{server.description}</p>
        {server.detail ? <p className="mt-1 text-[12px] text-stone-500">{server.detail}</p> : null}
      </div>
    </div>
    <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
      <PillLabel>{toLspSourceLabel(server.source)}</PillLabel>
      {server.canInstall ? (
        <Button
          size="sm"
          variant="outline"
          className="rounded-[10px]"
          onClick={onInstall}
          disabled={isPending}
        >
          {isPending ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Plus className="mr-1.5 h-3.5 w-3.5" />
          )}
          {isPending ? 'Installing…' : 'Install'}
        </Button>
      ) : null}
      {server.canDelete ? (
        <Button
          size="sm"
          variant="ghost"
          className={cn(
            'rounded-[10px]',
            mode === 'dark'
              ? 'text-rose-300 hover:bg-rose-950/40 hover:text-rose-200'
              : 'text-rose-700 hover:bg-rose-50 hover:text-rose-800',
          )}
          onClick={onDelete}
          disabled={isPending}
        >
          {isPending ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Trash2 className="mr-1.5 h-3.5 w-3.5" />
          )}
          {isPending ? 'Deleting…' : 'Delete'}
        </Button>
      ) : null}
      {!server.canInstall && !server.canDelete && server.installed ? (
        <Button size="sm" variant="ghost" className="rounded-[10px]" disabled>
          <Check className="mr-1.5 h-3.5 w-3.5" />
          Available
        </Button>
      ) : null}
    </div>
  </div>
);

const VoiceSettingsSection = (): JSX.Element => {
  const [draftOpenAiApiKey, setDraftOpenAiApiKey] = React.useState('');
  const [savedOpenAiApiKey, setSavedOpenAiApiKey] = React.useState('');
  const [isLoading, setIsLoading] = React.useState(true);
  const [isSaving, setIsSaving] = React.useState(false);
  const [isKeyVisible, setIsKeyVisible] = React.useState(false);
  const [statusMessage, setStatusMessage] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;

    const loadVoiceSettings = async (): Promise<void> => {
      setIsLoading(true);
      setStatusMessage(null);

      try {
        const result = await window.desktop.settingsGetVoiceSettings();
        if (cancelled) {
          return;
        }

        setDraftOpenAiApiKey(result.openAiApiKey);
        setSavedOpenAiApiKey(result.openAiApiKey);
      } catch (error) {
        if (cancelled) {
          return;
        }

        setStatusMessage(toSettingsErrorMessage(error, 'Could not load voice settings.'));
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void loadVoiceSettings();

    return () => {
      cancelled = true;
    };
  }, []);

  const normalizedDraftKey = draftOpenAiApiKey.trim();
  const normalizedSavedKey = savedOpenAiApiKey.trim();
  const hasSavedKey = normalizedSavedKey.length > 0;
  const canSave = !isLoading && !isSaving && normalizedDraftKey !== normalizedSavedKey;
  const canClear =
    !isLoading && !isSaving && (normalizedDraftKey.length > 0 || normalizedSavedKey.length > 0);

  const handleSave = React.useCallback(async (): Promise<void> => {
    setIsSaving(true);

    try {
      const nextSettings = await window.desktop.settingsSetVoiceSettings({
        openAiApiKey: draftOpenAiApiKey,
      });
      setDraftOpenAiApiKey(nextSettings.openAiApiKey);
      setSavedOpenAiApiKey(nextSettings.openAiApiKey);
      setStatusMessage(
        nextSettings.openAiApiKey.trim().length > 0
          ? 'Voice API key saved.'
          : 'Voice API key cleared.',
      );
    } catch (error) {
      setStatusMessage(toSettingsErrorMessage(error, 'Could not save voice settings.'));
    } finally {
      setIsSaving(false);
    }
  }, [draftOpenAiApiKey]);

  const handleClear = React.useCallback(() => {
    setDraftOpenAiApiKey('');
    setStatusMessage(null);
  }, []);

  const inputPlaceholder = hasSavedKey ? 'OpenAI API key saved' : 'sk-...';
  const description = statusMessage
    ? statusMessage
    : hasSavedKey
      ? 'Stored locally in Zero settings on this machine. Used for voice transcription fallback when ACP audio is unavailable.'
      : 'Stored locally in Zero settings on this machine. Leave empty to keep using OPENAI_API_KEY or CODEX_API_KEY from the environment.';

  return (
    <SectionGroup title="Voice">
      <SettingsCard>
        <SettingRow
          title="OpenAI API key"
          description={description}
          control={
            <div className="flex max-w-[440px] flex-wrap items-center justify-end gap-2">
              <input
                type={isKeyVisible ? 'text' : 'password'}
                value={draftOpenAiApiKey}
                onChange={(event) => {
                  setDraftOpenAiApiKey(event.target.value);
                  setStatusMessage(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && canSave) {
                    event.preventDefault();
                    void handleSave();
                  }
                }}
                placeholder={isLoading ? 'Loading…' : inputPlaceholder}
                disabled={isLoading || isSaving}
                autoCapitalize="off"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                className="no-drag h-8 w-[260px] rounded-full border border-stone-200 bg-white px-3 text-[13px] text-stone-700 placeholder:text-stone-400 focus:outline-none disabled:cursor-default disabled:bg-stone-50"
                aria-label="OpenAI API key for voice input"
              />
              <Button
                size="sm"
                variant="ghost"
                className="h-8 rounded-[10px] px-3 text-[13px]"
                disabled={isLoading}
                onClick={() => {
                  setIsKeyVisible((previous) => !previous);
                }}
              >
                {isKeyVisible ? 'Hide' : 'Show'}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                className="h-8 rounded-[10px] px-3 text-[13px]"
                disabled={!canSave}
                onClick={() => {
                  void handleSave();
                }}
              >
                {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Save'}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-8 rounded-[10px] px-3 text-[13px]"
                disabled={!canClear}
                onClick={handleClear}
              >
                Clear
              </Button>
            </div>
          }
        />
        <SettingRow
          title="Current source"
          description="This key is used only for local voice transcription fallback."
          control={<PillLabel>{hasSavedKey ? 'Settings' : 'Environment'}</PillLabel>}
        />
      </SettingsCard>
    </SectionGroup>
  );
};

interface SectionGroupProps {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}

const SectionGroup = ({ title, action, children }: SectionGroupProps): JSX.Element => (
  <section className="mt-6 first:mt-0">
    {title || action ? (
      <div className="flex items-center justify-between gap-4">
        {title ? <h3 className="text-[20px] font-semibold text-stone-900">{title}</h3> : <div />}
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
    ) : null}
    <div className="mt-3">{children}</div>
  </section>
);

const SettingsCard = ({ children }: { children: React.ReactNode }): JSX.Element => (
  <div className="overflow-hidden rounded-2xl border border-stone-200/80 bg-white">{children}</div>
);

interface SettingRowProps {
  title: string;
  description?: string;
  control: React.ReactNode;
}

const SettingRow = ({ title, description, control }: SettingRowProps): JSX.Element => {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-stone-200/75 px-3 py-3 last:border-b-0">
      <div className="min-w-0">
        <p className="text-[14px] font-medium text-stone-800">{title}</p>
        {description ? <p className="mt-0.5 text-[13px] text-stone-500">{description}</p> : null}
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
};

const PillLabel = ({ children }: { children: React.ReactNode }): JSX.Element => (
  <span className="inline-flex h-8 items-center rounded-full bg-stone-100 px-3 text-[13px] text-stone-700">
    {children}
  </span>
);

interface SegmentChipProps {
  children: React.ReactNode;
  active?: boolean;
  onClick: () => void;
}

const SegmentChip = ({ children, active = false, onClick }: SegmentChipProps): JSX.Element => {
  return (
    <button
      type="button"
      className={cn(
        'inline-flex h-7 items-center rounded-full px-2.5 text-[12px] text-stone-600 transition-colors',
        active && 'settings-segment-chip-active shadow-sm',
      )}
      aria-pressed={active}
      onClick={onClick}
    >
      {children}
    </button>
  );
};

interface EditorThemePreviewProps {
  lightTheme: EditorThemeSettings;
  darkTheme: EditorThemeSettings;
}

const EditorThemePreview = ({
  lightTheme,
  darkTheme,
}: EditorThemePreviewProps): JSX.Element => (
  <div className="overflow-hidden bg-stone-50">
    <div className="grid gap-px bg-stone-200/80 md:grid-cols-2">
      <EditorThemePreviewPane mode="light" theme={lightTheme} />
      <EditorThemePreviewPane mode="dark" theme={darkTheme} />
    </div>
  </div>
);

interface EditorThemePreviewPaneProps {
  mode: EditorThemeMode;
  theme: EditorThemeSettings;
}

const EditorThemePreviewPane = ({
  mode,
  theme,
}: EditorThemePreviewPaneProps): JSX.Element => {
  const resolvedVisuals = React.useMemo(() => resolveEditorThemeVisuals(theme, mode), [mode, theme]);
  const lineOverlay =
    mode === 'light' ? hexToRgba(theme.diffRemoved, 0.18) : hexToRgba(theme.diffAdded, 0.18);
  const gutterOverlay =
    mode === 'light' ? hexToRgba(theme.diffRemoved, 0.28) : hexToRgba(theme.diffAdded, 0.28);
  const keywordColor = resolvedVisuals.syntaxColors.keyword;
  const propertyColor = resolvedVisuals.syntaxColors.type;
  const valueColor = resolvedVisuals.syntaxColors.string;
  const fontFamily = getCodeFontFamily(theme.codeFont);
  const fontVariantLigatures = theme.fontLigatures ? 'normal' : 'none';
  const rows =
    mode === 'light'
      ? [
          ['1', 'const', 'themePreview', '{'],
          ['2', 'surface', `"${theme.background}"`, ''],
          ['3', 'accent', `"${theme.accent}"`, ''],
          ['4', '};', '', ''],
        ]
      : [
          ['1', 'const', 'themePreview', '{'],
          ['2', 'surface', `"${theme.background}"`, ''],
          ['3', 'accent', `"${theme.accent}"`, ''],
          ['4', '};', '', ''],
        ];

  return (
    <div
      className="px-0 py-0"
      style={{
        backgroundColor: theme.background,
        color: theme.foreground,
      }}
    >
      {rows.map(([lineNumber, key, value, suffix], index) => (
        <div
          key={`${mode}-${lineNumber}`}
          className="grid grid-cols-[44px_minmax(0,1fr)] text-[13px]"
          style={{
            backgroundColor: index > 0 && index < rows.length - 1 ? lineOverlay : 'transparent',
          }}
        >
          <div
            className="border-r border-black/5 px-3 py-2 text-right"
            style={{
              backgroundColor: index > 0 && index < rows.length - 1 ? gutterOverlay : 'transparent',
              color: mode === 'light' ? 'rgba(17, 24, 39, 0.55)' : 'rgba(255, 255, 255, 0.52)',
              fontFamily,
              fontVariantLigatures,
            }}
          >
            {lineNumber}
          </div>
          <div className="overflow-hidden px-4 py-2" style={{ fontFamily, fontVariantLigatures }}>
            {index === 0 ? (
              <>
                <span style={{ color: keywordColor }}>const</span>{' '}
                <span style={{ color: propertyColor }}>themePreview</span>: ThemeConfig ={' '}
                <span>{'{'}</span>
              </>
            ) : index === rows.length - 1 ? (
              <span>{key}</span>
            ) : (
              <>
                <span className="opacity-70">  </span>
                <span style={{ color: propertyColor }}>{key}</span>:&nbsp;
                <span style={{ color: valueColor }}>{value}</span>
                {suffix ? <span>{suffix}</span> : null}
                <span>,</span>
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  );
};

interface EditorThemeCardProps {
  appearanceMode: EditorThemeMode;
  mode: EditorThemeMode;
  theme: EditorThemeSettings;
  statusMessage: string | null;
  onImportFromClipboard: () => void;
  onImportFromFile: () => void;
  onCopyTheme: () => void;
  onSelectPreset: (preset: Exclude<EditorThemePreset, 'custom'>) => void;
  onAccentChange: (value: string) => void;
  onBackgroundChange: (value: string) => void;
  onMatchWindowBackground: () => void;
  onForegroundChange: (value: string) => void;
  onSyntaxColorChange: (key: SyntaxColorKey, value: string) => void;
  onEditorColorChange: (key: EditorColorKey, value: string) => void;
}

const EditorThemeCard = ({
  appearanceMode,
  mode,
  theme,
  statusMessage,
  onImportFromClipboard,
  onImportFromFile,
  onCopyTheme,
  onSelectPreset,
  onAccentChange,
  onBackgroundChange,
  onMatchWindowBackground,
  onForegroundChange,
  onSyntaxColorChange,
  onEditorColorChange,
}: EditorThemeCardProps): JSX.Element => {
  const title = mode === 'light' ? 'Light theme' : 'Dark theme';
  const resolvedVisuals = React.useMemo(() => resolveEditorThemeVisuals(theme, mode), [mode, theme]);

  return (
    <div className="overflow-hidden rounded-2xl border border-stone-200/80 bg-white">
      <div className="flex items-center justify-between gap-4 border-b border-stone-200/75 px-3 py-3">
        <div>
          <p className="text-[15px] font-medium text-stone-800">{title}</p>
          <p
            className={cn(
              'mt-0.5 text-[13px]',
              statusMessage ? 'text-[#0169cc]' : 'text-stone-500',
            )}
          >
            {statusMessage ?? `Active whenever the app is in ${mode} mode.`}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-4">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <HeaderActionButton className="gap-1.5">
                Import
                <ChevronDown className="h-3.5 w-3.5" />
              </HeaderActionButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[180px] rounded-[18px] p-2">
              <DropdownMenuItem
                className="min-h-10 rounded-[12px] px-3 text-[14px]"
                onSelect={onImportFromClipboard}
              >
                From clipboard
              </DropdownMenuItem>
              <DropdownMenuItem
                className="min-h-10 rounded-[12px] px-3 text-[14px]"
                onSelect={onImportFromFile}
              >
                Browse..
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <HeaderActionButton onClick={onCopyTheme}>Copy theme</HeaderActionButton>
          <EditorThemePresetSelect mode={mode} value={theme.preset} onSelect={onSelectPreset} />
        </div>
      </div>
      <SettingRow
        title="Accent"
        control={<HexColorControl value={theme.accent} onChange={onAccentChange} />}
      />
      <SettingRow
        title="Background"
        control={
          <div className="flex items-center gap-2">
            <HexColorControl value={theme.background} onChange={onBackgroundChange} />
            <ActionChip onClick={onMatchWindowBackground}>Match app</ActionChip>
          </div>
        }
      />
      <SettingRow
        title="Foreground"
        control={<HexColorControl value={theme.foreground} onChange={onForegroundChange} />}
      />
      <ThemeColorSection
        mode={appearanceMode}
        title="Syntax"
        description="Fine-tune the token palette used in the editor."
        items={editorThemeSyntaxColorOptions.map((option) => ({
          key: option.key,
          label: option.label,
          value: resolvedVisuals.syntaxColors[option.key],
        }))}
        onChange={(key, value) => {
          onSyntaxColorChange(key as SyntaxColorKey, value);
        }}
      />
      <ThemeColorSection
        mode={appearanceMode}
        title="Editor"
        description="Adjust editor chrome like selection, cursor, and guides."
        items={editorThemeEditorColorOptions.map((option) => ({
          key: option.key,
          label: option.label,
          value: resolvedVisuals.editorColors[option.key],
        }))}
        onChange={(key, value) => {
          onEditorColorChange(key as EditorColorKey, value);
        }}
      />
    </div>
  );
};

interface HexColorControlProps {
  value: string;
  onChange: (value: string) => void;
  variant?: 'light' | 'dark';
}

const HexColorControl = ({
  value,
  onChange,
  variant = 'light',
}: HexColorControlProps): JSX.Element => (
  <label
    className={cn(
      'no-drag relative inline-flex h-8 cursor-pointer items-center gap-2 rounded-full pl-2 pr-2.5 text-[13px] transition-colors',
      variant === 'dark'
        ? 'border border-[var(--zeroade-border)] bg-[var(--zeroade-bg-canvas)] text-[var(--zeroade-text-strong)] hover:bg-[var(--zeroade-bg-panel)]'
        : 'border border-stone-200 bg-white text-stone-700 hover:bg-stone-50',
    )}
  >
    <span
      className={cn(
        'h-4 w-4 rounded-full',
        variant === 'dark' ? 'border border-white/10' : 'border border-black/10',
      )}
      style={{ backgroundColor: value }}
    />
    <span className="font-mono uppercase">{value}</span>
    <input
      type="color"
      value={value}
      onChange={(event) => {
        onChange(event.target.value.toLowerCase());
      }}
      className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
      aria-label="Choose color"
    />
  </label>
);

interface ThemeColorSectionProps {
  mode: EditorThemeMode;
  title: string;
  description?: string;
  items: Array<{ key: string; label: string; value: string }>;
  onChange: (key: string, value: string) => void;
}

const ThemeColorSection = ({
  mode,
  title,
  description,
  items,
  onChange,
}: ThemeColorSectionProps): JSX.Element => (
  <div
    className={cn(
      'border-t px-3 py-3',
      mode === 'dark'
        ? 'border-[var(--zeroade-border)] bg-[var(--zeroade-bg-panel)]'
        : 'border-stone-200/75 bg-transparent',
    )}
  >
    <div className="mb-3">
      <p
        className={cn(
          'text-[14px] font-medium',
          mode === 'dark' ? 'text-[var(--zeroade-text-strong)]' : 'text-stone-800',
        )}
      >
        {title}
      </p>
      {description ? (
        <p
          className={cn(
            'mt-0.5 text-[13px]',
            mode === 'dark' ? 'text-[var(--zeroade-text-muted)]' : 'text-stone-500',
          )}
        >
          {description}
        </p>
      ) : null}
    </div>
    <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
      {items.map((item) => (
        <div
          key={item.key}
          className={cn(
            'flex items-center justify-between gap-3 rounded-[14px] border px-3 py-2',
            mode === 'dark'
              ? 'border-[var(--zeroade-border)] bg-[var(--zeroade-bg-elev)] shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]'
              : 'border-stone-200/80 bg-stone-50/60',
          )}
        >
          <span
            className={cn(
              'min-w-0 text-[13px]',
              mode === 'dark' ? 'text-[var(--zeroade-text)]' : 'text-stone-700',
            )}
          >
            {item.label}
          </span>
          <HexColorControl
            value={item.value}
            variant={mode === 'dark' ? 'dark' : 'light'}
            onChange={(value) => {
              onChange(item.key, value);
            }}
          />
        </div>
      ))}
    </div>
  </div>
);

const ActionChip = ({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}): JSX.Element => (
  <button
    type="button"
    className="no-drag inline-flex h-8 items-center rounded-full border border-stone-200 bg-white px-3 text-[13px] text-stone-700 transition-colors hover:bg-stone-50"
    onClick={onClick}
  >
    {children}
  </button>
);

const HeaderActionButton = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement>
>(({ children, className, type = 'button', ...props }, ref): JSX.Element => (
  <button
    ref={ref}
    type={type}
    className={cn(
      'no-drag inline-flex h-8 items-center rounded-[10px] px-2.5 text-[13px] font-medium text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-900 focus-visible:bg-stone-100',
      className,
    )}
    {...props}
  >
    {children}
  </button>
));

HeaderActionButton.displayName = 'HeaderActionButton';

const SettingsSelectTrigger = ({
  children,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>): JSX.Element => (
  <button
    type="button"
    className={cn(
      'no-drag inline-flex h-8 items-center gap-2 rounded-full border border-stone-200 bg-white pl-2 pr-2.5 text-[13px] text-stone-700 transition-colors hover:bg-stone-50',
      className,
    )}
    {...props}
  >
    {children}
  </button>
);

const SettingsSelectItem = ({
  selected,
  children,
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuItem> & {
  selected?: boolean;
}): JSX.Element => (
  <DropdownMenuItem
    className={cn(
      'min-h-11 rounded-[14px] px-3 text-[15px]',
      selected && 'bg-stone-100/85',
      className,
    )}
    {...props}
  >
    {children}
  </DropdownMenuItem>
);

const ThemeBadge = ({
  backgroundColor,
  color,
}: {
  backgroundColor: string;
  color: string;
}): JSX.Element => (
  <span
    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] border border-black/10 text-[14px] font-semibold tracking-[-0.02em]"
    style={{
      backgroundColor,
      color,
    }}
  >
    Aa
  </span>
);

interface EditorThemePresetSelectProps {
  mode: EditorThemeMode;
  value: EditorThemePreset;
  onSelect: (value: Exclude<EditorThemePreset, 'custom'>) => void;
}

const EditorThemePresetSelect = ({
  mode,
  value,
  onSelect,
}: EditorThemePresetSelectProps): JSX.Element => {
  const activeOption = getEditorThemePresetOption(value);
  const activeLabel = activeOption?.label ?? 'Custom';
  const activeBadgeBackground =
    activeOption?.[mode === 'light' ? 'badgeLightBackground' : 'badgeDarkBackground'] ??
    (mode === 'light' ? '#f5f5f4' : '#202020');
  const activeBadgeForeground =
    activeOption?.[mode === 'light' ? 'badgeLightForeground' : 'badgeDarkForeground'] ??
    (mode === 'light' ? '#44403c' : '#fafaf9');

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <SettingsSelectTrigger
          className="h-10 min-w-[176px] justify-between rounded-[14px] pl-1 pr-3"
          aria-label={`Select ${mode} editor theme preset`}
        >
          <span className="flex min-w-0 items-center gap-3">
            <ThemeBadge
              backgroundColor={activeBadgeBackground}
              color={activeBadgeForeground}
            />
            <span className="truncate">{activeLabel}</span>
          </span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-stone-500" />
        </SettingsSelectTrigger>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="zeroade-dropdown-scroll max-h-[360px] w-[230px] overflow-y-auto rounded-[22px] p-2">
        {editorThemePresetOptions.map((option) => {
          const isSelected = option.value === value;
          const badgeBackground =
            option[mode === 'light' ? 'badgeLightBackground' : 'badgeDarkBackground'];
          const badgeForeground =
            option[mode === 'light' ? 'badgeLightForeground' : 'badgeDarkForeground'];

          return (
            <SettingsSelectItem
              key={option.value}
              selected={isSelected}
              onSelect={() => {
                onSelect(option.value);
              }}
            >
              <span className="flex min-w-0 flex-1 items-center gap-3">
                <ThemeBadge
                  backgroundColor={badgeBackground}
                  color={badgeForeground}
                />
                <span className="truncate">{option.label}</span>
              </span>
              <Check
                className={cn(
                  'ml-3 h-4 w-4 shrink-0 text-stone-900 transition-opacity',
                  !isSelected && 'opacity-0',
                )}
              />
            </SettingsSelectItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

interface CodeFontSelectProps {
  value: CodeFontPreference;
  onSelect: (value: CodeFontPreference) => void;
}

interface SettingsSwitchProps {
  checked: boolean;
  ariaLabel: string;
  onCheckedChange: (checked: boolean) => void;
}

interface EditorFontSizeSelectProps {
  value: number;
  onSelect: (value: number) => void;
}

const EditorFontSizeSelect = ({ value, onSelect }: EditorFontSizeSelectProps): JSX.Element => (
  <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <SettingsSelectTrigger
        aria-label="Select editor font size"
        className="min-w-[96px] justify-between"
      >
        <span>{value} px</span>
        <ChevronDown className="h-3.5 w-3.5 text-stone-500" />
      </SettingsSelectTrigger>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="zeroade-dropdown-scroll max-h-[320px] w-[128px] overflow-y-auto rounded-[22px] p-2">
      {editorFontSizeOptions.map((fontSize) => {
        const isSelected = fontSize === value;

        return (
          <SettingsSelectItem
            key={fontSize}
            selected={isSelected}
            onSelect={() => {
              onSelect(fontSize);
            }}
          >
            <span className="mr-2 inline-flex h-5 w-5 items-center justify-center">
              <Check className={cn('h-4 w-4 text-stone-900', !isSelected && 'opacity-0')} />
            </span>
            <span>{fontSize} px</span>
          </SettingsSelectItem>
        );
      })}
    </DropdownMenuContent>
  </DropdownMenu>
);

const CodeFontSelect = ({ value, onSelect }: CodeFontSelectProps): JSX.Element => {
  const activeOption = codeFontOptions.find((option) => option.value === value) ?? codeFontOptions[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <SettingsSelectTrigger
          aria-label="Select code font"
          className="justify-between"
          style={{ fontFamily: getCodeFontFamily(activeOption.value) }}
        >
          <span>{activeOption.label}</span>
          <ChevronDown className="h-3.5 w-3.5 text-stone-500" />
        </SettingsSelectTrigger>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[240px] rounded-[22px] p-2">
        {codeFontOptions.map((option) => {
          const isSelected = option.value === value;

          return (
            <SettingsSelectItem
              key={option.value}
              selected={isSelected}
              onSelect={() => {
                onSelect(option.value);
              }}
              style={{ fontFamily: getCodeFontFamily(option.value) }}
            >
              <span className="mr-2 inline-flex h-5 w-5 items-center justify-center">
                <Check className={cn('h-4 w-4 text-stone-900', !isSelected && 'opacity-0')} />
              </span>
              <span>{option.label}</span>
            </SettingsSelectItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

const SettingsSwitch = ({
  checked,
  ariaLabel,
  onCheckedChange,
}: SettingsSwitchProps): JSX.Element => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={ariaLabel}
    data-state={checked ? 'checked' : 'unchecked'}
    className={cn(
      'relative inline-flex h-6 w-10 shrink-0 items-center rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--zeroade-selection)]',
      checked
        ? 'border-transparent bg-[var(--zeroade-accent-strong)]'
        : 'border-stone-300 bg-stone-100',
    )}
    onClick={() => {
      onCheckedChange(!checked);
    }}
  >
    <span
      className={cn(
        'pointer-events-none absolute left-0.5 h-5 w-5 rounded-full border border-black/10 bg-[white] shadow-sm transition-transform',
        checked && 'translate-x-4',
      )}
    />
  </button>
);

interface AccentColorSelectProps {
  value: AccentColorPreference;
  onSelect: (value: AccentColorPreference) => void;
}

const AccentColorSelect = ({ value, onSelect }: AccentColorSelectProps): JSX.Element => {
  const activeOption = accentOptions.find((option) => option.value === value) ?? accentOptions[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <SettingsSelectTrigger
          aria-label="Select accent color"
          className="justify-between"
        >
          <span
            className="h-4 w-4 rounded-full border border-black/10"
            style={{ backgroundColor: activeOption.swatch }}
          />
          <span>{activeOption.label}</span>
          <ChevronDown className="h-3.5 w-3.5 text-stone-500" />
        </SettingsSelectTrigger>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[230px] rounded-[22px] p-2">
        {accentOptions.map((option) => {
          const isSelected = option.value === value;

          return (
            <SettingsSelectItem
              key={option.value}
              selected={isSelected}
              onSelect={() => {
                onSelect(option.value);
              }}
            >
              <span className="mr-2 inline-flex h-5 w-5 items-center justify-center">
                <Check className={cn('h-4 w-4 text-stone-900', !isSelected && 'opacity-0')} />
              </span>
              <span
                className="mr-3 h-5 w-5 rounded-full border border-black/10"
                style={{ backgroundColor: option.swatch }}
              />
              <span>{option.label}</span>
            </SettingsSelectItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

interface AgentsSettingsSectionProps {
  workspacePath: string;
  agentPreset: AcpAgentPreset;
  customAgentConfig: AcpCustomAgentConfig | null;
  onSelectAgentPreset: (selection: AgentPresetSelection) => void;
}

const AgentsSettingsSection = ({
  workspacePath,
  agentPreset,
  customAgentConfig,
  onSelectAgentPreset,
}: AgentsSettingsSectionProps): JSX.Element => {
  const currentPlatform = window.desktop?.platform ?? 'darwin';
  const [storedCustomAgents, setStoredCustomAgents] = React.useState<StoredCustomAgentEntry[]>(() =>
    readStoredCustomAgents(),
  );
  const [activeCustomAgentId, setActiveCustomAgentId] = React.useState<string | null>(() =>
    readStoredActiveCustomAgentId(),
  );
  const [registryAgents, setRegistryAgents] = React.useState<RegistryAgent[]>([]);
  const [isRegistryLoading, setIsRegistryLoading] = React.useState(false);
  const [registryError, setRegistryError] = React.useState<string | null>(null);
  const [editorState, setEditorState] = React.useState<AgentEditorState | null>(null);
  const [pendingDeleteAgentId, setPendingDeleteAgentId] = React.useState<string | null>(null);

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
    void loadRegistryAgents();
  }, [loadRegistryAgents]);

  React.useEffect(() => {
    if (storedCustomAgents.length === 0) {
      window.localStorage.removeItem(CUSTOM_AGENT_LIBRARY_KEY);
      return;
    }

    window.localStorage.setItem(CUSTOM_AGENT_LIBRARY_KEY, JSON.stringify(storedCustomAgents));
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
      if (storedCustomAgents.length > 0) {
        setActiveCustomAgentId(storedCustomAgents[0]?.id ?? null);
      }
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
      (entry) => toCustomAgentConfigSignature(entry.config) === currentSignature,
    );
    if (existing) {
      if (activeCustomAgentId !== existing.id) {
        setActiveCustomAgentId(existing.id);
      }
      return;
    }

    const matchingRegistryAgent =
      registryAgents.find((agent) => matchesRegistryTemplate(agent, normalizedConfig, currentPlatform)) ??
      null;
    const nextEntry: StoredCustomAgentEntry = {
      id: nextStoredCustomAgentId(),
      label: matchingRegistryAgent?.name ?? toDefaultCustomAgentLabel(normalizedConfig),
      config: normalizedConfig,
      registryAgentId: matchingRegistryAgent?.id,
    };

    setStoredCustomAgents((previous) => [...previous, nextEntry]);
    setActiveCustomAgentId(nextEntry.id);
  }, [activeCustomAgentId, currentPlatform, customAgentConfig, registryAgents, storedCustomAgents]);

  const codexRegistryAgent = React.useMemo(
    () => registryAgents.find((agent) => agent.id === 'codex-acp') ?? null,
    [registryAgents],
  );
  const claudeRegistryAgent = React.useMemo(
    () =>
      registryAgents.find((agent) => agent.id === 'claude-acp' || agent.id === 'claude-agent-acp') ??
      null,
    [registryAgents],
  );
  const customRegistryAgent = React.useMemo(
    () =>
      registryAgents.find((agent) => matchesRegistryTemplate(agent, customAgentConfig, currentPlatform)) ??
      null,
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
          registryAgents.find((agent) => matchesRegistryTemplate(agent, normalizedConfig, currentPlatform)) ??
          null;
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

  const customAgentById = React.useMemo(
    () => new Map(customAgentOptions.map((entry) => [entry.id, entry])),
    [customAgentOptions],
  );
  const pendingDeleteAgent = pendingDeleteAgentId
    ? (customAgentById.get(pendingDeleteAgentId) ?? null)
    : null;
  const registryOptionById = React.useMemo(
    () =>
      new Map(
        customAgentOptions
          .filter((entry): entry is CustomAgentOption & { registryAgentId: string } =>
            typeof entry.registryAgentId === 'string' && entry.registryAgentId.length > 0,
          )
          .map((entry) => [entry.registryAgentId, entry]),
      ),
    [customAgentOptions],
  );
  const activeCustomConfigSignature = React.useMemo(
    () => toCustomAgentConfigSignature(customAgentConfig),
    [customAgentConfig],
  );
  const activeCustomAgentOption = React.useMemo(
    () =>
      customAgentOptions.find(
        (entry) => toCustomAgentConfigSignature(entry.config) === activeCustomConfigSignature,
      ) ?? null,
    [activeCustomConfigSignature, customAgentOptions],
  );

  const handleUseBuiltIn = React.useCallback(
    (preset: 'codex' | 'claude') => {
      onSelectAgentPreset({
        preset,
        label: preset === 'codex' ? 'Codex' : 'Claude Code',
        iconUrl:
          preset === 'codex'
            ? (codexRegistryAgent?.icon ?? null)
            : (claudeRegistryAgent?.icon ?? null),
      });
    },
    [claudeRegistryAgent?.icon, codexRegistryAgent?.icon, onSelectAgentPreset],
  );

  const handleUseCustomAgent = React.useCallback(
    (agent: CustomAgentOption) => {
      setActiveCustomAgentId(agent.id);
      onSelectAgentPreset({
        preset: 'custom',
        label: agent.label,
        iconUrl: agent.iconUrl,
        customConfig: agent.config,
        customAgentId: agent.id,
      });
    },
    [onSelectAgentPreset],
  );

  const openCustomEditor = React.useCallback(
    (customAgentId: string | 'new', seedConfig?: AcpCustomAgentConfig, title = 'Custom ACP agent') => {
      const target = customAgentId === 'new' ? null : customAgentById.get(customAgentId) ?? null;
      const config = target?.config ?? seedConfig ?? null;

      setEditorState({
        customAgentId,
        title: target?.label ?? title,
        command: config?.command ?? '',
        args: config?.args.join(' ') ?? '',
        cwd: config?.cwd ?? '',
        env: config?.env
          ? Object.entries(config.env)
              .map(([key, value]) => `${key}=${value}`)
              .join('\n')
          : '',
      });
    },
    [customAgentById],
  );

  const handleSaveEditedAgent = React.useCallback(() => {
    if (!editorState) {
      return;
    }

    const parsedConfig = normalizeCustomAgentConfig({
      command: editorState.command.trim(),
      args: parseArgs(editorState.args),
      cwd: editorState.cwd.trim() || undefined,
      env: parseEnv(editorState.env),
    });
    if (!parsedConfig) {
      return;
    }

    const editingEntry =
      editorState.customAgentId !== 'new'
        ? storedCustomAgents.find((entry) => entry.id === editorState.customAgentId) ?? null
        : null;
    const matchingRegistryAgent =
      registryAgents.find((agent) => matchesRegistryTemplate(agent, parsedConfig, currentPlatform)) ??
      null;
    const existingByRegistry =
      matchingRegistryAgent
        ? storedCustomAgents.find((entry) => entry.registryAgentId === matchingRegistryAgent.id) ?? null
        : null;
    const existingBySignature =
      storedCustomAgents.find(
        (entry) =>
          toCustomAgentConfigSignature(entry.config) === toCustomAgentConfigSignature(parsedConfig),
      ) ?? null;

    const targetId =
      editingEntry?.id ??
      existingByRegistry?.id ??
      existingBySignature?.id ??
      nextStoredCustomAgentId();
    const nextEntry: StoredCustomAgentEntry = {
      id: targetId,
      label:
        matchingRegistryAgent?.name ??
        editingEntry?.label ??
        toDefaultCustomAgentLabel(parsedConfig),
      config: parsedConfig,
      registryAgentId: matchingRegistryAgent?.id ?? editingEntry?.registryAgentId,
    };

    setStoredCustomAgents((previous) => {
      const hasTarget = previous.some((entry) => entry.id === targetId);
      if (!hasTarget) {
        return [...previous, nextEntry];
      }

      return previous.map((entry) => (entry.id === targetId ? nextEntry : entry));
    });
    setActiveCustomAgentId(targetId);

    const editingSignature = editingEntry ? toCustomAgentConfigSignature(editingEntry.config) : '';
    const shouldApplyToCurrentAgent =
      agentPreset === 'custom' &&
      (activeCustomAgentId === editorState.customAgentId ||
        (editingSignature.length > 0 && activeCustomConfigSignature === editingSignature));

    if (shouldApplyToCurrentAgent) {
      onSelectAgentPreset({
        preset: 'custom',
        label: nextEntry.label,
        iconUrl: matchingRegistryAgent?.icon ?? null,
        customConfig: parsedConfig,
        customAgentId: targetId,
      });
    }

    setEditorState(null);
  }, [
    activeCustomAgentId,
    activeCustomConfigSignature,
    agentPreset,
    currentPlatform,
    editorState,
    onSelectAgentPreset,
    registryAgents,
    storedCustomAgents,
  ]);

  const handleDeleteCustomAgent = React.useCallback(
    (agentId: string) => {
      const targetAgent = customAgentById.get(agentId) ?? null;
      if (!targetAgent) {
        return;
      }

      const remainingAgents = customAgentOptions.filter((entry) => entry.id !== agentId);
      setStoredCustomAgents((previous) => previous.filter((entry) => entry.id !== agentId));
      setPendingDeleteAgentId(null);

      if (activeCustomAgentId === agentId) {
        setActiveCustomAgentId(remainingAgents[0]?.id ?? null);
      }

      if (
        agentPreset === 'custom' &&
        activeCustomConfigSignature === toCustomAgentConfigSignature(targetAgent.config)
      ) {
        const nextActiveAgent = remainingAgents[0] ?? null;
        if (nextActiveAgent) {
          handleUseCustomAgent(nextActiveAgent);
        } else {
          handleUseBuiltIn('codex');
        }
      }
    },
    [
      activeCustomAgentId,
      activeCustomConfigSignature,
      agentPreset,
      customAgentById,
      customAgentOptions,
      handleUseBuiltIn,
      handleUseCustomAgent,
    ],
  );

  const handleAddRegistryAgent = React.useCallback(
    (agent: RegistryAgent) => {
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
            toCustomAgentConfigSignature(entry.config) === toCustomAgentConfigSignature(parsedConfig),
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
    },
    [currentPlatform, storedCustomAgents],
  );

  const currentAgentLabel =
    agentPreset === 'custom'
      ? activeCustomAgentOption?.label ??
        customRegistryAgent?.name ??
        (customAgentConfig ? toDefaultCustomAgentLabel(customAgentConfig) : 'Custom agent')
      : agentPreset === 'codex'
        ? 'Codex'
        : agentPreset === 'claude'
          ? 'Claude Code'
          : 'Not selected';
  const currentAgentIconUrl =
    agentPreset === 'custom'
      ? (activeCustomAgentOption?.iconUrl ?? customRegistryAgent?.icon ?? null)
      : agentPreset === 'codex'
        ? (codexRegistryAgent?.icon ?? null)
        : agentPreset === 'claude'
          ? (claudeRegistryAgent?.icon ?? null)
          : null;
  return (
    <>
      <SectionGroup title="Default">
        <SettingsCard>
          <SettingRow
            title="Default agent"
            description="Choose which ACP agent new sessions should start with."
            control={
              <AgentPresetSelect
                currentLabel={currentAgentLabel}
                currentIconUrl={currentAgentIconUrl}
                agentPreset={agentPreset}
                activeCustomConfigSignature={activeCustomConfigSignature}
                codexIconUrl={codexRegistryAgent?.icon ?? null}
                claudeIconUrl={claudeRegistryAgent?.icon ?? null}
                customAgentOptions={customAgentOptions}
                onSelectBuiltIn={handleUseBuiltIn}
                onSelectCustom={handleUseCustomAgent}
              />
            }
          />
          <SettingRow
            title="Installed agents"
            description="Registry-installed and manual ACP agents saved in your local library."
            control={<PillLabel>{toCountLabel(customAgentOptions.length, 'agent')}</PillLabel>}
          />
        </SettingsCard>
      </SectionGroup>

      <SectionGroup
        title="Installed"
        action={
          <Button
            size="sm"
            variant="secondary"
            className="rounded-[10px]"
            onClick={() => {
              openCustomEditor('new', undefined, 'Custom ACP agent');
            }}
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            New custom agent
          </Button>
        }
      >
        <SettingsCard>
          {customAgentOptions.length === 0 ? (
            <SettingRow
              title="No installed agents"
              description="Install an ACP agent from the registry or create a manual command below."
              control={<PillLabel>Empty</PillLabel>}
            />
          ) : (
            customAgentOptions.map((agent) => (
              <AgentSettingsRow
                key={agent.id}
                iconUrl={agent.iconUrl}
                title={agent.label}
                description={toCommandPreview(agent.config)}
                meta={agent.registryAgentId ? 'From registry' : 'Manual command'}
                actions={
                  <>
                    <Button
                      size="sm"
                      variant={
                        agentPreset === 'custom' &&
                        activeCustomConfigSignature === toCustomAgentConfigSignature(agent.config)
                          ? 'secondary'
                          : 'outline'
                      }
                      className="rounded-[10px]"
                      onClick={() => {
                        handleUseCustomAgent(agent);
                      }}
                    >
                      {agentPreset === 'custom' &&
                      activeCustomConfigSignature === toCustomAgentConfigSignature(agent.config)
                        ? 'Active'
                        : 'Use'}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="rounded-[10px]"
                      onClick={() => {
                        openCustomEditor(agent.id, agent.config, agent.label);
                      }}
                    >
                      <Pencil className="mr-1.5 h-3.5 w-3.5" />
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="rounded-[10px] text-rose-700 hover:bg-rose-50 hover:text-rose-800"
                      onClick={() => {
                        setPendingDeleteAgentId(agent.id);
                      }}
                    >
                      <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                      Delete
                    </Button>
                  </>
                }
              />
            ))
          )}
        </SettingsCard>
      </SectionGroup>

      <SectionGroup
        title="ACP Registry"
        action={
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-[10px]"
            onClick={() => {
              void loadRegistryAgents();
            }}
            disabled={isRegistryLoading}
            aria-label="Reload ACP registry"
            title="Reload ACP registry"
          >
            {isRegistryLoading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
          </Button>
        }
      >
        <SettingsCard>
          {isRegistryLoading && registryAgents.length === 0 ? (
            <SettingRow
              title="Loading registry"
              description="Fetching available ACP agents from the public registry."
              control={<PillLabel>Loading…</PillLabel>}
            />
          ) : registryError ? (
            <SettingRow
              title="Registry unavailable"
              description={registryError}
              control={<PillLabel>Error</PillLabel>}
            />
          ) : (
            registryAgents.map((agent) => {
              const installedOption = registryOptionById.get(agent.id) ?? null;
              const launchTemplate = toRegistryLaunchTemplate(agent, currentPlatform);
              const canAutoConfigure = launchTemplate.autoConfigurable;

              return (
                <AgentSettingsRow
                  key={agent.id}
                  iconUrl={agent.icon ?? null}
                  title={agent.name}
                  description={
                    agent.description?.trim().length
                      ? agent.description
                      : canAutoConfigure
                        ? launchTemplate.preview
                        : 'Manual setup required for this registry entry.'
                  }
                  meta={[
                    agent.id,
                    agent.version ? `v${agent.version}` : null,
                    installedOption ? 'Installed' : canAutoConfigure ? 'Ready to install' : 'Manual setup',
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                  actions={
                    <>
                      {installedOption ? (
                        <Button
                          size="sm"
                          variant={
                            agentPreset === 'custom' &&
                            activeCustomConfigSignature ===
                              toCustomAgentConfigSignature(installedOption.config)
                              ? 'secondary'
                              : 'outline'
                          }
                          className="rounded-[10px]"
                          onClick={() => {
                            handleUseCustomAgent(installedOption);
                          }}
                        >
                          {agentPreset === 'custom' &&
                          activeCustomConfigSignature ===
                            toCustomAgentConfigSignature(installedOption.config)
                            ? 'Active'
                            : 'Use'}
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          className="rounded-[10px]"
                          disabled={!canAutoConfigure}
                          onClick={() => {
                            handleAddRegistryAgent(agent);
                          }}
                        >
                          Install
                        </Button>
                      )}
                      {agent.repository ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="rounded-[10px]"
                          onClick={() => {
                            window.open(agent.repository, '_blank', 'noopener,noreferrer');
                          }}
                        >
                          <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                          Repo
                        </Button>
                      ) : null}
                    </>
                  }
                />
              );
            })
          )}
        </SettingsCard>
      </SectionGroup>

      <Dialog open={editorState !== null} onOpenChange={(open) => !open && setEditorState(null)}>
        <DialogContent className="max-w-[680px] rounded-[28px] p-0">
          <div className="px-5 pb-5 pt-5">
            <h2 className="text-[24px] font-semibold leading-none tracking-[-0.015em] text-stone-900">
              {editorState?.title ?? 'ACP agent'}
            </h2>
            <p className="mt-2 text-[13px] leading-[1.35] text-stone-500">
              Update the launch command used for this ACP agent.
            </p>

            <div className="mt-4 space-y-3">
              <label className="block text-[13px] font-medium text-stone-600">
                Command
                <input
                  value={editorState?.command ?? ''}
                  onChange={(event) => {
                    setEditorState((previous) =>
                      previous
                        ? {
                            ...previous,
                            command: event.target.value,
                          }
                        : previous,
                    );
                  }}
                  placeholder="npx"
                  className="no-drag mt-1.5 h-9 w-full rounded-[10px] border border-stone-300 bg-white px-3 text-[13px] text-stone-800 placeholder:text-stone-400 focus:outline-none"
                />
              </label>

              <label className="block text-[13px] font-medium text-stone-600">
                Arguments
                <input
                  value={editorState?.args ?? ''}
                  onChange={(event) => {
                    setEditorState((previous) =>
                      previous
                        ? {
                            ...previous,
                            args: event.target.value,
                          }
                        : previous,
                    );
                  }}
                  placeholder="-y your-agent --transport stdio"
                  className="no-drag mt-1.5 h-9 w-full rounded-[10px] border border-stone-300 bg-white px-3 text-[13px] text-stone-800 placeholder:text-stone-400 focus:outline-none"
                />
              </label>

              <label className="block text-[13px] font-medium text-stone-600">
                Working directory (optional)
                <input
                  value={editorState?.cwd ?? ''}
                  onChange={(event) => {
                    setEditorState((previous) =>
                      previous
                        ? {
                            ...previous,
                            cwd: event.target.value,
                          }
                        : previous,
                    );
                  }}
                  placeholder={workspacePath}
                  className="no-drag mt-1.5 h-9 w-full rounded-[10px] border border-stone-300 bg-white px-3 text-[13px] text-stone-800 placeholder:text-stone-400 focus:outline-none"
                />
              </label>

              <label className="block text-[13px] font-medium text-stone-600">
                Environment (optional)
                <textarea
                  value={editorState?.env ?? ''}
                  onChange={(event) => {
                    setEditorState((previous) =>
                      previous
                        ? {
                            ...previous,
                            env: event.target.value,
                          }
                        : previous,
                    );
                  }}
                  placeholder={'API_KEY=...\nDEBUG=1'}
                  spellCheck={false}
                  className="no-drag mt-1.5 h-[96px] w-full resize-none rounded-[10px] border border-stone-300 bg-white px-3 py-2 font-mono text-[12px] leading-[1.45] text-stone-800 placeholder:text-stone-400 focus:outline-none"
                />
              </label>
            </div>

            <div className="mt-4 flex items-center justify-end gap-2">
              <Button
                variant="ghost"
                className="h-9 rounded-[11px] px-3 text-[13px]"
                onClick={() => {
                  setEditorState(null);
                }}
              >
                Cancel
              </Button>
              <Button
                className="h-9 rounded-[11px] px-4 text-[13px] font-semibold"
                disabled={(editorState?.command.trim().length ?? 0) === 0}
                onClick={handleSaveEditedAgent}
              >
                Save
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={pendingDeleteAgent !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPendingDeleteAgentId(null);
          }
        }}
      >
        <DialogContent className="max-w-[480px] rounded-[28px] p-0">
          <div className="px-5 pb-5 pt-5">
            <h2 className="text-[24px] font-semibold leading-none tracking-[-0.015em] text-stone-900">
              Delete agent
            </h2>
            <p className="mt-2 text-[13px] leading-[1.45] text-stone-500">
              {pendingDeleteAgent
                ? `Remove ${pendingDeleteAgent.label} from your installed agents library. This does not delete anything outside the app.`
                : 'Remove this agent from your installed agents library.'}
            </p>

            <div className="mt-4 flex items-center justify-end gap-2">
              <Button
                variant="ghost"
                className="h-9 rounded-[11px] px-3 text-[13px]"
                onClick={() => {
                  setPendingDeleteAgentId(null);
                }}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                className="h-9 rounded-[11px] bg-rose-600 px-4 text-[13px] font-semibold text-white hover:bg-rose-700"
                onClick={() => {
                  if (pendingDeleteAgentId) {
                    handleDeleteCustomAgent(pendingDeleteAgentId);
                  }
                }}
              >
                Delete
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};

const AgentSettingsRow = ({
  iconUrl,
  title,
  description,
  meta,
  actions,
}: {
  iconUrl: string | null;
  title: string;
  description: string;
  meta?: string;
  actions: React.ReactNode;
}): JSX.Element => (
  <div className="flex items-center justify-between gap-4 border-b border-stone-200/75 px-3 py-3 last:border-b-0">
    <div className="min-w-0 flex items-start gap-3">
      <AgentAvatar iconUrl={iconUrl} label={title} className="mt-0.5 h-10 w-10 rounded-[12px]" />
      <div className="min-w-0">
        <p className="truncate text-[14px] font-medium text-stone-800">{title}</p>
        {meta ? <p className="mt-0.5 text-[12px] text-stone-500">{meta}</p> : null}
        <p className="mt-1 break-all text-[13px] text-stone-500">{description}</p>
      </div>
    </div>
    <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">{actions}</div>
  </div>
);

const AgentAvatar = ({
  iconUrl,
  label,
  className,
}: {
  iconUrl: string | null;
  label: string;
  className?: string;
}): JSX.Element => {
  const fallbackLabel = label.trim().charAt(0).toUpperCase() || '?';

  return (
    <Avatar className={cn('rounded-[10px] bg-stone-100', className)}>
      {iconUrl ? (
        <AvatarImage
          src={iconUrl}
          alt={`${label} icon`}
          className="zeroade-agent-icon-image h-full w-full object-cover"
        />
      ) : null}
      <AvatarFallback className="rounded-[10px] bg-stone-200 text-[10px] font-semibold uppercase text-stone-600">
        {fallbackLabel}
      </AvatarFallback>
    </Avatar>
  );
};

const AgentPresetSelect = ({
  currentLabel,
  currentIconUrl,
  agentPreset,
  activeCustomConfigSignature,
  codexIconUrl,
  claudeIconUrl,
  customAgentOptions,
  onSelectBuiltIn,
  onSelectCustom,
}: {
  currentLabel: string;
  currentIconUrl: string | null;
  agentPreset: AcpAgentPreset;
  activeCustomConfigSignature: string;
  codexIconUrl: string | null;
  claudeIconUrl: string | null;
  customAgentOptions: CustomAgentOption[];
  onSelectBuiltIn: (preset: 'codex' | 'claude') => void;
  onSelectCustom: (agent: CustomAgentOption) => void;
}): JSX.Element => (
  <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <SettingsSelectTrigger
        className="h-10 min-w-[220px] justify-between rounded-[14px] pl-1 pr-3"
        aria-label="Select default ACP agent"
      >
        <span className="flex min-w-0 items-center gap-3">
          <AgentAvatar
            iconUrl={currentIconUrl}
            label={currentLabel}
            className="h-[26px] w-[26px] rounded-[8px]"
          />
          <span className="truncate">{currentLabel}</span>
        </span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-stone-500" />
      </SettingsSelectTrigger>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="zeroade-dropdown-scroll max-h-[360px] w-[260px] overflow-y-auto rounded-[22px] p-2">
      <SettingsSelectItem selected={agentPreset === 'codex'} onSelect={() => onSelectBuiltIn('codex')}>
        <span className="flex min-w-0 flex-1 items-center gap-3">
          <AgentAvatar
            iconUrl={codexIconUrl}
            label="Codex"
            className="h-[26px] w-[26px] rounded-[8px]"
          />
          <span className="truncate">Codex</span>
        </span>
      </SettingsSelectItem>
      <SettingsSelectItem selected={agentPreset === 'claude'} onSelect={() => onSelectBuiltIn('claude')}>
        <span className="flex min-w-0 flex-1 items-center gap-3">
          <AgentAvatar
            iconUrl={claudeIconUrl}
            label="Claude Code"
            className="h-[26px] w-[26px] rounded-[8px]"
          />
          <span className="truncate">Claude Code</span>
        </span>
      </SettingsSelectItem>
      {customAgentOptions.map((agent) => (
        <SettingsSelectItem
          key={agent.id}
          selected={
            agentPreset === 'custom' &&
            toCustomAgentConfigSignature(agent.config) === activeCustomConfigSignature
          }
          onSelect={() => {
            onSelectCustom(agent);
          }}
        >
          <span className="flex min-w-0 flex-1 items-center gap-3">
            <AgentAvatar
              iconUrl={agent.iconUrl}
              label={agent.label}
              className="h-[26px] w-[26px] rounded-[8px]"
            />
            <span className="truncate">{agent.label}</span>
          </span>
        </SettingsSelectItem>
      ))}
    </DropdownMenuContent>
  </DropdownMenu>
);

interface SkillEditorState {
  mode: 'create' | 'edit';
  absolutePath?: string;
  slug: string;
  content: string;
  slugTouched: boolean;
}

const DEFAULT_NEW_SKILL_NAME = 'New Skill';

const buildSkillTemplate = (name: string): string => `# ${name}

Describe when this skill should be used.

## Instructions
- Add the workflow or rules the agent should follow.
`;

const extractSkillTitleFromContent = (content: string, fallback = DEFAULT_NEW_SKILL_NAME): string => {
  for (const line of content.replace(/\r\n?/g, '\n').split('\n')) {
    const match = line.trim().match(/^#\s+(.+)$/);
    if (match?.[1]) {
      return match[1].trim();
    }
  }

  return fallback;
};

const toSkillSlug = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[\\/]+/g, '-')
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');

const toSkillsErrorMessage = (error: unknown, fallback: string): string => {
  const restartMessage =
    'Restart the app once to enable Skills. The renderer updated, but the Electron main process has not reloaded the new skills handlers yet.';

  if (error instanceof Error && error.message.trim().length > 0) {
    if (
      error.message.includes("No handler registered for 'skills:") ||
      error.message.includes('skillsList is not a function') ||
      error.message.includes('skillsCatalog is not a function') ||
      error.message.includes('skillsCatalogDetail is not a function') ||
      error.message.includes('skillsRead is not a function') ||
      error.message.includes('skillsWrite is not a function') ||
      error.message.includes('skillsDelete is not a function') ||
      error.message.includes('skillsInstall is not a function')
    ) {
      return restartMessage;
    }

    return error.message.trim();
  }

  if (typeof error === 'string' && error.trim().length > 0) {
    if (
      error.includes("No handler registered for 'skills:") ||
      error.includes('skillsList is not a function') ||
      error.includes('skillsCatalog is not a function') ||
      error.includes('skillsCatalogDetail is not a function') ||
      error.includes('skillsRead is not a function') ||
      error.includes('skillsWrite is not a function') ||
      error.includes('skillsDelete is not a function') ||
      error.includes('skillsInstall is not a function')
    ) {
      return restartMessage;
    }

    return error.trim();
  }

  return fallback;
};

const REMOTE_SKILLS_PAGE_SIZE = 20;

const toCatalogSkillKey = (skill: Pick<SkillsCatalogEntry, 'source' | 'skillId'>): string =>
  `${skill.source}/${skill.skillId}`.toLowerCase();

const formatSkillInstallCount = (value: number | null): string | null => {
  if (!Number.isFinite(value ?? NaN) || !value || value <= 0) {
    return null;
  }

  return `${new Intl.NumberFormat('en', {
    notation: 'compact',
    maximumFractionDigits: value >= 100000 ? 0 : 1,
  }).format(value)} installs`;
};

const toCatalogSkillIconCandidates = (skill: SkillsCatalogEntry): string[] => {
  const branches = ['main', 'master'];
  const paths = [
    'resources/icon.png',
    `resources/${skill.skillId}.png`,
    `resources/${skill.skillId}/icon.png`,
    'assets/icon.png',
    `assets/${skill.skillId}.png`,
    `assets/${skill.skillId}/icon.png`,
    `skills/${skill.skillId}/resources/icon.png`,
    `skills/${skill.skillId}/resources/${skill.skillId}.png`,
    `skills/${skill.skillId}/assets/icon.png`,
    `skills/${skill.skillId}/assets/${skill.skillId}.png`,
  ];

  return branches.flatMap((branch) =>
    paths.map(
      (relativePath) =>
        `https://raw.githubusercontent.com/${skill.source}/${branch}/${relativePath}`,
    ),
  );
};

const toVisibleCatalogPages = (
  currentPage: number,
  pageCount: number,
): Array<number | 'ellipsis'> => {
  if (pageCount <= 5) {
    return Array.from({ length: pageCount }, (_value, index) => index + 1);
  }

  const pages = new Set<number>([1, pageCount, currentPage - 1, currentPage, currentPage + 1]);
  const normalizedPages = [...pages]
    .filter((page) => page >= 1 && page <= pageCount)
    .sort((left, right) => left - right);
  const visiblePages: Array<number | 'ellipsis'> = [];

  for (const page of normalizedPages) {
    const previous = visiblePages[visiblePages.length - 1];
    if (typeof previous === 'number' && page - previous > 1) {
      visiblePages.push('ellipsis');
    }

    visiblePages.push(page);
  }

  return visiblePages;
};

const useResolvedSkillIconSource = ({
  localIconAbsolutePath,
  remoteIconCandidates,
}: {
  localIconAbsolutePath?: string | null;
  remoteIconCandidates?: string[];
}): {
  imageSource: string | null;
  handleImageError: () => void;
} => {
  const remoteCandidatesKey = React.useMemo(
    () => (remoteIconCandidates ?? []).join('\n'),
    [remoteIconCandidates],
  );
  const [imageSource, setImageSource] = React.useState<string | null>(null);
  const [remoteIconIndex, setRemoteIconIndex] = React.useState(0);

  React.useEffect(() => {
    let cancelled = false;
    setImageSource(null);
    setRemoteIconIndex(0);

    const resolveIcon = async (): Promise<void> => {
      const normalizedLocalPath = localIconAbsolutePath?.trim() ?? '';
      if (normalizedLocalPath) {
        try {
          const preview = await window.desktop.readAttachmentPreview({
            absolutePath: normalizedLocalPath,
          });
          if (!cancelled && preview.dataUrl?.trim()) {
            setImageSource(preview.dataUrl);
            return;
          }
        } catch {
          // Fall through to remote candidates.
        }
      }

      const nextRemoteCandidate = remoteIconCandidates?.[0] ?? null;
      if (!cancelled) {
        setImageSource(nextRemoteCandidate);
      }
    };

    void resolveIcon();

    return () => {
      cancelled = true;
    };
  }, [localIconAbsolutePath, remoteCandidatesKey, remoteIconCandidates]);

  const handleImageError = React.useCallback(() => {
    setRemoteIconIndex((previous) => {
      const nextIndex = previous + 1;
      const nextSource = remoteIconCandidates?.[nextIndex] ?? null;
      setImageSource(nextSource);
      return nextIndex;
    });
  }, [remoteIconCandidates]);

  React.useEffect(() => {
    if (!imageSource && remoteIconIndex > 0) {
      setRemoteIconIndex(0);
    }
  }, [imageSource, remoteIconIndex]);

  return {
    imageSource,
    handleImageError,
  };
};

const SkillsSettingsSection = ({ mode }: { mode: EditorThemeMode }): JSX.Element => {
  const [skillsResult, setSkillsResult] = React.useState<SkillsListResult | null>(null);
  const [isSkillsLoading, setIsSkillsLoading] = React.useState(false);
  const [skillsError, setSkillsError] = React.useState<string | null>(null);
  const [searchQuery, setSearchQuery] = React.useState('');
  const [catalogResult, setCatalogResult] = React.useState<SkillsCatalogResult | null>(null);
  const [isCatalogLoading, setIsCatalogLoading] = React.useState(false);
  const [catalogError, setCatalogError] = React.useState<string | null>(null);
  const [catalogSearchQuery, setCatalogSearchQuery] = React.useState('');
  const [catalogPage, setCatalogPage] = React.useState(1);
  const [selectedCatalogSkill, setSelectedCatalogSkill] = React.useState<SkillsCatalogEntry | null>(null);
  const [selectedCatalogSkillDetail, setSelectedCatalogSkillDetail] =
    React.useState<SkillsCatalogDetailResult | null>(null);
  const [isCatalogDetailLoading, setIsCatalogDetailLoading] = React.useState(false);
  const [catalogDetailError, setCatalogDetailError] = React.useState<string | null>(null);
  const [installingCatalogSkillKey, setInstallingCatalogSkillKey] = React.useState<string | null>(
    null,
  );
  const [editorState, setEditorState] = React.useState<SkillEditorState | null>(null);
  const [pendingDeleteSkill, setPendingDeleteSkill] = React.useState<SkillSummary | null>(null);
  const [isSkillActionPending, setIsSkillActionPending] = React.useState(false);

  const loadSkills = React.useCallback(async (): Promise<void> => {
    setIsSkillsLoading(true);
    setSkillsError(null);

    try {
      const result = await window.desktop.skillsList();
      setSkillsResult(result);
    } catch (error) {
      setSkillsError(toSkillsErrorMessage(error, 'Could not load skills.'));
    } finally {
      setIsSkillsLoading(false);
    }
  }, []);

  const loadCatalog = React.useCallback(async (): Promise<void> => {
    setIsCatalogLoading(true);
    setCatalogError(null);

    try {
      const result = await window.desktop.skillsCatalog();
      setCatalogResult(result);
    } catch (error) {
      setCatalogError(toSkillsErrorMessage(error, 'Could not load skills.sh.'));
    } finally {
      setIsCatalogLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadSkills();
  }, [loadSkills]);

  React.useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  const skills = skillsResult?.skills ?? [];
  const catalogSkills = catalogResult?.skills ?? [];
  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const normalizedCatalogSearchQuery = catalogSearchQuery.trim().toLowerCase();

  const filteredSkills = React.useMemo(
    () =>
      skills.filter((skill) => {
        if (!normalizedSearchQuery) {
          return true;
        }

        const haystack = `${skill.name} ${skill.description} ${skill.slug}`.toLowerCase();
        return haystack.includes(normalizedSearchQuery);
      }),
    [normalizedSearchQuery, skills],
  );

  const filteredCatalogSkills = React.useMemo(
    () =>
      catalogSkills.filter((skill) => {
        if (!normalizedCatalogSearchQuery) {
          return true;
        }

        const haystack =
          `${skill.name} ${skill.skillId} ${skill.source} ${skill.owner} ${skill.repo}`.toLowerCase();
        return haystack.includes(normalizedCatalogSearchQuery);
      }),
    [catalogSkills, normalizedCatalogSearchQuery],
  );

  const catalogPageCount = Math.max(1, Math.ceil(filteredCatalogSkills.length / REMOTE_SKILLS_PAGE_SIZE));
  const visibleCatalogSkills = React.useMemo(() => {
    const offset = (catalogPage - 1) * REMOTE_SKILLS_PAGE_SIZE;
    return filteredCatalogSkills.slice(offset, offset + REMOTE_SKILLS_PAGE_SIZE);
  }, [catalogPage, filteredCatalogSkills]);
  const visibleCatalogPages = React.useMemo(
    () => toVisibleCatalogPages(catalogPage, catalogPageCount),
    [catalogPage, catalogPageCount],
  );

  const installedSkillLookup = React.useMemo(() => {
    const lookup = new Map<string, SkillSummary>();

    for (const skill of skills) {
      const normalizedSlug = skill.slug.toLowerCase();
      lookup.set(normalizedSlug, skill);

      const slugTail = normalizedSlug.split('/').pop();
      if (slugTail && !lookup.has(slugTail)) {
        lookup.set(slugTail, skill);
      }
    }

    return lookup;
  }, [skills]);

  React.useEffect(() => {
    setCatalogPage(1);
  }, [normalizedCatalogSearchQuery]);

  React.useEffect(() => {
    setCatalogPage((previous) => Math.min(previous, catalogPageCount));
  }, [catalogPageCount]);

  const findInstalledSkillForCatalogEntry = React.useCallback(
    (skill: SkillsCatalogEntry): SkillSummary | null =>
      installedSkillLookup.get(`${skill.owner}/${skill.repo}/${skill.skillId}`.toLowerCase()) ??
      installedSkillLookup.get(skill.skillId.toLowerCase()) ??
      null,
    [installedSkillLookup],
  );

  const openNewSkillDialog = React.useCallback(() => {
    setEditorState({
      mode: 'create',
      slug: toSkillSlug(DEFAULT_NEW_SKILL_NAME),
      content: buildSkillTemplate(DEFAULT_NEW_SKILL_NAME),
      slugTouched: false,
    });
  }, []);

  const openCatalogSkillDialog = React.useCallback(async (skill: SkillsCatalogEntry) => {
    setSelectedCatalogSkill(skill);
    setSelectedCatalogSkillDetail(null);
    setCatalogDetailError(null);
    setIsCatalogDetailLoading(true);

    try {
      const result = await window.desktop.skillsCatalogDetail({
        pageUrl: skill.pageUrl,
      });
      setSelectedCatalogSkillDetail(result);
    } catch (error) {
      setCatalogDetailError(toSkillsErrorMessage(error, 'Could not load skills.sh details.'));
    } finally {
      setIsCatalogDetailLoading(false);
    }
  }, []);

  const openEditSkillDialog = React.useCallback(async (skill: SkillSummary) => {
    try {
      const result = await window.desktop.skillsRead({
        absolutePath: skill.absolutePath,
      });

      setEditorState({
        mode: 'edit',
        absolutePath: skill.absolutePath,
        slug: skill.slug,
        content: result.content,
        slugTouched: true,
      });
    } catch (error) {
      window.alert(toSkillsErrorMessage(error, 'Could not open skill.'));
    }
  }, []);

  const handleRevealSkill = React.useCallback(async (skill: SkillSummary) => {
    try {
      await window.desktop.workspaceRevealFile({
        absolutePath: skill.absolutePath,
      });
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Could not reveal skill.');
    }
  }, []);

  const handleInstallCatalogSkill = React.useCallback(
    async (skill: SkillsCatalogEntry): Promise<void> => {
      const installKey = toCatalogSkillKey(skill);
      setInstallingCatalogSkillKey(installKey);

      try {
        await window.desktop.skillsInstall({
          source: skill.source,
          skillId: skill.skillId,
          repositoryUrl: skill.repositoryUrl,
        });
        await loadSkills();
      } catch (error) {
        window.alert(toSkillsErrorMessage(error, 'Could not install skill from skills.sh.'));
      } finally {
        setInstallingCatalogSkillKey(null);
      }
    },
    [loadSkills],
  );

  const handleSaveSkill = React.useCallback(async (): Promise<void> => {
    if (!editorState) {
      return;
    }

    setIsSkillActionPending(true);

    try {
      await window.desktop.skillsWrite({
        absolutePath: editorState.mode === 'edit' ? editorState.absolutePath : undefined,
        slug: editorState.mode === 'create' ? editorState.slug : undefined,
        content: editorState.content,
      });
      setEditorState(null);
      setSearchQuery('');
      await loadSkills();
    } catch (error) {
      window.alert(toSkillsErrorMessage(error, 'Could not save skill.'));
    } finally {
      setIsSkillActionPending(false);
    }
  }, [editorState, loadSkills]);

  const handleDeleteSkill = React.useCallback(async (): Promise<void> => {
    if (!pendingDeleteSkill) {
      return;
    }

    setIsSkillActionPending(true);

    try {
      await window.desktop.skillsDelete({
        absolutePath: pendingDeleteSkill.absolutePath,
      });
      setPendingDeleteSkill(null);
      await loadSkills();
    } catch (error) {
      window.alert(toSkillsErrorMessage(error, 'Could not delete skill.'));
    } finally {
      setIsSkillActionPending(false);
    }
  }, [loadSkills, pendingDeleteSkill]);

  const skillsToolbar = (
    <div className="flex items-center gap-2">
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 rounded-[10px]"
        onClick={() => {
          void loadSkills();
        }}
        disabled={isSkillsLoading}
        aria-label="Reload skills"
        title="Reload skills"
      >
        {isSkillsLoading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <RefreshCw className="h-3.5 w-3.5" />
        )}
      </Button>
      <label className="inline-flex h-8 items-center gap-2 rounded-full border border-stone-200 bg-white pl-3 pr-3 text-[13px] text-stone-500">
        <Search className="h-3.5 w-3.5 shrink-0" />
        <input
          value={searchQuery}
          onChange={(event) => {
            setSearchQuery(event.target.value);
          }}
          placeholder="Search skills"
          className="w-[180px] bg-transparent text-stone-700 outline-none placeholder:text-stone-400"
          aria-label="Search skills"
        />
      </label>
      <Button
        size="sm"
        className="h-8 rounded-[10px] px-3 text-[13px] font-semibold"
        onClick={openNewSkillDialog}
      >
        <Plus className="mr-1.5 h-3.5 w-3.5" />
        New skill
      </Button>
    </div>
  );

  const catalogToolbar = (
    <div className="flex items-center gap-2">
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 rounded-[10px]"
        onClick={() => {
          void loadCatalog();
        }}
        disabled={isCatalogLoading}
        aria-label="Reload skills.sh"
        title="Reload skills.sh"
      >
        {isCatalogLoading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <RefreshCw className="h-3.5 w-3.5" />
        )}
      </Button>
      <label className="inline-flex h-8 items-center gap-2 rounded-full border border-stone-200 bg-white pl-3 pr-3 text-[13px] text-stone-500">
        <Search className="h-3.5 w-3.5 shrink-0" />
        <input
          value={catalogSearchQuery}
          onChange={(event) => {
            setCatalogSearchQuery(event.target.value);
          }}
          placeholder="Browse skills.sh"
          className="w-[180px] bg-transparent text-stone-700 outline-none placeholder:text-stone-400"
          aria-label="Browse skills.sh"
        />
      </label>
    </div>
  );

  const selectedCatalogSkillEntry = selectedCatalogSkillDetail?.skill ?? selectedCatalogSkill;
  const selectedInstalledCatalogSkill = selectedCatalogSkillEntry
    ? findInstalledSkillForCatalogEntry(selectedCatalogSkillEntry)
    : null;

  return (
    <>
      <SectionGroup title="Installed" action={skillsToolbar}>
        <SettingsCard>
          {isSkillsLoading && skills.length === 0 ? (
            <SettingRow
              title="Loading skills"
              description="Reading installed skills from the local library."
              control={<PillLabel>Loading…</PillLabel>}
            />
          ) : skillsError ? (
            <SettingRow
              title="Skills unavailable"
              description={skillsError}
              control={<PillLabel>Error</PillLabel>}
            />
          ) : filteredSkills.length === 0 ? (
            <SettingRow
              title={normalizedSearchQuery ? 'No matching skills' : 'No installed skills'}
              description={
                normalizedSearchQuery
                  ? 'Try a different search query.'
                  : 'Create a custom skill to start building reusable agent workflows.'
              }
              control={<PillLabel>Empty</PillLabel>}
            />
          ) : (
            filteredSkills.map((skill) => (
              <SkillSettingsRow
                key={skill.absolutePath}
                mode={mode}
                skill={skill}
                onReveal={() => {
                  void handleRevealSkill(skill);
                }}
                onEdit={
                  skill.readOnly
                    ? undefined
                    : () => {
                        void openEditSkillDialog(skill);
                      }
                }
                onDelete={
                  skill.readOnly
                    ? undefined
                    : () => {
                        setPendingDeleteSkill(skill);
                      }
                }
              />
            ))
          )}
        </SettingsCard>
      </SectionGroup>

      <SectionGroup title="Browse" action={catalogToolbar}>
        <SettingsCard>
          {isCatalogLoading && catalogSkills.length === 0 ? (
            <SettingRow
              title="Loading skills.sh"
              description="Fetching the public skills catalog from skills.sh."
              control={<PillLabel>Loading…</PillLabel>}
            />
          ) : catalogError ? (
            <SettingRow
              title="skills.sh unavailable"
              description={catalogError}
              control={<PillLabel>Error</PillLabel>}
            />
          ) : visibleCatalogSkills.length === 0 ? (
            <SettingRow
              title={normalizedCatalogSearchQuery ? 'No matching skills' : 'No remote skills'}
              description={
                normalizedCatalogSearchQuery
                  ? 'Try a different search query.'
                  : 'skills.sh did not return any installable skills.'
              }
              control={<PillLabel>Empty</PillLabel>}
            />
          ) : (
            <>
              {visibleCatalogSkills.map((skill) => {
                const installedSkill = findInstalledSkillForCatalogEntry(skill);
                const installKey = toCatalogSkillKey(skill);

                return (
                  <CatalogSkillSettingsRow
                    key={skill.pageUrl}
                    mode={mode}
                    skill={skill}
                    installedSkill={installedSkill}
                    isInstalling={installingCatalogSkillKey === installKey}
                    onOpen={() => {
                      void openCatalogSkillDialog(skill);
                    }}
                    onInstall={() => {
                      void handleInstallCatalogSkill(skill);
                    }}
                    onReveal={
                      installedSkill
                        ? () => {
                            void handleRevealSkill(installedSkill);
                          }
                        : undefined
                    }
                  />
                );
              })}
              {filteredCatalogSkills.length > 0 ? (
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-stone-200/75 px-3 py-3">
                  <p className="text-[12px] text-stone-500">
                    Showing{' '}
                    {(
                      (catalogPage - 1) * REMOTE_SKILLS_PAGE_SIZE +
                      (visibleCatalogSkills.length > 0 ? 1 : 0)
                    ).toLocaleString()}
                    -
                    {(
                      (catalogPage - 1) * REMOTE_SKILLS_PAGE_SIZE +
                      visibleCatalogSkills.length
                    ).toLocaleString()}{' '}
                    of {filteredCatalogSkills.length.toLocaleString()} skills.
                  </p>
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="rounded-[10px]"
                      onClick={() => {
                        setCatalogPage((previous) => Math.max(1, previous - 1));
                      }}
                      disabled={catalogPage <= 1}
                    >
                      Previous
                    </Button>
                    {visibleCatalogPages.map((page, index) =>
                      page === 'ellipsis' ? (
                        <span
                          key={`ellipsis-${catalogPageCount}-${index}`}
                          className="px-1 text-[12px] text-stone-400"
                        >
                          …
                        </span>
                      ) : (
                        <Button
                          key={page}
                          size="sm"
                          variant={page === catalogPage ? 'secondary' : 'ghost'}
                          className="min-w-[36px] rounded-[10px] px-2"
                          onClick={() => {
                            setCatalogPage(page);
                          }}
                        >
                          {page}
                        </Button>
                      ),
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="rounded-[10px]"
                      onClick={() => {
                        setCatalogPage((previous) => Math.min(catalogPageCount, previous + 1));
                      }}
                      disabled={catalogPage >= catalogPageCount}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              ) : null}
            </>
          )}
        </SettingsCard>
      </SectionGroup>

      <Dialog
        open={selectedCatalogSkill !== null}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedCatalogSkill(null);
            setSelectedCatalogSkillDetail(null);
            setCatalogDetailError(null);
            setIsCatalogDetailLoading(false);
          }
        }}
      >
        <DialogContent className="max-w-[680px] rounded-[28px] p-0">
          <div className="px-5 pb-5 pt-5">
            <div className="min-w-0">
              <h2 className="truncate text-[24px] font-semibold leading-none tracking-[-0.015em] text-stone-900">
                {selectedCatalogSkillEntry?.name ?? 'skills.sh skill'}
              </h2>
              <p className="mt-2 text-[13px] leading-[1.45] text-stone-500">
                {selectedCatalogSkillEntry?.source ?? 'skills.sh'}
                {selectedCatalogSkillEntry ? ` · ${selectedCatalogSkillEntry.skillId}` : ''}
              </p>
            </div>

            {isCatalogDetailLoading ? (
              <div className="mt-4 rounded-[18px] border border-stone-200 bg-stone-50 px-4 py-4 text-[13px] text-stone-500">
                Loading skill details from skills.sh…
              </div>
            ) : catalogDetailError ? (
              <div className="mt-4 rounded-[18px] border border-rose-200 bg-rose-50 px-4 py-4 text-[13px] text-rose-700">
                {catalogDetailError}
              </div>
            ) : (
              <>
                <p className="mt-4 text-[15px] leading-[1.6] text-stone-600">
                  {selectedCatalogSkillDetail?.summary ?? 'No summary was provided on skills.sh.'}
                </p>

                <div className="mt-5 rounded-[16px] bg-stone-50 px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <p className="break-all font-mono text-[13px] leading-[1.6] text-stone-700">
                      {selectedCatalogSkillEntry?.installCommand ?? 'Unavailable'}
                    </p>
                    {selectedCatalogSkillEntry?.installCommand ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 shrink-0 rounded-[10px]"
                        aria-label="Copy install command"
                        title="Copy install command"
                        onClick={() => {
                          void navigator.clipboard.writeText(selectedCatalogSkillEntry.installCommand);
                        }}
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
                    ) : null}
                  </div>
                </div>
              </>
            )}

            <div className="mt-5 flex items-center justify-between gap-3">
              <p className="text-[13px] text-stone-500">
                {selectedCatalogSkillDetail?.weeklyInstalls
                  ? `${selectedCatalogSkillDetail.weeklyInstalls} weekly installs`
                  : ''}
              </p>
              <div className="flex items-center justify-end gap-2">
                {selectedCatalogSkillEntry ? (
                  <Button
                    variant="ghost"
                    className="h-9 rounded-[11px] px-3 text-[13px]"
                    title={selectedCatalogSkillEntry.source}
                    onClick={() => {
                      window.open(selectedCatalogSkillEntry.repositoryUrl, '_blank', 'noopener,noreferrer');
                    }}
                  >
                    <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                    Repo
                  </Button>
                ) : null}
                {selectedInstalledCatalogSkill ? (
                  <Button
                    variant="ghost"
                    className="h-9 rounded-[11px] px-3 text-[13px]"
                    onClick={() => {
                      void handleRevealSkill(selectedInstalledCatalogSkill);
                    }}
                  >
                    <FolderSearch className="mr-1.5 h-3.5 w-3.5" />
                    Reveal
                  </Button>
                ) : selectedCatalogSkillEntry ? (
                  <Button
                    className="h-9 rounded-[11px] px-4 text-[13px] font-semibold"
                    disabled={installingCatalogSkillKey === toCatalogSkillKey(selectedCatalogSkillEntry)}
                    onClick={() => {
                      void handleInstallCatalogSkill(selectedCatalogSkillEntry);
                    }}
                  >
                    {installingCatalogSkillKey === toCatalogSkillKey(selectedCatalogSkillEntry)
                      ? 'Installing…'
                      : 'Install'}
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={editorState !== null} onOpenChange={(open) => !open && setEditorState(null)}>
        <DialogContent className="max-w-[760px] rounded-[28px] p-0">
          <div className="px-5 pb-5 pt-5">
            <h2 className="text-[24px] font-semibold leading-none tracking-[-0.015em] text-stone-900">
              {editorState?.mode === 'edit' ? 'Edit skill' : 'New skill'}
            </h2>
            <p className="mt-2 text-[13px] leading-[1.45] text-stone-500">
              Skills are stored as `SKILL.md` files inside your local Codex skills directory.
            </p>

            {editorState?.mode === 'create' ? (
              <label className="mt-4 block text-[13px] font-medium text-stone-700">
                Folder name
                <input
                  value={editorState.slug}
                  onChange={(event) => {
                    const nextSlug = toSkillSlug(event.target.value);
                    setEditorState((previous) =>
                      previous
                        ? {
                            ...previous,
                            slug: nextSlug,
                            slugTouched: true,
                          }
                        : previous,
                    );
                  }}
                  placeholder="my-skill"
                  className="no-drag mt-2 h-9 w-full rounded-[10px] border border-stone-300 bg-white px-3 text-[13px] text-stone-800 placeholder:text-stone-400 focus:outline-none"
                />
              </label>
            ) : null}

            <label className="mt-4 block text-[13px] font-medium text-stone-700">
              SKILL.md
              <textarea
                value={editorState?.content ?? ''}
                onChange={(event) => {
                  const nextContent = event.target.value;
                  setEditorState((previous) => {
                    if (!previous) {
                      return previous;
                    }

                    const nextTitle = extractSkillTitleFromContent(nextContent);
                    const nextSlug =
                      previous.mode === 'create' && !previous.slugTouched
                        ? toSkillSlug(nextTitle)
                        : previous.slug;

                    return {
                      ...previous,
                      content: nextContent,
                      slug: nextSlug,
                    };
                  });
                }}
                spellCheck={false}
                className="no-drag mt-2 h-[320px] w-full resize-none rounded-[12px] border border-stone-300 bg-white px-3 py-2 font-mono text-[12px] leading-[1.55] text-stone-800 placeholder:text-stone-400 focus:outline-none"
              />
            </label>

            <div className="mt-4 flex items-center justify-end gap-2">
              <Button
                variant="ghost"
                className="h-9 rounded-[11px] px-3 text-[13px]"
                onClick={() => {
                  setEditorState(null);
                }}
                disabled={isSkillActionPending}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                className="h-9 rounded-[11px] bg-[var(--zeroade-accent-strong)] px-4 text-[13px] font-semibold text-white hover:bg-[var(--zeroade-accent-strong)] hover:opacity-95"
                onClick={() => {
                  void handleSaveSkill();
                }}
                disabled={
                  isSkillActionPending ||
                  (editorState?.mode === 'create' && (editorState.slug?.trim().length ?? 0) === 0) ||
                  (editorState?.content.trim().length ?? 0) === 0
                }
              >
                {isSkillActionPending ? 'Saving…' : editorState?.mode === 'edit' ? 'Save changes' : 'Create'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={pendingDeleteSkill !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPendingDeleteSkill(null);
          }
        }}
      >
        <DialogContent className="max-w-[480px] rounded-[28px] p-0">
          <div className="px-5 pb-5 pt-5">
            <h2 className="text-[24px] font-semibold leading-none tracking-[-0.015em] text-stone-900">
              Delete skill
            </h2>
            <p className="mt-2 text-[13px] leading-[1.45] text-stone-500">
              {pendingDeleteSkill
                ? `Remove ${pendingDeleteSkill.name} from your local skills library. This deletes the skill directory and any files inside it.`
                : 'Remove this skill from your local skills library.'}
            </p>

            <div className="mt-4 flex items-center justify-end gap-2">
              <Button
                variant="ghost"
                className="h-9 rounded-[11px] px-3 text-[13px]"
                onClick={() => {
                  setPendingDeleteSkill(null);
                }}
                disabled={isSkillActionPending}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                className="h-9 rounded-[11px] bg-rose-600 px-4 text-[13px] font-semibold text-white hover:bg-rose-700"
                onClick={() => {
                  void handleDeleteSkill();
                }}
                disabled={isSkillActionPending}
              >
                {isSkillActionPending ? 'Deleting…' : 'Delete'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};

const SkillSettingsRow = ({
  mode,
  skill,
  onReveal,
  onEdit,
  onDelete,
}: {
  mode: EditorThemeMode;
  skill: SkillSummary;
  onReveal: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}): JSX.Element => (
  <div className="flex items-center justify-between gap-4 border-b border-stone-200/75 px-3 py-3 last:border-b-0">
    <div className="min-w-0 flex items-start gap-3">
      <SkillAvatar
        scope={skill.scope}
        iconAbsolutePath={skill.iconAbsolutePath}
        className="mt-0.5 h-10 w-10 rounded-[12px]"
      />
      <div className="min-w-0">
        <p className="truncate text-[14px] font-medium text-stone-800">{skill.name}</p>
        <p className="mt-0.5 text-[12px] text-stone-500">
          {skill.scope === 'custom' ? 'Custom skill' : 'Built-in skill'}
          {' · '}
          {skill.slug}
        </p>
        <p className="mt-1 text-[13px] text-stone-500">{skill.description}</p>
      </div>
    </div>
    <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
      <Button
        size="sm"
        variant="ghost"
        className="rounded-[10px]"
        onClick={onReveal}
      >
        <FolderSearch className="mr-1.5 h-3.5 w-3.5" />
        Reveal
      </Button>
      {onEdit ? (
        <Button
          size="sm"
          variant="ghost"
          className="rounded-[10px]"
          onClick={onEdit}
        >
          <Pencil className="mr-1.5 h-3.5 w-3.5" />
          Edit
        </Button>
      ) : null}
      {onDelete ? (
        <Button
          size="sm"
          variant="ghost"
          className={cn(
            'rounded-[10px]',
            mode === 'dark'
              ? 'text-rose-300 hover:bg-rose-950/40 hover:text-rose-200'
              : 'text-rose-700 hover:bg-rose-50 hover:text-rose-800',
          )}
          onClick={onDelete}
        >
          <Trash2 className="mr-1.5 h-3.5 w-3.5" />
          Delete
        </Button>
      ) : null}
    </div>
  </div>
);

const CatalogSkillSettingsRow = ({
  mode,
  skill,
  installedSkill,
  isInstalling,
  onOpen,
  onInstall,
  onReveal,
}: {
  mode: EditorThemeMode;
  skill: SkillsCatalogEntry;
  installedSkill: SkillSummary | null;
  isInstalling: boolean;
  onOpen: () => void;
  onInstall: () => void;
  onReveal?: () => void;
}): JSX.Element => (
  <div
    className={cn(
      'flex cursor-pointer items-center justify-between gap-4 border-b border-stone-200/75 px-3 py-3 transition-colors last:border-b-0',
      mode === 'dark' ? 'hover:bg-[var(--zeroade-bg-soft)]' : 'hover:bg-stone-50/60',
    )}
    onClick={onOpen}
  >
    <div className="min-w-0 flex items-start gap-3">
      <SkillAvatar
        scope={installedSkill?.scope ?? 'system'}
        iconAbsolutePath={installedSkill?.iconAbsolutePath}
        remoteIconCandidates={toCatalogSkillIconCandidates(skill)}
        className="mt-0.5 h-10 w-10 rounded-[12px]"
      />
      <div className="min-w-0">
        <p className="truncate text-[14px] font-medium text-stone-800">{skill.name}</p>
        <p className="mt-0.5 truncate text-[12px] text-stone-500">{skill.source}</p>
        {formatSkillInstallCount(skill.installsCount) ? (
          <p className="mt-1 text-[12px] text-stone-500">
            {formatSkillInstallCount(skill.installsCount)}
          </p>
        ) : null}
        <p className="mt-1 break-all text-[13px] text-stone-500">{skill.installCommand}</p>
      </div>
    </div>
    <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
      {installedSkill && onReveal ? (
        <Button
          size="sm"
          variant="ghost"
          className="rounded-[10px]"
          onClick={(event) => {
            event.stopPropagation();
            onReveal();
          }}
        >
          <Check className="mr-1.5 h-3.5 w-3.5" />
          Installed
        </Button>
      ) : (
        <Button
          size="sm"
          variant="outline"
          className="rounded-[10px]"
          onClick={(event) => {
            event.stopPropagation();
            onInstall();
          }}
          disabled={isInstalling}
        >
          {isInstalling ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Plus className="mr-1.5 h-3.5 w-3.5" />
          )}
          {isInstalling ? 'Installing…' : 'Install'}
        </Button>
      )}
    </div>
  </div>
);

const SkillAvatar = ({
  scope,
  iconAbsolutePath,
  remoteIconCandidates,
  className,
}: {
  scope: SkillSummary['scope'];
  iconAbsolutePath?: string | null;
  remoteIconCandidates?: string[];
  className?: string;
}): JSX.Element => {
  const { imageSource, handleImageError } = useResolvedSkillIconSource({
    localIconAbsolutePath: iconAbsolutePath,
    remoteIconCandidates,
  });

  return (
    <Avatar
      className={cn(
        'border border-black/5 bg-white',
        className,
      )}
    >
      {imageSource ? (
        <AvatarImage
          src={imageSource}
          alt=""
          className="zeroade-agent-icon-image h-full w-full object-cover object-center"
          onError={handleImageError}
        />
      ) : null}
      <AvatarFallback
        className={cn(
          'rounded-[12px]',
          'text-stone-800',
          scope === 'custom'
            ? 'bg-amber-50 text-amber-700'
            : 'bg-stone-100 text-stone-800',
        )}
      >
        {scope === 'custom' ? (
          <Sparkles className="h-[18px] w-[18px]" />
        ) : (
          <Bot className="h-[18px] w-[18px]" />
        )}
      </AvatarFallback>
    </Avatar>
  );
};
