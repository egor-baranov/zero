import * as React from 'react';
import { Bell } from 'lucide-react';
import { ScrollArea } from '@renderer/components/ui/scroll-area';
import { cn } from '@renderer/lib/cn';
import type { BrowserPushItem } from '@renderer/store/browser-pushes';

interface BrowserPushPanelProps {
  open: boolean;
  items: BrowserPushItem[];
  onOpenUrl: (url: string) => void;
}

const BROWSER_PUSH_PANEL_WIDTH_KEY = 'zeroade.notifications-panel.width.v1';
const BROWSER_PUSH_PANEL_WIDTH_DEFAULT = 336;
const BROWSER_PUSH_PANEL_WIDTH_MIN = 260;
const BROWSER_PUSH_PANEL_WIDTH_MAX = 560;

const clampWidth = (width: number, viewportWidth: number): number => {
  const maxFromViewport = Math.max(BROWSER_PUSH_PANEL_WIDTH_MIN, Math.floor(viewportWidth * 0.6));
  return Math.min(BROWSER_PUSH_PANEL_WIDTH_MAX, Math.max(BROWSER_PUSH_PANEL_WIDTH_MIN, Math.min(width, maxFromViewport)));
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
    }).format(createdAtMs);
  } catch {
    return '';
  }
};

export const BrowserPushPanel = ({
  open,
  items,
  onOpenUrl,
}: BrowserPushPanelProps): JSX.Element => {
  const [panelWidth, setPanelWidth] = React.useState<number>(() => readStoredPanelWidth());
  const resizePointerIdRef = React.useRef<number | null>(null);
  const resizeHandleRef = React.useRef<HTMLButtonElement | null>(null);

  React.useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(BROWSER_PUSH_PANEL_WIDTH_KEY, String(panelWidth));
  }, [panelWidth]);

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

      const next = clampWidth(window.innerWidth - event.clientX, window.innerWidth);
      setPanelWidth(next);
    };

    const handlePointerUp = (): void => {
      if (resizePointerIdRef.current === null) {
        return;
      }

      stopResizing();
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('blur', stopResizing);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('blur', stopResizing);
    };
  }, [stopResizing]);

  const startResizing = (event: React.PointerEvent<HTMLButtonElement>): void => {
    resizePointerIdRef.current = event.pointerId;
    resizeHandleRef.current?.setPointerCapture(event.pointerId);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    event.preventDefault();
  };

  return (
    <aside
      style={{ width: open ? panelWidth : 0 }}
      className={cn(
        'relative h-full shrink-0 overflow-hidden border-l border-stone-200 bg-[#fdfdfff2] backdrop-blur-xl transition-[width] duration-200 ease-out',
        !open && 'border-l-transparent',
      )}
    >
      <button
        ref={resizeHandleRef}
        type="button"
        aria-label="Resize notifications panel"
        className={cn(
          'no-drag group absolute inset-y-0 left-0 z-10 w-2 -translate-x-1 cursor-col-resize',
          !open && 'pointer-events-none opacity-0',
        )}
        onPointerDown={startResizing}
      >
        <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors group-hover:bg-stone-300/80" />
      </button>

      <div
        className={cn(
          'flex h-full w-full min-w-0 flex-col transition-opacity duration-150',
          open ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
      >
        {items.length === 0 ? (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 text-center">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-stone-100 text-stone-500">
              <Bell className="h-5 w-5" />
            </div>
            <p className="mt-4 text-[13px] font-medium text-stone-700">No notifications yet</p>
            <p className="mt-1 text-[11px] leading-5 text-stone-500">
              App and browser notifications will be saved here and kept after reload.
            </p>
          </div>
        ) : (
          <ScrollArea className="min-h-0 flex-1">
            <div className="space-y-2 px-3 py-3">
              {items.map((item) => {
                const cardClass = cn(
                  'w-full min-w-0 rounded-2xl border px-3 py-3 text-left transition-colors',
                  item.url
                    ? 'no-drag hover:border-stone-300 hover:bg-white'
                    : 'cursor-default',
                  item.severity === 'error'
                    ? 'border-rose-200/80 bg-rose-50/70'
                    : 'border-stone-200/80 bg-white/80',
                  !item.read &&
                    (item.severity === 'error'
                      ? 'border-rose-300/80 bg-rose-50'
                      : 'border-stone-300/80 bg-stone-100/70'),
                );

                const content = (
                  <div className="flex min-w-0 items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-2">
                        <p className="truncate text-[12px] font-medium text-stone-800">
                          {item.title}
                        </p>
                        <span
                          className={cn(
                            'shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-[0.08em]',
                            item.kind === 'app'
                              ? 'bg-stone-200/80 text-stone-600'
                              : 'bg-stone-100 text-stone-500',
                          )}
                        >
                          {item.kind}
                        </span>
                      </div>
                      {item.body ? (
                        <p className="mt-1 line-clamp-3 break-words text-[11px] leading-5 text-stone-500">
                          {item.body}
                        </p>
                      ) : null}
                      <div className="mt-2 flex items-center gap-1.5 text-[10px] text-stone-400">
                        <span className="truncate">{item.origin}</span>
                        <span>&bull;</span>
                        <span>{formatPushTimestamp(item.createdAtMs)}</span>
                      </div>
                    </div>
                    {!item.read ? (
                      <span
                        className={cn(
                          'mt-1 inline-flex h-2.5 w-2.5 shrink-0 rounded-full',
                          item.severity === 'error' ? 'bg-rose-500' : 'bg-stone-800',
                        )}
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
