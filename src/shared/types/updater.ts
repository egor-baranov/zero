export type UpdaterStatus =
  | 'disabled'
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error';

export interface UpdaterState {
  status: UpdaterStatus;
  currentVersion: string;
  targetVersion: string | null;
  downloadProgressPercent: number | null;
  message: string;
  isPackaged: boolean;
  isConfigured: boolean;
  repositoryUrl: string;
  lastCheckedAtMs: number | null;
}

export interface UpdaterActionResult {
  ok: boolean;
  message: string;
  state: UpdaterState;
}

export interface UpdaterRendererEvent {
  kind: 'updater-state';
  state: UpdaterState;
}
