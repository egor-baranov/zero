import {
  spawn,
  spawnSync,
  type ChildProcessWithoutNullStreams,
} from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, promises as fs } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { app } from 'electron';
import {
  LSP_SEMANTIC_TOKEN_MODIFIERS,
  LSP_SEMANTIC_TOKEN_TYPES,
} from '@shared/types/lsp';
import type {
  LspCompletionItem,
  LspCompletionRequest,
  LspCompletionResult,
  LspDeleteServerRequest,
  LspDefinitionResult,
  LspDiagnostic,
  LspDiagnosticSeverity,
  LspDocumentCloseRequest,
  LspDocumentSyncRequest,
  LspDocumentSyncResult,
  LspHoverResult,
  LspInstallServerRequest,
  LspListServersResult,
  LspLocation,
  LspManagedServerInstallKind,
  LspManagedServerSource,
  LspRange,
  LspReferencesRequest,
  LspReferencesResult,
  LspRendererEvent,
  LspServerCatalogEntry,
  LspServerMutationResult,
  LspSemanticTokensRequest,
  LspSemanticTokensResult,
  LspTextDocumentPositionRequest,
  LspTextEdit,
} from '@shared/types/lsp';

type JsonRpcId = number | string;

interface JsonRpcResponse {
  id: JsonRpcId;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

interface LspLaunchCandidate {
  command: string;
  args: string[];
  env?: Record<string, string>;
  shell?: boolean;
}

type LspManagedDownloadStrategy = 'rust-analyzer' | 'kotlin-lsp' | 'jdtls';
type LspManagedToolchainStrategy = 'go-gopls';

interface LspManagedInstallConfig {
  id: string;
  kind: LspManagedServerInstallKind;
  packageName?: string;
  packages?: string[];
  relativeScriptPaths?: string[];
  relativeCommandPaths?: string[];
  downloadStrategy?: LspManagedDownloadStrategy;
  toolchainStrategy?: LspManagedToolchainStrategy;
}

interface LspServerConfig {
  id: string;
  name: string;
  description: string;
  languages: string[];
  commandNames: string[];
  args: string[];
  installHint: string;
  managedInstall?: LspManagedInstallConfig;
}

interface LspServerAvailability {
  source: LspManagedServerSource;
  installed: boolean;
  canInstall: boolean;
  canDelete: boolean;
  detail: string | null;
  launchCandidates: LspLaunchCandidate[];
}

interface LspDocumentState {
  uri: string;
  relativePath: string;
  languageId: string;
  version: number;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
}

interface LspSemanticTokensLegend {
  tokenTypes: string[];
  tokenModifiers: string[];
}

interface LspSemanticTokensSupport {
  legend: LspSemanticTokensLegend;
  full: boolean;
}

const COMPLETION_TRIGGER_INVOKED = 1;
const COMPLETION_TRIGGER_CHARACTER = 2;

const POSITION_ENCODING = 'utf-16';
const CLIENT_SEMANTIC_TOKEN_TYPES = [...LSP_SEMANTIC_TOKEN_TYPES];
const CLIENT_SEMANTIC_TOKEN_MODIFIERS = [...LSP_SEMANTIC_TOKEN_MODIFIERS];
const CLIENT_SEMANTIC_TOKEN_TYPE_INDEX = new Map(
  CLIENT_SEMANTIC_TOKEN_TYPES.map((tokenType, index) => [tokenType, index]),
);
const CLIENT_SEMANTIC_TOKEN_MODIFIER_INDEX = new Map(
  CLIENT_SEMANTIC_TOKEN_MODIFIERS.map((modifier, index) => [modifier, index]),
);
const MANAGED_LSP_DIRECTORY_NAME = 'lsp-servers';

const getExecutableNames = (name: string): string[] =>
  process.platform === 'win32'
    ? Array.from(new Set([name, `${name}.cmd`, `${name}.exe`, `${name}.bat`]))
    : [name];

const COMMON_BIN_DIRECTORIES = Array.from(
  new Set([
    path.join(homedir(), '.local', 'share', 'nvim', 'mason', 'bin'),
    path.join(homedir(), '.local', 'bin'),
    path.join(homedir(), '.asdf', 'shims'),
    path.join(homedir(), '.cargo', 'bin'),
    path.join(homedir(), '.volta', 'bin'),
    path.join(homedir(), 'go', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
  ]),
);

const resolveSystemSearchDirectories = (): string[] =>
  Array.from(
    new Set([
      ...(process.env.PATH ?? '')
        .split(path.delimiter)
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0),
      ...COMMON_BIN_DIRECTORIES,
    ]),
  );

const resolveManagedLspRoot = (): string =>
  path.join(app.getPath('userData'), MANAGED_LSP_DIRECTORY_NAME);

const resolveManagedInstallRoot = (installId: string): string =>
  path.join(resolveManagedLspRoot(), installId);

const resolveDevelopmentPackageRoots = (): string[] => {
  if (app.isPackaged) {
    return [];
  }

  return Array.from(new Set([process.cwd()])).filter((candidate) => existsSync(candidate));
};

const resolveNodePackageScripts = (
  packageRoots: string[],
  packageName: string,
  relativeScriptPaths: string[],
): string[] => {
  const candidates: string[] = [];

  for (const root of packageRoots) {
    for (const relativeScriptPath of relativeScriptPaths) {
      const candidate = path.join(root, 'node_modules', packageName, relativeScriptPath);
      if (existsSync(candidate)) {
        candidates.push(candidate);
      }
    }
  }

  return Array.from(new Set(candidates));
};

const resolveCommandInDirectories = (
  command: string,
  directories: string[],
): string[] => {
  if (!command) {
    return [];
  }

  if (path.isAbsolute(command) || /[\\/]/.test(command)) {
    return existsSync(command) ? [command] : [];
  }

  const candidates: string[] = [];
  for (const executableName of getExecutableNames(command)) {
    for (const directory of directories) {
      const candidate = path.join(directory, executableName);
      if (existsSync(candidate)) {
        candidates.push(candidate);
      }
    }
  }

  return Array.from(new Set(candidates));
};

const isShellCommandPath = (command: string): boolean =>
  process.platform === 'win32' && /\.(cmd|bat)$/i.test(command);

const dedupeLaunchCandidates = (
  candidates: LspLaunchCandidate[],
): LspLaunchCandidate[] => {
  const seen = new Set<string>();

  return candidates.filter((candidate) => {
    const key = `${candidate.command}\u0000${candidate.args.join('\u0000')}`;
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
};

const resolveCommandOnLoginShell = (command: string): string | null => {
  if (process.platform === 'win32' || !command || /[\\/]/.test(command) || path.isAbsolute(command)) {
    return null;
  }

  const shellPath = process.env.SHELL?.trim() || '/bin/zsh';
  try {
    const result = spawnSync(shellPath, ['-lc', `command -v '${command.replace(/'/g, `'\\''`)}'`], {
      encoding: 'utf8',
    });
    if (result.status !== 0) {
      return null;
    }

    const resolved = result.stdout.trim().split('\n').pop()?.trim();
    return resolved && existsSync(resolved) ? resolved : null;
  } catch {
    return null;
  }
};

const resolveFirstExecutablePath = (commands: string[]): string | null => {
  const searchDirectories = resolveSystemSearchDirectories();

  for (const command of commands) {
    const fromDirectories = resolveCommandInDirectories(command, searchDirectories)[0];
    if (fromDirectories) {
      return fromDirectories;
    }

    const fromLoginShell = resolveCommandOnLoginShell(command);
    if (fromLoginShell) {
      return fromLoginShell;
    }
  }

  return null;
};

const createNodeScriptLaunchCandidates = (
  scriptPaths: string[],
  args: string[] = [],
): LspLaunchCandidate[] =>
  scriptPaths.map((scriptPath) => ({
    command: process.execPath,
    args: [scriptPath, ...args],
    env: {
      ELECTRON_RUN_AS_NODE: '1',
    },
  }));

const createDirectLaunchCandidates = (
  commandPaths: string[],
  args: string[] = [],
): LspLaunchCandidate[] =>
  commandPaths.map((commandPath) => ({
    command: commandPath,
    args,
    shell: isShellCommandPath(commandPath),
  }));

const resolveManagedCommandPaths = (
  installRoot: string,
  relativeCommandPaths: string[],
): string[] =>
  Array.from(
    new Set(
      relativeCommandPaths
        .map((relativeCommandPath) => path.join(installRoot, relativeCommandPath))
        .filter((candidate) => existsSync(candidate)),
    ),
  );

const resolveExecutableLaunchCandidates = (
  commands: string[],
  args: string[] = [],
): LspLaunchCandidate[] => {
  const candidates: LspLaunchCandidate[] = [];
  const searchDirectories = resolveSystemSearchDirectories();

  for (const command of commands) {
    for (const resolvedCommand of resolveCommandInDirectories(command, searchDirectories)) {
      candidates.push({
        command: resolvedCommand,
        args,
        shell: isShellCommandPath(resolvedCommand),
      });
    }

    const resolvedFromShell = resolveCommandOnLoginShell(command);
    if (resolvedFromShell) {
      candidates.push({
        command: resolvedFromShell,
        args,
        shell: isShellCommandPath(resolvedFromShell),
      });
    }

    candidates.push({
      command,
      args,
      shell: isShellCommandPath(command),
    });
  }

  return dedupeLaunchCandidates(candidates);
};

const resolveServerLaunchCandidates = (config: LspServerConfig): LspLaunchCandidate[] => {
  const candidates: LspLaunchCandidate[] = [];

  if (
    config.managedInstall?.kind === 'npm' &&
    config.managedInstall.packageName &&
    config.managedInstall.relativeScriptPaths
  ) {
    const managedScriptPaths = resolveNodePackageScripts(
      [resolveManagedInstallRoot(config.managedInstall.id)],
      config.managedInstall.packageName,
      config.managedInstall.relativeScriptPaths,
    );
    const developmentScriptPaths = resolveNodePackageScripts(
      resolveDevelopmentPackageRoots(),
      config.managedInstall.packageName,
      config.managedInstall.relativeScriptPaths,
    );

    candidates.push(...createNodeScriptLaunchCandidates(managedScriptPaths, config.args));
    candidates.push(...createNodeScriptLaunchCandidates(developmentScriptPaths, config.args));
  } else if (
    (config.managedInstall?.kind === 'download' || config.managedInstall?.kind === 'toolchain') &&
    config.managedInstall.relativeCommandPaths
  ) {
    const managedCommandPaths = resolveManagedCommandPaths(
      resolveManagedInstallRoot(config.managedInstall.id),
      config.managedInstall.relativeCommandPaths,
    );
    candidates.push(...createDirectLaunchCandidates(managedCommandPaths, config.args));
  }

  candidates.push(...resolveExecutableLaunchCandidates(config.commandNames, config.args));
  return dedupeLaunchCandidates(candidates);
};

const resolveServerAvailability = (config: LspServerConfig): LspServerAvailability => {
  if (config.managedInstall) {
    const managedRoot = resolveManagedInstallRoot(config.managedInstall.id);
    const managedInstalled =
      config.managedInstall.kind === 'npm' &&
      config.managedInstall.packageName &&
      config.managedInstall.relativeScriptPaths
        ? resolveNodePackageScripts(
            [managedRoot],
            config.managedInstall.packageName,
            config.managedInstall.relativeScriptPaths,
          ).length > 0
        : (config.managedInstall.kind === 'download' ||
            config.managedInstall.kind === 'toolchain') &&
            config.managedInstall.relativeCommandPaths
          ? resolveManagedCommandPaths(
              managedRoot,
              config.managedInstall.relativeCommandPaths,
            ).length > 0
          : false;

    if (managedInstalled) {
      return {
        source: 'managed',
        installed: true,
        canInstall: false,
        canDelete: true,
        detail: `Installed in ${managedRoot}.`,
        launchCandidates: resolveServerLaunchCandidates(config),
      };
    }

    if (
      config.managedInstall.kind === 'npm' &&
      config.managedInstall.packageName &&
      config.managedInstall.relativeScriptPaths
    ) {
      const developmentRoots = resolveDevelopmentPackageRoots();
      const developmentScriptPaths = resolveNodePackageScripts(
        developmentRoots,
        config.managedInstall.packageName,
        config.managedInstall.relativeScriptPaths,
      );
      if (developmentScriptPaths.length > 0) {
        const developmentRoot = developmentRoots[0] ?? process.cwd();
        return {
          source: 'development',
          installed: true,
          canInstall: true,
          canDelete: false,
          detail: `Using development dependency from ${developmentRoot}. Install here to pin a managed copy.`,
          launchCandidates: resolveServerLaunchCandidates(config),
        };
      }
    }
  }

  const systemExecutablePath = resolveFirstExecutablePath(config.commandNames);
  if (systemExecutablePath) {
    return {
      source: 'system',
      installed: true,
      canInstall: Boolean(config.managedInstall),
      canDelete: false,
      detail: config.managedInstall
        ? `Using ${systemExecutablePath}. Install here to pin a managed copy.`
        : `Using ${systemExecutablePath}.`,
      launchCandidates: resolveServerLaunchCandidates(config),
    };
  }

  return {
    source: null,
    installed: false,
    canInstall: Boolean(config.managedInstall),
    canDelete: false,
    detail: config.installHint,
    launchCandidates: resolveServerLaunchCandidates(config),
  };
};

const createManagedNodeServerConfig = (
  id: string,
  name: string,
  description: string,
  languages: string[],
  commandNames: string[],
  args: string[] = [],
  managedInstall: LspManagedInstallConfig,
  installHint: string,
): LspServerConfig => ({
  id,
  name,
  description,
  languages,
  commandNames,
  args,
  installHint,
  managedInstall,
});

const createManagedDownloadServerConfig = (
  id: string,
  name: string,
  description: string,
  languages: string[],
  commandNames: string[],
  args: string[] = [],
  managedInstall: LspManagedInstallConfig,
  installHint: string,
): LspServerConfig => ({
  id,
  name,
  description,
  languages,
  commandNames,
  args,
  installHint,
  managedInstall,
});

const createManagedToolchainServerConfig = (
  id: string,
  name: string,
  description: string,
  languages: string[],
  commandNames: string[],
  args: string[] = [],
  managedInstall: LspManagedInstallConfig,
  installHint: string,
): LspServerConfig => ({
  id,
  name,
  description,
  languages,
  commandNames,
  args,
  installHint,
  managedInstall,
});

const SERVER_CONFIGS: LspServerConfig[] = [
  createManagedNodeServerConfig(
    'typescript-language-server',
    'TypeScript / JavaScript',
    'TypeScript language server with JavaScript support.',
    ['typescript', 'javascript'],
    ['typescript-language-server'],
    ['--stdio'],
    {
      id: 'typescript-language-server',
      kind: 'npm',
      packageName: 'typescript-language-server',
      packages: ['typescript-language-server', 'typescript'],
      relativeScriptPaths: ['lib/cli.mjs'],
    },
    'Install from Settings to keep a managed TypeScript server copy. This requires `npm` on PATH.',
  ),
  createManagedNodeServerConfig(
    'pyright',
    'Python',
    'Pyright language server for Python analysis and completions.',
    ['python'],
    ['pyright-langserver'],
    ['--stdio'],
    {
      id: 'pyright',
      kind: 'npm',
      packageName: 'pyright',
      packages: ['pyright'],
      relativeScriptPaths: ['langserver.index.js'],
    },
    'Install from Settings to keep a managed Pyright copy. This requires `npm` on PATH.',
  ),
  createManagedToolchainServerConfig(
    'gopls',
    'Go',
    'Go language server powered by gopls.',
    ['go'],
    ['gopls'],
    [],
    {
      id: 'gopls',
      kind: 'toolchain',
      toolchainStrategy: 'go-gopls',
      relativeCommandPaths: process.platform === 'win32' ? ['bin/gopls.exe'] : ['bin/gopls'],
    },
    'Install from Settings to keep a managed gopls copy. This requires the Go toolchain on PATH.',
  ),
  createManagedDownloadServerConfig(
    'kotlin-lsp',
    'Kotlin',
    'Kotlin language server for Kotlin and Gradle Kotlin files.',
    ['kotlin'],
    ['kotlin-lsp', 'kotlin-language-server'],
    [],
    {
      id: 'kotlin-lsp',
      kind: 'download',
      downloadStrategy: 'kotlin-lsp',
      relativeCommandPaths:
        process.platform === 'win32' ? ['kotlin-lsp.cmd'] : ['kotlin-lsp.sh'],
    },
    'Install from Settings to keep a managed Kotlin LSP copy. Zero downloads the official standalone package with its bundled runtime.',
  ),
  createManagedDownloadServerConfig(
    'rust-analyzer',
    'Rust',
    'Rust language server powered by rust-analyzer.',
    ['rust'],
    ['rust-analyzer'],
    [],
    {
      id: 'rust-analyzer',
      kind: 'download',
      downloadStrategy: 'rust-analyzer',
      relativeCommandPaths:
        process.platform === 'win32'
          ? ['bin/rust-analyzer.exe']
          : ['bin/rust-analyzer'],
    },
    'Install from Settings to keep a managed rust-analyzer binary. Zero downloads the official upstream release for your platform.',
  ),
  createManagedDownloadServerConfig(
    'jdtls',
    'Java',
    'Eclipse JDT language server for Java projects.',
    ['java'],
    ['jdtls'],
    [],
    {
      id: 'jdtls',
      kind: 'download',
      downloadStrategy: 'jdtls',
      relativeCommandPaths: process.platform === 'win32' ? ['bin/jdtls.bat'] : ['bin/jdtls'],
    },
    'Install from Settings to keep a managed Eclipse JDT LS copy. Java 21 and Python 3 are still required at runtime.',
  ),
  createManagedNodeServerConfig(
    'json-ls',
    'JSON',
    'VS Code JSON language server.',
    ['json'],
    ['vscode-json-language-server'],
    ['--stdio'],
    {
      id: 'vscode-langservers-extracted',
      kind: 'npm',
      packageName: 'vscode-langservers-extracted',
      packages: ['vscode-langservers-extracted'],
      relativeScriptPaths: ['bin/vscode-json-language-server'],
    },
    'Install from Settings to keep a managed JSON server copy. This requires `npm` on PATH.',
  ),
  createManagedNodeServerConfig(
    'yaml-ls',
    'YAML',
    'YAML language server with schema-aware validation.',
    ['yaml'],
    ['yaml-language-server'],
    ['--stdio'],
    {
      id: 'yaml-language-server',
      kind: 'npm',
      packageName: 'yaml-language-server',
      packages: ['yaml-language-server'],
      relativeScriptPaths: ['bin/yaml-language-server'],
    },
    'Install from Settings to keep a managed YAML server copy. This requires `npm` on PATH.',
  ),
  createManagedNodeServerConfig(
    'bash-ls',
    'Shell / Bash',
    'Bash language server for shell scripts.',
    ['shell'],
    ['bash-language-server'],
    ['start'],
    {
      id: 'bash-language-server',
      kind: 'npm',
      packageName: 'bash-language-server',
      packages: ['bash-language-server'],
      relativeScriptPaths: ['out/cli.js'],
    },
    'Install from Settings to keep a managed Bash server copy. This requires `npm` on PATH.',
  ),
  createManagedNodeServerConfig(
    'html-ls',
    'HTML',
    'VS Code HTML language server.',
    ['html'],
    ['vscode-html-language-server'],
    ['--stdio'],
    {
      id: 'vscode-langservers-extracted',
      kind: 'npm',
      packageName: 'vscode-langservers-extracted',
      packages: ['vscode-langservers-extracted'],
      relativeScriptPaths: ['bin/vscode-html-language-server'],
    },
    'Install from Settings to keep a managed HTML server copy. This requires `npm` on PATH.',
  ),
  createManagedNodeServerConfig(
    'css-ls',
    'CSS',
    'VS Code CSS language server.',
    ['css'],
    ['vscode-css-language-server'],
    ['--stdio'],
    {
      id: 'vscode-langservers-extracted',
      kind: 'npm',
      packageName: 'vscode-langservers-extracted',
      packages: ['vscode-langservers-extracted'],
      relativeScriptPaths: ['bin/vscode-css-language-server'],
    },
    'Install from Settings to keep a managed CSS server copy. This requires `npm` on PATH.',
  ),
];

const isMissingExecutableMessage = (value: string): boolean =>
  /ENOENT|not found|No such file or directory/i.test(value);

const parseSha256Digest = (value: string): string | null => {
  const match = value.match(/\b[a-f0-9]{64}\b/i);
  return match ? match[0].toLowerCase() : null;
};

const getServerConfigById = (serverId: string): LspServerConfig | null =>
  SERVER_CONFIGS.find((config) => config.id === serverId) ?? null;

const getServerConfigForLanguage = (languageId: string): LspServerConfig | null =>
  SERVER_CONFIGS.find((config) => config.languages.includes(languageId)) ?? null;

const toWorkspaceFileUri = (workspacePath: string, relativePath: string): string =>
  pathToFileURL(path.resolve(workspacePath, relativePath)).toString();

const toWorkspaceRelativePath = (workspacePath: string, uri: string): string | null => {
  try {
    const absolutePath = path.resolve(fileURLToPath(uri));
    const normalizedWorkspace = path.resolve(workspacePath);

    if (
      absolutePath !== normalizedWorkspace &&
      !absolutePath.startsWith(`${normalizedWorkspace}${path.sep}`)
    ) {
      return null;
    }

    return path.relative(normalizedWorkspace, absolutePath).split(path.sep).join('/');
  } catch {
    return null;
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isPosition = (value: unknown): value is { line: number; character: number } =>
  isRecord(value) &&
  typeof value.line === 'number' &&
  Number.isFinite(value.line) &&
  typeof value.character === 'number' &&
  Number.isFinite(value.character);

const normalizeRange = (value: unknown): LspRange | null => {
  if (!isRecord(value) || !isPosition(value.start) || !isPosition(value.end)) {
    return null;
  }

  return {
    start: {
      line: value.start.line,
      character: value.start.character,
    },
    end: {
      line: value.end.line,
      character: value.end.character,
    },
  };
};

const normalizeTextEdit = (value: unknown): LspTextEdit | null => {
  if (!isRecord(value)) {
    return null;
  }

  const directRange = normalizeRange(value.range);
  if (directRange && typeof value.newText === 'string') {
    return {
      range: directRange,
      newText: value.newText,
    };
  }

  const replaceRange = normalizeRange(value.replace);
  if (replaceRange && typeof value.newText === 'string') {
    return {
      range: replaceRange,
      newText: value.newText,
    };
  }

  return null;
};

const normalizeMarkup = (value: unknown): string | null => {
  if (typeof value === 'string') {
    return value;
  }

  if (isRecord(value)) {
    if (typeof value.value === 'string') {
      return value.value;
    }

    if (typeof value.language === 'string' && typeof value.value === 'string') {
      return `\`\`\`${value.language}\n${value.value}\n\`\`\``;
    }
  }

  return null;
};

const normalizeHover = (value: unknown): LspHoverResult => {
  if (!isRecord(value)) {
    return {
      markdown: null,
      range: null,
    };
  }

  const rawContents = value.contents;
  let markdown: string | null = null;

  if (Array.isArray(rawContents)) {
    markdown = rawContents.map((entry) => normalizeMarkup(entry)).filter(Boolean).join('\n\n');
  } else {
    markdown = normalizeMarkup(rawContents);
  }

  return {
    markdown,
    range: normalizeRange(value.range),
  };
};

const normalizeLocationArray = (
  workspacePath: string,
  value: unknown,
): LspLocation[] => {
  const entries = Array.isArray(value) ? value : value ? [value] : [];
  const locations: LspLocation[] = [];

  for (const entry of entries) {
    if (!isRecord(entry)) {
      continue;
    }

    const uri =
      typeof entry.targetUri === 'string'
        ? entry.targetUri
        : typeof entry.uri === 'string'
          ? entry.uri
          : null;
    const range = normalizeRange(entry.targetSelectionRange ?? entry.targetRange ?? entry.range);

    if (!uri || !range) {
      continue;
    }

    const relativePath = toWorkspaceRelativePath(workspacePath, uri);
    if (!relativePath) {
      continue;
    }

    locations.push({
      relativePath,
      range,
    });
  }

  return locations;
};

const normalizeCompletionItem = (value: unknown): LspCompletionItem | null => {
  if (!isRecord(value)) {
    return null;
  }

  const rawLabel = value.label;
  const label =
    typeof rawLabel === 'string'
      ? rawLabel
      : isRecord(rawLabel) && typeof rawLabel.label === 'string'
        ? rawLabel.label
        : '';
  if (!label) {
    return null;
  }

  const additionalTextEdits = Array.isArray(value.additionalTextEdits)
    ? value.additionalTextEdits
        .map((entry) => normalizeTextEdit(entry))
        .filter((entry): entry is LspTextEdit => entry !== null)
    : undefined;

  return {
    label,
    kind: typeof value.kind === 'number' ? value.kind : undefined,
    detail: typeof value.detail === 'string' ? value.detail : undefined,
    documentation: normalizeMarkup(value.documentation) ?? undefined,
    insertText: typeof value.insertText === 'string' ? value.insertText : undefined,
    sortText: typeof value.sortText === 'string' ? value.sortText : undefined,
    filterText: typeof value.filterText === 'string' ? value.filterText : undefined,
    preselect: typeof value.preselect === 'boolean' ? value.preselect : undefined,
    insertTextFormat:
      typeof value.insertTextFormat === 'number' ? value.insertTextFormat : undefined,
    textEdit: normalizeTextEdit(value.textEdit),
    additionalTextEdits,
    commitCharacters: Array.isArray(value.commitCharacters)
      ? value.commitCharacters.filter(
          (entry): entry is string => typeof entry === 'string',
        )
      : undefined,
  };
};

const normalizeCompletionResult = (value: unknown): LspCompletionResult => {
  if (Array.isArray(value)) {
    return {
      items: value
        .map((entry) => normalizeCompletionItem(entry))
        .filter((entry): entry is LspCompletionItem => entry !== null),
      isIncomplete: false,
    };
  }

  if (!isRecord(value) || !Array.isArray(value.items)) {
    return {
      items: [],
      isIncomplete: false,
    };
  }

  return {
    items: value.items
      .map((entry) => normalizeCompletionItem(entry))
      .filter((entry): entry is LspCompletionItem => entry !== null),
    isIncomplete: value.isIncomplete === true,
  };
};

const toDiagnosticSeverity = (value: unknown): LspDiagnosticSeverity => {
  if (value === 1) {
    return 'error';
  }

  if (value === 2) {
    return 'warning';
  }

  if (value === 4) {
    return 'hint';
  }

  return 'information';
};

const normalizeDiagnostics = (value: unknown): LspDiagnostic[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      if (!isRecord(entry)) {
        return null;
      }

      const range = normalizeRange(entry.range);
      if (!range || typeof entry.message !== 'string') {
        return null;
      }

      const diagnostic: LspDiagnostic = {
        range,
        severity: toDiagnosticSeverity(entry.severity),
        message: entry.message,
        source: typeof entry.source === 'string' ? entry.source : null,
        code:
          typeof entry.code === 'string' || typeof entry.code === 'number'
            ? entry.code
            : null,
      };

      return diagnostic;
    })
    .filter((entry): entry is LspDiagnostic => entry !== null);
};

const normalizeSemanticTokenLegend = (value: unknown): LspSemanticTokensLegend | null => {
  if (!isRecord(value)) {
    return null;
  }

  const tokenTypes = Array.isArray(value.tokenTypes)
    ? value.tokenTypes.filter((entry): entry is string => typeof entry === 'string')
    : [];
  const tokenModifiers = Array.isArray(value.tokenModifiers)
    ? value.tokenModifiers.filter((entry): entry is string => typeof entry === 'string')
    : [];

  if (tokenTypes.length === 0) {
    return null;
  }

  return {
    tokenTypes,
    tokenModifiers,
  };
};

const normalizeSemanticTokenSupport = (value: unknown): LspSemanticTokensSupport | null => {
  if (!isRecord(value)) {
    return null;
  }

  const legend = normalizeSemanticTokenLegend(value.legend);
  if (!legend) {
    return null;
  }

  const full =
    value.full === true || isRecord(value.full);

  return {
    legend,
    full,
  };
};

const normalizeSemanticTokenType = (value: string): string | null => {
  if (CLIENT_SEMANTIC_TOKEN_TYPE_INDEX.has(value)) {
    return value;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  if (normalized.includes('parameter') || normalized.includes('argument')) {
    return 'parameter';
  }

  if (normalized.includes('method')) {
    return 'method';
  }

  if (normalized.includes('function')) {
    return 'function';
  }

  if (normalized.includes('field') || normalized.includes('property') || normalized.includes('member')) {
    return 'property';
  }

  if (normalized.includes('typeparameter')) {
    return 'typeParameter';
  }

  if (normalized.includes('interface')) {
    return 'interface';
  }

  if (normalized.includes('enum') && normalized.includes('member')) {
    return 'enumMember';
  }

  if (normalized.includes('enum')) {
    return 'enum';
  }

  if (normalized.includes('class')) {
    return 'class';
  }

  if (normalized.includes('struct')) {
    return 'struct';
  }

  if (normalized.includes('namespace') || normalized.includes('module') || normalized.includes('package')) {
    return 'namespace';
  }

  if (normalized.includes('keyword')) {
    return 'keyword';
  }

  if (normalized.includes('operator')) {
    return 'operator';
  }

  if (normalized.includes('decorator') || normalized.includes('annotation') || normalized.includes('metadata')) {
    return 'decorator';
  }

  if (normalized.includes('comment')) {
    return 'comment';
  }

  if (normalized.includes('string')) {
    return 'string';
  }

  if (normalized.includes('regexp') || normalized.includes('regex')) {
    return 'regexp';
  }

  if (normalized.includes('number')) {
    return 'number';
  }

  if (normalized.includes('modifier')) {
    return 'modifier';
  }

  if (normalized.includes('event')) {
    return 'event';
  }

  if (normalized.includes('macro')) {
    return 'macro';
  }

  if (normalized.includes('type')) {
    return 'type';
  }

  if (normalized.includes('variable') || normalized.includes('local')) {
    return 'variable';
  }

  return null;
};

const normalizeSemanticTokenModifier = (value: string): string | null => {
  if (CLIENT_SEMANTIC_TOKEN_MODIFIER_INDEX.has(value)) {
    return value;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  if (normalized.includes('declare')) {
    return 'declaration';
  }

  if (normalized.includes('define')) {
    return 'definition';
  }

  if (normalized.includes('readonly')) {
    return 'readonly';
  }

  if (normalized.includes('static')) {
    return 'static';
  }

  if (normalized.includes('deprecated')) {
    return 'deprecated';
  }

  if (normalized.includes('abstract')) {
    return 'abstract';
  }

  if (normalized.includes('async')) {
    return 'async';
  }

  if (normalized.includes('modification') || normalized.includes('mutable')) {
    return 'modification';
  }

  if (normalized.includes('documentation') || normalized.includes('doc')) {
    return 'documentation';
  }

  if (normalized.includes('defaultlibrary') || normalized.includes('builtin')) {
    return 'defaultLibrary';
  }

  return null;
};

const normalizeSemanticTokensResult = (
  value: unknown,
  legend: LspSemanticTokensLegend | null,
): LspSemanticTokensResult => {
  if (!isRecord(value) || !legend || !Array.isArray(value.data)) {
    return {
      supported: legend !== null,
      data: [],
      resultId: null,
    };
  }

  const rawData = value.data.filter(
    (entry): entry is number => typeof entry === 'number' && Number.isFinite(entry),
  );
  if (rawData.length < 5) {
    return {
      supported: true,
      data: [],
      resultId: typeof value.resultId === 'string' ? value.resultId : null,
    };
  }

  const remappedData: number[] = [];
  let inputLine = 0;
  let inputCharacter = 0;
  let outputLine = 0;
  let outputCharacter = 0;

  for (let index = 0; index + 4 < rawData.length; index += 5) {
    const deltaLine = rawData[index];
    const deltaCharacter = rawData[index + 1];
    const length = rawData[index + 2];
    const serverTokenTypeIndex = rawData[index + 3];
    const serverModifierSet = rawData[index + 4];

    inputLine += deltaLine;
    inputCharacter = deltaLine === 0 ? inputCharacter + deltaCharacter : deltaCharacter;

    if (!Number.isInteger(length) || length <= 0 || !Number.isInteger(serverTokenTypeIndex)) {
      continue;
    }

    const serverTokenType = legend.tokenTypes[serverTokenTypeIndex];
    if (typeof serverTokenType !== 'string') {
      continue;
    }

    const normalizedType = normalizeSemanticTokenType(serverTokenType);
    const clientTokenTypeIndex =
      normalizedType !== null ? CLIENT_SEMANTIC_TOKEN_TYPE_INDEX.get(normalizedType) : undefined;
    if (typeof clientTokenTypeIndex !== 'number') {
      continue;
    }

    let clientModifierSet = 0;
    let modifierSet = serverModifierSet;
    let modifierIndex = 0;

    while (modifierSet > 0 && modifierIndex < legend.tokenModifiers.length) {
      if (modifierSet & 1) {
        const serverModifier = legend.tokenModifiers[modifierIndex];
        const normalizedModifier =
          typeof serverModifier === 'string'
            ? normalizeSemanticTokenModifier(serverModifier)
            : null;
        const clientModifierIndex =
          normalizedModifier !== null
            ? CLIENT_SEMANTIC_TOKEN_MODIFIER_INDEX.get(normalizedModifier)
            : undefined;

        if (typeof clientModifierIndex === 'number') {
          clientModifierSet |= 1 << clientModifierIndex;
        }
      }

      modifierSet >>= 1;
      modifierIndex += 1;
    }

    const outputDeltaLine = inputLine - outputLine;
    const outputDeltaCharacter =
      outputDeltaLine === 0 ? inputCharacter - outputCharacter : inputCharacter;

    remappedData.push(
      outputDeltaLine,
      outputDeltaCharacter,
      length,
      clientTokenTypeIndex,
      clientModifierSet,
    );

    outputLine = inputLine;
    outputCharacter = inputCharacter;
  }

  return {
    supported: true,
    data: remappedData,
    resultId: typeof value.resultId === 'string' ? value.resultId : null,
  };
};

const toCompletionContext = (
  triggerCharacter?: string,
  triggerKind?: number,
): { triggerKind: number; triggerCharacter?: string } => {
  if (triggerCharacter && triggerCharacter.length > 0) {
    return {
      triggerKind: COMPLETION_TRIGGER_CHARACTER,
      triggerCharacter,
    };
  }

  return {
    triggerKind:
      typeof triggerKind === 'number' && Number.isFinite(triggerKind)
        ? triggerKind
        : COMPLETION_TRIGGER_INVOKED,
  };
};

class LspServerSession {
  private child: ChildProcessWithoutNullStreams | null = null;
  private readonly documents = new Map<string, LspDocumentState>();
  private readonly pendingRequests = new Map<JsonRpcId, PendingRequest>();
  private semanticTokensSupport: LspSemanticTokensSupport | null = null;
  private nextRequestId = 1;
  private outputBuffer = Buffer.alloc(0);
  private readyPromise: Promise<void> | null = null;
  private startError: Error | null = null;

  public constructor(
    private readonly config: LspServerConfig,
    private readonly workspacePath: string,
    private readonly emitEvent: (event: LspRendererEvent) => void,
  ) {}

  public async ensureReady(): Promise<void> {
    if (this.readyPromise) {
      return this.readyPromise;
    }

    this.emitStatus('starting', null);
    this.readyPromise = this.start();
    return this.readyPromise;
  }

  public async syncDocument(request: LspDocumentSyncRequest): Promise<void> {
    await this.ensureReady();
    const uri = toWorkspaceFileUri(this.workspacePath, request.relativePath);
    const existing = this.documents.get(uri);

    if (!existing) {
      this.documents.set(uri, {
        uri,
        relativePath: request.relativePath,
        languageId: request.languageId,
        version: request.version,
      });
      this.notify('textDocument/didOpen', {
        textDocument: {
          uri,
          languageId: request.languageId,
          version: request.version,
          text: request.content,
        },
      });
      return;
    }

    existing.version = request.version;
    existing.languageId = request.languageId;
    existing.relativePath = request.relativePath;

    this.notify('textDocument/didChange', {
      textDocument: {
        uri,
        version: request.version,
      },
      contentChanges: [
        {
          text: request.content,
        },
      ],
    });
  }

  public async closeDocument(request: LspDocumentCloseRequest): Promise<void> {
    const uri = toWorkspaceFileUri(this.workspacePath, request.relativePath);
    if (!this.documents.has(uri)) {
      return;
    }

    await this.ensureReady();
    this.documents.delete(uri);
    this.notify('textDocument/didClose', {
      textDocument: {
        uri,
      },
    });
    this.emitEvent({
      kind: 'diagnostics',
      workspacePath: this.workspacePath,
      relativePath: request.relativePath,
      diagnostics: [],
    });
  }

  public async hover(request: LspTextDocumentPositionRequest): Promise<LspHoverResult> {
    await this.ensureReady();
    const result = await this.request('textDocument/hover', {
      textDocument: {
        uri: toWorkspaceFileUri(this.workspacePath, request.relativePath),
      },
      position: request.position,
    });
    return normalizeHover(result);
  }

  public async completion(request: LspCompletionRequest): Promise<LspCompletionResult> {
    await this.ensureReady();
    const result = await this.request('textDocument/completion', {
      textDocument: {
        uri: toWorkspaceFileUri(this.workspacePath, request.relativePath),
      },
      position: request.position,
      context: toCompletionContext(request.triggerCharacter, request.triggerKind),
    });
    return normalizeCompletionResult(result);
  }

  public async semanticTokens(
    request: LspSemanticTokensRequest,
  ): Promise<LspSemanticTokensResult> {
    await this.ensureReady();

    if (!this.semanticTokensSupport?.full) {
      return {
        supported: false,
        data: [],
        resultId: null,
      };
    }

    const uri = toWorkspaceFileUri(this.workspacePath, request.relativePath);
    if (!this.documents.has(uri)) {
      return {
        supported: true,
        data: [],
        resultId: null,
      };
    }

    const result = await this.request('textDocument/semanticTokens/full', {
      textDocument: {
        uri,
      },
    });

    return normalizeSemanticTokensResult(result, this.semanticTokensSupport.legend);
  }

  public async definition(
    request: LspTextDocumentPositionRequest,
    method: 'textDocument/definition' | 'textDocument/declaration',
  ): Promise<LspDefinitionResult> {
    await this.ensureReady();
    const result = await this.request(method, {
      textDocument: {
        uri: toWorkspaceFileUri(this.workspacePath, request.relativePath),
      },
      position: request.position,
    });

    return {
      locations: normalizeLocationArray(this.workspacePath, result),
    };
  }

  public async references(request: LspReferencesRequest): Promise<LspReferencesResult> {
    await this.ensureReady();
    const result = await this.request('textDocument/references', {
      textDocument: {
        uri: toWorkspaceFileUri(this.workspacePath, request.relativePath),
      },
      position: request.position,
      context: {
        includeDeclaration: request.includeDeclaration !== false,
      },
    });

    return {
      locations: normalizeLocationArray(this.workspacePath, result),
    };
  }

  public dispose(): void {
    for (const pending of this.pendingRequests.values()) {
      pending.reject(new Error(`LSP session for ${this.config.id} was disposed.`));
    }

    this.pendingRequests.clear();
    this.documents.clear();

    if (this.child && !this.child.killed) {
      this.child.kill();
    }

    this.child = null;
  }

  public getServerId(): string {
    return this.config.id;
  }

  private async start(): Promise<void> {
    try {
      this.child = await this.spawnChild();
    } catch (error) {
      const failure =
        error instanceof Error ? error : new Error('Failed to launch language server.');
      this.startError = failure;
      this.emitStatus('error', failure.message);
      throw failure;
    }

    this.child.stdout.on('data', (chunk: Buffer | string) => {
      this.handleOutput(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });

    this.child.stderr.on('data', (chunk: Buffer | string) => {
      const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : chunk;
      const message = text.trim();
      if (message) {
        console.warn(`[lsp:${this.config.id}] ${message}`);
      }
    });

    this.child.on('exit', (code, signal) => {
      const message =
        this.startError?.message ??
        `Language server exited${code !== null ? ` with code ${code}` : ''}${
          signal ? ` (${signal})` : ''
        }.`;

      for (const pending of this.pendingRequests.values()) {
        pending.reject(new Error(message));
      }

      this.pendingRequests.clear();
      this.child = null;
      this.emitStatus('error', message);
    });

    const initializeResult = await this.sendRequest('initialize', {
      processId: process.pid,
      clientInfo: {
        name: 'Zero',
        version: '1.0.0',
      },
      rootUri: pathToFileURL(this.workspacePath).toString(),
      capabilities: {
        general: {
          positionEncodings: [POSITION_ENCODING],
        },
        textDocument: {
          hover: {
            contentFormat: ['markdown', 'plaintext'],
          },
          semanticTokens: {
            tokenTypes: CLIENT_SEMANTIC_TOKEN_TYPES,
            tokenModifiers: CLIENT_SEMANTIC_TOKEN_MODIFIERS,
            formats: ['relative'],
            requests: {
              full: true,
            },
          },
          completion: {
            completionItem: {
              snippetSupport: true,
              insertReplaceSupport: true,
              commitCharactersSupport: true,
              documentationFormat: ['markdown', 'plaintext'],
            },
          },
          definition: {
            linkSupport: true,
          },
          declaration: {
            linkSupport: true,
          },
          publishDiagnostics: {
            relatedInformation: true,
            versionSupport: true,
          },
          synchronization: {
            didSave: false,
            willSave: false,
            willSaveWaitUntil: false,
          },
        },
        workspace: {
          workspaceFolders: true,
          configuration: true,
        },
      },
      workspaceFolders: [
        {
          uri: pathToFileURL(this.workspacePath).toString(),
          name: path.basename(this.workspacePath),
        },
      ],
    });

    if (!isRecord(initializeResult)) {
      throw new Error('Language server returned an invalid initialize response.');
    }

    const capabilities = isRecord(initializeResult.capabilities)
      ? initializeResult.capabilities
      : null;
    this.semanticTokensSupport = capabilities
      ? normalizeSemanticTokenSupport(capabilities.semanticTokensProvider)
      : null;

    this.notify('initialized', {});
    this.emitStatus('ready', null);
  }

  private async spawnChild(): Promise<ChildProcessWithoutNullStreams> {
    const errors: string[] = [];
    const availability = resolveServerAvailability(this.config);

    for (const candidate of availability.launchCandidates) {
      try {
        const child = await new Promise<ChildProcessWithoutNullStreams>((resolve, reject) => {
          const nextChild = spawn(candidate.command, candidate.args, {
            cwd: this.workspacePath,
            stdio: 'pipe',
            env: {
              ...process.env,
              ...candidate.env,
            },
            shell: candidate.shell ?? false,
          });

          nextChild.once('spawn', () => {
            resolve(nextChild);
          });
          nextChild.once('error', (error) => {
            reject(error);
          });
        });

        return child;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`${candidate.command}: ${message}`);
      }
    }

    const errorMessage =
      errors.length > 0
        ? errors.join(' | ')
        : `No launch candidate available for ${this.config.id}.`;

    const shouldAppendInstallHint =
      this.config.installHint.length > 0 &&
      errors.length > 0 &&
      errors.every((message) => isMissingExecutableMessage(message));

    throw new Error(
      shouldAppendInstallHint ? `${errorMessage} ${this.config.installHint}` : errorMessage,
    );
  }

  private emitStatus(
    status: 'ready' | 'starting' | 'error',
    detail: string | null,
  ): void {
    for (const languageId of this.config.languages) {
      this.emitEvent({
        kind: 'status',
        workspacePath: this.workspacePath,
        languageId,
        serverId: this.config.id,
        status,
        detail,
      });
    }
  }

  private handleOutput(chunk: Buffer): void {
    this.outputBuffer = Buffer.concat([this.outputBuffer, chunk]);

    while (this.outputBuffer.length > 0) {
      const headerEnd = this.outputBuffer.indexOf('\r\n\r\n');
      if (headerEnd < 0) {
        return;
      }

      const header = this.outputBuffer.slice(0, headerEnd).toString('utf8');
      const contentLengthMatch = header.match(/Content-Length:\s*(\d+)/i);
      if (!contentLengthMatch) {
        this.outputBuffer = Buffer.alloc(0);
        return;
      }

      const contentLength = Number.parseInt(contentLengthMatch[1], 10);
      const bodyStart = headerEnd + 4;
      const bodyEnd = bodyStart + contentLength;
      if (this.outputBuffer.length < bodyEnd) {
        return;
      }

      const body = this.outputBuffer.slice(bodyStart, bodyEnd).toString('utf8');
      this.outputBuffer = this.outputBuffer.slice(bodyEnd);

      try {
        const message = JSON.parse(body) as Record<string, unknown>;
        this.handleMessage(message);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[lsp:${this.config.id}] Failed to parse message: ${message}`);
      }
    }
  }

  private handleMessage(message: Record<string, unknown>): void {
    if (
      Object.prototype.hasOwnProperty.call(message, 'id') &&
      (Object.prototype.hasOwnProperty.call(message, 'result') ||
        Object.prototype.hasOwnProperty.call(message, 'error'))
    ) {
      this.handleResponse(message as JsonRpcResponse);
      return;
    }

    if (typeof message.method !== 'string') {
      return;
    }

    if (Object.prototype.hasOwnProperty.call(message, 'id')) {
      void this.handleServerRequest(message.method, message.id as JsonRpcId, message.params);
      return;
    }

    this.handleNotification(message.method, message.params);
  }

  private handleResponse(message: JsonRpcResponse): void {
    const pending = this.pendingRequests.get(message.id);
    if (!pending) {
      return;
    }

    this.pendingRequests.delete(message.id);

    if (message.error) {
      pending.reject(new Error(message.error.message));
      return;
    }

    pending.resolve(message.result);
  }

  private async handleServerRequest(
    method: string,
    id: JsonRpcId,
    params: unknown,
  ): Promise<void> {
    let result: unknown = null;

    switch (method) {
      case 'workspace/configuration': {
        const items = isRecord(params) && Array.isArray(params.items) ? params.items : [];
        result = items.map(() => null);
        break;
      }
      case 'workspace/workspaceFolders': {
        result = [
          {
            uri: pathToFileURL(this.workspacePath).toString(),
            name: path.basename(this.workspacePath),
          },
        ];
        break;
      }
      case 'window/workDoneProgress/create':
      case 'client/registerCapability':
      case 'client/unregisterCapability': {
        result = null;
        break;
      }
      case 'workspace/applyEdit': {
        result = {
          applied: false,
        };
        break;
      }
      case 'window/showDocument': {
        result = {
          success: false,
        };
        break;
      }
      default: {
        result = null;
        break;
      }
    }

    this.writeMessage({
      jsonrpc: '2.0',
      id,
      result,
    });
  }

  private handleNotification(method: string, params: unknown): void {
    if (method !== 'textDocument/publishDiagnostics' || !isRecord(params)) {
      return;
    }

    const uri = typeof params.uri === 'string' ? params.uri : null;
    if (!uri) {
      return;
    }

    const relativePath = toWorkspaceRelativePath(this.workspacePath, uri);
    if (!relativePath) {
      return;
    }

    this.emitEvent({
      kind: 'diagnostics',
      workspacePath: this.workspacePath,
      relativePath,
      diagnostics: normalizeDiagnostics(params.diagnostics),
    });
  }

  private async request(method: string, params: unknown): Promise<unknown> {
    await this.ensureReady();
    return this.sendRequest(method, params);
  }

  private async sendRequest(method: string, params: unknown): Promise<unknown> {
    if (!this.child) {
      throw new Error(`Language server ${this.config.id} is not running.`);
    }

    const id = this.nextRequestId;
    this.nextRequestId += 1;

    const responsePromise = new Promise<unknown>((resolve, reject) => {
      this.pendingRequests.set(id, {
        resolve,
        reject,
      });
    });

    this.writeMessage({
      jsonrpc: '2.0',
      id,
      method,
      params,
    });

    return responsePromise;
  }

  private notify(method: string, params: unknown): void {
    this.writeMessage({
      jsonrpc: '2.0',
      method,
      params,
    });
  }

  private writeMessage(message: Record<string, unknown>): void {
    if (!this.child) {
      throw new Error(`Language server ${this.config.id} is not running.`);
    }

    const payload = Buffer.from(JSON.stringify(message), 'utf8');
    const header = Buffer.from(`Content-Length: ${payload.byteLength}\r\n\r\n`, 'utf8');
    this.child.stdin.write(Buffer.concat([header, payload]));
  }
}

export class LspService {
  private readonly sessions = new Map<string, LspServerSession>();
  private readonly listeners = new Set<(event: LspRendererEvent) => void>();

  public onEvent(listener: (event: LspRendererEvent) => void): () => void {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  }

  public async listServers(): Promise<LspListServersResult> {
    return {
      servers: SERVER_CONFIGS.map((config) => this.toCatalogEntry(config)),
    };
  }

  public async installServer(
    request: LspInstallServerRequest,
  ): Promise<LspServerMutationResult> {
    const config = getServerConfigById(request.serverId);
    if (!config) {
      return {
        ok: false,
        detail: `Unknown language server: ${request.serverId}.`,
      };
    }

    const managedInstall = config.managedInstall;
    if (
      !managedInstall ||
      (managedInstall.kind === 'npm' &&
        (!managedInstall.packageName ||
          !managedInstall.packages ||
          managedInstall.packages.length === 0)) ||
      (managedInstall.kind === 'download' && !managedInstall.downloadStrategy) ||
      (managedInstall.kind === 'toolchain' && !managedInstall.toolchainStrategy)
    ) {
      return {
        ok: false,
        detail: `${config.name} must be installed manually. ${config.installHint}`,
      };
    }

    const availability = resolveServerAvailability(config);
    if (availability.source === 'managed') {
      return {
        ok: true,
        detail: `${config.name} is already installed.`,
      };
    }

    try {
      if (managedInstall.kind === 'npm') {
        const packages = managedInstall.packages ?? [];
        const npmCommand = resolveFirstExecutablePath(['npm']);
        if (!npmCommand) {
          return {
            ok: false,
            detail: `npm was not found on PATH. Install Node.js/npm to manage ${config.name}.`,
          };
        }

        const installRoot = await this.ensureManagedNodeServerRoot(managedInstall.id);
        await this.runCommand(
          npmCommand,
          ['install', '--no-audit', '--no-fund', '--omit=dev', ...packages],
          installRoot,
        );
      } else if (managedInstall.kind === 'download') {
        await this.installDownloadedServer(config, managedInstall);
      } else {
        await this.installToolchainServer(config, managedInstall);
      }

      const nextAvailability = resolveServerAvailability(config);
      if (nextAvailability.source !== 'managed') {
        return {
          ok: false,
          detail: `${config.name} installed, but Zero could not find the managed server files afterwards.`,
        };
      }

      this.disposeSessionsForManagedInstall(managedInstall.id);

      return {
        ok: true,
        detail: `Installed ${config.name}.`,
      };
    } catch (error) {
      return {
        ok: false,
        detail:
          error instanceof Error && error.message.trim().length > 0
            ? error.message.trim()
            : `Could not install ${config.name}.`,
      };
    }
  }

  public async deleteServer(
    request: LspDeleteServerRequest,
  ): Promise<LspServerMutationResult> {
    const config = getServerConfigById(request.serverId);
    if (!config) {
      return {
        ok: false,
        detail: `Unknown language server: ${request.serverId}.`,
      };
    }

    const managedInstall = config.managedInstall;
    if (!managedInstall) {
      return {
        ok: false,
        detail: `${config.name} is not managed by Zero.`,
      };
    }

    const installRoot = resolveManagedInstallRoot(managedInstall.id);
    if (!existsSync(installRoot)) {
      return {
        ok: true,
        detail: `${config.name} is not installed.`,
      };
    }

    try {
      this.disposeSessionsForManagedInstall(managedInstall.id);
      await fs.rm(installRoot, { recursive: true, force: true });

      return {
        ok: true,
        detail: `Deleted ${config.name}.`,
      };
    } catch (error) {
      return {
        ok: false,
        detail:
          error instanceof Error && error.message.trim().length > 0
            ? error.message.trim()
            : `Could not delete ${config.name}.`,
      };
    }
  }

  public async syncDocument(
    request: LspDocumentSyncRequest,
  ): Promise<LspDocumentSyncResult> {
    const config = getServerConfigForLanguage(request.languageId);
    if (!config) {
      return {
        supported: false,
        serverId: null,
        status: 'unsupported',
        detail: `No LSP server configured for ${request.languageId}.`,
      };
    }

    const serverId = config.id;

    try {
      const session = await this.ensureSession(request.workspacePath, request.languageId);
      await session.syncDocument(request);
      return {
        supported: true,
        serverId,
        status: 'ready',
        detail: null,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.emit({
        kind: 'status',
        workspacePath: request.workspacePath,
        languageId: request.languageId,
        serverId,
        status: 'error',
        detail: message,
      });
      return {
        supported: true,
        serverId,
        status: 'error',
        detail: message,
      };
    }
  }

  public async closeDocument(request: LspDocumentCloseRequest): Promise<void> {
    const config = getServerConfigForLanguage(request.languageId);
    if (!config) {
      return;
    }

    const key = this.getSessionKey(request.workspacePath, config.id);
    const session = this.sessions.get(key);
    if (!session) {
      return;
    }

    try {
      await session.closeDocument(request);
    } catch {
      // Ignore close failures during teardown.
    }
  }

  public async hover(request: LspTextDocumentPositionRequest): Promise<LspHoverResult> {
    try {
      const session = await this.ensureSession(request.workspacePath, request.languageId);
      return await session.hover(request);
    } catch {
      return {
        markdown: null,
        range: null,
      };
    }
  }

  public async completion(
    request: LspCompletionRequest,
  ): Promise<LspCompletionResult> {
    try {
      const session = await this.ensureSession(request.workspacePath, request.languageId);
      return await session.completion(request);
    } catch {
      return {
        items: [],
        isIncomplete: false,
      };
    }
  }

  public async definition(
    request: LspTextDocumentPositionRequest,
    method: 'textDocument/definition' | 'textDocument/declaration',
  ): Promise<LspDefinitionResult> {
    try {
      const session = await this.ensureSession(request.workspacePath, request.languageId);
      return await session.definition(request, method);
    } catch {
      return {
        locations: [],
      };
    }
  }

  public async references(
    request: LspReferencesRequest,
  ): Promise<LspReferencesResult> {
    try {
      const session = await this.ensureSession(request.workspacePath, request.languageId);
      return await session.references(request);
    } catch {
      return {
        locations: [],
      };
    }
  }

  public async semanticTokens(
    request: LspSemanticTokensRequest,
  ): Promise<LspSemanticTokensResult> {
    try {
      const session = await this.ensureSession(request.workspacePath, request.languageId);
      return await session.semanticTokens(request);
    } catch {
      return {
        supported: false,
        data: [],
        resultId: null,
      };
    }
  }

  public disposeAll(): void {
    for (const session of this.sessions.values()) {
      session.dispose();
    }

    this.sessions.clear();
  }

  private toCatalogEntry(config: LspServerConfig): LspServerCatalogEntry {
    const availability = resolveServerAvailability(config);

    return {
      id: config.id,
      name: config.name,
      description: config.description,
      languages: config.languages,
      installKind: config.managedInstall?.kind ?? 'manual',
      source: availability.source,
      installed: availability.installed,
      canInstall: availability.canInstall,
      canDelete: availability.canDelete,
      detail: availability.detail,
    };
  }

  private getConfigsForManagedInstall(installId: string): LspServerConfig[] {
    return SERVER_CONFIGS.filter((config) => config.managedInstall?.id === installId);
  }

  private disposeSessionsForManagedInstall(installId: string): void {
    const serverIds = new Set(this.getConfigsForManagedInstall(installId).map((config) => config.id));

    for (const [key, session] of this.sessions.entries()) {
      if (!serverIds.has(session.getServerId())) {
        continue;
      }

      session.dispose();
      this.sessions.delete(key);
    }
  }

  private async ensureManagedNodeServerRoot(installId: string): Promise<string> {
    const installRoot = resolveManagedInstallRoot(installId);
    await fs.mkdir(installRoot, { recursive: true });

    const packageJsonPath = path.join(installRoot, 'package.json');
    if (!existsSync(packageJsonPath)) {
      const packageName = `zero-managed-lsp-${installId}`
        .toLowerCase()
        .replace(/[^a-z0-9-_]+/g, '-')
        .replace(/^-+|-+$/g, '');
      const packageJson = {
        name: packageName.length > 0 ? packageName : 'zero-managed-lsp',
        private: true,
      };
      await fs.writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8');
    }

    return installRoot;
  }

  private async createManagedInstallStagingRoot(
    installId: string,
  ): Promise<{ installRoot: string; stagingRoot: string }> {
    const managedRoot = resolveManagedLspRoot();
    await fs.mkdir(managedRoot, { recursive: true });

    const installRoot = resolveManagedInstallRoot(installId);
    const stagingRoot = path.join(
      managedRoot,
      `.${installId}.tmp-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`,
    );
    await fs.rm(stagingRoot, { recursive: true, force: true });
    await fs.mkdir(stagingRoot, { recursive: true });

    return {
      installRoot,
      stagingRoot,
    };
  }

  private async finalizeManagedInstall(
    installRoot: string,
    stagingRoot: string,
  ): Promise<void> {
    await fs.rm(installRoot, { recursive: true, force: true });
    await fs.rename(stagingRoot, installRoot);
  }

  private async downloadBuffer(
    url: string,
    headers: Record<string, string> = {},
    redirectCount = 0,
  ): Promise<Buffer> {
    if (redirectCount > 6) {
      throw new Error(`Too many redirects while downloading ${url}.`);
    }

    return await new Promise<Buffer>((resolve, reject) => {
      const client = url.startsWith('https://') ? https : http;
      const request = client.get(
        url,
        {
          headers: {
            'User-Agent': 'Zero-LSP-Manager',
            Accept: '*/*',
            ...headers,
          },
        },
        (response) => {
          const statusCode = response.statusCode ?? 0;
          const locationHeader = response.headers.location;
          if (statusCode >= 300 && statusCode < 400 && locationHeader) {
            response.resume();
            resolve(
              this.downloadBuffer(new URL(locationHeader, url).toString(), headers, redirectCount + 1),
            );
            return;
          }

          if (statusCode < 200 || statusCode >= 300) {
            response.resume();
            reject(new Error(`Download failed for ${url} (HTTP ${statusCode}).`));
            return;
          }

          const chunks: Buffer[] = [];
          response.on('data', (chunk: Buffer | string) => {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          });
          response.once('end', () => {
            resolve(Buffer.concat(chunks));
          });
          response.once('error', reject);
        },
      );

      request.once('error', reject);
    });
  }

  private async downloadText(
    url: string,
    headers: Record<string, string> = {},
  ): Promise<string> {
    return (await this.downloadBuffer(url, headers)).toString('utf8');
  }

  private async downloadJson<T>(
    url: string,
    headers: Record<string, string> = {},
  ): Promise<T> {
    return JSON.parse(
      await this.downloadText(url, {
        Accept: 'application/vnd.github+json',
        ...headers,
      }),
    ) as T;
  }

  private async extractZipArchive(archivePath: string, destinationPath: string): Promise<void> {
    if (process.platform === 'win32') {
      const powerShell = resolveFirstExecutablePath(['pwsh', 'powershell']) ?? 'powershell';
      const escapedArchivePath = archivePath.replace(/'/g, "''");
      const escapedDestinationPath = destinationPath.replace(/'/g, "''");
      await this.runCommand(
        powerShell,
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `Expand-Archive -LiteralPath '${escapedArchivePath}' -DestinationPath '${escapedDestinationPath}' -Force`,
        ],
        destinationPath,
      );
      return;
    }

    const unzipCommand = resolveFirstExecutablePath(['unzip']);
    if (unzipCommand) {
      await this.runCommand(unzipCommand, ['-q', '-o', archivePath, '-d', destinationPath], destinationPath);
      return;
    }

    const pythonCommand = resolveFirstExecutablePath(['python3', 'python']);
    if (pythonCommand) {
      await this.runCommand(
        pythonCommand,
        [
          '-c',
          'import sys, zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])',
          archivePath,
          destinationPath,
        ],
        destinationPath,
      );
      return;
    }

    throw new Error('Could not extract ZIP archive. Install `unzip` or Python 3.');
  }

  private async extractTarGzArchive(archivePath: string, destinationPath: string): Promise<void> {
    const tarCommand = resolveFirstExecutablePath(['tar']);
    if (tarCommand) {
      await this.runCommand(tarCommand, ['-xzf', archivePath, '-C', destinationPath], destinationPath);
      return;
    }

    const pythonCommand = resolveFirstExecutablePath(['python3', 'python']);
    if (pythonCommand) {
      await this.runCommand(
        pythonCommand,
        [
          '-c',
          "import sys, tarfile; tarfile.open(sys.argv[1], 'r:gz').extractall(sys.argv[2])",
          archivePath,
          destinationPath,
        ],
        destinationPath,
      );
      return;
    }

    throw new Error('Could not extract .tar.gz archive. Install `tar` or Python 3.');
  }

  private async setExecutableIfNeeded(filePath: string): Promise<void> {
    if (process.platform === 'win32' || !existsSync(filePath)) {
      return;
    }

    await fs.chmod(filePath, 0o755);
  }

  private async installDownloadedServer(
    config: LspServerConfig,
    managedInstall: LspManagedInstallConfig,
  ): Promise<void> {
    switch (managedInstall.downloadStrategy) {
      case 'rust-analyzer':
        await this.installRustAnalyzer(config, managedInstall);
        return;
      case 'kotlin-lsp':
        await this.installKotlinLanguageServer(config, managedInstall);
        return;
      case 'jdtls':
        await this.installJdtls(config, managedInstall);
        return;
      default:
        throw new Error(`Zero does not know how to install ${config.name} yet.`);
    }
  }

  private async installToolchainServer(
    config: LspServerConfig,
    managedInstall: LspManagedInstallConfig,
  ): Promise<void> {
    switch (managedInstall.toolchainStrategy) {
      case 'go-gopls':
        await this.installGoLanguageServer(config, managedInstall);
        return;
      default:
        throw new Error(`Zero does not know how to install ${config.name} yet.`);
    }
  }

  private async installGoLanguageServer(
    config: LspServerConfig,
    managedInstall: LspManagedInstallConfig,
  ): Promise<void> {
    const goCommand = resolveFirstExecutablePath(['go']);
    if (!goCommand) {
      throw new Error(`Go was not found on PATH. Install Go to manage ${config.name}.`);
    }

    const { installRoot, stagingRoot } = await this.createManagedInstallStagingRoot(
      managedInstall.id,
    );
    try {
      const binDirectory = path.join(stagingRoot, 'bin');
      await fs.mkdir(binDirectory, { recursive: true });
      await this.runCommand(
        goCommand,
        ['install', 'golang.org/x/tools/gopls@latest'],
        stagingRoot,
        {
          GOBIN: binDirectory,
        },
      );

      await this.setExecutableIfNeeded(path.join(binDirectory, 'gopls'));
      await this.finalizeManagedInstall(installRoot, stagingRoot);
    } catch (error) {
      await fs.rm(stagingRoot, { recursive: true, force: true });
      throw error;
    }
  }

  private async installRustAnalyzer(
    config: LspServerConfig,
    managedInstall: LspManagedInstallConfig,
  ): Promise<void> {
    const assetName = this.getRustAnalyzerAssetName();
    const release = await this.downloadJson<{
      assets?: Array<{ name?: string; browser_download_url?: string; digest?: string | null }>;
    }>('https://api.github.com/repos/rust-lang/rust-analyzer/releases/latest');
    const asset = release.assets?.find(
      (entry) => entry.name === assetName && typeof entry.browser_download_url === 'string',
    );
    if (!asset?.browser_download_url) {
      throw new Error(`Could not find the official ${assetName} release asset for ${config.name}.`);
    }

    const archiveBuffer = await this.downloadBuffer(asset.browser_download_url);
    const expectedSha256 = parseSha256Digest(asset.digest ?? '');
    if (expectedSha256) {
      const actualSha256 = createHash('sha256').update(archiveBuffer).digest('hex');
      if (actualSha256 !== expectedSha256) {
        throw new Error(`Checksum verification failed while downloading ${config.name}.`);
      }
    }

    const { installRoot, stagingRoot } = await this.createManagedInstallStagingRoot(managedInstall.id);
    try {
      const binDirectory = path.join(stagingRoot, 'bin');
      await fs.mkdir(binDirectory, { recursive: true });

      if (assetName.endsWith('.gz')) {
        const targetPath = path.join(binDirectory, 'rust-analyzer');
        await fs.writeFile(targetPath, gunzipSync(archiveBuffer));
        await this.setExecutableIfNeeded(targetPath);
      } else {
        const archivePath = path.join(stagingRoot, 'rust-analyzer.zip');
        await fs.writeFile(archivePath, archiveBuffer);
        await this.extractZipArchive(archivePath, stagingRoot);
        await fs.rm(archivePath, { force: true });

        const extractedExecutable = path.join(stagingRoot, 'rust-analyzer.exe');
        if (!existsSync(extractedExecutable)) {
          throw new Error(`Downloaded ${config.name}, but rust-analyzer.exe was missing from the archive.`);
        }

        await fs.rename(extractedExecutable, path.join(binDirectory, 'rust-analyzer.exe'));
      }

      await this.finalizeManagedInstall(installRoot, stagingRoot);
    } catch (error) {
      await fs.rm(stagingRoot, { recursive: true, force: true });
      throw error;
    }
  }

  private async installKotlinLanguageServer(
    config: LspServerConfig,
    managedInstall: LspManagedInstallConfig,
  ): Promise<void> {
    const release = await this.downloadJson<{ tag_name?: string }>(
      'https://api.github.com/repos/Kotlin/kotlin-lsp/releases/latest',
    );
    const version = release.tag_name?.split('/').pop()?.trim();
    if (!version) {
      throw new Error(`Could not determine the latest Kotlin LSP version for ${config.name}.`);
    }

    const archiveName = `kotlin-lsp-${version}-${this.getKotlinArchiveSuffix()}.zip`;
    const archiveUrl = `https://download-cdn.jetbrains.com/kotlin-lsp/${version}/${archiveName}`;
    const checksumText = await this.downloadText(`${archiveUrl}.sha256`);
    const expectedSha256 = parseSha256Digest(checksumText);
    if (!expectedSha256) {
      throw new Error(`Could not read the checksum for ${config.name}.`);
    }

    const archiveBuffer = await this.downloadBuffer(archiveUrl);
    const actualSha256 = createHash('sha256').update(archiveBuffer).digest('hex');
    if (actualSha256 !== expectedSha256) {
      throw new Error(`Checksum verification failed while downloading ${config.name}.`);
    }

    const { installRoot, stagingRoot } = await this.createManagedInstallStagingRoot(managedInstall.id);
    try {
      const archivePath = path.join(stagingRoot, archiveName);
      await fs.writeFile(archivePath, archiveBuffer);
      await this.extractZipArchive(archivePath, stagingRoot);
      await fs.rm(archivePath, { force: true });

      await this.setExecutableIfNeeded(path.join(stagingRoot, 'kotlin-lsp.sh'));
      await this.finalizeManagedInstall(installRoot, stagingRoot);
    } catch (error) {
      await fs.rm(stagingRoot, { recursive: true, force: true });
      throw error;
    }
  }

  private async installJdtls(
    config: LspServerConfig,
    managedInstall: LspManagedInstallConfig,
  ): Promise<void> {
    const latestFileName = (await this.downloadText('https://download.eclipse.org/jdtls/snapshots/latest.txt')).trim();
    if (!latestFileName.endsWith('.tar.gz')) {
      throw new Error(`Could not resolve the latest Eclipse JDT LS archive for ${config.name}.`);
    }

    const archiveUrl = `https://download.eclipse.org/jdtls/snapshots/${latestFileName}`;
    const checksumText = await this.downloadText(`${archiveUrl}.sha256`);
    const expectedSha256 = parseSha256Digest(checksumText);
    if (!expectedSha256) {
      throw new Error(`Could not read the checksum for ${config.name}.`);
    }

    const archiveBuffer = await this.downloadBuffer(archiveUrl);
    const actualSha256 = createHash('sha256').update(archiveBuffer).digest('hex');
    if (actualSha256 !== expectedSha256) {
      throw new Error(`Checksum verification failed while downloading ${config.name}.`);
    }

    const { installRoot, stagingRoot } = await this.createManagedInstallStagingRoot(managedInstall.id);
    try {
      const archivePath = path.join(stagingRoot, latestFileName);
      await fs.writeFile(archivePath, archiveBuffer);
      await this.extractTarGzArchive(archivePath, stagingRoot);
      await fs.rm(archivePath, { force: true });

      await this.setExecutableIfNeeded(path.join(stagingRoot, 'bin', 'jdtls'));
      await this.finalizeManagedInstall(installRoot, stagingRoot);
    } catch (error) {
      await fs.rm(stagingRoot, { recursive: true, force: true });
      throw error;
    }
  }

  private getRustAnalyzerAssetName(): string {
    if (process.platform === 'darwin' && process.arch === 'arm64') {
      return 'rust-analyzer-aarch64-apple-darwin.gz';
    }
    if (process.platform === 'darwin' && process.arch === 'x64') {
      return 'rust-analyzer-x86_64-apple-darwin.gz';
    }
    if (process.platform === 'linux' && process.arch === 'arm64') {
      return 'rust-analyzer-aarch64-unknown-linux-gnu.gz';
    }
    if (process.platform === 'linux' && process.arch === 'x64') {
      return 'rust-analyzer-x86_64-unknown-linux-gnu.gz';
    }
    if (process.platform === 'win32' && process.arch === 'arm64') {
      return 'rust-analyzer-aarch64-pc-windows-msvc.zip';
    }
    if (process.platform === 'win32' && process.arch === 'x64') {
      return 'rust-analyzer-x86_64-pc-windows-msvc.zip';
    }

    throw new Error(`Rust Analyzer installs are not available for ${process.platform}/${process.arch}.`);
  }

  private getKotlinArchiveSuffix(): string {
    if (process.platform === 'darwin' && process.arch === 'arm64') {
      return 'mac-aarch64';
    }
    if (process.platform === 'darwin' && process.arch === 'x64') {
      return 'mac-x64';
    }
    if (process.platform === 'linux' && process.arch === 'arm64') {
      return 'linux-aarch64';
    }
    if (process.platform === 'linux' && process.arch === 'x64') {
      return 'linux-x64';
    }
    if (process.platform === 'win32' && process.arch === 'arm64') {
      return 'win-aarch64';
    }
    if (process.platform === 'win32' && process.arch === 'x64') {
      return 'win-x64';
    }

    throw new Error(`Kotlin LSP installs are not available for ${process.platform}/${process.arch}.`);
  }

  private async runCommand(
    command: string,
    args: string[],
    cwd: string,
    extraEnv: Record<string, string> = {},
  ): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(command, args, {
        cwd,
        env: {
          ...process.env,
          ...extraEnv,
          npm_config_audit: 'false',
          npm_config_fund: 'false',
          npm_config_update_notifier: 'false',
        },
        shell: isShellCommandPath(command),
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (chunk: Buffer | string) => {
        stdout += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : chunk;
      });
      child.stderr.on('data', (chunk: Buffer | string) => {
        stderr += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : chunk;
      });
      child.once('error', (error) => {
        reject(error);
      });
      child.once('exit', (code, signal) => {
        if (code === 0) {
          resolve();
          return;
        }

        const output = [stderr.trim(), stdout.trim()].find((value) => value.length > 0);
        reject(
          new Error(
            output ??
              `${command} exited${code !== null ? ` with code ${code}` : ''}${
                signal ? ` (${signal})` : ''
              }.`,
          ),
        );
      });
    });
  }

  private async ensureSession(
    workspacePath: string,
    languageId: string,
  ): Promise<LspServerSession> {
    const config = getServerConfigForLanguage(languageId);
    if (!config) {
      this.emit({
        kind: 'status',
        workspacePath,
        languageId,
        serverId: null,
        status: 'unsupported',
        detail: `No LSP server configured for ${languageId}.`,
      });
      throw new Error(`No LSP server configured for ${languageId}.`);
    }

    const key = this.getSessionKey(workspacePath, config.id);
    let session = this.sessions.get(key) ?? null;
    if (!session) {
      session = new LspServerSession(config, workspacePath, (event) => {
        this.emit(event);
      });
      this.sessions.set(key, session);
    }

    await session.ensureReady();
    return session;
  }

  private getSessionKey(workspacePath: string, serverId: string): string {
    return `${path.resolve(workspacePath)}::${serverId}`;
  }

  private emit(event: LspRendererEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}
