export interface AppNotificationItem {
  id: string;
  title: string;
  body: string;
  url: string | null;
  origin: string;
  source: 'notification' | 'service-worker' | 'app' | 'unknown';
  kind: 'browser' | 'app';
  severity: 'info' | 'error';
  createdAtMs: number;
  read: boolean;
}

export type BrowserPushItem = AppNotificationItem;

const APP_NOTIFICATIONS_KEY = 'zeroade.notifications.v1';
const LEGACY_BROWSER_PUSHES_KEY = 'zeroade.webpanel.pushes.v1';
const APP_NOTIFICATIONS_UPDATED_EVENT = 'zeroade.notifications-updated';
const APP_NOTIFICATION_MAX_ITEMS = 120;

const asText = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const toNotificationSource = (value: unknown): AppNotificationItem['source'] => {
  if (value === 'notification' || value === 'service-worker' || value === 'app') {
    return value;
  }
  return 'unknown';
};

const toNotificationKind = (
  value: unknown,
  source: AppNotificationItem['source'],
): AppNotificationItem['kind'] => {
  if (value === 'browser' || value === 'app') {
    return value;
  }

  return source === 'app' ? 'app' : 'browser';
};

const toNotificationSeverity = (
  value: unknown,
  source: AppNotificationItem['source'],
): AppNotificationItem['severity'] => {
  if (value === 'info' || value === 'error') {
    return value;
  }

  return source === 'app' ? 'error' : 'info';
};

const normalizeNotificationEntry = (entry: unknown): AppNotificationItem | null => {
  if (typeof entry !== 'object' || entry === null) {
    return null;
  }

  const candidate = entry as Partial<AppNotificationItem>;
  if (typeof candidate.id !== 'string' || candidate.id.trim().length === 0) {
    return null;
  }

  const source = toNotificationSource(candidate.source);
  const kind = toNotificationKind(candidate.kind, source);
  const severity = toNotificationSeverity(candidate.severity, source);
  const title =
    asText(candidate.title) || (kind === 'browser' ? 'Website notification' : 'App notification');
  const body = asText(candidate.body);
  const rawUrl = asText(candidate.url);
  const origin = asText(candidate.origin) || (kind === 'browser' ? 'web' : 'Zero');
  const createdAtMs =
    typeof candidate.createdAtMs === 'number' && Number.isFinite(candidate.createdAtMs)
      ? candidate.createdAtMs
      : Date.now();

  return {
    id: candidate.id,
    title,
    body,
    url: rawUrl || null,
    origin,
    source,
    kind,
    severity,
    createdAtMs,
    read: Boolean(candidate.read),
  };
};

const sortAndTrimNotifications = (items: AppNotificationItem[]): AppNotificationItem[] =>
  [...items]
    .sort((left, right) => right.createdAtMs - left.createdAtMs)
    .slice(0, APP_NOTIFICATION_MAX_ITEMS);

const writeNotificationsToStorage = (items: AppNotificationItem[]): void => {
  window.localStorage.setItem(APP_NOTIFICATIONS_KEY, JSON.stringify(sortAndTrimNotifications(items)));
};

const migrateLegacyBrowserPushes = (): AppNotificationItem[] => {
  const raw = window.localStorage.getItem(LEGACY_BROWSER_PUSHES_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    const migrated = parsed
      .map((entry): AppNotificationItem | null => {
        const normalized = normalizeNotificationEntry(entry);
        if (!normalized) {
          return null;
        }

        return {
          ...normalized,
          kind: 'browser',
          severity: 'info',
          source:
            normalized.source === 'app' ? 'unknown' : normalized.source,
        };
      })
      .filter((item): item is AppNotificationItem => Boolean(item));

    if (migrated.length > 0) {
      writeNotificationsToStorage(migrated);
    }
    window.localStorage.removeItem(LEGACY_BROWSER_PUSHES_KEY);
    return migrated;
  } catch {
    return [];
  }
};

export const readStoredNotifications = (): AppNotificationItem[] => {
  const raw = window.localStorage.getItem(APP_NOTIFICATIONS_KEY);
  if (!raw) {
    return migrateLegacyBrowserPushes();
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return sortAndTrimNotifications(
      parsed
        .map((entry) => normalizeNotificationEntry(entry))
        .filter((item): item is AppNotificationItem => Boolean(item)),
    );
  } catch {
    return [];
  }
};

export const writeStoredNotifications = (items: AppNotificationItem[]): void => {
  writeNotificationsToStorage(items);
  window.dispatchEvent(new CustomEvent(APP_NOTIFICATIONS_UPDATED_EVENT));
};

export const appendStoredNotification = (item: AppNotificationItem): void => {
  const existing = readStoredNotifications();
  writeStoredNotifications([item, ...existing]);
};

export const onStoredNotificationsChanged = (listener: () => void): (() => void) => {
  const handleNotificationsUpdated = (): void => {
    listener();
  };
  const handleStorage = (event: StorageEvent): void => {
    if (event.key === APP_NOTIFICATIONS_KEY || event.key === LEGACY_BROWSER_PUSHES_KEY) {
      listener();
    }
  };

  window.addEventListener(APP_NOTIFICATIONS_UPDATED_EVENT, handleNotificationsUpdated);
  window.addEventListener('storage', handleStorage);

  return () => {
    window.removeEventListener(APP_NOTIFICATIONS_UPDATED_EVENT, handleNotificationsUpdated);
    window.removeEventListener('storage', handleStorage);
  };
};

export const readStoredBrowserPushes = readStoredNotifications;
export const writeStoredBrowserPushes = writeStoredNotifications;
export const onStoredBrowserPushesChanged = onStoredNotificationsChanged;
