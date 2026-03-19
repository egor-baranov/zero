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

const BROWSER_PUSH_PANEL_WIDTH = 336;

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
  return (
    <aside
      style={{ width: open ? BROWSER_PUSH_PANEL_WIDTH : 0 }}
      className={cn(
        'relative h-full shrink-0 overflow-hidden border-l border-stone-200 bg-[#fdfdfff2] backdrop-blur-xl transition-[width] duration-200 ease-out',
        !open && 'border-l-transparent',
      )}
    >
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
                  'w-full rounded-2xl border px-3 py-3 text-left transition-colors',
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
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
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
                        <p className="mt-1 line-clamp-3 text-[11px] leading-5 text-stone-500">
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
