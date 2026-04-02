import { ipcRenderer, webUtils, type IpcRendererEvent } from 'electron';
import { IPC_CHANNELS } from '@shared/contracts/ipc';
import type {
  AcpAuthenticateRequest,
  AcpAuthenticateResult,
  AcpCancelRequest,
  AcpInitializeRequest,
  AcpInitializeResult,
  AcpPrepareAgentRequest,
  AcpPrepareAgentResult,
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
} from '@shared/types/acp';
import type {
  SkillsCatalogDetailRequest,
  SkillsCatalogDetailResult,
  SkillsDeleteRequest,
  SkillsDeleteResult,
  SkillsInstallRequest,
  SkillsInstallResult,
  SkillsReadRequest,
  SkillsReadResult,
  SkillsWriteRequest,
  SkillsWriteResult,
} from '@shared/types/skills';
import type {
  LspCompletionRequest,
  LspCompletionResult,
  LspDeleteServerRequest,
  LspDefinitionResult,
  LspDocumentCloseRequest,
  LspDocumentSyncRequest,
  LspDocumentSyncResult,
  LspHoverResult,
  LspInstallServerRequest,
  LspListServersResult,
  LspReferencesRequest,
  LspReferencesResult,
  LspRendererEvent,
  LspServerMutationResult,
  LspSemanticTokensRequest,
  LspSemanticTokensResult,
  LspTextDocumentPositionRequest,
} from '@shared/types/lsp';
import type {
  DesktopApi,
  OpenAttachmentFileRequest,
  OpenAttachmentFileResult,
  OpenFolderResult,
  ReadAttachmentPreviewRequest,
  ReadAttachmentPreviewResult,
} from '@shared/types/preload';
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
} from '@shared/types/workspace';
import type {
  TerminalCloseRequest,
  TerminalCreateRequest,
  TerminalCreateResult,
  TerminalEvent,
  TerminalResizeRequest,
  TerminalWriteRequest,
} from '@shared/types/terminal';
import type {
  UpdaterActionResult,
  UpdaterRendererEvent,
  UpdaterState,
} from '@shared/types/updater';
import type { VoiceSettings } from '@shared/types/settings';
import type {
  VoiceTranscriptionRequest,
  VoiceTranscriptionResult,
} from '@shared/types/voice';

