import * as React from 'react';
import { FileText, FolderOpen, Hash, Search } from 'lucide-react';
import { Dialog, DialogContent } from '@renderer/components/ui/dialog';
import { cn } from '@renderer/lib/cn';

export interface CommandPaletteItem {
  id: string;
  section: string;
  title: string;
  subtitle?: string;
  keywords?: string;
  icon?: 'file' | 'folder' | 'thread';
  onPreview?: () => void;
  onSelect: () => void;
}

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: CommandPaletteItem[];
  placeholder?: string;
  emptyMessage?: string;
  filterItems?: boolean;
  loading?: boolean;
  onQueryChange?: (query: string) => void;
  query?: string;
  sectionOrder?: string[];
}

const defaultSectionOrder = ['Workspace', 'Threads', 'Files', 'Actions'];

export const CommandPalette = ({
  open,
  onOpenChange,
  items,
  placeholder = 'Type a command or search threads',
  emptyMessage = 'No results',
  filterItems = true,
  loading = false,
  onQueryChange,
  query: controlledQuery,
  sectionOrder = defaultSectionOrder,
}: CommandPaletteProps): JSX.Element => {
  const [uncontrolledQuery, setUncontrolledQuery] = React.useState('');
  const [selectedItemId, setSelectedItemId] = React.useState<string | null>(null);
  const [hoveredItemId, setHoveredItemId] = React.useState<string | null>(null);
  const [isDarkTheme, setIsDarkTheme] = React.useState(
    document.documentElement.dataset.zeroadeTheme === 'dark',
  );
  const itemButtonByIdRef = React.useRef(new Map<string, HTMLButtonElement>());
  const suppressNextPreviewRef = React.useRef(false);
  const query = controlledQuery ?? uncontrolledQuery;
  const activeItemId = hoveredItemId ?? selectedItemId;

  React.useEffect(() => {
    const handleThemeChange = (): void => {
      setIsDarkTheme(document.documentElement.dataset.zeroadeTheme === 'dark');
    };

    window.addEventListener('zeroade-ui-preferences-changed', handleThemeChange);
    return () => {
      window.removeEventListener('zeroade-ui-preferences-changed', handleThemeChange);
    };
  }, []);

  React.useEffect(() => {
    if (!open) {
      setUncontrolledQuery('');
      setSelectedItemId(null);
      setHoveredItemId(null);
      suppressNextPreviewRef.current = false;
      onQueryChange?.('');
    }
  }, [onQueryChange, open]);

  const handleQueryChange = React.useCallback(
    (nextQuery: string): void => {
      if (controlledQuery === undefined) {
        setUncontrolledQuery(nextQuery);
      }

      onQueryChange?.(nextQuery);
    },
    [controlledQuery, onQueryChange],
  );

  const filteredItems = React.useMemo(() => {
    if (!filterItems) {
      return items;
    }

    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return items;
    }

    return items.filter((item) => {
      const haystack = `${item.title} ${item.subtitle ?? ''} ${item.keywords ?? ''}`.toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [filterItems, items, query]);

  const groupedItems = React.useMemo(() => {
    const groups = new Map<string, CommandPaletteItem[]>();

    for (const item of filteredItems) {
      const existing = groups.get(item.section) ?? [];
      existing.push(item);
      groups.set(item.section, existing);
    }

    const orderedSections = [
      ...sectionOrder,
      ...Array.from(groups.keys()).filter((section) => !sectionOrder.includes(section)),
    ];

    return orderedSections
      .map((section) => ({
        section,
        items: groups.get(section) ?? [],
      }))
      .filter((group) => group.items.length > 0);
  }, [filteredItems, sectionOrder]);

  const orderedItems = React.useMemo(
    () => groupedItems.flatMap((group) => group.items),
    [groupedItems],
  );

  React.useEffect(() => {
    if (orderedItems.length === 0) {
      setSelectedItemId(null);
      setHoveredItemId(null);
      suppressNextPreviewRef.current = false;
      return;
    }

    setSelectedItemId((previous) => {
      if (previous && orderedItems.some((item) => item.id === previous)) {
        return previous;
      }

      suppressNextPreviewRef.current = true;
      return orderedItems[0].id;
    });
    setHoveredItemId((previous) =>
      previous && orderedItems.some((item) => item.id === previous) ? previous : null,
    );
  }, [orderedItems]);

  React.useEffect(() => {
    if (!activeItemId) {
      return;
    }

    itemButtonByIdRef.current.get(activeItemId)?.scrollIntoView({
      block: 'nearest',
    });
  }, [activeItemId]);

  React.useEffect(() => {
    if (!activeItemId) {
      return;
    }

    if (suppressNextPreviewRef.current) {
      suppressNextPreviewRef.current = false;
      return;
    }

    orderedItems.find((item) => item.id === activeItemId)?.onPreview?.();
  }, [activeItemId, orderedItems]);

  const selectItem = React.useCallback(
    (item: CommandPaletteItem): void => {
      item.onSelect();
      onOpenChange(false);
    },
    [onOpenChange],
  );

  const moveActiveItem = React.useCallback(
    (direction: -1 | 1): void => {
      if (orderedItems.length === 0) {
        return;
      }

      setHoveredItemId(null);
      setSelectedItemId((previous) => {
        const currentIndex = previous
          ? orderedItems.findIndex((item) => item.id === previous)
          : -1;

        if (currentIndex < 0) {
          return direction > 0
            ? orderedItems[0]?.id ?? null
            : orderedItems[orderedItems.length - 1]?.id ?? null;
        }

        const nextIndex =
          (currentIndex + direction + orderedItems.length) % orderedItems.length;
        suppressNextPreviewRef.current = false;
        return orderedItems[nextIndex]?.id ?? previous;
      });
    },
    [orderedItems],
  );

  const handleInputKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>): void => {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        moveActiveItem(1);
        return;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        moveActiveItem(-1);
        return;
      }

      if (event.key === 'Enter' && activeItemId) {
        const activeItem = orderedItems.find((item) => item.id === activeItemId);
        if (!activeItem) {
          return;
        }

        event.preventDefault();
        selectItem(activeItem);
      }
    },
    [activeItemId, moveActiveItem, orderedItems, selectItem],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="no-drag max-w-[620px] border-0 bg-transparent p-0 shadow-none"
      >
        <div
          className={cn(
            'relative max-h-[76vh] overflow-hidden rounded-[22px] backdrop-blur-[30px] backdrop-saturate-150',
            isDarkTheme
              ? 'border border-white/10 bg-[#111215]/72 text-stone-100 shadow-[0_34px_90px_-42px_rgba(0,0,0,0.82),0_1px_0_rgba(255,255,255,0.06)_inset,0_22px_38px_-30px_rgba(255,255,255,0.03)_inset]'
              : 'border border-stone-200/85 bg-white/32 shadow-[0_30px_90px_-42px_rgba(15,23,42,0.45),0_1px_0_rgba(255,255,255,0.65)_inset,0_20px_34px_-28px_rgba(255,255,255,0.78)_inset]',
          )}
        >
          <div
            aria-hidden="true"
            className={cn(
              'pointer-events-none absolute inset-x-0 top-0 h-24',
              isDarkTheme
                ? 'bg-[linear-gradient(180deg,rgba(255,255,255,0.08),rgba(255,255,255,0.015),transparent)]'
                : 'bg-[linear-gradient(180deg,rgba(255,255,255,0.76),rgba(255,255,255,0.24),transparent)]',
            )}
          />
          <div
            aria-hidden="true"
            className={cn(
              'pointer-events-none absolute inset-x-8 top-0 h-px',
              isDarkTheme ? 'bg-transparent' : 'bg-white/80',
            )}
          />

          <div className="relative p-3">
            <label
              className={cn(
                'flex items-center gap-2 rounded-xl px-3 py-2',
                isDarkTheme
                  ? 'border border-white/10 bg-black/26 shadow-[0_1px_0_rgba(255,255,255,0.05)_inset]'
                  : 'border border-white/80 bg-white shadow-[0_1px_0_rgba(255,255,255,0.82)_inset,0_10px_24px_-20px_rgba(15,23,42,0.18)]',
              )}
            >
              <Search className={cn('h-4 w-4', isDarkTheme ? 'text-stone-400' : 'text-stone-500')} />
              <input
                autoFocus
                value={query}
                onChange={(event) => handleQueryChange(event.target.value)}
                onKeyDown={handleInputKeyDown}
                placeholder={placeholder}
                className={cn(
                  'w-full bg-transparent text-sm focus:outline-none',
                  isDarkTheme
                    ? 'text-stone-100 placeholder:text-stone-500'
                    : 'text-stone-700 placeholder:text-stone-500',
                )}
              />
            </label>
          </div>

          <div
            className={cn(
              'relative overflow-y-auto px-3 py-3',
              filterItems ? 'max-h-[56vh]' : 'h-[52vh] min-h-[280px] max-h-[56vh]',
            )}
          >
            <div
              className="space-y-5 pb-2"
              onMouseLeave={() => {
                setHoveredItemId(null);
              }}
            >
              {groupedItems.length === 0 && (
                <div
                  className={cn(
                    'rounded-xl px-3 py-2 text-sm backdrop-blur-md',
                    isDarkTheme ? 'bg-white/6 text-stone-400' : 'bg-white/18 text-stone-500',
                  )}
                >
                  {loading ? 'Searching…' : emptyMessage}
                </div>
              )}

              {groupedItems.map((group) => (
                <section key={group.section} className="space-y-2.5">
                  <h3
                    className={cn(
                      'px-1 text-[13px] font-medium',
                      isDarkTheme ? 'text-stone-400' : 'text-stone-600/90',
                    )}
                  >
                    {group.section}
                  </h3>

                  <div className="space-y-1.5">
                    {group.items.map((item) => (
                      <button
                        type="button"
                        key={item.id}
                        ref={(element) => {
                          if (element) {
                            itemButtonByIdRef.current.set(item.id, element);
                            return;
                          }

                          itemButtonByIdRef.current.delete(item.id);
                        }}
                        aria-selected={activeItemId === item.id}
                        className={cn(
                          'no-drag flex w-full items-start gap-2 rounded-xl border border-transparent px-2.5 py-2 text-left',
                          activeItemId === item.id &&
                            (isDarkTheme ? 'bg-white/10' : 'bg-stone-200'),
                        )}
                        onMouseEnter={() => {
                          suppressNextPreviewRef.current = false;
                          setHoveredItemId(item.id);
                        }}
                        onFocus={() => {
                          suppressNextPreviewRef.current = false;
                          setSelectedItemId(item.id);
                          setHoveredItemId(null);
                        }}
                        onClick={() => selectItem(item)}
                      >
                        <span
                          className={cn(
                            'mt-0.5 p-1',
                            isDarkTheme ? 'text-stone-400' : 'text-stone-500',
                          )}
                        >
                          {item.icon === 'folder' ? (
                            <FolderOpen className="h-3.5 w-3.5" />
                          ) : item.icon === 'file' ? (
                            <FileText className="h-3.5 w-3.5" />
                          ) : (
                            <Hash className="h-3.5 w-3.5" />
                          )}
                        </span>

                        <span className="min-w-0">
                          <span
                            className={cn(
                              'block truncate text-sm font-normal',
                              isDarkTheme ? 'text-stone-100' : 'text-stone-700',
                            )}
                          >
                            {item.title}
                          </span>
                          {item.subtitle ? (
                            <span
                              className={cn(
                                'block truncate text-xs',
                                isDarkTheme ? 'text-stone-500' : 'text-stone-500',
                              )}
                            >
                              {item.subtitle}
                            </span>
                          ) : null}
                        </span>
                      </button>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
