import * as React from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  RotateCw,
  Search,
  X,
} from 'lucide-react';
import { cn } from '@renderer/lib/cn';
import {
  appendStoredNotification,
  type BrowserPushItem,
} from '@renderer/store/browser-pushes';

interface WebBrowserPanelProps {
  open: boolean;
  openRequest: {
    id: number;
    url: string;
  } | null;
}

interface BrowserTab {
  id: string;
  url: string;
  label: string;
}

interface BrowserPushPayload {
  title?: unknown;
  body?: unknown;
  url?: unknown;
  origin?: unknown;
  source?: unknown;
  timestamp?: unknown;
}

interface ShortcutInput {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  preventDefault: () => void;
}

interface BrowserWebviewElement extends HTMLElement {
  src: string;
  loadURL: (url: string) => Promise<void>;
  getURL: () => string;
  canGoBack: () => boolean;
  canGoForward: () => boolean;
  goBack: () => void;
  goForward: () => void;
  reload: () => void;
  addEventListener: (
    type:
      | 'dom-ready'
      | 'did-start-loading'
      | 'did-stop-loading'
      | 'did-finish-load'
      | 'did-fail-load'
      | 'did-navigate'
      | 'did-navigate-in-page'
      | 'console-message',
    listener: (event: Event) => void,
  ) => void;
  removeEventListener: (
    type:
      | 'dom-ready'
      | 'did-start-loading'
      | 'did-stop-loading'
      | 'did-finish-load'
      | 'did-fail-load'
      | 'did-navigate'
      | 'did-navigate-in-page'
      | 'console-message',
    listener: (event: Event) => void,
  ) => void;
  executeJavaScript: (code: string) => Promise<unknown>;
}

const DEFAULT_HOME_URL = 'https://www.google.com';
const WEB_PANEL_WIDTH_KEY = 'zeroade.webpanel.width';
const WEB_PANEL_WIDTH_DEFAULT = 620;
const WEB_PANEL_WIDTH_MIN = 440;
const WEB_PANEL_WIDTH_MAX = 980;
const WEB_PANEL_PUSH_PREFIX = '__zeroade_browser_push__:';
const GOOGLE_VOLATILE_HOME_QUERY_PARAMS = new Set(['zx', 'no_sw_cr']);
const createTabId = (): string => `web-tab-${Date.now()}-${Math.random().toString(16).slice(2, 9)}`;
const createPushId = (): string => `browser-push-${Date.now()}-${Math.random().toString(16).slice(2, 9)}`;

const clampWidth = (value: number): number =>
  Math.min(Math.max(value, WEB_PANEL_WIDTH_MIN), WEB_PANEL_WIDTH_MAX);

const readStoredWidth = (): number => {
  const raw = window.localStorage.getItem(WEB_PANEL_WIDTH_KEY);
  if (!raw) {
    return WEB_PANEL_WIDTH_DEFAULT;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    return WEB_PANEL_WIDTH_DEFAULT;
  }

  return clampWidth(parsed);
};

const toPushSource = (value: unknown): BrowserPushItem['source'] => {
  if (value === 'notification' || value === 'service-worker') {
    return value;
  }
  return 'unknown';
};

const asText = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const toPushTimestamp = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value;
  }
  return Date.now();
};

const normalizeBrowserPushPayload = (
  payload: BrowserPushPayload,
  fallbackUrl: string,
): BrowserPushItem | null => {
  const rawTitle = asText(payload.title);
  const rawBody = asText(payload.body);
  if (!rawTitle && !rawBody) {
    return null;
  }

  const rawUrl = asText(payload.url);
  const pushUrl = rawUrl ? toStableNavigableUrl(rawUrl) : toStableNavigableUrl(fallbackUrl);
  const origin = asText(payload.origin) || (() => {
    try {
      return new URL(pushUrl).origin;
    } catch {
      return 'web';
    }
  })();

  return {
    id: createPushId(),
    title: rawTitle || origin || 'Website notification',
    body: rawBody,
    url: pushUrl,
    origin,
    source: toPushSource(payload.source),
    kind: 'browser',
    severity: 'info',
    createdAtMs: toPushTimestamp(payload.timestamp),
    read: false,
  };
};

