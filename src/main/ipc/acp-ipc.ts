import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@shared/contracts/ipc';
import type {
  AcpAuthenticateRequest,
  AcpCancelRequest,
  AcpInitializeRequest,
  AcpPromptRequest,
  AcpRespondPermissionRequest,
  AcpSetSessionConfigOptionRequest,
  AcpSetSessionModeRequest,
  AcpSetSessionModelRequest,
  AcpSessionLoadRequest,
  AcpSessionNewRequest,
} from '@shared/types/acp';
import type { AcpService } from '../services/acp/acp-service';

export const registerAcpIpc = (acpService: AcpService): void => {
  ipcMain.handle(IPC_CHANNELS.acpInitialize, (_event, request: AcpInitializeRequest) =>
    acpService.initialize(request),
  );

  ipcMain.handle(IPC_CHANNELS.acpSessionNew, (_event, request: AcpSessionNewRequest) =>
    acpService.newSession(request),
  );

  ipcMain.handle(IPC_CHANNELS.acpSessionLoad, (_event, request: AcpSessionLoadRequest) =>
    acpService.loadSession(request),
  );

  ipcMain.handle(
    IPC_CHANNELS.acpSessionSetMode,
    (_event, request: AcpSetSessionModeRequest) => acpService.setSessionMode(request),
  );

  ipcMain.handle(
    IPC_CHANNELS.acpSessionSetModel,
    (_event, request: AcpSetSessionModelRequest) => acpService.setSessionModel(request),
  );

  ipcMain.handle(
    IPC_CHANNELS.acpSessionSetConfigOption,
    (_event, request: AcpSetSessionConfigOptionRequest) =>
      acpService.setSessionConfigOption(request),
  );

  ipcMain.handle(IPC_CHANNELS.acpAuthenticate, (_event, request: AcpAuthenticateRequest) =>
    acpService.authenticate(request),
  );

  ipcMain.handle(IPC_CHANNELS.acpPrompt, (_event, request: AcpPromptRequest) =>
    acpService.prompt(request),
  );

  ipcMain.handle(IPC_CHANNELS.acpCancel, (_event, request: AcpCancelRequest) =>
    acpService.cancel(request),
  );

  ipcMain.handle(
    IPC_CHANNELS.acpRespondPermission,
    (_event, request: AcpRespondPermissionRequest) =>
      acpService.respondPermission(request),
  );
};
