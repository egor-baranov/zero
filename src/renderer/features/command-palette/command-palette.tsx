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
  const [activeItemId, setActiveItemId] = React.useState<string | null>(null);
  const itemButtonByIdRef = React.useRef(new Map<string, HTMLButtonElement>());
  const suppressNextPreviewRef = React.useRef(false);
  const query = controlledQuery ?? uncontrolledQuery;

  React.useEffect(() => {
    if (!open) {
      setUncontrolledQuery('');
      setActiveItemId(null);
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
      setActiveItemId(null);
      suppressNextPreviewRef.current = false;
      return;
    }

    setActiveItemId((previous) => {
      if (previous && orderedItems.some((item) => item.id === previous)) {
        return previous;
      }

      suppressNextPreviewRef.current = true;
      return orderedItems[0].id;
    });
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

      setActiveItemId((previous) => {
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
        className="no-drag max-h-[76vh] max-w-[620px] overflow-hidden p-0"
      >
        <div className="p-3">
          <label className="flex items-center gap-2 rounded-xl bg-stone-50 px-3 py-2">
            <Search className="h-4 w-4 text-stone-500" />
            <input
              autoFocus
              value={query}
              onChange={(event) => handleQueryChange(event.target.value)}
              onKeyDown={handleInputKeyDown}
              placeholder={placeholder}
              className="w-full bg-transparent text-sm text-stone-700 placeholder:text-stone-400 focus:outline-none"
            />
          </label>
        </div>

        <div
          className={cn(
            'overflow-y-auto px-3 py-3',
            filterItems ? 'max-h-[56vh]' : 'h-[52vh] min-h-[280px] max-h-[56vh]',
          )}
        >
          <div className="space-y-5 pb-2">
            {groupedItems.length === 0 && (
              <div className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-500">
                {loading ? 'Searching…' : emptyMessage}
              </div>
            )}

            {groupedItems.map((group) => (
              <section key={group.section} className="space-y-2.5">
                <h3 className="px-1 text-[13px] font-medium text-stone-600">
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
                        'no-drag flex w-full items-start gap-2 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-stone-100',
                        activeItemId === item.id && 'bg-stone-100',
                      )}
                      onMouseEnter={() => {
                        suppressNextPreviewRef.current = false;
                        setActiveItemId(item.id);
                      }}
                      onFocus={() => {
                        suppressNextPreviewRef.current = false;
                        setActiveItemId(item.id);
                      }}
                      onClick={() => selectItem(item)}
                    >
                      <span className="mt-0.5 rounded-md bg-stone-100 p-1 text-stone-500">
                        {item.icon === 'folder' ? (
                          <FolderOpen className="h-3.5 w-3.5" />
                        ) : item.icon === 'file' ? (
                          <FileText className="h-3.5 w-3.5" />
                        ) : (
                          <Hash className="h-3.5 w-3.5" />
                        )}
                      </span>

                      <span className="min-w-0">
                        <span className="block truncate text-sm font-normal text-stone-700">
                          {item.title}
                        </span>
                        {item.subtitle ? (
                          <span className="block truncate text-xs text-stone-500">
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
      </DialogContent>
    </Dialog>
  );
};
