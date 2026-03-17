import * as React from 'react';
import { FolderOpen, Hash, Search } from 'lucide-react';
import { Dialog, DialogContent } from '@renderer/components/ui/dialog';
import { cn } from '@renderer/lib/cn';

export interface CommandPaletteItem {
  id: string;
  section: string;
  title: string;
  subtitle?: string;
  keywords?: string;
  icon?: 'folder' | 'thread';
  onSelect: () => void;
}

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: CommandPaletteItem[];
}

const sectionOrder = ['Workspace', 'Threads', 'Actions'];

export const CommandPalette = ({
  open,
  onOpenChange,
  items,
}: CommandPaletteProps): JSX.Element => {
  const [query, setQuery] = React.useState('');

  React.useEffect(() => {
    if (!open) {
      setQuery('');
    }
  }, [open]);

  const filteredItems = React.useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return items;
    }

    return items.filter((item) => {
      const haystack = `${item.title} ${item.subtitle ?? ''} ${item.keywords ?? ''}`.toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [items, query]);

  const groupedItems = React.useMemo(() => {
    const groups = new Map<string, CommandPaletteItem[]>();

    for (const item of filteredItems) {
      const existing = groups.get(item.section) ?? [];
      existing.push(item);
      groups.set(item.section, existing);
    }

    return sectionOrder
      .map((section) => ({
        section,
        items: groups.get(section) ?? [],
      }))
      .filter((group) => group.items.length > 0);
  }, [filteredItems]);

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
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Type a command or search threads"
              className="w-full bg-transparent text-sm text-stone-700 placeholder:text-stone-400 focus:outline-none"
            />
          </label>
        </div>

        <div className="max-h-[56vh] overflow-y-auto px-3 py-3">
          <div className="space-y-5 pb-2">
            {groupedItems.length === 0 && (
              <div className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-500">
                No results
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
                      className={cn(
                        'no-drag flex w-full items-start gap-2 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-stone-100',
                      )}
                      onClick={() => {
                        item.onSelect();
                        onOpenChange(false);
                      }}
                    >
                      <span className="mt-0.5 rounded-md bg-stone-100 p-1 text-stone-500">
                        {item.icon === 'folder' ? (
                          <FolderOpen className="h-3.5 w-3.5" />
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
