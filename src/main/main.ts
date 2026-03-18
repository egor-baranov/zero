import { app, BrowserWindow } from 'electron';
import { existsSync } from 'node:fs';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import { IPC_CHANNELS } from '@shared/contracts/ipc';
import { registerAcpIpc } from './ipc/acp-ipc';
import { registerShellIpc } from './ipc/shell-ipc';
import { registerTerminalIpc } from './ipc/terminal-ipc';
import { registerUpdaterIpc } from './ipc/updater-ipc';
import { registerWorkspaceIpc } from './ipc/workspace-ipc';
import { AcpService } from './services/acp/acp-service';
import { SettingsStore } from './services/settings/settings-store';
import { TerminalService } from './services/terminal/terminal-service';
import { UpdaterService } from './services/updater/updater-service';
import { WorkspaceService } from './services/workspace/workspace-service';
import { createMainWindow } from './window';

if (started) {
  app.quit();
}

app.setName('Zero');

const resolveAppIconPath = (): string | null => {
  const appPath = app.getAppPath();
  const candidates = [
    path.join(process.cwd(), 'assets/icons/zero-icon.png'),
    path.join(appPath, 'assets/icons/zero-icon.png'),
    path.join(process.cwd(), 'src/renderer/assets/zero-icon.png'),
    path.join(appPath, 'src/renderer/assets/zero-icon.png'),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
};

const applyMacAppIcon = (): void => {
  if (process.platform !== 'darwin' || !app.dock || app.isPackaged) {
    return;
  }

  const iconPath = resolveAppIconPath();
  if (!iconPath) {
    return;
  }

  app.dock.setIcon(iconPath);
};

const settingsStore = new SettingsStore();
const acpService = new AcpService();
const workspaceService = new WorkspaceService();
const terminalService = new TerminalService();
const updaterService = new UpdaterService();

acpService.onEvent((event) => {
  const windows = BrowserWindow.getAllWindows();

  for (const window of windows) {
    if (!window.isDestroyed()) {
      window.webContents.send(IPC_CHANNELS.acpEvent, event);
    }
  }
});

terminalService.onEvent((event) => {
  const windows = BrowserWindow.getAllWindows();

  for (const window of windows) {
    if (!window.isDestroyed()) {
      window.webContents.send(IPC_CHANNELS.terminalEvent, event);
    }
  }
});

updaterService.onEvent((event) => {
  const windows = BrowserWindow.getAllWindows();

  for (const window of windows) {
    if (!window.isDestroyed()) {
      window.webContents.send(IPC_CHANNELS.updaterEvent, event);
    }
  }
});

const bootstrap = async (): Promise<void> => {
  registerShellIpc();
  registerWorkspaceIpc(workspaceService);
  registerAcpIpc(acpService);
  registerTerminalIpc(terminalService);
  registerUpdaterIpc(updaterService);
  await createMainWindow(settingsStore);
  updaterService.start();
};

app.on('ready', () => {
  applyMacAppIcon();
  void bootstrap().catch((error: unknown) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    // Prevent unhandled promise rejections from leaving the app in a blank state.
    console.error('Failed to bootstrap app:', message);
  });
});

app.on('window-all-closed', () => {
  terminalService.disposeAll();

  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  terminalService.disposeAll();
  updaterService.dispose();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void createMainWindow(settingsStore).catch((error: unknown) => {
      const message = error instanceof Error ? error.stack ?? error.message : String(error);
      console.error('Failed to create main window:', message);
    });
  }
});
