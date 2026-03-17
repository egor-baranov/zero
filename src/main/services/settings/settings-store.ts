import { app } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { AppSettings, WindowBoundsState } from '@shared/types/settings';

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

    if (!('windowBounds' in value)) {
      return true;
    }

    const windowBounds = (value as { windowBounds?: unknown }).windowBounds;
    if (windowBounds === undefined) {
      return true;
    }

    if (typeof windowBounds !== 'object' || windowBounds === null) {
      return false;
    }

    const parsed = windowBounds as Partial<WindowBoundsState>;
    return (
      typeof parsed.width === 'number' &&
      typeof parsed.height === 'number' &&
      typeof parsed.isMaximized === 'boolean'
    );
  }
}
