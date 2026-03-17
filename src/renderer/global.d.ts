import type { DesktopApi } from '@shared/types/preload';

declare global {
  interface Window {
    desktop: DesktopApi;
  }
}

export {};
