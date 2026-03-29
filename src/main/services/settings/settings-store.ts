import { app } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type {
  AppSettings,
  VoiceSettings,
  WindowBoundsState,
} from '@shared/types/settings';

const SETTINGS_FILE = 'settings.json';

export class SettingsStore {
  private readonly settingsPath = path.join(app.getPath('userData'), SETTINGS_FILE);
  private cache: AppSettings | null = null;

  public async getWindowBounds(): Promise<WindowBoundsState | undefined> {
    const settings = await this.read();
    return settings.windowBounds;
  }

  public async setWindowBounds(bounds: WindowBoundsState): Promise<void> {
    const settings = await this.read();
    settings.windowBounds = bounds;
    await this.write(settings);
  }

  public async getVoiceSettings(): Promise<VoiceSettings> {
    const settings = await this.read();
    return {
      openAiApiKey: settings.voice?.openAiApiKey?.trim() ?? '',
    };
  }

  public async setVoiceSettings(nextVoiceSettings: VoiceSettings): Promise<VoiceSettings> {
    const settings = await this.read();
    const openAiApiKey = nextVoiceSettings.openAiApiKey.trim();

    if (openAiApiKey.length > 0) {
      settings.voice = {
        ...settings.voice,
        openAiApiKey,
      };
    } else if (settings.voice) {
      delete settings.voice.openAiApiKey;
      if (Object.keys(settings.voice).length === 0) {
        delete settings.voice;
      }
    }

    await this.write(settings);

    return {
      openAiApiKey,
    };
  }

  private async read(): Promise<AppSettings> {
    if (this.cache) {
      return this.cache;
    }

    try {
      const raw = await fs.readFile(this.settingsPath, 'utf8');
      if (raw.trim().length === 0) {
        const defaults: AppSettings = {};
        this.cache = defaults;
        await this.write(defaults);
        return defaults;
      }

      const parsed = JSON.parse(raw) as unknown;
      if (!this.isSettingsShape(parsed)) {
        throw new Error('Invalid settings payload');
      }

      this.cache = parsed;
      return parsed;
    } catch (error: unknown) {
      if (this.isMissingFile(error)) {
        this.cache = {};
        return this.cache;
      }

      this.cache = {};
      await this.write(this.cache);
      return this.cache;
    }
  }

  private async write(settings: AppSettings): Promise<void> {
    this.cache = settings;
    await fs.mkdir(path.dirname(this.settingsPath), { recursive: true });
    await fs.writeFile(this.settingsPath, JSON.stringify(settings, null, 2), 'utf8');
  }

  private isMissingFile(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'ENOENT'
    );
  }

  private isSettingsShape(value: unknown): value is AppSettings {
    if (typeof value !== 'object' || value === null) {
      return false;
    }

    const typedValue = value as {
      windowBounds?: unknown;
      voice?: unknown;
    };

    if ('windowBounds' in typedValue) {
      const windowBounds = typedValue.windowBounds;
      if (windowBounds !== undefined) {
        if (typeof windowBounds !== 'object' || windowBounds === null) {
          return false;
        }

        const parsed = windowBounds as Partial<WindowBoundsState>;
        if (
          typeof parsed.width !== 'number' ||
          typeof parsed.height !== 'number' ||
          typeof parsed.isMaximized !== 'boolean'
        ) {
          return false;
        }
      }
    }

    if ('voice' in typedValue) {
      const voice = typedValue.voice;
      if (voice !== undefined) {
        if (typeof voice !== 'object' || voice === null) {
          return false;
        }

        const parsedVoice = voice as { openAiApiKey?: unknown };
        if (
          'openAiApiKey' in parsedVoice &&
          parsedVoice.openAiApiKey !== undefined &&
          typeof parsedVoice.openAiApiKey !== 'string'
        ) {
          return false;
        }
      }
    }

    return true;
  }
}
