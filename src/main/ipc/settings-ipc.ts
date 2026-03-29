import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@shared/contracts/ipc';
import type { VoiceSettings } from '@shared/types/settings';
import type { SettingsStore } from '../services/settings/settings-store';

export const registerSettingsIpc = (settingsStore: SettingsStore): void => {
  ipcMain.handle(IPC_CHANNELS.settingsGetVoiceSettings, () =>
    settingsStore.getVoiceSettings(),
  );
  ipcMain.handle(
    IPC_CHANNELS.settingsSetVoiceSettings,
    (_event, request: VoiceSettings) => settingsStore.setVoiceSettings(request),
  );
};