export const desktopApi: DesktopApi = {
  platform: process.platform,
  getPathForFile: (file: File): string | null => {
    try {
      const resolvedPath = webUtils.getPathForFile(file).trim();
      return resolvedPath.length > 0 ? resolvedPath : null;
    } catch {
      return null;
    }
  },
  openFolder: async (): Promise<OpenFolderResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.shellOpenFolder),
  openAttachmentFile: (
    request: OpenAttachmentFileRequest,
  ): Promise<OpenAttachmentFileResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.shellOpenAttachmentFile, request),
  readAttachmentPreview: (
    request: ReadAttachmentPreviewRequest,
  ): Promise<ReadAttachmentPreviewResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.shellReadAttachmentPreview, request),
  workspaceListFiles: (
    request: WorkspaceListFilesRequest,
  ): Promise<WorkspaceListFilesResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.workspaceListFiles, request),
  workspaceSearchText: (
    request: WorkspaceSearchTextRequest,
  ): Promise<WorkspaceSearchTextResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.workspaceSearchText, request),
  workspaceReadFile: (
    request: WorkspaceReadFileRequest,
  ): Promise<WorkspaceReadFileResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.workspaceReadFile, request),
  workspaceWriteFile: (
    request: WorkspaceWriteFileRequest,
  ): Promise<WorkspaceWriteFileResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.workspaceWriteFile, request),
  workspaceDiffFile: (
    request: WorkspaceDiffFileRequest,
  ): Promise<WorkspaceDiffFileResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.workspaceDiffFile, request),
  workspaceCopyEntry: (
    request: WorkspaceCopyEntryRequest,
  ): Promise<WorkspaceCopyEntryResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.workspaceCopyEntry, request),
  workspaceMoveEntry: (
    request: WorkspaceMoveEntryRequest,
  ): Promise<WorkspaceMoveEntryResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.workspaceMoveEntry, request),
  workspaceDeleteEntry: (
    request: WorkspaceDeleteEntryRequest,
  ): Promise<WorkspaceDeleteEntryResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.workspaceDeleteEntry, request),
  workspaceGitStatus: (
    request: WorkspaceGitStatusRequest,
  ): Promise<WorkspaceGitStatusResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.workspaceGitStatus, request),
  workspaceGitCheckoutBranch: (
    request: WorkspaceGitCheckoutBranchRequest,
  ): Promise<WorkspaceGitMutationResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.workspaceGitCheckoutBranch, request),
  workspaceGitCreateBranch: (
    request: WorkspaceGitCreateBranchRequest,
  ): Promise<WorkspaceGitMutationResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.workspaceGitCreateBranch, request),
  workspaceGitCommit: (
    request: WorkspaceGitCommitRequest,
  ): Promise<WorkspaceGitMutationResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.workspaceGitCommit, request),
  workspaceGitPush: (
    request: WorkspaceGitPushRequest,
  ): Promise<WorkspaceGitMutationResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.workspaceGitPush, request),
  settingsGetVoiceSettings: (): Promise<VoiceSettings> =>
    ipcRenderer.invoke(IPC_CHANNELS.settingsGetVoiceSettings),
  settingsSetVoiceSettings: (request: VoiceSettings): Promise<VoiceSettings> =>
    ipcRenderer.invoke(IPC_CHANNELS.settingsSetVoiceSettings, request),
  voiceTranscribe: (
    request: VoiceTranscriptionRequest,
  ): Promise<VoiceTranscriptionResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.voiceTranscribe, request),
  workspaceRevealFile: (
    request: WorkspaceRevealFileRequest,
  ): Promise<WorkspaceRevealFileResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.workspaceRevealFile, request),
  lspDocumentSync: (
    request: LspDocumentSyncRequest,
  ): Promise<LspDocumentSyncResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.lspDocumentSync, request),
  lspDocumentClose: (
    request: LspDocumentCloseRequest,
  ): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.lspDocumentClose, request),
  lspHover: (
    request: LspTextDocumentPositionRequest,
  ): Promise<LspHoverResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.lspHover, request),
  lspCompletion: (
    request: LspCompletionRequest,
  ): Promise<LspCompletionResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.lspCompletion, request),
  lspSemanticTokens: (
    request: LspSemanticTokensRequest,
  ): Promise<LspSemanticTokensResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.lspSemanticTokens, request),
  lspDefinition: (
    request: LspTextDocumentPositionRequest,
  ): Promise<LspDefinitionResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.lspDefinition, request),
  lspDeclaration: (
    request: LspTextDocumentPositionRequest,
  ): Promise<LspDefinitionResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.lspDeclaration, request),
  lspReferences: (
    request: LspReferencesRequest,
  ): Promise<LspReferencesResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.lspReferences, request),
  lspListServers: (): Promise<LspListServersResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.lspListServers),
  lspInstallServer: (
    request: LspInstallServerRequest,
  ): Promise<LspServerMutationResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.lspInstallServer, request),
  lspDeleteServer: (
    request: LspDeleteServerRequest,
  ): Promise<LspServerMutationResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.lspDeleteServer, request),
  onLspEvent: (listener: (event: LspRendererEvent) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, payload: LspRendererEvent) => {
      listener(payload);
    };

    ipcRenderer.on(IPC_CHANNELS.lspEvent, handler);

    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.lspEvent, handler);
    };
  },
  acpInitialize: (request: AcpInitializeRequest): Promise<AcpInitializeResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.acpInitialize, request),
  acpPrepareAgent: (request: AcpPrepareAgentRequest): Promise<AcpPrepareAgentResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.acpPrepareAgent, request),
  acpSessionNew: (request: AcpSessionNewRequest): Promise<AcpSessionNewResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.acpSessionNew, request),
  acpSessionLoad: (request: AcpSessionLoadRequest): Promise<AcpSessionLoadResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.acpSessionLoad, request),
  acpSessionSetMode: (
    request: AcpSetSessionModeRequest,
  ): Promise<AcpSetSessionModeResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.acpSessionSetMode, request),
  acpSessionSetModel: (
    request: AcpSetSessionModelRequest,
  ): Promise<AcpSetSessionModelResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.acpSessionSetModel, request),
  acpSessionSetConfigOption: (
    request: AcpSetSessionConfigOptionRequest,
  ): Promise<AcpSetSessionConfigOptionResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.acpSessionSetConfigOption, request),
  acpAuthenticate: (request: AcpAuthenticateRequest): Promise<AcpAuthenticateResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.acpAuthenticate, request),
  acpPrompt: (request: AcpPromptRequest): Promise<AcpPromptResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.acpPrompt, request),
  acpCancel: (request: AcpCancelRequest): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.acpCancel, request),
  acpRespondPermission: (
    request: AcpRespondPermissionRequest,
  ): Promise<AcpRespondPermissionResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.acpRespondPermission, request),
  onAcpEvent: (listener: (event: AcpRendererEvent) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, payload: AcpRendererEvent) => {
      listener(payload);
    };

    ipcRenderer.on(IPC_CHANNELS.acpEvent, handler);

    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.acpEvent, handler);
    };
  },
  skillsList: () => ipcRenderer.invoke(IPC_CHANNELS.skillsList),
  skillsCatalog: () => ipcRenderer.invoke(IPC_CHANNELS.skillsCatalog),
  skillsCatalogDetail: (request: SkillsCatalogDetailRequest): Promise<SkillsCatalogDetailResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.skillsCatalogDetail, request),
  skillsRead: (request: SkillsReadRequest): Promise<SkillsReadResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.skillsRead, request),
  skillsWrite: (request: SkillsWriteRequest): Promise<SkillsWriteResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.skillsWrite, request),
  skillsDelete: (request: SkillsDeleteRequest): Promise<SkillsDeleteResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.skillsDelete, request),
  skillsInstall: (request: SkillsInstallRequest): Promise<SkillsInstallResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.skillsInstall, request),
  terminalCreate: (request: TerminalCreateRequest): Promise<TerminalCreateResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.terminalCreate, request),
  terminalWrite: (request: TerminalWriteRequest): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.terminalWrite, request),
  terminalResize: (request: TerminalResizeRequest): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.terminalResize, request),
  terminalClose: (request: TerminalCloseRequest): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.terminalClose, request),
  onTerminalEvent: (listener: (event: TerminalEvent) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, payload: TerminalEvent) => {
      listener(payload);
    };

    ipcRenderer.on(IPC_CHANNELS.terminalEvent, handler);

    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.terminalEvent, handler);
    };
  },
  updaterGetState: (): Promise<UpdaterState> =>
    ipcRenderer.invoke(IPC_CHANNELS.updaterGetState),
  updaterCheckForUpdates: (): Promise<UpdaterActionResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.updaterCheckForUpdates),
  updaterInstallDownloadedUpdate: (): Promise<UpdaterActionResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.updaterInstallDownloadedUpdate),
  onUpdaterEvent: (listener: (event: UpdaterRendererEvent) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, payload: UpdaterRendererEvent) => {
      listener(payload);
    };

    ipcRenderer.on(IPC_CHANNELS.updaterEvent, handler);

    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.updaterEvent, handler);
    };
  },
};
