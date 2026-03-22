import {
  spawn,
  spawnSync,
  type ChildProcessWithoutNullStreams,
} from 'node:child_process';
import { createWriteStream, promises as fs, statSync } from 'node:fs';
import * as http from 'node:http';
import * as https from 'node:https';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { Readable, Writable } from 'node:stream';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  ClientSideConnection,
  PROTOCOL_VERSION,
  ndJsonStream,
  type AuthMethod,
  type ContentBlock,
  type Client,
  type InitializeResponse,
  type ModelInfo,
  type ReadTextFileRequest,
  type RequestPermissionResponse,
  type SessionConfigOption,
  type SessionConfigSelectGroup,
  type SessionConfigSelectOption,
  type SessionMode,
} from '@agentclientprotocol/sdk';
import type {
  AcpAuthenticateRequest,
  AcpAuthenticateResult,
  AcpAgentConfig,
  AcpCancelRequest,
  AcpConnectionState,
  AcpInitializeRequest,
  AcpInitializeResult,
  AcpPromptRequest,
  AcpPromptResult,
  AcpRendererEvent,
  AcpRespondPermissionRequest,
  AcpRespondPermissionResult,
  AcpSessionConfigControl,
  AcpSessionControls,
  AcpSessionConfigSelectValue,
  AcpSessionLoadRequest,
  AcpSessionLoadResult,
  AcpSetSessionConfigOptionRequest,
  AcpSetSessionConfigOptionResult,
  AcpSetSessionModeRequest,
  AcpSetSessionModeResult,
  AcpSetSessionModelRequest,
  AcpSetSessionModelResult,
  AcpSessionNewRequest,
  AcpSessionNewResult,
} from '@shared/types/acp';
import { toAcpPermissionEvent } from '@shared/types/acp';
import { ensureMockAgentScript } from './mock-agent-script';

const require = createRequire(import.meta.url);

interface AgentProcessLaunchConfig {
  command: string;
  args: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

interface PendingPermissionRequest {
  resolve: (value: RequestPermissionResponse) => void;
  sessionId: string;
}

interface LaunchRetryBackoff {
  message: string;
  untilEpochMs: number;
}

interface TerminalAuthLaunchSpec {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
}

interface RegistryBinaryDistributionTarget {
  archive?: string;
  cmd?: string;
  args?: string[];
}

interface RegistryBinaryTemplate {
  agentId: string;
  agentName: string;
  version: string;
  platformKey: string;
  archiveUrl: string;
  command: string;
  args: string[];
}

interface RegistryBinaryTemplateCache {
  fetchedAtMs: number;
  templates: RegistryBinaryTemplate[];
}

const AUTH_FAILURE_RETRY_BACKOFF_MS = 30_000;
const ACP_REGISTRY_URL =
  'https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json';
const ACP_REGISTRY_CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_REGISTRY_DOWNLOAD_REDIRECTS = 5;
const COMMON_POSIX_PATH_SEGMENTS = [
  '/opt/homebrew/bin',
  '/opt/homebrew/sbin',
  '/usr/local/bin',
  '/usr/local/sbin',
  '/usr/bin',
  '/bin',
  '/usr/sbin',
  '/sbin',
];

const isResourceNotFoundError = (error: unknown): boolean => {
  const containsEmptySessionFile = (value: string): boolean =>
    value.toLowerCase().includes('empty session file');

  if (typeof error !== 'object' || error === null) {
    if (typeof error === 'string') {
      return containsEmptySessionFile(error);
    }
    return false;
  }

  if ('error' in error) {
    return isResourceNotFoundError(error.error);
  }

  if ('data' in error) {
    if (typeof error.data === 'string' && containsEmptySessionFile(error.data)) {
      return true;
    }

    const fromData = isResourceNotFoundError(error.data);
    if (fromData) {
      return true;
    }
  }

  if (
    'code' in error &&
    (error.code === -32002 || error.code === '-32002')
  ) {
    return true;
  }

  if ('message' in error && typeof error.message === 'string') {
    const message = error.message.toLowerCase();
    return message.includes('resource not found') || containsEmptySessionFile(message);
  }

  return false;
};

const toErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  if (typeof error === 'object' && error !== null) {
    if ('message' in error && typeof error.message === 'string') {
      return error.message;
    }

    if ('error' in error) {
      return toErrorMessage(error.error);
    }
  }

  return String(error);
};

const isAuthenticationRequiredError = (error: unknown): boolean => {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    if (error.code === -32000 || error.code === '-32000') {
      const message = toErrorMessage(error).toLowerCase();
      if (message.includes('authentication required') || message.includes('please run /login')) {
        return true;
      }
    }
  }

  const message = toErrorMessage(error).toLowerCase();
  return message.includes('authentication required') || message.includes('please run /login');
};

const isFatalAdapterStderr = (message: string): boolean => {
  const normalized = message.toLowerCase();
  return (
    normalized.includes('panicked at') ||
    normalized.includes('threadpoolbuilderror') ||
    normalized.includes('creating threadpool failed') ||
    normalized.includes('failed to spawn thread') ||
    normalized.includes('resource temporarily unavailable') ||
    normalized.includes('wouldblock') ||
    normalized.includes('failed to connect to websocket') ||
    normalized.includes('403 forbidden') ||
    normalized.includes('unauthorized') ||
    normalized.includes('authentication failed') ||
    normalized.includes('invalid api key') ||
    normalized.includes('api key is required')
  );
};

const toUserFacingAdapterError = (agentKind: AcpAgentConfig['kind'], message: string): string => {
  const normalized = message.toLowerCase();

  if (
    normalized.includes('threadpoolbuilderror') ||
    normalized.includes('creating threadpool failed') ||
    normalized.includes('failed to spawn thread') ||
    normalized.includes('resource temporarily unavailable') ||
    normalized.includes('wouldblock')
  ) {
    return 'ACP adapter hit an OS thread limit and exited. Close other heavy processes, then reconnect the agent.';
  }

  if (
    agentKind === 'codex' &&
    normalized.includes('403 forbidden') &&
    normalized.includes('/codex/responses')
  ) {
    return 'Codex ACP authentication failed (403). Run `codex login` in your terminal, then reconnect.';
  }

  if (
    agentKind === 'claude' &&
    normalized.includes('403 forbidden')
  ) {
    return 'Claude Code ACP authentication failed (403). Re-authenticate Claude Code, then reconnect.';
  }

  if (
    normalized.includes('unauthorized') ||
    normalized.includes('authentication failed') ||
    normalized.includes('authentication required') ||
    normalized.includes('invalid api key') ||
    normalized.includes('api key is required')
  ) {
    return 'ACP authentication failed. Check agent credentials, then reconnect.';
  }

  return message;
};