const WEBVIEW_PUSH_BRIDGE_SCRIPT = `(() => {
  const PREFIX = ${JSON.stringify(WEB_PANEL_PUSH_PREFIX)};
  const emit = (payload) => {
    try {
      console.info(PREFIX + JSON.stringify(payload));
    } catch {
      // no-op
    }
  };
  const toText = (value) => (typeof value === 'string' ? value : '');
  if ((window).__zeroadePushBridgeInstalled) {
    return;
  }

  Object.defineProperty(window, '__zeroadePushBridgeInstalled', {
    value: true,
    configurable: true,
  });

  try {
    const NativeNotification = window.Notification;
    if (typeof NativeNotification === 'function' && !(NativeNotification).__zeroadeWrapped) {
      const WrappedNotification = new Proxy(NativeNotification, {
        construct(target, args, newTarget) {
          const title = toText(args[0]);
          const options = args[1] && typeof args[1] === 'object' ? args[1] : {};
          emit({
            title,
            body: toText(options.body),
            url: location.href,
            origin: location.origin,
            source: 'notification',
            timestamp: Date.now(),
          });
          return Reflect.construct(target, args, newTarget);
        },
      });

      try {
        Object.defineProperty(WrappedNotification, '__zeroadeWrapped', {
          value: true,
          configurable: true,
        });
      } catch {
        // no-op
      }

      try {
        Object.setPrototypeOf(WrappedNotification, NativeNotification);
      } catch {
        // no-op
      }
      WrappedNotification.prototype = NativeNotification.prototype;

      Object.defineProperty(window, 'Notification', {
        configurable: true,
        writable: true,
        value: WrappedNotification,
      });
    }
  } catch {
    // no-op
  }

  try {
    const registrationPrototype =
      window.ServiceWorkerRegistration && window.ServiceWorkerRegistration.prototype;
    if (
      registrationPrototype &&
      typeof registrationPrototype.showNotification === 'function' &&
      !registrationPrototype.__zeroadeShowNotificationWrapped
    ) {
      const originalShowNotification = registrationPrototype.showNotification;
      registrationPrototype.showNotification = function(title, options) {
        const normalizedOptions = options && typeof options === 'object' ? options : {};
        emit({
          title: toText(title),
          body: toText(normalizedOptions.body),
          url: location.href,
          origin: location.origin,
          source: 'service-worker',
          timestamp: Date.now(),
        });
        return originalShowNotification.apply(this, arguments);
      };

      Object.defineProperty(registrationPrototype, '__zeroadeShowNotificationWrapped', {
        value: true,
        configurable: true,
      });
    }
  } catch {
    // no-op
  }
})();`;

const searchUrl = (query: string): string =>
  `https://www.google.com/search?q=${encodeURIComponent(query.trim())}`;

const extractSearchQuery = (url: URL): string | null => {
  const query = url.searchParams.get('q');
  if (!query) {
    return null;
  }

  if (url.hostname.includes('duckduckgo.com')) {
    return query;
  }

  if (url.hostname.includes('google.') || url.hostname.endsWith('.google')) {
    return query;
  }

  return null;
};

const isExternalNavigation = (fromUrl: string, toUrl: string): boolean => {
  try {
    const from = new URL(fromUrl);
    const to = new URL(toUrl);

    const fromIsWeb = from.protocol === 'http:' || from.protocol === 'https:';
    const toIsWeb = to.protocol === 'http:' || to.protocol === 'https:';
    if (!fromIsWeb || !toIsWeb) {
      return false;
    }

    return from.host !== to.host;
  } catch {
    return false;
  }
};

const isGoogleHomeUrl = (url: URL): boolean => {
  const hostname = url.hostname.toLowerCase().replace(/^www\./, '');
  const isGoogleDomain = hostname === 'google.com' || hostname.startsWith('google.');
  if (!isGoogleDomain) {
    return false;
  }

  return url.pathname === '/' || url.pathname === '';
};

const toStableNavigableUrl = (rawUrl: string): string => {
  try {
    const parsed = new URL(rawUrl.trim());
    if (!isGoogleHomeUrl(parsed)) {
      return parsed.href;
    }

    for (const volatileParam of GOOGLE_VOLATILE_HOME_QUERY_PARAMS) {
      parsed.searchParams.delete(volatileParam);
    }

    return parsed.href;
  } catch {
    return rawUrl.trim();
  }
};

const toNavigableUrl = (rawValue: string): string => {
  const trimmed = rawValue.trim();
  if (!trimmed) {
    return DEFAULT_HOME_URL;
  }

  if (/\s/.test(trimmed)) {
    return toStableNavigableUrl(searchUrl(trimmed));
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return toStableNavigableUrl(trimmed);
  }

  if (/^[\w.-]+\.[a-z]{2,}(\/.*)?$/i.test(trimmed)) {
    return toStableNavigableUrl(`https://${trimmed}`);
  }

  return toStableNavigableUrl(searchUrl(trimmed));
};

