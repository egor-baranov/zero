import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@shared/contracts/ipc';
import type {
  WorkspaceCopyEntryRequest,
  WorkspaceDeleteEntryRequest,
  WorkspaceGitCommitRequest,
  WorkspaceDiffFileRequest,
  WorkspaceGitCheckoutBranchRequest,
  WorkspaceGitCreateBranchRequest,
  WorkspaceGitPushRequest,
  WorkspaceMoveEntryRequest,
  WorkspaceGitStatusRequest,
  WorkspaceListFilesRequest,
  WorkspaceReadFileRequest,
  WorkspaceWriteFileRequest,
  WorkspaceRevealFileRequest,
} from '@shared/types/workspace';
import type { WorkspaceService } from '../services/workspace/workspace-service';

export const registerWorkspaceIpc = (workspaceService: WorkspaceService): void => {
  ipcMain.handle(
    IPC_CHANNELS.workspaceListFiles,
    (_event, request: WorkspaceListFilesRequest) => workspaceService.listFiles(request),
  );

  ipcMain.handle(
    IPC_CHANNELS.workspaceReadFile,
    (_event, request: WorkspaceReadFileRequest) => workspaceService.readFile(request),
  );

  ipcMain.handle(
    IPC_CHANNELS.workspaceWriteFile,
    (_event, request: WorkspaceWriteFileRequest) => workspaceService.writeFile(request),
  );

  ipcMain.handle(
    IPC_CHANNELS.workspaceDiffFile,
    (_event, request: WorkspaceDiffFileRequest) => workspaceService.diffFile(request),
  );

  ipcMain.handle(
    IPC_CHANNELS.workspaceRevealFile,
    (_event, request: WorkspaceRevealFileRequest) => workspaceService.revealFile(request),
  );

  ipcMain.handle(
    IPC_CHANNELS.workspaceCopyEntry,
    (_event, request: WorkspaceCopyEntryRequest) => workspaceService.copyEntry(request),
  );

  ipcMain.handle(
    IPC_CHANNELS.workspaceMoveEntry,
    (_event, request: WorkspaceMoveEntryRequest) => workspaceService.moveEntry(request),
  );

  ipcMain.handle(
    IPC_CHANNELS.workspaceDeleteEntry,
    (_event, request: WorkspaceDeleteEntryRequest) => workspaceService.deleteEntry(request),
  );

  ipcMain.handle(
    IPC_CHANNELS.workspaceGitStatus,
    (_event, request: WorkspaceGitStatusRequest) => workspaceService.gitStatus(request),
  );

  ipcMain.handle(
    IPC_CHANNELS.workspaceGitCheckoutBranch,
    (_event, request: WorkspaceGitCheckoutBranchRequest) => workspaceService.checkoutBranch(request),
  );

  ipcMain.handle(
    IPC_CHANNELS.workspaceGitCreateBranch,
    (_event, request: WorkspaceGitCreateBranchRequest) => workspaceService.createBranch(request),
  );

  ipcMain.handle(
    IPC_CHANNELS.workspaceGitCommit,
    (_event, request: WorkspaceGitCommitRequest) => workspaceService.commit(request),
  );

  ipcMain.handle(
    IPC_CHANNELS.workspaceGitPush,
    (_event, request: WorkspaceGitPushRequest) => workspaceService.push(request),
  );
};
