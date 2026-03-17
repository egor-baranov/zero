import { ipcRenderer, webUtils, type IpcRendererEvent } from 'electron';
import { IPC_CHANNELS } from '@shared/contracts/ipc';
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
} from '@shared/types/acp';
import type {
  DesktopApi,
  OpenAttachmentFileRequest,
  OpenAttachmentFileResult,
  OpenFolderResult,
  ReadAttachmentPreviewRequest,
  ReadAttachmentPreviewResult,
} from '@shared/types/preload';
import type {
  WorkspaceDiffFileRequest,
  WorkspaceDiffFileResult,
  WorkspaceGitCheckoutBranchRequest,
  WorkspaceGitCreateBranchRequest,
  WorkspaceGitMutationResult,
  WorkspaceGitStatusRequest,
  WorkspaceGitStatusResult,
  WorkspaceListFilesRequest,
  WorkspaceListFilesResult,
  WorkspaceReadFileRequest,
  WorkspaceReadFileResult,
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
  workspaceReadFile: (
    request: WorkspaceReadFileRequest,
  ): Promise<WorkspaceReadFileResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.workspaceReadFile, request),
  workspaceDiffFile: (
    request: WorkspaceDiffFileRequest,
  ): Promise<WorkspaceDiffFileResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.workspaceDiffFile, request),
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
  workspaceRevealFile: (
    request: WorkspaceRevealFileRequest,
  ): Promise<WorkspaceRevealFileResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.workspaceRevealFile, request),
  acpInitialize: (request: AcpInitializeRequest): Promise<AcpInitializeResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.acpInitialize, request),
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