const toSearchInputValue = (url: string): string => {
  try {
    const parsed = new URL(url);
    const query = extractSearchQuery(parsed);
    if (query) {
      return query;
    }

    return parsed.href;
  } catch {
    return url;
  }
};

const toTabLabel = (url: string): string => {
  try {
    const parsed = new URL(url);
    const query = extractSearchQuery(parsed);
    if (query) {
      return query;
    }

    return parsed.hostname.replace(/^www\./i, '') || parsed.href;
  } catch {
    return 'New tab';
  }
};

const isSameNavigableUrl = (left: string, right: string): boolean => {
  const normalizedLeft = toStableNavigableUrl(left);
  const normalizedRight = toStableNavigableUrl(right);

  if (normalizedLeft === normalizedRight) {
    return true;
  }

  try {
    return new URL(normalizedLeft).href === new URL(normalizedRight).href;
  } catch {
    return false;
  }
};

export const WebBrowserPanel = ({ open, openRequest }: WebBrowserPanelProps): JSX.Element => {
  const initialTab = React.useMemo<BrowserTab>(
    () => ({
      id: createTabId(),
      url: DEFAULT_HOME_URL,
      label: toTabLabel(DEFAULT_HOME_URL),
    }),
    [],
  );
  const [tabs, setTabs] = React.useState<BrowserTab[]>([initialTab]);
  const [activeTabId, setActiveTabId] = React.useState(initialTab.id);
  const [searchValue, setSearchValue] = React.useState('');
  const [isLoading, setIsLoading] = React.useState(false);
  const [canGoBack, setCanGoBack] = React.useState(false);
  const [canGoForward, setCanGoForward] = React.useState(false);
  const [draggingTabId, setDraggingTabId] = React.useState<string | null>(null);
  const [dragOverTabId, setDragOverTabId] = React.useState<string | null>(null);
  const [panelWidth, setPanelWidth] = React.useState(WEB_PANEL_WIDTH_DEFAULT);
  const [isResizing, setIsResizing] = React.useState(false);
  const resizingRef = React.useRef(false);
  const resizePointerIdRef = React.useRef<number | null>(null);
  const searchInputRef = React.useRef<HTMLInputElement | null>(null);
  const shouldSelectAddressRef = React.useRef(true);
  const webviewRef = React.useRef<BrowserWebviewElement | null>(null);
  const resizeHandleRef = React.useRef<HTMLButtonElement | null>(null);
  const panelRef = React.useRef<HTMLElement | null>(null);
  const webviewReadyRef = React.useRef(false);
  const intendedNavigationUrlRef = React.useRef<string | null>(null);
  const lastOpenRequestIdRef = React.useRef<number | null>(null);
  const activeTab = React.useMemo(
    () => tabs.find((tab) => tab.id === activeTabId) ?? tabs[0],
    [activeTabId, tabs],
  );
  const currentUrl = activeTab?.url ?? DEFAULT_HOME_URL;
  const activeTabIdRef = React.useRef(activeTabId);
  const currentUrlRef = React.useRef(currentUrl);

  React.useEffect(() => {
    activeTabIdRef.current = activeTabId;
  }, [activeTabId]);

  React.useEffect(() => {
    currentUrlRef.current = currentUrl;
  }, [currentUrl]);

  const isAbortedNavigationError = React.useCallback((error: unknown): boolean => {
    if (!error || typeof error !== 'object') {
      return false;
    }

    const maybeError = error as {
      code?: string;
      errno?: number;
      message?: string;
    };

    return (
      maybeError.code === 'ERR_ABORTED' ||
      maybeError.errno === -3 ||
      maybeError.message?.includes('ERR_ABORTED') === true
    );
  }, []);

  const openUrlInNewTab = React.useCallback((rawUrl: string): void => {
    const nextUrl = toNavigableUrl(rawUrl);
    const nextTab: BrowserTab = {
      id: createTabId(),
      url: nextUrl,
      label: toTabLabel(nextUrl),
    };

    intendedNavigationUrlRef.current = nextUrl;
    shouldSelectAddressRef.current = false;
    setTabs((previous) => [...previous, nextTab]);
    setActiveTabId(nextTab.id);
    setSearchValue(toSearchInputValue(nextUrl));
    setIsLoading(true);
    setCanGoBack(false);
    setCanGoForward(false);
  }, []);

  const appendPushItem = React.useCallback(
    (payload: BrowserPushPayload): void => {
      const normalized = normalizeBrowserPushPayload(payload, currentUrlRef.current || DEFAULT_HOME_URL);
      if (!normalized) {
        return;
      }
      appendStoredNotification(normalized);
    },
    [],
  );

  React.useEffect(() => {
    setPanelWidth(readStoredWidth());
  }, []);

  React.useEffect(() => {
    if (!open) {
      return;
    }

    setSearchValue(toSearchInputValue(currentUrl));
    requestAnimationFrame(() => {
      const input = searchInputRef.current;
      if (!input) {
        return;
      }

      input.focus();
      if (shouldSelectAddressRef.current) {
        input.select();
        return;
      }

      const caret = input.value.length;
      input.setSelectionRange(caret, caret);
      shouldSelectAddressRef.current = true;
    });
  }, [currentUrl, open]);

  React.useEffect(() => {
    if (!openRequest) {
      return;
    }

    if (lastOpenRequestIdRef.current === openRequest.id) {
      return;
    }

    lastOpenRequestIdRef.current = openRequest.id;
    openUrlInNewTab(openRequest.url);
  }, [openRequest, openUrlInNewTab]);


  React.useEffect(() => {
    const view = webviewRef.current;
    if (!view) {
      return;
    }

    const handleStart = (): void => {
      setIsLoading(true);
    };

    const handleStop = (): void => {
      setIsLoading(false);
    };

    const handleFinish = (): void => {
      setIsLoading(false);
    };

    const handleFail = (): void => {
      setIsLoading(false);
    };

    const handleNavigate = (): void => {
      if (!webviewReadyRef.current) {
        return;
      }

      try {
        const nextUrl = toStableNavigableUrl(view.getURL() as string);
        if (nextUrl) {
          intendedNavigationUrlRef.current = null;

          if (nextUrl === 'about:blank' && currentUrlRef.current !== 'about:blank') {
            return;
          }

          const nextLabel = toTabLabel(nextUrl);
          setTabs((previous) => {
            let changed = false;
            const nextTabs = previous.map((tab) => {
              if (tab.id !== activeTabIdRef.current) {
                return tab;
              }

              if (tab.url === nextUrl && tab.label === nextLabel) {
                return tab;
              }

              changed = true;
              return { ...tab, url: nextUrl, label: nextLabel };
            });

            return changed ? nextTabs : previous;
          });
          setSearchValue(toSearchInputValue(nextUrl));
        }
        setCanGoBack(Boolean(view.canGoBack?.()));
        setCanGoForward(Boolean(view.canGoForward?.()));
      } catch {
        // no-op
      }
    };

    const handleDomReady = (): void => {
      webviewReadyRef.current = true;
      void view.executeJavaScript(WEBVIEW_PUSH_BRIDGE_SCRIPT).catch(() => {
        // Ignore push bridge injection failures on restricted pages.
      });
      handleNavigate();
    };

    const handleConsoleMessage = (event: Event): void => {
      const browserEvent = event as Event & {
        message?: string;
      };
      const message = typeof browserEvent.message === 'string' ? browserEvent.message.trim() : '';
      if (!message.startsWith(WEB_PANEL_PUSH_PREFIX)) {
        return;
      }

      const rawPayload = message.slice(WEB_PANEL_PUSH_PREFIX.length).trim();
      if (!rawPayload) {
        return;
      }

      try {
        const payload = JSON.parse(rawPayload) as BrowserPushPayload;
        appendPushItem(payload);
      } catch {
        // Ignore malformed payloads.
      }
    };

    const handleNewWindow = (event: Event): void => {
      const browserEvent = event as Event & {
        url?: string;
        preventDefault?: () => void;
      };
      const targetUrl = typeof browserEvent.url === 'string' ? browserEvent.url.trim() : '';
      if (!targetUrl) {
        return;
      }

      browserEvent.preventDefault?.();
      openUrlInNewTab(targetUrl);
    };

    const handleWillNavigate = (event: Event): void => {
      const browserEvent = event as Event & {
        url?: string;
        preventDefault?: () => void;
      };
      const targetUrl = typeof browserEvent.url === 'string' ? browserEvent.url.trim() : '';
      if (!targetUrl) {
        return;
      }

      if (intendedNavigationUrlRef.current) {
        return;
      }

      if (!isExternalNavigation(currentUrlRef.current, targetUrl)) {
        return;
      }

      browserEvent.preventDefault?.();
      openUrlInNewTab(targetUrl);
    };

    const rawView = view as unknown as HTMLElement;

    view.addEventListener('dom-ready', handleDomReady);
    view.addEventListener('did-start-loading', handleStart);
    view.addEventListener('did-stop-loading', handleStop);
    view.addEventListener('did-finish-load', handleFinish);
    view.addEventListener('did-fail-load', handleFail);
    view.addEventListener('did-navigate', handleNavigate);
    view.addEventListener('did-navigate-in-page', handleNavigate);
    view.addEventListener('console-message', handleConsoleMessage);
    rawView.addEventListener('new-window', handleNewWindow as EventListener);
    rawView.addEventListener('will-navigate', handleWillNavigate as EventListener);

    return () => {
      webviewReadyRef.current = false;
      setCanGoBack(false);
      setCanGoForward(false);
      view.removeEventListener('dom-ready', handleDomReady);
      view.removeEventListener('did-start-loading', handleStart);
      view.removeEventListener('did-stop-loading', handleStop);
      view.removeEventListener('did-finish-load', handleFinish);
      view.removeEventListener('did-fail-load', handleFail);
      view.removeEventListener('did-navigate', handleNavigate);
      view.removeEventListener('did-navigate-in-page', handleNavigate);
      view.removeEventListener('console-message', handleConsoleMessage);
      rawView.removeEventListener('new-window', handleNewWindow as EventListener);
      rawView.removeEventListener('will-navigate', handleWillNavigate as EventListener);
    };
  }, [appendPushItem, openUrlInNewTab]);

  React.useEffect(() => {
    if (!open) {
      return;
    }

    const view = webviewRef.current;
    if (!view) {
      return;
    }

    const intendedUrl = intendedNavigationUrlRef.current?.trim() ?? '';
    if (webviewReadyRef.current) {
      if (!intendedUrl || !isSameNavigableUrl(intendedUrl, currentUrl)) {
        return;
      }
    }

    let disposed = false;

    try {
      const currentViewUrl = toStableNavigableUrl(view.getURL());
      if (currentViewUrl && isSameNavigableUrl(currentViewUrl, currentUrl)) {
        intendedNavigationUrlRef.current = null;
        setIsLoading(false);
        return;
      }
    } catch {
      // Continue to load the requested URL.
    }

    setIsLoading(true);
    intendedNavigationUrlRef.current = currentUrl;

    void view.loadURL(currentUrl).catch((error) => {
      if (disposed || isAbortedNavigationError(error)) {
        return;
      }

      setIsLoading(false);
      console.error('Webview navigation failed', error);
    });

    return () => {
      disposed = true;
    };
  }, [currentUrl, isAbortedNavigationError, open]);

  React.useEffect(() => {
    const stopResizing = (): void => {
      if (!resizingRef.current) {
        return;
      }

      resizingRef.current = false;
      resizePointerIdRef.current = null;
      setIsResizing(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    const handlePointerMove = (event: PointerEvent): void => {
      if (!resizingRef.current) {
        return;
      }

      if (resizePointerIdRef.current !== null && event.pointerId !== resizePointerIdRef.current) {
        return;
      }

      const nextWidth = clampWidth(window.innerWidth - event.clientX);
      setPanelWidth(nextWidth);
      window.localStorage.setItem(WEB_PANEL_WIDTH_KEY, String(nextWidth));
    };

    const handlePointerUp = (event: PointerEvent): void => {
      if (!resizingRef.current) {
        return;
      }

      if (resizePointerIdRef.current !== null && event.pointerId !== resizePointerIdRef.current) {
        return;
      }

      stopResizing();
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
    window.addEventListener('mouseup', stopResizing);
    window.addEventListener('blur', stopResizing);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
      window.removeEventListener('mouseup', stopResizing);
      window.removeEventListener('blur', stopResizing);
      stopResizing();
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, []);

  const startResizing = React.useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    resizePointerIdRef.current = event.pointerId;
    resizingRef.current = true;
    setIsResizing(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // no-op
    }
  }, []);

  const stopResizing = React.useCallback(() => {
    if (!resizingRef.current) {
      return;
    }

    resizingRef.current = false;
    const pointerId = resizePointerIdRef.current;
    resizePointerIdRef.current = null;
    setIsResizing(false);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';

    if (pointerId !== null && resizeHandleRef.current?.hasPointerCapture(pointerId)) {
      resizeHandleRef.current.releasePointerCapture(pointerId);
    }
  }, []);

  const handleNavigate = React.useCallback((value: string) => {
    const nextUrl = toNavigableUrl(value);
    intendedNavigationUrlRef.current = nextUrl;
    setTabs((previous) =>
      previous.map((tab) =>
        tab.id === activeTabId ? { ...tab, url: nextUrl, label: toTabLabel(nextUrl) } : tab,
      ),
    );
    setSearchValue(toSearchInputValue(nextUrl));
    setIsLoading(true);
  }, [activeTabId]);

  const handleCreateTab = React.useCallback(() => {
    const nextTab: BrowserTab = {
      id: createTabId(),
      url: DEFAULT_HOME_URL,
      label: toTabLabel(DEFAULT_HOME_URL),
    };

    intendedNavigationUrlRef.current = nextTab.url;
    shouldSelectAddressRef.current = false;
    setTabs((previous) => [...previous, nextTab]);
    setActiveTabId(nextTab.id);
    setSearchValue(toSearchInputValue(nextTab.url));
    setIsLoading(true);
    setCanGoBack(false);
    setCanGoForward(false);
  }, []);

  const handleSelectTab = React.useCallback((tabId: string) => {
    const tab = tabs.find((item) => item.id === tabId);
    if (!tab) {
      return;
    }

    intendedNavigationUrlRef.current = tab.url;
    shouldSelectAddressRef.current = false;
    setActiveTabId(tabId);
    setSearchValue(toSearchInputValue(tab.url));
    setIsLoading(true);
    setCanGoBack(false);
    setCanGoForward(false);
  }, [tabs]);

  const handleCloseTab = React.useCallback(
    (tabId: string) => {
      if (tabs.length <= 1) {
        return;
      }

      const closeIndex = tabs.findIndex((tab) => tab.id === tabId);
      if (closeIndex < 0) {
        return;
      }

      const nextTabs = tabs.filter((tab) => tab.id !== tabId);
      if (!nextTabs.length) {
        return;
      }

      setTabs(nextTabs);

      if (activeTabId === tabId) {
        const fallbackTab = nextTabs[Math.max(0, closeIndex - 1)] ?? nextTabs[0];
        intendedNavigationUrlRef.current = fallbackTab.url;
        setActiveTabId(fallbackTab.id);
        setSearchValue(toSearchInputValue(fallbackTab.url));
        setIsLoading(true);
        setCanGoBack(false);
        setCanGoForward(false);
      }
    },
    [activeTabId, tabs],
  );

  const handleReorderTabs = React.useCallback((sourceTabId: string, targetTabId: string) => {
    if (!sourceTabId || !targetTabId || sourceTabId === targetTabId) {
      return;
    }

    setTabs((previous) => {
      const sourceIndex = previous.findIndex((tab) => tab.id === sourceTabId);
      const targetIndex = previous.findIndex((tab) => tab.id === targetTabId);
      if (sourceIndex < 0 || targetIndex < 0) {
        return previous;
      }

      const next = [...previous];
      const [moved] = next.splice(sourceIndex, 1);
      if (!moved) {
        return previous;
      }
      next.splice(targetIndex, 0, moved);
      return next;
    });
  }, []);

  const handleGoBack = React.useCallback(() => {
    const view = webviewRef.current;
    if (!view || !webviewReadyRef.current || !view.canGoBack?.()) {
      return;
    }

    try {
      view.goBack();
    } catch {
      // no-op
    }
  }, []);

  const handleGoForward = React.useCallback(() => {
    const view = webviewRef.current;
    if (!view || !webviewReadyRef.current || !view.canGoForward?.()) {
      return;
    }

    try {
      view.goForward();
    } catch {
      // no-op
    }
  }, []);

  const handleReload = React.useCallback(() => {
    const view = webviewRef.current;
    if (!view || !webviewReadyRef.current) {
      return;
    }

    try {
      view.reload();
    } catch {
      // no-op
    }
  }, []);

  const focusAddressBar = React.useCallback(() => {
    requestAnimationFrame(() => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    });
  }, []);

  const handleSelectAdjacentTab = React.useCallback(
    (direction: 1 | -1) => {
      if (tabs.length < 2) {
        return;
      }

      const currentIndex = tabs.findIndex((tab) => tab.id === activeTabId);
      const normalizedIndex = currentIndex < 0 ? 0 : currentIndex;
      const nextIndex = (normalizedIndex + direction + tabs.length) % tabs.length;
      const nextTab = tabs[nextIndex];
      if (!nextTab) {
        return;
      }

      handleSelectTab(nextTab.id);
    },
    [activeTabId, handleSelectTab, tabs],
  );

  const handleSelectTabByNumber = React.useCallback(
    (index: number) => {
      if (!tabs.length) {
        return;
      }

      if (index === 9) {
        const lastTab = tabs.at(-1);
        if (lastTab) {
          handleSelectTab(lastTab.id);
        }
        return;
      }

      const target = tabs[index - 1];
      if (!target) {
        return;
      }

      handleSelectTab(target.id);
    },
    [handleSelectTab, tabs],
  );

  const handleBrowserShortcut = React.useCallback(
    (input: ShortcutInput): boolean => {
      const key = input.key.toLowerCase();
      const mod = input.metaKey || input.ctrlKey;
      const isBackBracket = input.key === '[' || key === 'bracketleft';
      const isForwardBracket = input.key === ']' || key === 'bracketright';

      if (mod && key === 'l') {
        input.preventDefault();
        focusAddressBar();
        return true;
      }

      if (mod && key === 't') {
        input.preventDefault();
        handleCreateTab();
        return true;
      }

      if (mod && key === 'w') {
        input.preventDefault();
        handleCloseTab(activeTabId);
        return true;
      }

      if ((mod && input.shiftKey && isBackBracket) || (input.ctrlKey && input.shiftKey && key === 'tab')) {
        input.preventDefault();
        handleSelectAdjacentTab(-1);
        return true;
      }

      if ((mod && input.shiftKey && isForwardBracket) || (input.ctrlKey && !input.shiftKey && key === 'tab')) {
        input.preventDefault();
        handleSelectAdjacentTab(1);
        return true;
      }

      if (mod && key.length === 1 && key >= '1' && key <= '9') {
        input.preventDefault();
        handleSelectTabByNumber(Number.parseInt(key, 10));
        return true;
      }

      if ((mod && key === 'r') || key === 'f5') {
        input.preventDefault();
        handleReload();
        return true;
      }

      if (input.altKey && key === 'arrowleft') {
        input.preventDefault();
        handleGoBack();
        return true;
      }

      if (input.altKey && key === 'arrowright') {
        input.preventDefault();
        handleGoForward();
        return true;
      }

      return false;
    },
    [
      activeTabId,
      focusAddressBar,
      handleCloseTab,
      handleCreateTab,
      handleGoBack,
      handleGoForward,
      handleReload,
      handleSelectAdjacentTab,
      handleSelectTabByNumber,
    ],
  );

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!open) {
        return;
      }

      const activeElement = document.activeElement;
      if (!panelRef.current || !activeElement || !panelRef.current.contains(activeElement)) {
        return;
      }

      void handleBrowserShortcut({
        key: event.key,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
        preventDefault: () => event.preventDefault(),
      });
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [handleBrowserShortcut, open]);

  React.useEffect(() => {
    const view = webviewRef.current as unknown as HTMLElement | null;
    if (!view) {
      return;
    }

    const onBeforeInputEvent = (event: Event): void => {
      if (!open) {
        return;
      }

      const browserEvent = event as Event & {
        key?: string;
        code?: string;
        control?: boolean;
        meta?: boolean;
        shift?: boolean;
        alt?: boolean;
      };
      const key = browserEvent.key ?? browserEvent.code ?? '';
      if (!key) {
        return;
      }

      void handleBrowserShortcut({
        key,
        metaKey: Boolean(browserEvent.meta),
        ctrlKey: Boolean(browserEvent.control),
        shiftKey: Boolean(browserEvent.shift),
        altKey: Boolean(browserEvent.alt),
        preventDefault: () => event.preventDefault(),
      });
    };

    view.addEventListener('before-input-event', onBeforeInputEvent as EventListener);
    return () => {
      view.removeEventListener('before-input-event', onBeforeInputEvent as EventListener);
    };
  }, [handleBrowserShortcut, open]);

  return (
    <aside
      ref={panelRef}
      style={{ width: open ? panelWidth : 0 }}
      className={cn(
        'relative h-full shrink-0 overflow-hidden border-l border-stone-200 bg-[#fdfdfff2] backdrop-blur-xl transition-[width] duration-200 ease-out',
        isResizing && 'transition-none',
        !open && 'border-l-transparent',
      )}
    >
      <button
        ref={resizeHandleRef}
        type="button"
        aria-label="Resize browser panel"
        className={cn(
          'no-drag group absolute inset-y-0 left-0 z-10 w-2 -translate-x-1 cursor-col-resize',
          !open && 'pointer-events-none opacity-0',
        )}
        onPointerDown={startResizing}
        onLostPointerCapture={stopResizing}
      >
        <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors group-hover:bg-stone-300/70" />
      </button>

      <div
        className={cn(
          'flex h-full w-full min-w-0 flex-col transition-opacity duration-150',
          open ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
      >
        <div className="flex items-center gap-2 px-3 py-2">
          <div className="inline-flex shrink-0 items-center gap-1">
            <button
              type="button"
              className="no-drag inline-flex h-7 w-7 items-center justify-center rounded-[9px] text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-700 disabled:opacity-40"
              aria-label="Back"
              disabled={!canGoBack}
              onClick={handleGoBack}
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              className="no-drag inline-flex h-7 w-7 items-center justify-center rounded-[9px] text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-700 disabled:opacity-40"
              aria-label="Forward"
              disabled={!canGoForward}
              onClick={handleGoForward}
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            <button
              type="button"
              className="no-drag inline-flex h-7 w-7 items-center justify-center rounded-[9px] text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-700"
              aria-label="Reload"
              onClick={handleReload}
            >
              <RotateCw className={cn('h-4 w-4', isLoading && 'animate-spin')} />
            </button>
          </div>
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-stone-200 bg-stone-50/80 px-2.5 py-1.5">
            <Search className="h-3.5 w-3.5 shrink-0 text-stone-500" />
            <input
              ref={searchInputRef}
              value={searchValue}
              onChange={(event) => setSearchValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  handleNavigate(searchValue);
                }
              }}
              placeholder="Search web or type URL"
              className="no-drag h-5 w-full bg-transparent text-[12px] text-stone-700 placeholder:text-stone-400 focus:outline-none"
            />
          </div>
          <button
            type="button"
            aria-label="New browser tab"
            className="no-drag inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-700"
            onClick={handleCreateTab}
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>

        {tabs.length > 1 ? (
          <div className="px-3 pb-2">
            <div className="scrollbar-none flex items-center gap-1.5 overflow-x-auto">
              {tabs.map((tab) => {
                const isActive = tab.id === activeTabId;
                return (
                  <div
                    key={tab.id}
                    role="button"
                    tabIndex={0}
                    draggable
                    className={cn(
                      'no-drag group inline-flex h-8 min-w-0 max-w-[220px] items-center gap-2 rounded-xl px-3 text-[12px] transition-colors focus:outline-none',
                      isActive
                        ? 'bg-stone-200/90 text-stone-900'
                        : 'bg-stone-100/80 text-stone-600 hover:bg-stone-200/75 hover:text-stone-800',
                      draggingTabId === tab.id && 'opacity-60',
                      dragOverTabId === tab.id && draggingTabId !== tab.id && 'bg-stone-200/90',
                    )}
                    onClick={() => handleSelectTab(tab.id)}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter' && event.key !== ' ') {
                        return;
                      }

                      event.preventDefault();
                      handleSelectTab(tab.id);
                    }}
                    onDragStart={(event) => {
                      setDraggingTabId(tab.id);
                      event.dataTransfer.effectAllowed = 'move';
                      event.dataTransfer.setData('text/plain', tab.id);
                    }}
                    onDragOver={(event) => {
                      event.preventDefault();
                      if (draggingTabId && draggingTabId !== tab.id) {
                        setDragOverTabId(tab.id);
                      }
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      const sourceTabId =
                        draggingTabId ?? event.dataTransfer.getData('text/plain');
                      if (!sourceTabId || sourceTabId === tab.id) {
                        return;
                      }

                      handleReorderTabs(sourceTabId, tab.id);
                    }}
                    onDragEnd={() => {
                      setDraggingTabId(null);
                      setDragOverTabId(null);
                    }}
                    onDragLeave={() => {
                      if (dragOverTabId === tab.id) {
                        setDragOverTabId(null);
                      }
                    }}
                  >
                    <span className="truncate">{tab.label}</span>
                    <button
                      type="button"
                      aria-label={`Close ${tab.label}`}
                      className={cn(
                        'inline-flex h-4 w-4 items-center justify-center rounded-md text-stone-500 transition-colors',
                        'hover:bg-stone-300/70 hover:text-stone-700',
                      )}
                      onClick={(event) => {
                        event.stopPropagation();
                        handleCloseTab(tab.id);
                      }}
                      onKeyDown={(event) => {
                        event.stopPropagation();
                      }}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        <div className="relative min-h-0 flex-1 bg-white">
          <webview
            ref={webviewRef}
            src="about:blank"
            className="block h-full w-full"
            style={{ display: 'inline-flex' }}
          />
        </div>
      </div>
    </aside>
  );
};
