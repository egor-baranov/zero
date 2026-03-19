import { app } from 'electron';
import { autoUpdater, type ProgressInfo, type UpdateInfo } from 'electron-updater';
import packageJson from '../../../../package.json';
import type {
  UpdaterActionResult,
  UpdaterRendererEvent,
  UpdaterState,
} from '@shared/types/updater';

const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
const INITIAL_UPDATE_CHECK_DELAY_MS = 8_000;

interface PackageJsonLike {
  repository?: string | { url?: string };
}

const toRepositoryUrlFromPackageJson = (
  repositoryField: PackageJsonLike['repository'],
): string => {
  if (typeof repositoryField === 'string') {
    return repositoryField.trim();
  }

  if (
    repositoryField &&
    typeof repositoryField === 'object' &&
    typeof repositoryField.url === 'string'
  ) {
    return repositoryField.url.trim();
  }

  return '';
};

const PACKAGE_REPOSITORY_URL = toRepositoryUrlFromPackageJson(
  (packageJson as PackageJsonLike).repository,
);
const DEFAULT_UPDATE_REPOSITORY_URL =
  PACKAGE_REPOSITORY_URL || 'https://github.com/REPLACE_ME_OWNER/REPLACE_ME_REPO';

const parseGitHubRepository = (
  repositoryUrl: string,
): { owner: string; repo: string } | null => {
  const trimmed = repositoryUrl.trim();
  if (!trimmed) {
    return null;
  }

  const match = trimmed.match(
    /^https?:\/\/(?:www\.)?github\.com\/([^/\s]+)\/([^/\s#?]+)\/?$/i,
  );
  if (!match) {
    return null;
  }

  const owner = match[1]?.trim() ?? '';
  const repo = (match[2]?.trim() ?? '').replace(/\.git$/i, '');
  if (!owner || !repo) {
    return null;
  }

  return { owner, repo };
};

const isPlaceholderRepository = (repositoryUrl: string): boolean =>
  repositoryUrl.includes('REPLACE_ME_OWNER') || repositoryUrl.includes('REPLACE_ME_REPO');

const toErrorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message.trim();
  }

  return String(error);
};

const isNoUpdatePublishedError = (message: string): boolean => {
  const normalized = message.toLowerCase();
  return (
    normalized.includes('no published versions on github') ||
    normalized.includes('unable to find latest version on github') ||
    normalized.includes('ensure a production release exists')
  );
};

type UpdaterListener = (event: UpdaterRendererEvent) => void;

export class UpdaterService {
  private readonly listeners = new Set<UpdaterListener>();
  private readonly repositoryUrl: string;
  private state: UpdaterState;
  private started = false;
  private isConfigured = false;
  private checkInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.repositoryUrl =
      process.env.ZEROADE_UPDATE_REPOSITORY_URL?.trim() || DEFAULT_UPDATE_REPOSITORY_URL;

