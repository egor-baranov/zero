import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@shared/contracts/ipc';
import type { UpdaterService } from '../services/updater/updater-service';

export const registerUpdaterIpc = (updaterService: UpdaterService): void => {
  ipcMain.handle(IPC_CHANNELS.updaterGetState, () => updaterService.getState());

  ipcMain.handle(IPC_CHANNELS.updaterCheckForUpdates, () =>
    updaterService.checkForUpdates(true),
  );

  ipcMain.handle(IPC_CHANNELS.updaterInstallDownloadedUpdate, () =>
    updaterService.installDownloadedUpdate(),
  );
};