const quotePosixShellArg = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`;

const toPosixShellCommand = (command: string, args: string[]): string =>
  [command, ...args].map((entry) => quotePosixShellArg(entry)).join(' ');

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const toTerminalAuthMeta = (method: AuthMethod): Record<string, unknown> | null => {
  const rawMeta = isRecord(method._meta) ? method._meta['terminal-auth'] : undefined;
  return isRecord(rawMeta) ? rawMeta : null;
};

const isTerminalAuthMethod = (method: AuthMethod): boolean =>
  ('type' in method && method.type === 'terminal') || toTerminalAuthMeta(method) !== null;

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

const toAbsolutePath = (value: string): string => {
  if (value.startsWith('file://')) {
    return fileURLToPath(value);
  }

  return path.resolve(value);
};

const toFileUri = (value: string): string => pathToFileURL(toAbsolutePath(value)).toString();

const toNormalizedRegistryCommand = (value: string): string =>
  value
    .trim()
    .replace(/^[.][\\/]+/, '')
    .replace(/\\/g, '/')
    .toLowerCase();

const toNormalizedArgs = (args: string[]): string[] =>
  args.map((entry) => entry.trim()).filter((entry) => entry.length > 0);

const toPathSegments = (value: string | undefined): string[] =>
  (value ?? '')
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

const isArgsPrefixCompatible = (left: string[], right: string[]): boolean => {
  if (left.length === 0 || right.length === 0) {
    return true;
  }

  const shorter = left.length <= right.length ? left : right;
  const longer = left.length <= right.length ? right : left;
  return shorter.every((entry, index) => longer[index] === entry);
};

const toConfigSelectValues = (
  options: SessionConfigSelectOption[] | SessionConfigSelectGroup[],
): AcpSessionConfigSelectValue[] => {
  const values: AcpSessionConfigSelectValue[] = [];

  for (const option of options) {
    if ('group' in option) {
      for (const nestedOption of option.options) {
        values.push({
          id: nestedOption.value,
          name: nestedOption.name,
          description: nestedOption.description ?? null,
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

const toModeState = (
  modes:
    | {
        availableModes: SessionMode[];
        currentModeId: string;
      }
    | null
    | undefined,
): AcpSessionControls['modeState'] => {
  if (!modes || !Array.isArray(modes.availableModes) || modes.availableModes.length === 0) {
    return undefined;
  }

  return {
    currentModeId: modes.currentModeId,
    options: modes.availableModes.map((mode) => ({
      id: mode.id,
      name: mode.name,
      description: mode.description ?? null,
    })),
  };
};

const toModelState = (
  models:
    | {
        availableModels: ModelInfo[];
        currentModelId: string;
      }
    | null
    | undefined,
): AcpSessionControls['modelState'] => {
  if (!models || !Array.isArray(models.availableModels) || models.availableModels.length === 0) {
    return undefined;
  }

  return {
    currentModelId: models.currentModelId,
    options: models.availableModels.map((model) => ({
      id: model.modelId,
      name: model.name,
      description: model.description ?? null,
    })),
  };
};

const toSessionControls = (payload: {
  configOptions?: SessionConfigOption[] | null;
  models?:
    | {
        availableModels: ModelInfo[];
        currentModelId: string;
      }
    | null;
  modes?:
    | {
        availableModes: SessionMode[];
        currentModeId: string;
      }
    | null;
}): AcpSessionControls | undefined => {
  const configControls = toConfigControls(payload.configOptions);
  const modeState = toModeState(payload.modes);
  const modelState = toModelState(payload.models);

  if (!modeState && !modelState && configControls.length === 0) {
    return undefined;
  }

  return {
    modeState,
    modelState,
    configControls,
  };
};

export class AcpService {
  private childProcess: ChildProcessWithoutNullStreams | null = null;
  private connection: ClientSideConnection | null = null;
  private initializeResponse: InitializeResponse | null = null;
  private connectionSignature: string | null = null;
  private launchEnv: NodeJS.ProcessEnv | null = null;
  private activeLaunchConfig: AgentProcessLaunchConfig | null = null;
  private authenticatedMethodId: string | null = null;
  private preferredAgent: AcpAgentConfig = { kind: 'mock' };
  private readonly listeners = new Set<(event: AcpRendererEvent) => void>();
  private readonly pendingPermissionRequests = new Map<
    string,
    PendingPermissionRequest
  >();
  private readonly launchRetryBackoffBySignature = new Map<string, LaunchRetryBackoff>();
  private registryBinaryTemplateCache: RegistryBinaryTemplateCache | null = null;
  private readonly registryBinaryInstallPromises = new Map<string, Promise<string>>();
  private permissionCounter = 0;

  public onEvent(listener: (event: AcpRendererEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public async initialize(
    request: AcpInitializeRequest,
  ): Promise<AcpInitializeResult> {
    try {
      if (request.agent) {
        this.preferredAgent = request.agent;
      }

      const connection = await this.ensureConnection(request);

      if (!this.initializeResponse) {
        this.emitConnectionState('connecting');

        this.initializeResponse = await connection.initialize({
          protocolVersion: PROTOCOL_VERSION,
          clientInfo: {
            name: 'zero-ade',
            version: '0.1.0',
          },
          clientCapabilities: {
            fs: {
              readTextFile: true,
              writeTextFile: false,
            },
            auth: {
              terminal: true,
            },
            _meta: {
              'terminal-auth': true,
            },
          },
        });

        this.emitConnectionState('ready', `Connected at ${request.cwd}`);

        if (this.connectionSignature) {
          this.launchRetryBackoffBySignature.delete(this.connectionSignature);
        }
      }

      return {
        connected: true,
        protocolVersion: this.initializeResponse.protocolVersion,
        loadSessionSupported:
          this.initializeResponse.agentCapabilities?.loadSession === true,
        agentName:
          this.initializeResponse.agentInfo?.title ??
          this.initializeResponse.agentInfo?.name ??
          'ACP Agent',
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'ACP initialize failed';
      this.emitConnectionState('error', message);

      return {
        connected: false,
        protocolVersion: PROTOCOL_VERSION,
        loadSessionSupported: false,
        agentName: 'ACP Agent',
      };
    }
  }

  public async newSession(
    request: AcpSessionNewRequest,
  ): Promise<AcpSessionNewResult> {
    const initialized = await this.initialize({
      cwd: request.cwd,
      agent: request.agent ?? this.preferredAgent,
    });
    if (!initialized.connected) {
      throw new Error('ACP connection is not available');
    }

    if (!this.connection) {
      throw new Error('ACP connection is not available');
    }

    let result: Awaited<ReturnType<ClientSideConnection['newSession']>>;
    try {
      result = await this.connection.newSession({
        cwd: request.cwd,
        mcpServers: request.mcpServers ?? [],
      });
    } catch (error) {
      if (isAuthenticationRequiredError(error)) {
        throw new Error(this.toAuthenticationRequiredMessage());
      }

      throw error instanceof Error ? error : new Error(toErrorMessage(error));
    }

    return {
      sessionId: result.sessionId,
      controls: toSessionControls({
        configOptions: result.configOptions,
        modes: result.modes,
        models: result.models,
      }),
    };
  }

  public async loadSession(
    request: AcpSessionLoadRequest,
  ): Promise<AcpSessionLoadResult> {
    const initialized = await this.initialize({
      cwd: request.cwd,
      agent: request.agent ?? this.preferredAgent,
    });
    if (!initialized.connected) {
      return { loaded: false };
    }

    if (!this.connection || !this.initializeResponse) {
      throw new Error('ACP connection is not available');
    }

    if (this.initializeResponse.agentCapabilities?.loadSession !== true) {
      return { loaded: false };
    }

    try {
      const result = await this.connection.loadSession({
        sessionId: request.sessionId,
        cwd: request.cwd,
        mcpServers: request.mcpServers ?? [],
      });

      return {
        loaded: true,
        controls: toSessionControls({
          configOptions: result.configOptions,
          modes: result.modes,
          models: result.models,
        }),
      };
    } catch (error) {
      if (isResourceNotFoundError(error)) {
        return { loaded: false };
      }
      if (isAuthenticationRequiredError(error)) {
        throw new Error(this.toAuthenticationRequiredMessage());
      }
      throw error instanceof Error ? error : new Error(toErrorMessage(error));
    }
  }

  public async authenticate(
    request: AcpAuthenticateRequest,
  ): Promise<AcpAuthenticateResult> {
    const initialized = await this.initialize({
      cwd: request.cwd,
      agent: request.agent ?? this.preferredAgent,
    });
    if (!initialized.connected || !this.connection || !this.initializeResponse) {
      return {
        started: false,
        requiresUserAction: false,
        methodId: null,
        methodName: null,
        message: 'ACP connection is not available.',
        terminalLaunchSpec: null,
      };
    }

    const authMethods = this.initializeResponse.authMethods ?? [];
    if (authMethods.length === 0) {
      return {
        started: false,
        requiresUserAction: false,
        methodId: null,
        methodName: null,
        message: 'No authentication methods were advertised by the ACP adapter.',
        terminalLaunchSpec: null,
      };
    }

    const methodId =
      request.methodId?.trim() ||
      this.selectAuthMethod(this.preferredAgent, authMethods, this.launchEnv);
    if (!methodId) {
      return {
        started: false,
        requiresUserAction: false,
        methodId: null,
        methodName: null,
        message: 'No compatible ACP authentication method was found.',
        terminalLaunchSpec: null,
      };
    }

    const method = authMethods.find((candidate) => candidate.id === methodId);
    if (!method) {
      return {
        started: false,
        requiresUserAction: false,
        methodId: null,
        methodName: null,
        message: 'Selected ACP authentication method is no longer available.',
        terminalLaunchSpec: null,
      };
    }

    if (isTerminalAuthMethod(method)) {
      const launchSpec = this.toTerminalAuthLaunchSpec(method, request.cwd);
      if (!launchSpec) {
        return {
          started: false,
          requiresUserAction: false,
          methodId: method.id,
          methodName: method.name ?? null,
          message: 'ACP terminal authentication metadata is missing required command details.',
          terminalLaunchSpec: null,
        };
      }

      return {
        started: true,
        requiresUserAction: true,
        methodId: method.id,
        methodName: method.name ?? null,
        message: 'Complete authentication in the built-in terminal, then resend your message.',
        terminalLaunchSpec: launchSpec,
      };
    }

    try {
      await this.connection.authenticate({
        methodId: method.id,
      });
      this.authenticatedMethodId = method.id;
      return {
        started: true,
        requiresUserAction: false,
        methodId: method.id,
        methodName: method.name ?? null,
        message: `${method.name} authentication completed.`,
        terminalLaunchSpec: null,
      };
    } catch (error) {
      return {
        started: false,
        requiresUserAction: false,
        methodId: method.id,
        methodName: method.name ?? null,
        message: `ACP authentication failed: ${toErrorMessage(error)}`,
        terminalLaunchSpec: null,
      };
    }
  }

  public async prompt(request: AcpPromptRequest): Promise<AcpPromptResult> {
    if (!this.connection) {
      throw new Error('ACP connection is not initialized');
    }

    const promptBlocks: ContentBlock[] = [
      {
        type: 'text',
        text: request.text,
      },
    ];

    for (const attachment of request.attachments ?? []) {
      const absolutePath = attachment.absolutePath.trim();
      if (!absolutePath) {
        continue;
      }

      const name =
        attachment.displayPath?.trim() ||
        attachment.relativePath?.trim() ||
        path.basename(absolutePath);
      const uri = toFileUri(absolutePath);

      promptBlocks.push({
        type: 'resource_link',
        name,
        title: name,
        uri,
        mimeType: attachment.mimeType,
      });
    }

    let result: Awaited<ReturnType<ClientSideConnection['prompt']>>;
    try {
      result = await this.connection.prompt({
        sessionId: request.sessionId,
        prompt: promptBlocks,
      });
    } catch (error) {
      if (isAuthenticationRequiredError(error)) {
        throw new Error(this.toAuthenticationRequiredMessage());
      }

      throw error instanceof Error ? error : new Error(toErrorMessage(error));
    }

    return {
      stopReason: result.stopReason,
    };
  }

  public async setSessionMode(
    request: AcpSetSessionModeRequest,
  ): Promise<AcpSetSessionModeResult> {
    if (!this.connection) {
      throw new Error('ACP connection is not initialized');
    }

    await this.connection.setSessionMode({
      sessionId: request.sessionId,
      modeId: request.modeId,
    });

    return { applied: true };
  }

  public async setSessionModel(
    request: AcpSetSessionModelRequest,
  ): Promise<AcpSetSessionModelResult> {
    if (!this.connection) {
      throw new Error('ACP connection is not initialized');
    }

    await this.connection.unstable_setSessionModel({
      sessionId: request.sessionId,
      modelId: request.modelId,
    });

    return { applied: true };
  }

  public async setSessionConfigOption(
    request: AcpSetSessionConfigOptionRequest,
  ): Promise<AcpSetSessionConfigOptionResult> {
    if (!this.connection) {
      throw new Error('ACP connection is not initialized');
    }

    const result =
      request.type === 'boolean'
        ? await this.connection.setSessionConfigOption({
            sessionId: request.sessionId,
            configId: request.configId,
            type: 'boolean',
            value: request.value,
          })
        : await this.connection.setSessionConfigOption({
            sessionId: request.sessionId,
            configId: request.configId,
            value: request.value,
          });

    return {
      applied: true,
      controls: toSessionControls({
        configOptions: result.configOptions,
      }),
    };
  }

  public async cancel(request: AcpCancelRequest): Promise<void> {
    if (!this.connection) {
      return;
    }

    await this.connection.cancel({ sessionId: request.sessionId });

    this.resolvePermissionRequestsForSession(request.sessionId, {
      outcome: { outcome: 'cancelled' },
    });
  }

  public async respondPermission(
    request: AcpRespondPermissionRequest,
  ): Promise<AcpRespondPermissionResult> {
    const pending = this.pendingPermissionRequests.get(request.requestId);

    if (!pending) {
      return { handled: false };
    }

    this.pendingPermissionRequests.delete(request.requestId);

    if (request.decision.outcome === 'cancelled') {
      pending.resolve({
        outcome: {
          outcome: 'cancelled',
        },
      });

      return { handled: true };
    }

    pending.resolve({
      outcome: {
        outcome: 'selected',
        optionId: request.decision.optionId,
      },
    });

    return { handled: true };
  }

  private emit(event: AcpRendererEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  private emitConnectionState(state: AcpConnectionState, message?: string): void {
    this.emit({
      type: 'connection-state',
      state,
      message,
    });
  }

  private toAuthenticationRequiredMessage(): string {
    const agentLabel = this.getPreferredAgentLabel();
    return `${agentLabel} authentication required. Use "Authenticate agent" to continue.`;
  }

  private getPreferredAgentLabel(): string {
    const initializedLabel =
      this.initializeResponse?.agentInfo?.title?.trim() ||
      this.initializeResponse?.agentInfo?.name?.trim();
    if (initializedLabel) {
      return initializedLabel;
    }

    if (this.preferredAgent.kind === 'claude') {
      return 'Claude Code';
    }

    if (this.preferredAgent.kind === 'codex') {
      return 'Codex';
    }

    if (this.preferredAgent.kind === 'custom') {
      const commandLabel = path.basename(this.preferredAgent.command.trim() || 'agent').trim();
      return commandLabel.length > 0 ? commandLabel : 'Agent';
    }

    return 'Agent';
  }

  private toTerminalAuthLaunchSpec(
    method: AuthMethod,
    cwd: string,
  ): TerminalAuthLaunchSpec | null {
    const stripAcpTransportArgs = (rawArgs: string[]): string[] => {
      const sanitized: string[] = [];
      for (let index = 0; index < rawArgs.length; index += 1) {
        const token = rawArgs[index];
        const lowerToken = token.trim().toLowerCase();
        if (lowerToken === '-y' || lowerToken === '--yes') {
          continue;
        }

        if (lowerToken === '--acp') {
          continue;
        }

        if (lowerToken === '--transport' && rawArgs[index + 1]?.trim().toLowerCase() === 'stdio') {
          index += 1;
          continue;
        }

        if (lowerToken === '--transport=stdio') {
          continue;
        }

        sanitized.push(token);
      }

      return sanitized;
    };

    const fallbackCommand = this.activeLaunchConfig?.command ?? '';
    const fallbackArgs = this.activeLaunchConfig?.args ?? [];

    let command = fallbackCommand;
    const methodArgs =
      'args' in method && Array.isArray(method.args)
        ? method.args.filter((entry): entry is string => typeof entry === 'string')
        : [];
    let args =
      methodArgs.length > 0
        ? [...stripAcpTransportArgs(fallbackArgs), ...methodArgs]
        : [...fallbackArgs];

    const terminalAuthMeta = toTerminalAuthMeta(method);
    if (terminalAuthMeta) {
      const metaCommand =
        typeof terminalAuthMeta.command === 'string'
          ? terminalAuthMeta.command.trim()
          : '';
      if (metaCommand) {
        command = metaCommand;
      }

      if (Array.isArray(terminalAuthMeta.args)) {
        args = terminalAuthMeta.args.filter(
          (entry): entry is string => typeof entry === 'string',
        );
      }
    }

    if (!command) {
      return null;
    }

    const env: Record<string, string> = {};
    if (this.preferredAgent.kind === 'claude') {
      const claudeEnvNames = ['HOME', 'CLAUDE_CONFIG_DIR', 'CLAUDE_CODE_EXECUTABLE'];
      for (const name of claudeEnvNames) {
        const value = this.launchEnv?.[name];
        if (typeof value === 'string' && value.trim().length > 0) {
          env[name] = value;
        }
      }
    }

    const methodEnv =
      'env' in method && isRecord(method.env)
        ? method.env
        : undefined;
    if (methodEnv) {
      for (const [key, value] of Object.entries(methodEnv)) {
        if (typeof value === 'string') {
          env[key] = value;
        }
      }
    }

    if (terminalAuthMeta && isRecord(terminalAuthMeta.env)) {
      for (const [key, value] of Object.entries(terminalAuthMeta.env)) {
        if (typeof value === 'string') {
          env[key] = value;
        }
      }
    }

    return {
      command,
      args,
      cwd,
      env,
    };
  }

  private openTerminalForAuth(spec: TerminalAuthLaunchSpec): void {
    if (process.platform === 'darwin') {
      const shellCommand = toPosixShellCommandWithEnv(spec.command, spec.args, spec.env);
      const terminalCommand = `cd ${quotePosixShellArg(spec.cwd)} && ${shellCommand}`;
      const applescript = [
        'tell application "Terminal"',
        'activate',
        `do script ${JSON.stringify(terminalCommand)}`,
        'end tell',
      ].join('\n');

      const result = spawnSync('osascript', ['-e', applescript], {
        encoding: 'utf8',
        windowsHide: true,
      });
      if (result.status !== 0) {
        const stderr = result.stderr?.trim();
        const stdout = result.stdout?.trim();
        const details = stderr || stdout || 'Unknown osascript failure.';
        throw new Error(details);
      }
      return;
    }

    if (process.platform === 'win32') {
      const command = [spec.command, ...spec.args]
        .map((entry) => (/\s|"/.test(entry) ? `"${entry.replace(/"/g, '""')}"` : entry))
        .join(' ');
      const child = spawn('cmd.exe', ['/d', '/k', command], {
        cwd: spec.cwd,
        env: {
          ...process.env,
          ...spec.env,
        },
        detached: true,
        stdio: 'ignore',
        windowsHide: false,
      });
      child.unref();
      return;
    }

    const shellPath = process.env.SHELL?.trim() || '/bin/sh';
    const shellCommand = toPosixShellCommandWithEnv(spec.command, spec.args, spec.env);
    const terminalCommand = `cd ${quotePosixShellArg(spec.cwd)} && ${shellCommand}`;
    const candidates: Array<{
      command: string;
      args: string[];
    }> = [
      {
        command: 'x-terminal-emulator',
        args: ['-e', shellPath, '-lc', terminalCommand],
      },
      {
        command: 'gnome-terminal',
        args: ['--', shellPath, '-lc', terminalCommand],
      },
      {
        command: 'konsole',
        args: ['-e', shellPath, '-lc', terminalCommand],
      },
      {
        command: 'xterm',
        args: ['-e', shellPath, '-lc', terminalCommand],
      },
    ];

    for (const candidate of candidates) {
      const resolved = this.resolveCommandOnPath(candidate.command);
      if (!resolved) {
        continue;
      }

      const child = spawn(resolved, candidate.args, {
        cwd: spec.cwd,
        env: {
          ...process.env,
          ...spec.env,
        },
        detached: true,
        stdio: 'ignore',
      });
      child.unref();
      return;
    }

    throw new Error('No supported terminal emulator found to complete ACP authentication.');
  }

  private toConfigSignature(config: {
    command: string;
    args: string[];
    cwd?: string;
    env?: Record<string, string>;
  }): string {
    const env = Object.entries(config.env ?? {})
      .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
      .map(([key, value]) => `${key}=${value}`);

    return JSON.stringify({
      command: config.command,
      args: config.args,
      cwd: config.cwd ?? '',
      env,
    });
  }

  private async toLaunchConfig(
    config: {
      command: string;
      args: string[];
      cwd?: string;
      env?: Record<string, string>;
    },
    cwd: string,
  ): Promise<AgentProcessLaunchConfig> {
    const launchCwd = this.resolveLaunchCwd(config.cwd ?? cwd);
    const rawCommand = config.command.trim();
    const trimmedCommand =
      rawCommand.startsWith('~/') || rawCommand.startsWith('~\\')
        ? path.join(os.homedir(), rawCommand.slice(2))
        : rawCommand;
    const hasPathSeparator = /[\\/]/.test(trimmedCommand);
    const isExplicitRelative = /^[.]{1,2}[\\/]/.test(trimmedCommand);
    let resolvedCommand = trimmedCommand;
    let resolvedArgs = config.args;

    if (trimmedCommand.length > 0 && isExplicitRelative) {
      const absoluteCandidate = path.resolve(launchCwd, trimmedCommand);
      const relativeResolved = this.resolveCommandAtAbsolutePath(absoluteCandidate);
      if (relativeResolved) {
        resolvedCommand = relativeResolved;
      } else {
        const registryResolvedCommand = await this.resolveRegistryBinaryRelativeCommand(
          trimmedCommand,
          resolvedArgs,
        );
        if (registryResolvedCommand) {
          resolvedCommand = registryResolvedCommand;
        } else {
          const basename = path.basename(trimmedCommand);
          resolvedCommand =
            this.resolveCommandOnPath(basename) ??
            this.resolveCommandOnLoginShell(basename) ??
            this.resolveCommandInWorkingDirectory(basename, launchCwd) ??
            trimmedCommand;
        }
      }
    } else if (trimmedCommand.length > 0 && !hasPathSeparator) {
      resolvedCommand =
        this.resolveCommandOnPath(trimmedCommand) ??
        this.resolveCommandOnLoginShell(trimmedCommand) ??
        this.resolveCommandInWorkingDirectory(trimmedCommand, launchCwd) ??
        trimmedCommand;
    }

    const knownFallback =
      resolvedCommand.length > 0
        ? this.resolveKnownCommandFallback(resolvedCommand, resolvedArgs)
        : null;
    if (knownFallback) {
      resolvedCommand = knownFallback.command;
      resolvedArgs = knownFallback.args;
    }

    const launchEnv: NodeJS.ProcessEnv = {
      ...process.env,
      ...(config.env ?? {}),
    };

    const pathSegments = new Set<string>(toPathSegments(launchEnv.PATH ?? launchEnv.Path));
    if (process.platform !== 'win32') {
      for (const segment of COMMON_POSIX_PATH_SEGMENTS) {
        pathSegments.add(segment);
      }

      const loginShellPath = this.resolvePathValueOnLoginShell();
      for (const segment of toPathSegments(loginShellPath ?? undefined)) {
        pathSegments.add(segment);
      }
    }

    if (path.isAbsolute(resolvedCommand)) {
      pathSegments.add(path.dirname(resolvedCommand));
    }

    if (pathSegments.size > 0) {
      const mergedPath = Array.from(pathSegments).join(path.delimiter);
      launchEnv.PATH = mergedPath;
      launchEnv.Path = mergedPath;
    }

    return {
      command: resolvedCommand,
      args: resolvedArgs,
      cwd: launchCwd,
      env: launchEnv,
    };
  }

  private resolveCommandAtAbsolutePath(candidate: string): string | null {
    try {
      const stats = statSync(candidate);
      if (stats.isFile()) {
        return candidate;
      }
      return null;
    } catch {
      return null;
    }
  }

  private toRegistryPlatformKeyCandidates(): string[] {
    const architecture = process.arch;

    if (process.platform === 'darwin') {
      if (architecture === 'arm64') {
        return ['darwin-aarch64', 'darwin-arm64', 'darwin'];
      }
      if (architecture === 'x64') {
        return ['darwin-x86_64', 'darwin-amd64', 'darwin'];
      }
      return ['darwin'];
    }

    if (process.platform === 'linux') {
      if (architecture === 'arm64') {
        return ['linux-aarch64', 'linux-arm64', 'linux'];
      }
      if (architecture === 'x64') {
        return ['linux-x86_64', 'linux-amd64', 'linux'];
      }
      return ['linux'];
    }

    if (process.platform === 'win32') {
      if (architecture === 'arm64') {
        return ['windows-aarch64', 'windows-arm64', 'windows'];
      }
      if (architecture === 'x64') {
        return ['windows-x86_64', 'windows-amd64', 'windows'];
      }
      return ['windows'];
    }

    return [];
  }

  private toSafePathSegment(value: string): string {
    const sanitized = value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '');

    return sanitized || 'agent';
  }

  private toRegistryAgentInstallDirectory(template: RegistryBinaryTemplate): string {
    const homeDirectory = this.getSystemHomeDirectory();
    const version = template.version.trim().length > 0 ? template.version : 'latest';
    const platformKey =
      template.platformKey.trim().length > 0
        ? template.platformKey
        : `${process.platform}-${process.arch}`;

    return path.join(
      homeDirectory,
      '.zero-ade',
      'acp-registry-agents',
      this.toSafePathSegment(template.agentId),
      this.toSafePathSegment(version),
      this.toSafePathSegment(platformKey),
    );
  }

  private toRegistryRelativeCommandSegments(command: string): string[] {
    return command
      .trim()
      .replace(/^[.][\\/]+/, '')
      .replace(/\\/g, '/')
      .split('/')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }

  private async fetchJsonFromUrl(
    url: string,
    redirectCount = 0,
  ): Promise<unknown> {
    if (redirectCount > MAX_REGISTRY_DOWNLOAD_REDIRECTS) {
      throw new Error('Too many redirects while loading ACP registry.');
    }

    const parsedUrl = new URL(url);
    const client = parsedUrl.protocol === 'http:' ? http : https;

    return new Promise<unknown>((resolve, reject) => {
      const request = client.get(
        parsedUrl,
        {
          headers: {
            'User-Agent': 'zero-ade-acp/1.0',
          },
        },
        (response) => {
          const statusCode = response.statusCode ?? 0;
          if (
            statusCode >= 300 &&
            statusCode < 400 &&
            typeof response.headers.location === 'string'
          ) {
            response.resume();
            const redirectedUrl = new URL(response.headers.location, parsedUrl).toString();
            void this.fetchJsonFromUrl(redirectedUrl, redirectCount + 1)
              .then(resolve)
              .catch(reject);
            return;
          }

          if (statusCode < 200 || statusCode >= 300) {
            response.resume();
            reject(
              new Error(
                `Registry request failed with HTTP ${statusCode}.`,
              ),
            );
            return;
          }

          const chunks: string[] = [];
          response.setEncoding('utf8');
          response.on('data', (chunk: string) => {
            chunks.push(chunk);
          });
          response.on('error', (error) => {
            reject(error);
          });
          response.on('end', () => {
            try {
              const payload = JSON.parse(chunks.join('')) as unknown;
              resolve(payload);
            } catch (error) {
              reject(error instanceof Error ? error : new Error(String(error)));
            }
          });
        },
      );

      request.on('error', (error) => {
        reject(error);
      });
      request.setTimeout(20_000, () => {
        request.destroy(new Error('Timed out while loading ACP registry.'));
      });
    });
  }

  private async loadRegistryBinaryTemplates(): Promise<RegistryBinaryTemplate[]> {
    if (
      this.registryBinaryTemplateCache &&
      Date.now() - this.registryBinaryTemplateCache.fetchedAtMs < ACP_REGISTRY_CACHE_TTL_MS
    ) {
      return this.registryBinaryTemplateCache.templates;
    }

    const payload = await this.fetchJsonFromUrl(ACP_REGISTRY_URL);
    if (!isRecord(payload) || !Array.isArray(payload.agents)) {
      this.registryBinaryTemplateCache = {
        fetchedAtMs: Date.now(),
        templates: [],
      };
      return [];
    }

    const platformKeyCandidates = this.toRegistryPlatformKeyCandidates();
    const templates: RegistryBinaryTemplate[] = [];
    const seenSignatures = new Set<string>();

    for (const entry of payload.agents) {
      if (!isRecord(entry)) {
        continue;
      }

      const agentId =
        typeof entry.id === 'string' ? entry.id.trim() : '';
      const agentName =
        typeof entry.name === 'string' ? entry.name.trim() : agentId;
      if (!agentId) {
        continue;
      }

      const version =
        typeof entry.version === 'string' ? entry.version.trim() : '';
      const distribution = isRecord(entry.distribution) ? entry.distribution : undefined;
      const binaryDistribution = distribution && isRecord(distribution.binary)
        ? distribution.binary
        : null;
      if (!binaryDistribution) {
        continue;
      }

      const candidateTargets: Array<[string, RegistryBinaryDistributionTarget]> = [];
      for (const key of platformKeyCandidates) {
        const target = binaryDistribution[key];
        if (!isRecord(target)) {
          continue;
        }

        candidateTargets.push([
          key,
          {
            archive: typeof target.archive === 'string' ? target.archive.trim() : undefined,
            cmd: typeof target.cmd === 'string' ? target.cmd.trim() : undefined,
            args: Array.isArray(target.args)
              ? target.args
                  .filter((item): item is string => typeof item === 'string')
                  .map((item) => item.trim())
                  .filter((item) => item.length > 0)
              : undefined,
          },
        ]);
      }

      if (candidateTargets.length === 0) {
        for (const [key, rawTarget] of Object.entries(binaryDistribution)) {
          if (!isRecord(rawTarget)) {
            continue;
          }

          candidateTargets.push([
            key,
            {
              archive:
                typeof rawTarget.archive === 'string'
                  ? rawTarget.archive.trim()
                  : undefined,
              cmd: typeof rawTarget.cmd === 'string' ? rawTarget.cmd.trim() : undefined,
              args: Array.isArray(rawTarget.args)
                ? rawTarget.args
                    .filter((item): item is string => typeof item === 'string')
                    .map((item) => item.trim())
                    .filter((item) => item.length > 0)
                : undefined,
            },
          ]);
        }
      }

      for (const [platformKey, target] of candidateTargets) {
        const archiveUrl = target.archive?.trim() ?? '';
        const command = target.cmd?.trim() ?? '';
        if (!archiveUrl || !command) {
          continue;
        }

        const signature = [
          agentId,
          version,
          platformKey,
          archiveUrl,
          toNormalizedRegistryCommand(command),
        ].join('|');
        if (seenSignatures.has(signature)) {
          continue;
        }
        seenSignatures.add(signature);

        templates.push({
          agentId,
          agentName: agentName || agentId,
          version,
          platformKey,
          archiveUrl,
          command,
          args: target.args ?? [],
        });
      }
    }

    this.registryBinaryTemplateCache = {
      fetchedAtMs: Date.now(),
      templates,
    };

    return templates;
  }

  private async resolveRegistryBinaryRelativeCommand(
    command: string,
    args: string[],
  ): Promise<string | null> {
    const normalizedCommand = toNormalizedRegistryCommand(command);
    if (!normalizedCommand) {
      return null;
    }

    let templates: RegistryBinaryTemplate[] = [];
    try {
      templates = await this.loadRegistryBinaryTemplates();
    } catch (error) {
      console.warn(`[acp:custom] failed to load ACP registry metadata: ${toErrorMessage(error)}`);
      return null;
    }

    const normalizedArgs = toNormalizedArgs(args);
    const matches = templates
      .filter((template) => toNormalizedRegistryCommand(template.command) === normalizedCommand)
      .filter((template) =>
        isArgsPrefixCompatible(toNormalizedArgs(template.args), normalizedArgs),
      )
      .sort((left, right) => right.args.length - left.args.length);

    if (matches.length === 0) {
      return null;
    }

    const selectedMatch = matches[0];
    return this.ensureRegistryBinaryInstalled(selectedMatch);
  }

  private async ensureRegistryBinaryInstalled(
    template: RegistryBinaryTemplate,
  ): Promise<string> {
    const installDirectory = this.toRegistryAgentInstallDirectory(template);
    const commandSegments = this.toRegistryRelativeCommandSegments(template.command);
    if (commandSegments.length === 0) {
      throw new Error(
        `Registry command for ${template.agentName} is invalid: ${template.command}`,
      );
    }

    const installedCommandPath = path.join(installDirectory, ...commandSegments);
    const existingCommand = this.resolveCommandAtAbsolutePath(installedCommandPath);
    if (existingCommand) {
      return existingCommand;
    }

    const installKey = [
      template.agentId,
      template.version || 'latest',
      template.platformKey || `${process.platform}-${process.arch}`,
      toNormalizedRegistryCommand(template.command),
      template.archiveUrl,
    ].join('|');

    const existingInstallPromise = this.registryBinaryInstallPromises.get(installKey);
    if (existingInstallPromise) {
      return existingInstallPromise;
    }

    const installPromise = this.installRegistryBinaryTemplate(
      template,
      installDirectory,
      installedCommandPath,
    ).finally(() => {
      this.registryBinaryInstallPromises.delete(installKey);
    });

    this.registryBinaryInstallPromises.set(installKey, installPromise);
    return installPromise;
  }

  private toArchiveFileSuffix(url: string): string {
    try {
      const pathname = new URL(url).pathname.toLowerCase();
      if (pathname.endsWith('.tar.gz')) {
        return '.tar.gz';
      }
      if (pathname.endsWith('.tgz')) {
        return '.tgz';
      }
      if (pathname.endsWith('.tar.xz')) {
        return '.tar.xz';
      }
      if (pathname.endsWith('.tar')) {
        return '.tar';
      }
      if (pathname.endsWith('.zip')) {
        return '.zip';
      }
    } catch {
      // Fall through to generic suffix.
    }

    return '.archive';
  }

  private async downloadUrlToFile(
    url: string,
    destinationPath: string,
    redirectCount = 0,
  ): Promise<void> {
    if (redirectCount > MAX_REGISTRY_DOWNLOAD_REDIRECTS) {
      throw new Error('Too many redirects while downloading registry binary.');
    }

    await new Promise<void>((resolve, reject) => {
      const parsedUrl = new URL(url);
      const client = parsedUrl.protocol === 'http:' ? http : https;
      const request = client.get(
        parsedUrl,
        {
          headers: {
            'User-Agent': 'zero-ade-acp/1.0',
          },
        },
        (response) => {
          const statusCode = response.statusCode ?? 0;
          if (
            statusCode >= 300 &&
            statusCode < 400 &&
            typeof response.headers.location === 'string'
          ) {
            response.resume();
            const redirectedUrl = new URL(response.headers.location, parsedUrl).toString();
            void this.downloadUrlToFile(redirectedUrl, destinationPath, redirectCount + 1)
              .then(resolve)
              .catch(reject);
            return;
          }

          if (statusCode < 200 || statusCode >= 300) {
            response.resume();
            reject(
              new Error(
                `Registry binary download failed with HTTP ${statusCode}.`,
              ),
            );
            return;
          }

          const output = createWriteStream(destinationPath);
          let settled = false;

          const finalizeWithError = (error: Error): void => {
            if (settled) {
              return;
            }
            settled = true;
            output.destroy();
            response.destroy();
            reject(error);
          };

          output.on('error', (error) => {
            finalizeWithError(error instanceof Error ? error : new Error(String(error)));
          });
          response.on('error', (error) => {
            finalizeWithError(error instanceof Error ? error : new Error(String(error)));
          });
          output.on('finish', () => {
            if (settled) {
              return;
            }
            settled = true;
            output.close((error) => {
              if (error) {
                reject(error);
                return;
              }
              resolve();
            });
          });

          response.pipe(output);
        },
      );

      request.on('error', (error) => {
        reject(error);
      });
      request.setTimeout(30_000, () => {
        request.destroy(new Error('Timed out while downloading registry binary.'));
      });
    });
  }

  private extractArchiveIntoDirectory(archivePath: string, targetDirectory: string): void {
    const lowerArchivePath = archivePath.toLowerCase();
    const failures: string[] = [];
    const escapedArchivePath = archivePath.replace(/'/g, "''");
    const escapedTargetDirectory = targetDirectory.replace(/'/g, "''");

    const extractionCandidates: Array<{ command: string; args: string[] }> = [];

    if (lowerArchivePath.endsWith('.zip')) {
      if (process.platform === 'darwin') {
        extractionCandidates.push({
          command: 'ditto',
          args: ['-x', '-k', archivePath, targetDirectory],
        });
      }

      if (process.platform === 'win32') {
        extractionCandidates.push({
          command: 'powershell.exe',
          args: [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            `Expand-Archive -LiteralPath '${escapedArchivePath}' -DestinationPath '${escapedTargetDirectory}' -Force`,
          ],
        });
      }

      extractionCandidates.push({
        command: 'unzip',
        args: ['-o', archivePath, '-d', targetDirectory],
      });
      extractionCandidates.push({
        command: 'tar',
        args: ['-xf', archivePath, '-C', targetDirectory],
      });
    } else {
      extractionCandidates.push({
        command: 'tar',
        args: ['-xf', archivePath, '-C', targetDirectory],
      });
    }

    for (const candidate of extractionCandidates) {
      const resolvedCommand =
        this.resolveCommandOnPath(candidate.command) ??
        this.resolveCommandOnLoginShell(candidate.command) ??
        candidate.command;
      const result = spawnSync(resolvedCommand, candidate.args, {
        encoding: 'utf8',
        windowsHide: true,
      });

      if (result.status === 0) {
        return;
      }

      const details = result.stderr?.trim() || result.stdout?.trim() || 'Unknown error';
      failures.push(`${candidate.command}: ${details}`);
    }

    throw new Error(
      `Failed to extract archive ${path.basename(archivePath)}. ${failures.join(' | ')}`,
    );
  }

  private async installRegistryBinaryTemplate(
    template: RegistryBinaryTemplate,
    installDirectory: string,
    installedCommandPath: string,
  ): Promise<string> {
    const archiveSuffix = this.toArchiveFileSuffix(template.archiveUrl);
    const temporaryRoot = path.join(
      os.tmpdir(),
      `zeroade-acp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    const archivePath = path.join(temporaryRoot, `agent${archiveSuffix}`);

    this.emitConnectionState(
      'connecting',
      `Installing ${template.agentName} (${template.version || 'latest'})…`,
    );

    try {
      await fs.mkdir(temporaryRoot, { recursive: true });
      await this.downloadUrlToFile(template.archiveUrl, archivePath);

      await fs.rm(installDirectory, { recursive: true, force: true });
      await fs.mkdir(installDirectory, { recursive: true });
      this.extractArchiveIntoDirectory(archivePath, installDirectory);

      const commandSegments = this.toRegistryRelativeCommandSegments(template.command);
      const resolvedInstalledCommand =
        this.resolveCommandAtAbsolutePath(installedCommandPath) ??
        (await this.findInstalledRegistryCommandBySuffix(installDirectory, commandSegments));
      if (!resolvedInstalledCommand) {
        throw new Error(
          `Installed archive for ${template.agentName} does not contain ${template.command}.`,
        );
      }

      if (process.platform !== 'win32') {
        try {
          await fs.chmod(resolvedInstalledCommand, 0o755);
        } catch {
          // Some binaries already have executable mode.
        }
      }

      return resolvedInstalledCommand;
    } catch (error) {
      throw new Error(
        `Failed to install ${template.agentName} from ACP registry: ${toErrorMessage(error)}`,
      );
    } finally {
      await fs.rm(temporaryRoot, { recursive: true, force: true });
    }
  }

  private async findInstalledRegistryCommandBySuffix(
    installDirectory: string,
    commandSegments: string[],
  ): Promise<string | null> {
    if (commandSegments.length === 0) {
      return null;
    }

    const normalizedSuffix = commandSegments
      .map((segment) => segment.trim())
      .filter((segment) => segment.length > 0)
      .join('/')
      .toLowerCase();
    if (!normalizedSuffix) {
      return null;
    }

    const pendingDirectories: string[] = [installDirectory];
    while (pendingDirectories.length > 0) {
      const directory = pendingDirectories.pop();
      if (!directory) {
        continue;
      }

      let entries: Awaited<ReturnType<typeof fs.readdir>>;
      try {
        entries = await fs.readdir(directory, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const entry of entries) {
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          pendingDirectories.push(entryPath);
          continue;
        }

        if (!entry.isFile()) {
          continue;
        }

        const relativePath = path
          .relative(installDirectory, entryPath)
          .split(path.sep)
          .join('/')
          .toLowerCase();
        if (!relativePath.endsWith(normalizedSuffix)) {
          continue;
        }

        const resolved = this.resolveCommandAtAbsolutePath(entryPath);
        if (resolved) {
          return resolved;
        }
      }
    }

    return null;
  }

  private resolveKnownCommandFallback(
    command: string,
    args: string[],
  ): { command: string; args: string[] } | null {
    if (/[\\/]/.test(command) && this.resolveCommandAtAbsolutePath(command)) {
      return null;
    }

    const commandToken = path.basename(command).replace(/\.exe$/i, '').toLowerCase();

    if (commandToken === 'npx') {
      const resolvedNpx =
        this.resolveCommandOnPath('npx') ??
        this.resolveCommandOnLoginShell('npx');
      if (resolvedNpx) {
        return {
          command: resolvedNpx,
          args,
        };
      }

      const resolvedNpm =
        this.resolveCommandOnPath('npm') ??
        this.resolveCommandOnLoginShell('npm');
      const npmExecArgs = resolvedNpm ? this.toNpmExecArgsFromNpxArgs(args) : null;
      if (resolvedNpm && npmExecArgs) {
        return {
          command: resolvedNpm,
          args: npmExecArgs,
        };
      }
    }

    if (commandToken === 'opencode') {
      const npxCommand =
        this.resolveCommandOnPath('npx') ??
        this.resolveCommandOnLoginShell('npx') ??
        'npx';
      return {
        command: npxCommand,
        args: ['-y', 'opencode-ai', ...args],
      };
    }

    return null;
  }

  private toNpmExecArgsFromNpxArgs(args: string[]): string[] | null {
    const remainingArgs = [...args];
    let includeYes = false;

    while (remainingArgs[0] === '-y' || remainingArgs[0] === '--yes') {
      includeYes = true;
      remainingArgs.shift();
    }

    const packageName = remainingArgs.shift();
    if (!packageName) {
      return null;
    }

    const npmExecArgs = ['exec'];
    if (includeYes) {
      npmExecArgs.push('--yes');
    }
    npmExecArgs.push(packageName);

    if (remainingArgs.length > 0) {
      npmExecArgs.push('--', ...remainingArgs);
    }

    return npmExecArgs;
  }

  private resolveCommandInWorkingDirectory(
    command: string,
    workingDirectory: string,
  ): string | null {
    if (!command || !workingDirectory) {
      return null;
    }

    const extensions =
      process.platform === 'win32'
        ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM')
            .split(';')
            .map((entry) => entry.trim())
            .filter(Boolean)
        : [''];

    for (const extension of extensions) {
      const candidate = path.join(workingDirectory, `${command}${extension}`);
      try {
        const stats = statSync(candidate);
        if (stats.isFile()) {
          return candidate;
        }
      } catch {
        // Continue scanning sibling executable candidates.
      }
    }

    return null;
  }

  private withAdapterThreadLimits(
    launchConfig: AgentProcessLaunchConfig,
  ): AgentProcessLaunchConfig {
    return {
      ...launchConfig,
      env: {
        ...launchConfig.env,
        RAYON_NUM_THREADS: launchConfig.env?.RAYON_NUM_THREADS ?? '2',
        TOKIO_WORKER_THREADS: launchConfig.env?.TOKIO_WORKER_THREADS ?? '2',
      },
    };
  }

  private hasNonEmptyEnvValue(
    env: NodeJS.ProcessEnv | undefined,
    name: string,
  ): boolean {
    if (!env) {
      return false;
    }

    const directValue = env[name];
    if (typeof directValue === 'string' && directValue.trim().length > 0) {
      return true;
    }

    const matchedEntry = Object.entries(env).find(
      ([key]) => key.toLowerCase() === name.toLowerCase(),
    );
    const value = matchedEntry?.[1];
    return typeof value === 'string' && value.trim().length > 0;
  }

  private hasCodexConfigOverride(args: string[], key: string): boolean {
    const loweredKey = key.toLowerCase();

    for (let index = 0; index < args.length; index += 1) {
      const token = args[index]?.trim();
      if (!token) {
        continue;
      }

      const lowerToken = token.toLowerCase();

      if ((lowerToken === '-c' || lowerToken === '--config') && index + 1 < args.length) {
        const nextToken = args[index + 1]?.trim().toLowerCase() ?? '';
        if (nextToken.startsWith(`${loweredKey}=`)) {
          return true;
        }
        continue;
      }

      if (lowerToken.startsWith(`-c${loweredKey}=`) || lowerToken.startsWith(`--config=${loweredKey}=`)) {
        return true;
      }
    }

    return false;
  }

  private withCodexChatGptDefaults(
    launchConfig: AgentProcessLaunchConfig,
  ): AgentProcessLaunchConfig {
    const nextArgs = [...launchConfig.args];
    const nextEnv: NodeJS.ProcessEnv = {
      ...(launchConfig.env ?? {}),
    };
    const userHome = os.homedir();

    const hasCodexApiKey = this.hasNonEmptyEnvValue(nextEnv, 'CODEX_API_KEY');

    if (!hasCodexApiKey && !this.hasCodexConfigOverride(nextArgs, 'forced_login_method')) {
      nextArgs.push('-c', 'forced_login_method=chatgpt');
    }

    if (!this.hasCodexConfigOverride(nextArgs, 'cli_auth_credentials_store')) {
      // Prefer the terminal Codex login store at ~/.codex/auth.json for app launches.
      nextArgs.push('-c', 'cli_auth_credentials_store=file');
    }

    if (!this.hasNonEmptyEnvValue(nextEnv, 'HOME') && userHome.trim().length > 0) {
      nextEnv.HOME = userHome;
    }

    if (!this.hasNonEmptyEnvValue(nextEnv, 'CODEX_HOME') && userHome.trim().length > 0) {
      nextEnv.CODEX_HOME = path.join(userHome, '.codex');
    }

    return {
      ...launchConfig,
      args: nextArgs,
      env: nextEnv,
    };
  }

  private getSystemHomeDirectory(): string {
    try {
      const userInfoHome = os.userInfo().homedir?.trim();
      if (userInfoHome) {
        return userInfoHome;
      }
    } catch {
      // Fall through to os.homedir.
    }

    return os.homedir().trim();
  }

  private hasClaudeAuthArtifacts(homeDirectory: string): boolean {
    const normalizedHome = homeDirectory.trim();
    if (!normalizedHome) {
      return false;
    }

    const claudeJsonPath = path.join(normalizedHome, '.claude.json');
    try {
      if (statSync(claudeJsonPath).isFile()) {
        return true;
      }
    } catch {
      // Keep probing.
    }

    const claudeConfigDirectory = path.join(normalizedHome, '.claude');
    try {
      return statSync(claudeConfigDirectory).isDirectory();
    } catch {
      return false;
    }
  }

  private withClaudeCodeDefaults(
    launchConfig: AgentProcessLaunchConfig,
  ): AgentProcessLaunchConfig {
    const nextEnv: NodeJS.ProcessEnv = {
      ...(launchConfig.env ?? {}),
    };
    const systemHomeDirectory = this.getSystemHomeDirectory();
    const configuredHomeDirectory = nextEnv.HOME?.trim() ?? '';

    let preferredHomeDirectory = configuredHomeDirectory;
    if (!preferredHomeDirectory && systemHomeDirectory) {
      preferredHomeDirectory = systemHomeDirectory;
    } else if (
      preferredHomeDirectory &&
      systemHomeDirectory &&
      preferredHomeDirectory !== systemHomeDirectory
    ) {
      const configuredHasClaudeAuth = this.hasClaudeAuthArtifacts(preferredHomeDirectory);
      const systemHasClaudeAuth = this.hasClaudeAuthArtifacts(systemHomeDirectory);
      if (!configuredHasClaudeAuth && systemHasClaudeAuth) {
        preferredHomeDirectory = systemHomeDirectory;
      }
    }

    if (preferredHomeDirectory) {
      nextEnv.HOME = preferredHomeDirectory;
    }

    if (!this.hasNonEmptyEnvValue(nextEnv, 'CLAUDE_CONFIG_DIR') && preferredHomeDirectory) {
      nextEnv.CLAUDE_CONFIG_DIR = path.join(preferredHomeDirectory, '.claude');
    }

    if (!this.hasNonEmptyEnvValue(nextEnv, 'CLAUDE_CODE_EXECUTABLE')) {
      const claudeExecutable =
        this.resolveCommandOnPath('claude') ?? this.resolveCommandOnLoginShell('claude');
      if (claudeExecutable) {
        nextEnv.CLAUDE_CODE_EXECUTABLE = claudeExecutable;
      }
    }

    return {
      ...launchConfig,
      env: nextEnv,
    };
  }

  private signatureForAgent(agent: AcpAgentConfig): string {
    if (agent.kind === 'mock') {
      return 'mock';
    }

    if (agent.kind === 'codex') {
      return agent.config
        ? `codex:${this.toConfigSignature(agent.config)}`
        : 'codex';
    }

    if (agent.kind === 'claude') {
      return agent.config
        ? `claude:${this.toConfigSignature(agent.config)}`
        : 'claude';
    }

    return `custom:${this.toConfigSignature(agent)}`;
  }

  private getBackoffMessageForSignature(signature: string): string | null {
    const backoff = this.launchRetryBackoffBySignature.get(signature);
    if (!backoff) {
      return null;
    }

    if (Date.now() >= backoff.untilEpochMs) {
      this.launchRetryBackoffBySignature.delete(signature);
      return null;
    }

    return backoff.message;
  }

  private toBackoffMessage(baseMessage: string): string {
    const seconds = Math.floor(AUTH_FAILURE_RETRY_BACKOFF_MS / 1000);
    return `${baseMessage} Automatic retries are paused for ${seconds}s to avoid reconnect loops.`;
  }

  private shouldBackoffFatalAdapterError(
    agentKind: AcpAgentConfig['kind'],
    message: string,
  ): boolean {
    if (agentKind !== 'codex') {
      return false;
    }

    const normalized = message.toLowerCase();
    return (
      (normalized.includes('failed to connect to websocket') &&
        normalized.includes('403 forbidden')) ||
      normalized.includes('authentication failed') ||
      normalized.includes('unauthorized')
    );
  }

  private async ensureCodexHomeExists(
    env: NodeJS.ProcessEnv | undefined,
  ): Promise<void> {
    const codeHome = env?.CODEX_HOME?.trim();
    if (!codeHome) {
      return;
    }

    try {
      await fs.mkdir(codeHome, { recursive: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[acp:codex] failed to prepare CODEX_HOME at ${codeHome}: ${message}`);
    }
  }

  private teardownConnection(message?: string): void {
    const child = this.childProcess;

    this.childProcess = null;
    this.connection = null;
    this.initializeResponse = null;
    this.connectionSignature = null;
    this.launchEnv = null;
    this.activeLaunchConfig = null;
    this.authenticatedMethodId = null;

    this.resolveAllPermissionRequests({
      outcome: { outcome: 'cancelled' },
    });

    if (child) {
      child.removeAllListeners();
      child.stderr?.removeAllListeners('data');

      if (!child.killed) {
        child.kill();
      }
    }

    if (message) {
      this.emitConnectionState('disconnected', message);
    }
  }

  private async ensureConnection(
    request: AcpInitializeRequest,
  ): Promise<ClientSideConnection> {
    if (!request.agent && this.connection) {
      return this.connection;
    }

    const agent: AcpAgentConfig = request.agent ?? this.preferredAgent;
    const signature = this.signatureForAgent(agent);

    if (this.connection && this.connectionSignature === signature) {
      return this.connection;
    }

    const launchBackoffMessage = this.getBackoffMessageForSignature(signature);
    if (launchBackoffMessage) {
      this.emitConnectionState('error', launchBackoffMessage);
      throw new Error(launchBackoffMessage);
    }

    if (this.connection || this.childProcess) {
      this.teardownConnection('Switching ACP agent');
    }

    const launchConfig = await this.resolveAgentLaunchConfig(agent, request.cwd);

    if (agent.kind === 'codex') {
      console.info(
        `[acp:codex] launching command=${launchConfig.command} cwd=${launchConfig.cwd ?? ''} HOME=${launchConfig.env?.HOME ?? ''} CODEX_HOME=${launchConfig.env?.CODEX_HOME ?? ''}`,
      );
    }

    if (agent.kind === 'claude') {
      console.info(
        `[acp:claude] launching command=${launchConfig.command} cwd=${launchConfig.cwd ?? ''} HOME=${launchConfig.env?.HOME ?? ''} CLAUDE_CONFIG_DIR=${launchConfig.env?.CLAUDE_CONFIG_DIR ?? ''} CLAUDE_CODE_EXECUTABLE=${launchConfig.env?.CLAUDE_CODE_EXECUTABLE ?? ''}`,
      );
    }

    const child = spawn(launchConfig.command, launchConfig.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: launchConfig.cwd,
      env: launchConfig.env,
    });

    this.connectionSignature = signature;
    this.launchEnv = launchConfig.env ?? null;
    this.activeLaunchConfig = launchConfig;
    this.authenticatedMethodId = null;

    this.childProcess = child;

    child.on('exit', (code, signal) => {
      this.connection = null;
      this.initializeResponse = null;
      this.connectionSignature = null;
      this.launchEnv = null;
      this.activeLaunchConfig = null;
      this.authenticatedMethodId = null;
      this.emitConnectionState(
        'disconnected',
        `Agent exited (code=${code ?? 'null'}, signal=${signal ?? 'null'})`,
      );
      this.resolveAllPermissionRequests({
        outcome: { outcome: 'cancelled' },
      });
    });

    child.on('error', (error) => {
      this.emitConnectionState('error', error.message);
    });

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      const message = chunk.trim();
      if (!message) {
        return;
      }

      console.error(`[acp:${agent.kind}] ${message}`);

      if (isFatalAdapterStderr(message)) {
        const userFacingError = toUserFacingAdapterError(agent.kind, message);

        if (this.shouldBackoffFatalAdapterError(agent.kind, message)) {
          const backoffMessage = this.toBackoffMessage(userFacingError);
          this.launchRetryBackoffBySignature.set(signature, {
            message: backoffMessage,
            untilEpochMs: Date.now() + AUTH_FAILURE_RETRY_BACKOFF_MS,
          });
          this.teardownConnection(backoffMessage);
          return;
        }

        this.teardownConnection(userFacingError);
      }
    });

    const output = Writable.toWeb(child.stdin);
    const input = Readable.toWeb(child.stdout);

    const stream = ndJsonStream(output, input);

    const client: Client = {
      sessionUpdate: async ({ sessionId, update }) => {
        this.emit({
          type: 'session-update',
          sessionId,
          update,
        });
      },
      requestPermission: async (request) => {
        const requestId = this.nextPermissionRequestId();

        return new Promise<RequestPermissionResponse>((resolve) => {
          this.pendingPermissionRequests.set(requestId, {
            resolve,
            sessionId: request.sessionId,
          });

          this.emit(toAcpPermissionEvent(requestId, request));
        });
      },
      readTextFile: async (request: ReadTextFileRequest) => {
        const absolutePath = toAbsolutePath(request.path);
        const content = await fs.readFile(absolutePath, 'utf8');

        if (!request.line && !request.limit) {
          return { content };
        }

        const lines = content.split('\n');
        const startIndex = Math.max((request.line ?? 1) - 1, 0);
        const endIndex =
          request.limit && request.limit > 0 ? startIndex + request.limit : undefined;

        return {
          content: lines.slice(startIndex, endIndex).join('\n'),
        };
      },
      writeTextFile: async () => ({}),
    };

    this.connection = new ClientSideConnection(() => client, stream);

    return this.connection;
  }

  private selectAuthMethod(
    agent: AcpAgentConfig,
    authMethods: AuthMethod[],
    env: NodeJS.ProcessEnv | null,
  ): string | null {
    if (!authMethods.length) {
      return null;
    }

    const findByIdPart = (value: string): AuthMethod | undefined =>
      authMethods.find((method) => method.id.toLowerCase().includes(value.toLowerCase()));

    const getEnvValue = (name: string): string | undefined => {
      if (!env) {
        return undefined;
      }

      const directValue = env[name];
      if (typeof directValue === 'string') {
        return directValue;
      }

      const matchedEntry = Object.entries(env).find(
        ([key]) => key.toLowerCase() === name.toLowerCase(),
      );
      const value = matchedEntry?.[1];
      return typeof value === 'string' ? value : undefined;
    };

    const hasEnvValue = (name: string): boolean => {
      const value = getEnvValue(name);
      return typeof value === 'string' && value.trim().length > 0;
    };

    const envVarMethodFor = (name: string): AuthMethod | undefined =>
      authMethods.find(
        (method) =>
          'type' in method &&
          method.type === 'env_var' &&
          method.vars.some((entry) => entry.name.toLowerCase() === name.toLowerCase()),
      );

    const compatibleEnvMethod = authMethods.find((method) => {
      if (!('type' in method) || method.type !== 'env_var') {
        return false;
      }

      return method.vars
        .filter((entry) => !entry.optional)
        .every((entry) => hasEnvValue(entry.name));
    });

    if (agent.kind === 'codex') {
      console.info(
        `[acp:codex] auth env present CODEX_API_KEY=${String(hasEnvValue('CODEX_API_KEY'))} OPENAI_API_KEY=${String(hasEnvValue('OPENAI_API_KEY'))}`,
      );

      const chatGptMethod =
        findByIdPart('chatgpt')?.id ?? findByIdPart('login')?.id ?? null;

      if (hasEnvValue('CODEX_API_KEY')) {
        return (
          envVarMethodFor('CODEX_API_KEY')?.id ??
          findByIdPart('codex_api_key')?.id ??
          findByIdPart('codex-api-key')?.id ??
          findByIdPart('api_key')?.id ??
          findByIdPart('apikey')?.id ??
          compatibleEnvMethod?.id ??
          authMethods.find(
            (method) =>
              !method.id.toLowerCase().includes('chatgpt') &&
              !method.id.toLowerCase().includes('login'),
          )?.id ??
          null
        );
      }

      if (chatGptMethod) {
        return chatGptMethod;
      }

      if (hasEnvValue('OPENAI_API_KEY')) {
        return (
          envVarMethodFor('OPENAI_API_KEY')?.id ??
          findByIdPart('openai_api_key')?.id ??
          findByIdPart('openai-api-key')?.id ??
          findByIdPart('openai')?.id ??
          findByIdPart('api_key')?.id ??
          findByIdPart('apikey')?.id ??
          compatibleEnvMethod?.id ??
          authMethods.find(
            (method) =>
              !method.id.toLowerCase().includes('chatgpt') &&
              !method.id.toLowerCase().includes('login'),
          )?.id ??
          null
        );
      }

      return null;
    }

    if (agent.kind === 'claude') {
      console.info(
        `[acp:claude] auth env present ANTHROPIC_AUTH_TOKEN=${String(hasEnvValue('ANTHROPIC_AUTH_TOKEN'))} ANTHROPIC_API_KEY=${String(hasEnvValue('ANTHROPIC_API_KEY'))}`,
      );
      const claudeEnvNames = ['ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_API_KEY'];
      for (const envName of claudeEnvNames) {
        if (hasEnvValue(envName)) {
          return envVarMethodFor(envName)?.id ?? compatibleEnvMethod?.id ?? null;
        }
      }

      return findByIdPart('claude-login')?.id ?? findByIdPart('login')?.id ?? null;
    }

    if (agent.kind === 'custom') {
      if (compatibleEnvMethod?.id) {
        return compatibleEnvMethod.id;
      }

      const loginLikeMethod = authMethods.find((method) => {
        const id = method.id.toLowerCase();
        const name = method.name.toLowerCase();
        return (
          id.includes('login') ||
          id.includes('oauth') ||
          id.includes('authenticate') ||
          name.includes('login') ||
          name.includes('oauth') ||
          name.includes('authenticate')
        );
      });
      if (loginLikeMethod) {
        return loginLikeMethod.id;
      }

      const nonEnvMethod = authMethods.find(
        (method) => !('type' in method) || method.type !== 'env_var',
      );
      return nonEnvMethod?.id ?? authMethods[0]?.id ?? null;
    }

    return null;
  }

  private async resolveAgentLaunchConfig(
    agent: AcpAgentConfig,
    cwd: string,
  ): Promise<AgentProcessLaunchConfig> {
    if (agent.kind === 'custom') {
      return this.toLaunchConfig(agent, cwd);
    }

    if (agent.kind === 'codex') {
      if (agent.config) {
        const launchConfig = this.withCodexChatGptDefaults(
          this.withAdapterThreadLimits(
            await this.toLaunchConfig(agent.config, cwd),
          ),
        );
        await this.ensureCodexHomeExists(launchConfig.env);
        return launchConfig;
      }

      const bundledCodexBinaryPath = this.resolveBundledCodexBinaryPath();
      const bundledCodexLaunchConfig: AgentProcessLaunchConfig | null = bundledCodexBinaryPath
        ? {
            command: bundledCodexBinaryPath,
            args: [],
            cwd: this.resolveLaunchCwd(cwd),
            env: process.env,
          }
        : null;

      const launchConfig = this.withCodexChatGptDefaults(
        this.withAdapterThreadLimits(
          bundledCodexLaunchConfig ??
            this.resolveBundledAdapterLaunchConfig({
              packageName: '@zed-industries/codex-acp',
              binaryName: 'codex-acp',
              cwd,
            }),
        ),
      );
      await this.ensureCodexHomeExists(launchConfig.env);
      return launchConfig;
    }

    if (agent.kind === 'claude') {
      if (agent.config) {
        return this.withClaudeCodeDefaults(
          this.withAdapterThreadLimits(
            await this.toLaunchConfig(agent.config, cwd),
          ),
        );
      }

      return this.withClaudeCodeDefaults(
        this.withAdapterThreadLimits(
          this.resolveBundledAdapterLaunchConfig({
            packageName: '@zed-industries/claude-agent-acp',
            binaryName: 'claude-agent-acp',
            cwd,
          }),
        ),
      );
    }

    const agentScriptPath = await ensureMockAgentScript();
    return {
      command: process.execPath,
      args: [agentScriptPath],
      cwd: this.resolveLaunchCwd(cwd),
      env: process.env,
    };
  }

  private resolveBundledAdapterLaunchConfig({
    packageName,
    binaryName,
    cwd,
  }: {
    packageName: string;
    binaryName: string;
    cwd: string;
  }): AgentProcessLaunchConfig {
    const launchCwd = this.resolveLaunchCwd(cwd);

    const onPathCommand = this.resolveCommandOnPath(binaryName);
    if (onPathCommand) {
      return {
        command: onPathCommand,
        args: [],
        cwd: launchCwd,
        env: process.env,
      };
    }

    const loginShellCommand = this.resolveCommandOnLoginShell(binaryName);
    if (loginShellCommand) {
      return {
        command: loginShellCommand,
        args: [],
        cwd: launchCwd,
        env: process.env,
      };
    }

    const bundledScriptPath = this.resolveBundledAdapterScriptPath(packageName, binaryName);

    if (bundledScriptPath) {
      return {
        command: process.execPath,
        args: [bundledScriptPath],
        cwd: launchCwd,
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: '1',
        },
      };
    }

    return {
      command: binaryName,
      args: [],
      cwd: launchCwd,
      env: process.env,
    };
  }

  private resolveLaunchCwd(candidateCwd?: string): string {
    const isDirectory = (target?: string): target is string => {
      if (!target || target.trim().length === 0) {
        return false;
      }

      try {
        return statSync(target).isDirectory();
      } catch {
        return false;
      }
    };

    if (isDirectory(candidateCwd)) {
      return candidateCwd;
    }

    const fallbackCandidates = [process.cwd(), this.getSystemHomeDirectory(), os.homedir(), '/'];
    const fallbackCwd = fallbackCandidates.find((entry) => isDirectory(entry));
    return fallbackCwd ?? '/';
  }

  private resolveBundledCodexBinaryPath(): string | null {
    const packageName = this.resolveCodexPlatformPackageName();
    if (!packageName) {
      return null;
    }

    const binaryName = process.platform === 'win32' ? 'codex-acp.exe' : 'codex-acp';
    const bundledBinaryPath = this.resolveBundledAdapterScriptPath(packageName, binaryName);
    if (!bundledBinaryPath) {
      return null;
    }

    const unpackedBinaryPath = this.toAsarUnpackedPath(bundledBinaryPath);
    return (
      this.resolveCommandAtAbsolutePath(unpackedBinaryPath) ??
      this.resolveCommandAtAbsolutePath(bundledBinaryPath)
    );
  }

  private resolveCodexPlatformPackageName(): string | null {
    if (process.platform === 'darwin') {
      if (process.arch === 'arm64') {
        return '@zed-industries/codex-acp-darwin-arm64';
      }
      if (process.arch === 'x64') {
        return '@zed-industries/codex-acp-darwin-x64';
      }
      return null;
    }

    if (process.platform === 'linux') {
      if (process.arch === 'arm64') {
        return '@zed-industries/codex-acp-linux-arm64';
      }
      if (process.arch === 'x64') {
        return '@zed-industries/codex-acp-linux-x64';
      }
      return null;
    }

    if (process.platform === 'win32') {
      if (process.arch === 'arm64') {
        return '@zed-industries/codex-acp-win32-arm64';
      }
      if (process.arch === 'x64') {
        return '@zed-industries/codex-acp-win32-x64';
      }
      return null;
    }

    return null;
  }

  private toAsarUnpackedPath(filePath: string): string {
    const asarSegment = `${path.sep}app.asar${path.sep}`;
    if (!filePath.includes(asarSegment)) {
      return filePath;
    }

    return filePath.replace(asarSegment, `${path.sep}app.asar.unpacked${path.sep}`);
  }

  private resolveCommandOnPath(command: string): string | null {
    const pathSegments = new Set<string>(toPathSegments(process.env.PATH));
    if (process.platform !== 'win32') {
      for (const segment of COMMON_POSIX_PATH_SEGMENTS) {
        pathSegments.add(segment);
      }
    }
    if (pathSegments.size === 0) {
      return null;
    }

    const extensions =
      process.platform === 'win32'
        ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM')
            .split(';')
            .map((entry) => entry.trim())
            .filter(Boolean)
        : [''];

    for (const segment of pathSegments.values()) {
      for (const extension of extensions) {
        const candidate = path.join(segment, `${command}${extension}`);
        try {
          const stats = statSync(candidate);
          if (stats.isFile()) {
            return candidate;
          }
        } catch {
          // Keep scanning PATH entries.
        }
      }
    }

    return null;
  }

  private resolveCommandOnLoginShell(command: string): string | null {
    if (process.platform === 'win32') {
      return null;
    }

    const shellCandidates = [
      process.env.SHELL?.trim(),
      '/bin/zsh',
      '/bin/bash',
      '/bin/sh',
    ]
      .filter((entry): entry is string => Boolean(entry && entry.length > 0))
      .map((entry) =>
        entry.includes(path.sep)
          ? this.resolveCommandAtAbsolutePath(entry)
          : this.resolveCommandOnPath(entry),
      )
      .filter((entry): entry is string => Boolean(entry && entry.length > 0));
    const uniqueShellCandidates = Array.from(new Set(shellCandidates));

    for (const shellPath of uniqueShellCandidates) {
      try {
        const result = spawnSync(
          shellPath,
          ['-lc', `command -v ${quotePosixShellArg(command)}`],
          {
            env: process.env,
            encoding: 'utf8',
            timeout: 1500,
            windowsHide: true,
          },
        );

        if (result.status !== 0) {
          continue;
        }

        const candidate = result.stdout
          .split('\n')
          .map((entry) => entry.trim())
          .find((entry) => entry.length > 0);
        if (!candidate || !path.isAbsolute(candidate)) {
          continue;
        }

        const stats = statSync(candidate);
        if (!stats.isFile()) {
          continue;
        }

        return candidate;
      } catch {
        // Keep trying other shell candidates.
      }
    }

    return null;
  }

  private resolvePathValueOnLoginShell(): string | null {
    if (process.platform === 'win32') {
      return null;
    }

    const shellCandidates = [
      process.env.SHELL?.trim(),
      '/bin/zsh',
      '/bin/bash',
      '/bin/sh',
    ]
      .filter((entry): entry is string => Boolean(entry && entry.length > 0))
      .map((entry) =>
        entry.includes(path.sep)
          ? this.resolveCommandAtAbsolutePath(entry)
          : this.resolveCommandOnPath(entry),
      )
      .filter((entry): entry is string => Boolean(entry && entry.length > 0));
    const uniqueShellCandidates = Array.from(new Set(shellCandidates));

    for (const shellPath of uniqueShellCandidates) {
      try {
        const result = spawnSync(shellPath, ['-lc', 'printf %s "$PATH"'], {
          env: process.env,
          encoding: 'utf8',
          timeout: 1500,
          windowsHide: true,
        });

        if (result.status !== 0) {
          continue;
        }

        const pathValue = result.stdout.trim();
        if (pathValue.length > 0) {
          return pathValue;
        }
      } catch {
        // Keep trying other shell candidates.
      }
    }

    return null;
  }

  private withLoginShellIfAvailable(
    launchConfig: AgentProcessLaunchConfig,
  ): AgentProcessLaunchConfig {
    if (process.platform === 'win32') {
      return launchConfig;
    }

    const shellPath = process.env.SHELL;
    if (!shellPath) {
      return launchConfig;
    }

    return {
      command: shellPath,
      args: ['-lc', toPosixShellCommand(launchConfig.command, launchConfig.args)],
      cwd: launchConfig.cwd,
      env: launchConfig.env,
    };
  }

  private resolveBundledAdapterScriptPath(
    packageName: string,
    binaryName: string,
  ): string | null {
    try {
      const packageJsonPath = require.resolve(`${packageName}/package.json`);
      const packageJson = require(packageJsonPath) as {
        bin?: string | Record<string, string>;
      };
      const packageDir = path.dirname(packageJsonPath);

      const binEntry =
        typeof packageJson.bin === 'string'
          ? packageJson.bin
          : packageJson.bin?.[binaryName] ??
            Object.values(packageJson.bin ?? {}).find((value) => typeof value === 'string');

      if (!binEntry || typeof binEntry !== 'string') {
        return null;
      }

      return path.resolve(packageDir, binEntry);
    } catch {
      return null;
    }
  }

  private nextPermissionRequestId(): string {
    this.permissionCounter += 1;
    return `permission-${Date.now()}-${this.permissionCounter}`;
  }

  private resolveAllPermissionRequests(
    response: RequestPermissionResponse,
  ): void {
    for (const pending of this.pendingPermissionRequests.values()) {
      pending.resolve(response);
    }
    this.pendingPermissionRequests.clear();
  }

  private resolvePermissionRequestsForSession(
    sessionId: string,
    response: RequestPermissionResponse,
  ): void {
    for (const [requestId, pending] of this.pendingPermissionRequests.entries()) {
      if (pending.sessionId !== sessionId) {
        continue;
      }

      pending.resolve(response);
      this.pendingPermissionRequests.delete(requestId);
    }
  }
}
