import * as React from 'react';

const SIDEBAR_WIDTH_KEY = 'zeroade.sidebar.width';
const SIDEBAR_COLLAPSED_KEY = 'zeroade.sidebar.collapsed';
const SIDEBAR_DEFAULT = 312;
const SIDEBAR_MIN = 220;
const SIDEBAR_MAX = 520;
const SIDEBAR_COLLAPSED_WIDTH = 0;

const clamp = (value: number): number =>
  Math.min(Math.max(value, SIDEBAR_MIN), SIDEBAR_MAX);

const readStoredWidth = (): number => {
  const raw = window.localStorage.getItem(SIDEBAR_WIDTH_KEY);
  if (!raw) {
    return SIDEBAR_DEFAULT;
  }

  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? clamp(parsed) : SIDEBAR_DEFAULT;
};

const readStoredCollapsed = (): boolean => {
  const raw = window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY);
  return raw === '1';
};

export const useSidebarWidth = (): {
  sidebarWidth: number;
  activeSidebarWidth: number;
  isCollapsed: boolean;
  isResizing: boolean;
  toggleCollapsed: () => void;
  startResizing: () => void;
} => {
  const [sidebarWidth, setSidebarWidth] = React.useState<number>(SIDEBAR_DEFAULT);
  const [isCollapsed, setIsCollapsed] = React.useState(false);
  const [isResizing, setIsResizing] = React.useState(false);
  const resizingRef = React.useRef(false);

  React.useEffect(() => {
    setSidebarWidth(readStoredWidth());
    setIsCollapsed(readStoredCollapsed());
  }, []);

  React.useEffect(() => {
    const handlePointerMove = (event: PointerEvent): void => {
      if (!resizingRef.current) {
        return;
      }

      const nextWidth = clamp(event.clientX);
      setSidebarWidth(nextWidth);
      window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(nextWidth));
    };

    const stopResizing = (): void => {
      resizingRef.current = false;
      setIsResizing(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', stopResizing);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', stopResizing);
    };
  }, []);

  const startResizing = React.useCallback(() => {
    if (isCollapsed) {
      return;
    }

    resizingRef.current = true;
    setIsResizing(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [isCollapsed]);

  const toggleCollapsed = React.useCallback(() => {
    setIsCollapsed((previous) => {
      const next = !previous;
      window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? '1' : '0');
      return next;
    });
  }, []);

  return {
    sidebarWidth,
    activeSidebarWidth: isCollapsed ? SIDEBAR_COLLAPSED_WIDTH : sidebarWidth,
    isCollapsed,
    isResizing,
    toggleCollapsed,
    startResizing,
  };
};
