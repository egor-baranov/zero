import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { app } from 'electron';
import {
  LSP_SEMANTIC_TOKEN_MODIFIERS,
  LSP_SEMANTIC_TOKEN_TYPES,
} from '@shared/types/lsp';
import type {
  LspCompletionItem,
  LspCompletionRequest,
  LspCompletionResult,
  LspDefinitionResult,
  LspDiagnostic,
  LspDiagnosticSeverity,
  LspDocumentCloseRequest,
  LspDocumentSyncRequest,
  LspDocumentSyncResult,
  LspHoverResult,
  LspLocation,
  LspRange,
  LspReferencesRequest,
  LspReferencesResult,
  LspRendererEvent,
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
}

interface LspServerConfig {
  id: string;
  languages: string[];
  launchCandidates: () => LspLaunchCandidate[];
  installHint?: string;
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
const BUNDLED_LSP_PLATFORM_DIR = `${process.platform}-${process.arch}`;

const resolveLocalBin = (name: string): string =>
  path.join(
    process.cwd(),
    'node_modules',
    '.bin',
    process.platform === 'win32' ? `${name}.cmd` : name,
  );

const getExecutableName = (name: string): string =>
  process.platform === 'win32' && !name.endsWith('.cmd') ? `${name}.cmd` : name;

const getBundledExecutableNames = (name: string): string[] =>
  process.platform === 'win32'
    ? [`${name}.bat`, `${name}.cmd`, `${name}.exe`, name]
    : [name];

const COMMON_BIN_DIRECTORIES = Array.from(
  new Set([
    path.join(homedir(), '.local', 'share', 'nvim', 'mason', 'bin'),
    path.join(homedir(), '.local', 'bin'),
    path.join(homedir(), '.asdf', 'shims'),
    path.join(homedir(), '.volta', 'bin'),
    path.join(homedir(), 'go', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
  ]),
);

const resolveBundledLspPlatformRoots = (): string[] =>
  Array.from(
    new Set([
      path.join(process.resourcesPath, 'lsp', BUNDLED_LSP_PLATFORM_DIR),
      path.join(process.cwd(), '.bundled-tools', 'lsp', BUNDLED_LSP_PLATFORM_DIR),
    ]),
  ).filter((candidate) => existsSync(candidate));

const resolveBundledJavaHome = (): string | null => {
  for (const root of resolveBundledLspPlatformRoots()) {
    const candidates =
      process.platform === 'darwin'
        ? [path.join(root, 'java', 'openjdk.jdk', 'Contents', 'Home')]
        : [path.join(root, 'java')];

    for (const candidate of candidates) {
      if (
        existsSync(
          path.join(candidate, 'bin', process.platform === 'win32' ? 'java.exe' : 'java'),
        )
      ) {
        return candidate;
      }
    }
  }

  return null;
};

const resolveAppPackageRoots = (): string[] => {
  const candidates = new Set<string>([
    process.cwd(),
    path.join(process.resourcesPath, 'app.asar'),
    path.join(process.resourcesPath, 'app.asar.unpacked'),
  ]);

  try {
    const appPath = app.getAppPath();
    if (appPath) {
      candidates.add(appPath);
    }
  } catch {
    // Ignore app path lookup errors during early startup and keep other fallbacks.
  }

  return Array.from(candidates).filter((candidate) => existsSync(candidate));
};

const resolveBundledNodePackageScripts = (
  packageName: string,
  relativeScriptPaths: string[],
): string[] => {
  const candidates: string[] = [];

  for (const root of resolveAppPackageRoots()) {
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
  const executableName = getExecutableName(command);

  return directories
    .map((directory) => path.join(directory, executableName))
    .filter((candidate) => existsSync(candidate));
};

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

const resolveExecutableLaunchCandidates = (
  commands: string[],
  args: string[] = [],
): LspLaunchCandidate[] => {
  const candidates: LspLaunchCandidate[] = [];

  for (const command of commands) {
    const localBin = resolveLocalBin(command);
    if (existsSync(localBin)) {
      candidates.push({
        command: localBin,
        args,
      });
    }

    for (const resolvedCommand of resolveCommandInDirectories(
      command,
      COMMON_BIN_DIRECTORIES,
    )) {
      candidates.push({
        command: resolvedCommand,
        args,
      });
    }

    candidates.push({
      command,
      args,
    });
  }

  return dedupeLaunchCandidates(candidates);
};

const resolveBundledLaunchCandidates = (
  serverDirectory: string,
  commands: string[],
  args: string[] = [],
  options?: {
    includeBundledJavaHome?: boolean;
  },
): LspLaunchCandidate[] => {
  const candidates: LspLaunchCandidate[] = [];
  const bundledJavaHome = options?.includeBundledJavaHome ? resolveBundledJavaHome() : null;

  for (const root of resolveBundledLspPlatformRoots()) {
    for (const command of commands) {
      for (const executableName of getBundledExecutableNames(command)) {
        const bundledCommand = path.join(root, serverDirectory, 'bin', executableName);

        if (!existsSync(bundledCommand)) {
          continue;
        }

        candidates.push({
          command: bundledCommand,
          args,
          env: bundledJavaHome ? { JAVA_HOME: bundledJavaHome } : undefined,
        });
      }
    }
  }

  return dedupeLaunchCandidates(candidates);
};

const resolveBundledThenExecutableLaunchCandidates = (
  bundledServerDirectory: string,
  commands: string[],
  args: string[] = [],
  options?: {
    includeBundledJavaHome?: boolean;
  },
): LspLaunchCandidate[] =>
  dedupeLaunchCandidates([
    ...resolveBundledLaunchCandidates(
      bundledServerDirectory,
      commands,
      args,
      options,
    ),
    ...resolveExecutableLaunchCandidates(commands, args),
  ]);

const resolveBundledNodePackageLaunchCandidates = (
  packageName: string,
  relativeScriptPaths: string[],
  commands: string[],
  args: string[] = [],
): LspLaunchCandidate[] =>
  dedupeLaunchCandidates([
    ...resolveBundledNodePackageScripts(packageName, relativeScriptPaths).map((scriptPath) => ({
      command: process.execPath,
      args: [scriptPath, ...args],
      env: {
        ELECTRON_RUN_AS_NODE: '1',
      },
    })),
    ...resolveExecutableLaunchCandidates(commands, args),
  ]);

const createBundledDiscoveredServerConfig = (
  id: string,
  languages: string[],
  bundledServerDirectory: string,
  commands: string[],
  args: string[] = [],
  options?: {
    includeBundledJavaHome?: boolean;
    installHint?: string;
  },
): LspServerConfig => ({
  id,
  languages,
  installHint: options?.installHint,
  launchCandidates: () =>
    resolveBundledThenExecutableLaunchCandidates(
      bundledServerDirectory,
      commands,
      args,
      {
        includeBundledJavaHome: options?.includeBundledJavaHome,
      },
    ),
});

const createBundledNodePackageServerConfig = (
  id: string,
  languages: string[],
  packageName: string,
  relativeScriptPaths: string[],
  commands: string[],
  args: string[] = [],
  installHint?: string,
): LspServerConfig => ({
  id,
  languages,
  installHint,
  launchCandidates: () =>
    resolveBundledNodePackageLaunchCandidates(
      packageName,
      relativeScriptPaths,
      commands,
      args,
    ),
});

const SERVER_CONFIGS: LspServerConfig[] = [
  createBundledNodePackageServerConfig(
    'typescript-language-server',
    ['typescript', 'javascript'],
    'typescript-language-server',
    ['lib/cli.mjs'],
    ['typescript-language-server'],
    ['--stdio'],
    'Packaged builds should ship `typescript-language-server` and `typescript` in app dependencies.',
  ),
  createBundledNodePackageServerConfig(
    'pyright',
    ['python'],
    'pyright',
    ['langserver.index.js'],
    ['pyright-langserver'],
    ['--stdio'],
    'Packaged builds should ship `pyright` in app dependencies.',
  ),
  createBundledDiscoveredServerConfig(
    'gopls',
    ['go'],
    'gopls',
    ['gopls'],
    [],
    {
      installHint:
        'Packaged builds should bundle `gopls`. For local development, stage it with `npm run stage:lsps`, set `ZERO_BUNDLED_GOPLS`, or install `gopls` on PATH.',
    },
  ),
  createBundledDiscoveredServerConfig(
    'kotlin-lsp',
    ['kotlin'],
    'kotlin-language-server',
    ['kotlin-language-server', 'kotlin-lsp'],
    [],
    {
      includeBundledJavaHome: true,
      installHint:
        'Packaged builds should bundle Kotlin LSP resources. For local development, stage them with `npm run stage:lsps` or install `kotlin-language-server` / `kotlin-lsp` on PATH.',
    },
  ),
  createBundledDiscoveredServerConfig(
    'rust-analyzer',
    ['rust'],
    'rust-analyzer',
    ['rust-analyzer'],
    [],
    {
      installHint:
        'Packaged builds should bundle `rust-analyzer`. For local development, stage it with `npm run stage:lsps`, set `ZERO_BUNDLED_RUST_ANALYZER`, or install `rust-analyzer` on PATH.',
    },
  ),
  createBundledDiscoveredServerConfig(
    'jdtls',
    ['java'],
    'jdtls',
    ['jdtls'],
    [],
    {
      includeBundledJavaHome: true,
      installHint:
        'Packaged builds should bundle JDTLS resources. For local development, stage them with `npm run stage:lsps` or install `jdtls` on PATH.',
    },
  ),
  createBundledNodePackageServerConfig(
    'json-ls',
    ['json'],
    'vscode-langservers-extracted',
    ['bin/vscode-json-language-server'],
    ['vscode-json-language-server'],
    ['--stdio'],
    'Packaged builds should ship `vscode-langservers-extracted` in app dependencies.',
  ),
  createBundledNodePackageServerConfig(
    'yaml-ls',
    ['yaml'],
    'yaml-language-server',
    ['bin/yaml-language-server'],
    ['yaml-language-server'],
    ['--stdio'],
    'Packaged builds should ship `yaml-language-server` in app dependencies.',
  ),
  createBundledNodePackageServerConfig(
    'bash-ls',
    ['shell'],
    'bash-language-server',
    ['out/cli.js'],
    ['bash-language-server'],
    ['start'],
    'Packaged builds should ship `bash-language-server` in app dependencies.',
  ),
  createBundledNodePackageServerConfig(
    'html-ls',
    ['html'],
    'vscode-langservers-extracted',
    ['bin/vscode-html-language-server'],
    ['vscode-html-language-server'],
    ['--stdio'],
    'Packaged builds should ship `vscode-langservers-extracted` in app dependencies.',
  ),
  createBundledNodePackageServerConfig(
    'css-ls',
    ['css'],
    'vscode-langservers-extracted',
    ['bin/vscode-css-language-server'],
    ['vscode-css-language-server'],
    ['--stdio'],
    'Packaged builds should ship `vscode-langservers-extracted` in app dependencies.',
  ),
];

const isMissingExecutableMessage = (value: string): boolean =>
  /ENOENT|not found|No such file or directory/i.test(value);

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

    for (const candidate of this.config.launchCandidates()) {
      try {
        const child = await new Promise<ChildProcessWithoutNullStreams>((resolve, reject) => {
          const nextChild = spawn(candidate.command, candidate.args, {
            cwd: this.workspacePath,
            stdio: 'pipe',
            env: {
              ...process.env,
              ...candidate.env,
            },
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
      typeof this.config.installHint === 'string' &&
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
