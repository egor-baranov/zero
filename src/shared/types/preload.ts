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
  SkillsDeleteRequest,
  SkillsDeleteResult,
  SkillsListResult,
  SkillsReadRequest,
  SkillsReadResult,
  SkillsWriteRequest,
  SkillsWriteResult,
} from './skills';
import type {
  LspCompletionRequest,
  LspCompletionResult,
  LspDefinitionResult,
  LspDocumentCloseRequest,
  LspDocumentSyncRequest,
  LspDocumentSyncResult,
  LspHoverResult,
  LspReferencesRequest,
  LspReferencesResult,
  LspRendererEvent,
  LspTextDocumentPositionRequest,
} from './lsp';
import type {
  WorkspaceCopyEntryRequest,
  WorkspaceCopyEntryResult,
  WorkspaceDeleteEntryRequest,
  WorkspaceDeleteEntryResult,
  WorkspaceGitCommitRequest,
  WorkspaceDiffFileRequest,
  WorkspaceDiffFileResult,
  WorkspaceGitCheckoutBranchRequest,
  WorkspaceGitCreateBranchRequest,
  WorkspaceGitMutationResult,
    WorkspaceMoveEntryRequest,
    WorkspaceMoveEntryResult,
    WorkspaceGitPushRequest,
    WorkspaceGitStatusRequest,
    WorkspaceGitStatusResult,
    WorkspaceListFilesRequest,
    WorkspaceListFilesResult,
    WorkspaceSearchTextRequest,
    WorkspaceSearchTextResult,
    WorkspaceReadFileRequest,
    WorkspaceReadFileResult,
  WorkspaceWriteFileRequest,
  WorkspaceWriteFileResult,
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
import type {
  VoiceTranscriptionRequest,
  VoiceTranscriptionResult,
} from './voice';
import type { VoiceSettings } from './settings';

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
  workspaceSearchText: (
    request: WorkspaceSearchTextRequest,
  ) => Promise<WorkspaceSearchTextResult>;
  workspaceReadFile: (
    request: WorkspaceReadFileRequest,
  ) => Promise<WorkspaceReadFileResult>;
  workspaceWriteFile: (
    request: WorkspaceWriteFileRequest,
  ) => Promise<WorkspaceWriteFileResult>;
  workspaceDiffFile: (
    request: WorkspaceDiffFileRequest,
  ) => Promise<WorkspaceDiffFileResult>;
  workspaceCopyEntry: (
    request: WorkspaceCopyEntryRequest,
  ) => Promise<WorkspaceCopyEntryResult>;
  workspaceMoveEntry: (
    request: WorkspaceMoveEntryRequest,
  ) => Promise<WorkspaceMoveEntryResult>;
  workspaceDeleteEntry: (
    request: WorkspaceDeleteEntryRequest,
  ) => Promise<WorkspaceDeleteEntryResult>;
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
  settingsGetVoiceSettings: () => Promise<VoiceSettings>;
  settingsSetVoiceSettings: (request: VoiceSettings) => Promise<VoiceSettings>;
  voiceTranscribe: (
    request: VoiceTranscriptionRequest,
  ) => Promise<VoiceTranscriptionResult>;
  workspaceRevealFile: (
    request: WorkspaceRevealFileRequest,
  ) => Promise<WorkspaceRevealFileResult>;
  lspDocumentSync: (
    request: LspDocumentSyncRequest,
  ) => Promise<LspDocumentSyncResult>;
  lspDocumentClose: (
    request: LspDocumentCloseRequest,
  ) => Promise<void>;
  lspHover: (
    request: LspTextDocumentPositionRequest,
  ) => Promise<LspHoverResult>;
  lspCompletion: (
    request: LspCompletionRequest,
  ) => Promise<LspCompletionResult>;
  lspDefinition: (
    request: LspTextDocumentPositionRequest,
  ) => Promise<LspDefinitionResult>;
  lspDeclaration: (
    request: LspTextDocumentPositionRequest,
  ) => Promise<LspDefinitionResult>;
  lspReferences: (
    request: LspReferencesRequest,
  ) => Promise<LspReferencesResult>;
  onLspEvent: (listener: (event: LspRendererEvent) => void) => () => void;
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
  skillsList: () => Promise<SkillsListResult>;
  skillsRead: (request: SkillsReadRequest) => Promise<SkillsReadResult>;
  skillsWrite: (request: SkillsWriteRequest) => Promise<SkillsWriteResult>;
  skillsDelete: (request: SkillsDeleteRequest) => Promise<SkillsDeleteResult>;
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
