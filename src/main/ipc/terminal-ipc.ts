import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@shared/contracts/ipc';
import type {
  TerminalCloseRequest,
  TerminalCreateRequest,
  TerminalResizeRequest,
  TerminalWriteRequest,
} from '@shared/types/terminal';
import type { TerminalService } from '../services/terminal/terminal-service';

export const registerTerminalIpc = (terminalService: TerminalService): void => {
  ipcMain.handle(
    IPC_CHANNELS.terminalCreate,
    (_event, request: TerminalCreateRequest) => terminalService.create(request),
  );

  ipcMain.handle(
    IPC_CHANNELS.terminalWrite,
    (_event, request: TerminalWriteRequest) => terminalService.write(request),
  );

  ipcMain.handle(
    IPC_CHANNELS.terminalResize,
    (_event, request: TerminalResizeRequest) => terminalService.resize(request),
  );

  ipcMain.handle(
    IPC_CHANNELS.terminalClose,
    (_event, request: TerminalCloseRequest) => terminalService.close(request),
  );
};
