import type {
  McpServer,
  PermissionOption,
  RequestPermissionRequest,
  SessionUpdate,
  ToolCallUpdate,
} from '@agentclientprotocol/sdk';

export type AcpConnectionState = 'disconnected' | 'connecting' | 'ready' | 'error';

export interface AcpCustomAgentConfig {
  command: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
}

export type AcpAgentConfig =
  | {
      kind: 'mock';
    }
  | {
      kind: 'codex';
      config?: AcpCustomAgentConfig;
    }
  | {
      kind: 'claude';
      config?: AcpCustomAgentConfig;
    }
  | ({
      kind: 'custom';
    } & AcpCustomAgentConfig);

export interface AcpInitializeRequest {
  cwd: string;
  agent?: AcpAgentConfig;
}

export interface AcpInitializeResult {
  connected: boolean;
  protocolVersion: number;
  loadSessionSupported: boolean;
  agentName: string;
  promptCapabilities: AcpPromptCapabilities;
}

export interface AcpSessionNewRequest {
  cwd: string;
  agent?: AcpAgentConfig;
  mcpServers?: McpServer[];
}

export interface AcpSessionModeOption {
  id: string;
  name: string;
  description?: string | null;
}

export interface AcpSessionModeState {
  currentModeId: string;
  options: AcpSessionModeOption[];
}

export interface AcpSessionModelOption {
  id: string;
  name: string;
  description?: string | null;
}

export interface AcpSessionModelState {
  currentModelId: string;
  options: AcpSessionModelOption[];
}

export interface AcpSessionConfigSelectValue {
  id: string;
  name: string;
  description?: string | null;
  group?: string | null;
}

interface AcpSessionConfigControlBase {
  id: string;
  name: string;
  description?: string | null;
  category?: string | null;
}

export type AcpSessionConfigControl =
  | (AcpSessionConfigControlBase & {
      type: 'select';
      currentValue: string;
      options: AcpSessionConfigSelectValue[];
    })
  | (AcpSessionConfigControlBase & {
      type: 'boolean';
      currentValue: boolean;
    });

export interface AcpSessionControls {
  modeState?: AcpSessionModeState;
  modelState?: AcpSessionModelState;
  configControls: AcpSessionConfigControl[];
}

export interface AcpSessionNewResult {
  sessionId: string;
  controls?: AcpSessionControls;
}

export interface AcpSessionLoadRequest {
  sessionId: string;
  cwd: string;
  agent?: AcpAgentConfig;
  mcpServers?: McpServer[];
}

export interface AcpSessionLoadResult {
  loaded: boolean;
  controls?: AcpSessionControls;
}

export interface AcpPromptCapabilities {
  audio: boolean;
}

export interface AcpPromptAudioContent {
  data: string;
  mimeType: string;
}

export interface AcpPromptRequest {
  sessionId: string;
  text: string;
  attachments?: AcpPromptAttachment[];
  audio?: AcpPromptAudioContent | null;
}

export interface AcpPromptResult {
  stopReason: string;
}

export interface AcpAuthenticateRequest {
  cwd: string;
  agent?: AcpAgentConfig;
  methodId?: string;
}

export interface AcpTerminalAuthLaunchSpec {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
}

export interface AcpAuthenticateResult {
  started: boolean;
  requiresUserAction: boolean;
  methodId: string | null;
  methodName: string | null;
  message: string;
  terminalLaunchSpec?: AcpTerminalAuthLaunchSpec | null;
}

export interface AcpSetSessionModeRequest {
  sessionId: string;
  modeId: string;
}

export interface AcpSetSessionModeResult {
  applied: boolean;
}

export interface AcpSetSessionModelRequest {
  sessionId: string;
  modelId: string;
}

export interface AcpSetSessionModelResult {
  applied: boolean;
}

export type AcpSetSessionConfigOptionRequest =
  | {
      sessionId: string;
      configId: string;
      type: 'select';
      value: string;
    }
  | {
      sessionId: string;
      configId: string;
      type: 'boolean';
      value: boolean;
    };

export interface AcpSetSessionConfigOptionResult {
  applied: boolean;
  controls?: AcpSessionControls;
}

export interface AcpPromptAttachment {
  absolutePath: string;
  relativePath?: string;
  displayPath?: string;
  mimeType?: string;
}

export interface AcpCancelRequest {
  sessionId: string;
}

export type AcpPermissionDecision =
  | {
      outcome: 'cancelled';
    }
  | {
      outcome: 'selected';
      optionId: string;
    };

export interface AcpRespondPermissionRequest {
  requestId: string;
  decision: AcpPermissionDecision;
}

export interface AcpRespondPermissionResult {
  handled: boolean;
}

export interface AcpSessionUpdateEvent {
  type: 'session-update';
  sessionId: string;
  update: SessionUpdate;
}

export interface AcpPermissionRequestEvent {
  type: 'permission-request';
  requestId: string;
  sessionId: string;
  toolCall: ToolCallUpdate;
  options: PermissionOption[];
}

export interface AcpConnectionStateEvent {
  type: 'connection-state';
  state: AcpConnectionState;
  message?: string;
}

export type AcpRendererEvent =
  | AcpSessionUpdateEvent
  | AcpPermissionRequestEvent
  | AcpConnectionStateEvent;

export const isAcpPermissionRequest = (
  value: AcpRendererEvent,
): value is AcpPermissionRequestEvent => value.type === 'permission-request';

export const toAcpPermissionEvent = (
  requestId: string,
  request: RequestPermissionRequest,
): AcpPermissionRequestEvent => ({
  type: 'permission-request',
  requestId,
  sessionId: request.sessionId,
  toolCall: request.toolCall,
  options: request.options,
});
