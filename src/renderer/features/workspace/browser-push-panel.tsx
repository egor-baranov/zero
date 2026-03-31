import * as React from 'react';
import { Bell } from 'lucide-react';
import { ScrollArea } from '@renderer/components/ui/scroll-area';
import { cn } from '@renderer/lib/cn';
import type { BrowserPushItem } from '@renderer/store/browser-pushes';

interface BrowserPushPanelProps {
  open: boolean;
  items: BrowserPushItem[];
  onOpenUrl: (url: string) => void;
  onRequestClose: () => void;
}

const BROWSER_PUSH_PANEL_WIDTH_KEY = 'zeroade.notifications-panel.width.v1';
const BROWSER_PUSH_PANEL_WIDTH_DEFAULT = 336;
const BROWSER_PUSH_PANEL_WIDTH_OPEN = 250;
const BROWSER_PUSH_PANEL_WIDTH_MIN = 0;
const BROWSER_PUSH_PANEL_WIDTH_MAX = 560;
const BROWSER_PUSH_PANEL_COLLAPSE_THRESHOLD = 48;

const clampWidth = (width: number, viewportWidth: number): number => {
  const maxFromViewport = Math.max(BROWSER_PUSH_PANEL_WIDTH_OPEN, Math.floor(viewportWidth * 0.6));
  return Math.min(
    BROWSER_PUSH_PANEL_WIDTH_MAX,
    Math.max(BROWSER_PUSH_PANEL_WIDTH_MIN, Math.min(width, maxFromViewport)),
  );
};

const readStoredPanelWidth = (): number => {
  if (typeof window === 'undefined') {
    return BROWSER_PUSH_PANEL_WIDTH_DEFAULT;
  }

  const raw = window.localStorage.getItem(BROWSER_PUSH_PANEL_WIDTH_KEY);
  const parsed = Number(raw);

  if (!Number.isFinite(parsed)) {
    return clampWidth(BROWSER_PUSH_PANEL_WIDTH_DEFAULT, window.innerWidth);
  }

  return clampWidth(parsed, window.innerWidth);
};

const formatPushTimestamp = (createdAtMs: number): string => {
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
      .format(createdAtMs)
      .replace(/,\s*/g, ' ')
      .trim();
  } catch {
    return '';
  }
};

