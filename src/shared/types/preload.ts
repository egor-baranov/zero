import type {
  AcpAuthenticateRequest,
  AcpAuthenticateResult,
  AcpCancelRequest,
  AcpInitializeRequest,
  AcpInitializeResult,
  AcpPromptRequest,
  AcpPromptResult,
  AcpRendererEvent,
  AcpRespondPermissionRequest,
  AcpRespondPermissionResult,
  AcpSetSessionConfigOptionRequest,
  AcpSetSessionConfigOptionResult,
  AcpSetSessionModeRequest,
  AcpSetSessionModeResult,
  AcpSetSessionModelRequest,
  AcpSetSessionModelResult,
  AcpSessionLoadRequest,
  AcpSessionLoadResult,
  AcpSessionNewRequest,
  AcpSessionNewResult,
} from './acp';
import type {
  WorkspaceGitCommitRequest,
  WorkspaceDiffFileRequest,
  WorkspaceDiffFileResult,
  WorkspaceGitCheckoutBranchRequest,
  WorkspaceGitCreateBranchRequest,
  WorkspaceGitMutationResult,
  WorkspaceGitPushRequest,
  WorkspaceGitStatusRequest,
  WorkspaceGitStatusResult,
  WorkspaceListFilesRequest,
  WorkspaceListFilesResult,
  WorkspaceReadFileRequest,
  WorkspaceReadFileResult,
  WorkspaceRevealFileRequest,
  WorkspaceRevealFileResult,
} from './workspace';
import type {
  TerminalCloseRequest,
  TerminalCreateRequest,
  TerminalCreateResult,
  TerminalEvent,
  TerminalResizeRequest,
  TerminalWriteRequest,
} from './terminal';
import type {
  UpdaterActionResult,
  UpdaterRendererEvent,
  UpdaterState,
} from './updater';

export interface OpenFolderResult {
  canceled: boolean;
  path: string | null;
}

export interface OpenAttachmentFileRequest {
  workspacePath: string;
}

export interface OpenAttachmentFileResult {
  canceled: boolean;
  absolutePath: string | null;
  relativePath: string | null;
}

export interface ReadAttachmentPreviewRequest {
  absolutePath: string;
}

export interface ReadAttachmentPreviewResult {
  dataUrl: string | null;
  mimeType: string | null;
}

export interface DesktopApi {
  platform: NodeJS.Platform;
  getPathForFile: (file: File) => string | null;
  openFolder: () => Promise<OpenFolderResult>;
  openAttachmentFile: (
    request: OpenAttachmentFileRequest,
  ) => Promise<OpenAttachmentFileResult>;
  readAttachmentPreview: (
    request: ReadAttachmentPreviewRequest,
  ) => Promise<ReadAttachmentPreviewResult>;
  workspaceListFiles: (
    request: WorkspaceListFilesRequest,
  ) => Promise<WorkspaceListFilesResult>;
  workspaceReadFile: (
    request: WorkspaceReadFileRequest,
  ) => Promise<WorkspaceReadFileResult>;
  workspaceDiffFile: (
    request: WorkspaceDiffFileRequest,
  ) => Promise<WorkspaceDiffFileResult>;
  workspaceGitStatus: (
    request: WorkspaceGitStatusRequest,
  ) => Promise<WorkspaceGitStatusResult>;
  workspaceGitCheckoutBranch: (
    request: WorkspaceGitCheckoutBranchRequest,
  ) => Promise<WorkspaceGitMutationResult>;
  workspaceGitCreateBranch: (
    request: WorkspaceGitCreateBranchRequest,
  ) => Promise<WorkspaceGitMutationResult>;
  workspaceGitCommit: (
    request: WorkspaceGitCommitRequest,
  ) => Promise<WorkspaceGitMutationResult>;
  workspaceGitPush: (
    request: WorkspaceGitPushRequest,
  ) => Promise<WorkspaceGitMutationResult>;
  workspaceRevealFile: (
    request: WorkspaceRevealFileRequest,
  ) => Promise<WorkspaceRevealFileResult>;
  acpInitialize: (request: AcpInitializeRequest) => Promise<AcpInitializeResult>;
  acpSessionNew: (request: AcpSessionNewRequest) => Promise<AcpSessionNewResult>;
  acpSessionLoad: (request: AcpSessionLoadRequest) => Promise<AcpSessionLoadResult>;
  acpSessionSetMode: (
    request: AcpSetSessionModeRequest,
  ) => Promise<AcpSetSessionModeResult>;
  acpSessionSetModel: (
    request: AcpSetSessionModelRequest,
  ) => Promise<AcpSetSessionModelResult>;
  acpSessionSetConfigOption: (
    request: AcpSetSessionConfigOptionRequest,
  ) => Promise<AcpSetSessionConfigOptionResult>;
  acpAuthenticate: (request: AcpAuthenticateRequest) => Promise<AcpAuthenticateResult>;
  acpPrompt: (request: AcpPromptRequest) => Promise<AcpPromptResult>;
  acpCancel: (request: AcpCancelRequest) => Promise<void>;
  acpRespondPermission: (
    request: AcpRespondPermissionRequest,
  ) => Promise<AcpRespondPermissionResult>;
  onAcpEvent: (listener: (event: AcpRendererEvent) => void) => () => void;
  terminalCreate: (request: TerminalCreateRequest) => Promise<TerminalCreateResult>;
  terminalWrite: (request: TerminalWriteRequest) => Promise<void>;
  terminalResize: (request: TerminalResizeRequest) => Promise<void>;
  terminalClose: (request: TerminalCloseRequest) => Promise<void>;
  onTerminalEvent: (listener: (event: TerminalEvent) => void) => () => void;
  updaterGetState: () => Promise<UpdaterState>;
  updaterCheckForUpdates: () => Promise<UpdaterActionResult>;
  updaterInstallDownloadedUpdate: () => Promise<UpdaterActionResult>;
  onUpdaterEvent: (listener: (event: UpdaterRendererEvent) => void) => () => void;
}
