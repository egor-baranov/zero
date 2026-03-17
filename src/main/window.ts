import { BrowserWindow } from 'electron';
import path from 'node:path';
import type { SettingsStore } from './services/settings/settings-store';
import type { WindowBoundsState } from '@shared/types/settings';

const WINDOW_DEFAULTS = {
  width: 1440,
  height: 900,
  minWidth: 1120,
  minHeight: 720,
};

const SAVE_DEBOUNCE_MS = 250;

const isMac = process.platform === 'darwin';
const isWindows = process.platform === 'win32';
const MAC_TRAFFIC_LIGHT_POSITION = { x: 18, y: 14 };

const getPreloadPath = (): string => path.join(__dirname, 'index.js');

const getWindowBounds = (window: BrowserWindow): WindowBoundsState => {
  const [width, height] = window.getSize();
  const [x, y] = window.getPosition();

  return {
    x,
    y,
    width,
    height,
    isMaximized: window.isMaximized(),
  };
};

const persistWindowBounds = (
  window: BrowserWindow,
  settingsStore: SettingsStore,
): (() => void) => {
  let timeout: NodeJS.Timeout | undefined;

  return () => {
    if (timeout) {
      clearTimeout(timeout);
    }

    timeout = setTimeout(() => {
      const bounds = getWindowBounds(window);
      void settingsStore.setWindowBounds(bounds);
    }, SAVE_DEBOUNCE_MS);
  };
};

export const createMainWindow = async (
  settingsStore: SettingsStore,
): Promise<BrowserWindow> => {
  const savedBounds = await settingsStore.getWindowBounds();

  const mainWindow = new BrowserWindow({
    x: savedBounds?.x,
    y: savedBounds?.y,
    width: savedBounds?.width ?? WINDOW_DEFAULTS.width,
    height: savedBounds?.height ?? WINDOW_DEFAULTS.height,
    minWidth: WINDOW_DEFAULTS.minWidth,
    minHeight: WINDOW_DEFAULTS.minHeight,
    backgroundColor: isMac ? '#00000000' : '#f8f9fb',
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    trafficLightPosition: isMac ? MAC_TRAFFIC_LIGHT_POSITION : undefined,
    titleBarOverlay: isMac
      ? undefined
      : {
          color: '#f8f9fb',
          symbolColor: '#2f2d2b',
          height: 46,
        },
    vibrancy: isMac ? 'under-window' : undefined,
    visualEffectState: isMac ? 'active' : undefined,
    backgroundMaterial: isWindows ? 'mica' : undefined,
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true,
    },
  });

  if (savedBounds?.isMaximized) {
    mainWindow.maximize();
  }

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    await mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    await mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

  const schedulePersist = persistWindowBounds(mainWindow, settingsStore);

  mainWindow.on('resize', schedulePersist);
  mainWindow.on('move', schedulePersist);
  mainWindow.on('close', () => {
    if (!mainWindow.isDestroyed()) {
      const bounds = getWindowBounds(mainWindow);
      void settingsStore.setWindowBounds(bounds);
    }
  });

  return mainWindow;
};