export const BrowserPushPanel = ({
  open,
  items,
  onOpenUrl,
  onRequestClose,
}: BrowserPushPanelProps): JSX.Element => {
  const [panelWidth, setPanelWidth] = React.useState<number>(() => readStoredPanelWidth());
  const [isResizing, setIsResizing] = React.useState(false);
  const resizePointerIdRef = React.useRef<number | null>(null);
  const resizeHandleRef = React.useRef<HTMLButtonElement | null>(null);

  React.useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(BROWSER_PUSH_PANEL_WIDTH_KEY, String(panelWidth));
  }, [panelWidth]);

  React.useEffect(() => {
    if (!open) {
      return;
    }

    const nextWidth = clampWidth(BROWSER_PUSH_PANEL_WIDTH_OPEN, window.innerWidth);
    setPanelWidth(nextWidth);
    window.localStorage.setItem(BROWSER_PUSH_PANEL_WIDTH_KEY, String(nextWidth));
  }, [open]);

  React.useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const clampToViewport = (): void => {
      setPanelWidth((previous) => clampWidth(previous, window.innerWidth));
    };

    window.addEventListener('resize', clampToViewport);
    return () => {
      window.removeEventListener('resize', clampToViewport);
    };
  }, []);

  const stopResizing = React.useCallback((): void => {
    const pointerId = resizePointerIdRef.current;
    resizePointerIdRef.current = null;
    setIsResizing(false);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';

    if (pointerId !== null && resizeHandleRef.current?.hasPointerCapture(pointerId)) {
      resizeHandleRef.current.releasePointerCapture(pointerId);
    }
  }, []);

  React.useEffect(() => {
    const handlePointerMove = (event: PointerEvent): void => {
      if (resizePointerIdRef.current === null) {
        return;
      }

      if (event.pointerId !== resizePointerIdRef.current) {
        return;
      }

      const rawWidth = window.innerWidth - event.clientX;
      if (rawWidth <= BROWSER_PUSH_PANEL_COLLAPSE_THRESHOLD) {
        const resetWidth = clampWidth(BROWSER_PUSH_PANEL_WIDTH_OPEN, window.innerWidth);
        setPanelWidth(resetWidth);
        window.localStorage.setItem(BROWSER_PUSH_PANEL_WIDTH_KEY, String(resetWidth));
        stopResizing();
        onRequestClose();
        return;
      }

      const next = clampWidth(rawWidth, window.innerWidth);
      setPanelWidth(next);
    };

    const handlePointerUp = (event: PointerEvent): void => {
      if (resizePointerIdRef.current === null) {
        return;
      }

      if (event.pointerId !== resizePointerIdRef.current) {
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
    };
  }, [onRequestClose, stopResizing]);

  const startResizing = React.useCallback((event: React.PointerEvent<HTMLButtonElement>): void => {
    event.preventDefault();
    event.stopPropagation();
    resizePointerIdRef.current = event.pointerId;
    setIsResizing(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // no-op
    }
  }, []);

  return (
    <aside
      style={{ width: open ? panelWidth : 0 }}
      className={cn(
        'zeroade-notifications-panel relative h-full shrink-0 overflow-hidden border-l border-l-[var(--zeroade-shell-divider)] bg-[#fdfdfff2] shadow-[-18px_0_36px_-30px_rgba(28,28,33,0.18)] backdrop-blur-xl transition-[width] duration-200 ease-out',
        isResizing && 'transition-none',
        !open && 'border-l-0',
      )}
    >
      <button
        ref={resizeHandleRef}
        type="button"
        aria-label="Resize notifications panel"
        className={cn(
          'zeroade-notifications-resize-handle no-drag group absolute inset-y-0 left-0 z-10 w-4 cursor-col-resize',
          !open && 'pointer-events-none opacity-0',
        )}
        onPointerDown={startResizing}
        onLostPointerCapture={stopResizing}
      >
        <span className="zeroade-notifications-resize-line absolute inset-y-0 left-0 w-px bg-transparent transition-colors group-hover:bg-stone-300/80" />
      </button>

      <div
        className={cn(
          'flex h-full w-full min-w-0 flex-col transition-opacity duration-150',
          open ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
      >
        {items.length === 0 ? (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 text-center">
            <div className="zeroade-notifications-empty-icon flex h-11 w-11 items-center justify-center rounded-2xl border border-stone-200/80 bg-stone-100 text-stone-500">
              <Bell className="h-5 w-5" />
            </div>
            <p className="zeroade-notifications-empty-title mt-4 text-[13px] font-medium text-stone-700">
              No notifications yet
            </p>
            <p className="zeroade-notifications-empty-body mt-1 text-[11px] leading-5 text-stone-500">
              App and browser notifications will be saved here and kept after reload.
            </p>
          </div>
        ) : (
          <ScrollArea className="min-h-0 flex-1">
            <div className="space-y-2 px-3 py-3">
              {items.map((item) => {
                const cardClass = cn(
                  'zeroade-notification-card w-full min-w-0 rounded-2xl border px-3 py-3 text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.58)] transition-[border-color,background-color,box-shadow] duration-150',
                  item.url
                    ? 'no-drag hover:border-stone-300 hover:bg-white/95'
                    : 'cursor-default',
                  'border-stone-200/80 bg-white/80',
                  !item.read && 'zeroade-notification-card-unread border-stone-300/80 bg-stone-100/70',
                );

                const content = (
                  <div className="flex min-w-0 items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="min-w-0">
                        <p className="zeroade-notification-title truncate text-[12px] font-medium text-stone-800">
                          {item.title}
                        </p>
                      </div>
                      {item.body ? (
                        <p className="zeroade-notification-body mt-1 line-clamp-3 break-words text-[11px] leading-5 text-stone-500">
                          {item.body}
                        </p>
                      ) : null}
                      <div className="zeroade-notification-meta mt-2 flex w-full items-center justify-end text-[10px] text-stone-400">
                        <span>{formatPushTimestamp(item.createdAtMs)}</span>
                      </div>
                    </div>
                    {!item.read ? (
                      <span
                        className="zeroade-notification-unread-dot mt-1 inline-flex h-2.5 w-2.5 shrink-0 rounded-full bg-stone-800"
                      />
                    ) : null}
                  </div>
                );

                if (!item.url) {
                  return (
                    <div key={item.id} className={cardClass}>
                      {content}
                    </div>
                  );
                }

                return (
                  <button
                    key={item.id}
                    type="button"
                    className={cardClass}
                    onClick={() => {
                      onOpenUrl(item.url as string);
                    }}
                  >
                    {content}
                  </button>
                );
              })}
            </div>
          </ScrollArea>
        )}
      </div>
    </aside>
  );
};