    this.state = {
      status: 'idle',
      currentVersion: app.getVersion(),
      targetVersion: null,
      downloadProgressPercent: null,
      message: 'Updater idle',
      isPackaged: app.isPackaged,
      isConfigured: false,
      repositoryUrl: this.repositoryUrl,
      lastCheckedAtMs: null,
    };
  }

  onEvent(listener: UpdaterListener): () => void {
    this.listeners.add(listener);
    listener({
      kind: 'updater-state',
      state: this.state,
    });

    return () => {
      this.listeners.delete(listener);
    };
  }

  getState(): UpdaterState {
    return this.state;
  }

  start(): void {
    if (this.started) {
      return;
    }

    this.started = true;

    if (!app.isPackaged) {
      this.updateState({
        status: 'disabled',
        message: 'Auto-update is available in packaged builds only.',
      });
      return;
    }

    const parsed = parseGitHubRepository(this.repositoryUrl);
    if (!parsed || isPlaceholderRepository(this.repositoryUrl)) {
      this.updateState({
        status: 'disabled',
        message:
          'Auto-update is not configured. Set package.json repository.url or ZEROADE_UPDATE_REPOSITORY_URL to your public GitHub repo URL.',
      });
      return;
    }

    this.isConfigured = true;
    // We publish CI builds from `main` as prereleases,
    // so updater checks must include prereleases as candidates.
    autoUpdater.allowPrerelease = true;
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.setFeedURL({
      provider: 'github',
      owner: parsed.owner,
      repo: parsed.repo,
      private: false,
    });
    this.attachAutoUpdaterListeners();
    this.updateState({
      status: 'idle',
      isConfigured: true,
      message: 'Auto-update ready',
    });

    setTimeout(() => {
      void this.checkForUpdates(false);
    }, INITIAL_UPDATE_CHECK_DELAY_MS);

    this.checkInterval = setInterval(() => {
      void this.checkForUpdates(false);
    }, UPDATE_CHECK_INTERVAL_MS);
  }

  dispose(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }

    this.detachAutoUpdaterListeners();
  }

  async checkForUpdates(manual: boolean): Promise<UpdaterActionResult> {
    if (!app.isPackaged) {
      this.updateState({
        status: 'disabled',
        message: 'Auto-update is available in packaged builds only.',
      });

      return {
        ok: false,
        message: 'Auto-update is available in packaged builds only.',
        state: this.state,
      };
    }

    if (!this.isConfigured) {
      this.updateState({
        status: 'disabled',
        message:
          'Auto-update is not configured. Set package.json repository.url or ZEROADE_UPDATE_REPOSITORY_URL to your public GitHub repo URL.',
      });

      return {
        ok: false,
        message:
          'Updater is not configured. Set package.json repository.url or ZEROADE_UPDATE_REPOSITORY_URL to your GitHub releases repository URL.',
        state: this.state,
      };
    }

    if (manual) {
      this.updateState({
        status: 'checking',
        message: 'Checking for updates…',
        lastCheckedAtMs: Date.now(),
      });
    }

    try {
      await autoUpdater.checkForUpdates();

      return {
        ok: true,
        message: 'Checking for updates…',
        state: this.state,
      };
    } catch (error) {
      const message = toErrorMessage(error);

      if (isNoUpdatePublishedError(message)) {
        const notAvailableMessage = 'No new updates are available.';
        this.updateState({
          status: 'not-available',
          message: notAvailableMessage,
        });

        return {
          ok: true,
          message: notAvailableMessage,
          state: this.state,
        };
      }

      this.updateState({
        status: 'error',
        message: `Update check failed: ${message}`,
      });

      return {
        ok: false,
        message: `Update check failed: ${message}`,
        state: this.state,
      };
    }
  }

  async installDownloadedUpdate(): Promise<UpdaterActionResult> {
    if (this.state.status !== 'downloaded') {
      return {
        ok: false,
        message: 'No downloaded update is available yet.',
        state: this.state,
      };
    }

    this.updateState({
      message: 'Restarting to install update…',
    });

    try {
      autoUpdater.quitAndInstall(false, true);

      return {
        ok: true,
        message: 'Restarting to install update…',
        state: this.state,
      };
    } catch (error) {
      const message = toErrorMessage(error);
      this.updateState({
        status: 'error',
        message: `Failed to install update: ${message}`,
      });

      return {
        ok: false,
        message: `Failed to install update: ${message}`,
        state: this.state,
      };
    }
  }

  private attachAutoUpdaterListeners(): void {
    autoUpdater.on('checking-for-update', this.handleCheckingForUpdate);
    autoUpdater.on('update-available', this.handleUpdateAvailable);
    autoUpdater.on('update-not-available', this.handleUpdateNotAvailable);
    autoUpdater.on('download-progress', this.handleDownloadProgress);
    autoUpdater.on('update-downloaded', this.handleUpdateDownloaded);
    autoUpdater.on('error', this.handleError);
  }

  private detachAutoUpdaterListeners(): void {
    autoUpdater.off('checking-for-update', this.handleCheckingForUpdate);
    autoUpdater.off('update-available', this.handleUpdateAvailable);
    autoUpdater.off('update-not-available', this.handleUpdateNotAvailable);
    autoUpdater.off('download-progress', this.handleDownloadProgress);
    autoUpdater.off('update-downloaded', this.handleUpdateDownloaded);
    autoUpdater.off('error', this.handleError);
  }

  private readonly handleCheckingForUpdate = (): void => {
    this.updateState({
      status: 'checking',
      message: 'Checking for updates…',
      downloadProgressPercent: null,
      lastCheckedAtMs: Date.now(),
    });
  };

  private readonly handleUpdateAvailable = (info: UpdateInfo): void => {
    this.updateState({
      status: 'available',
      targetVersion: info.version ?? null,
      message: `Update available${info.version ? ` (${info.version})` : ''}. Downloading…`,
      downloadProgressPercent: 0,
    });
  };

  private readonly handleUpdateNotAvailable = (): void => {
    this.updateState({
      status: 'not-available',
      targetVersion: null,
      message: 'You are up to date.',
      downloadProgressPercent: null,
    });
  };

  private readonly handleDownloadProgress = (progress: ProgressInfo): void => {
    this.updateState({
      status: 'downloading',
      message: `Downloading update… ${Math.round(progress.percent)}%`,
      downloadProgressPercent: progress.percent,
    });
  };

  private readonly handleUpdateDownloaded = (info: UpdateInfo): void => {
    this.updateState({
      status: 'downloaded',
      targetVersion: info.version ?? this.state.targetVersion,
      downloadProgressPercent: 100,
      message: 'Update downloaded. Restart to install.',
    });
  };

  private readonly handleError = (error: Error): void => {
    if (isNoUpdatePublishedError(error.message)) {
      this.updateState({
        status: 'not-available',
        message: 'No new updates are available.',
        downloadProgressPercent: null,
      });
      return;
    }

    this.updateState({
      status: 'error',
      message: `Updater error: ${error.message}`,
      downloadProgressPercent: null,
    });
  };

  private updateState(patch: Partial<UpdaterState>): void {
    this.state = {
      ...this.state,
      ...patch,
      isPackaged: app.isPackaged,
      isConfigured: this.isConfigured && app.isPackaged,
      currentVersion: app.getVersion(),
      repositoryUrl: this.repositoryUrl,
    };

    const event: UpdaterRendererEvent = {
      kind: 'updater-state',
      state: this.state,
    };

    for (const listener of this.listeners) {
      listener(event);
    }
  }
}
