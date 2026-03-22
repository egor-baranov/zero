import * as React from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { ScrollArea } from '@renderer/components/ui/scroll-area';
import { Dialog, DialogContent } from '@renderer/components/ui/dialog';
import { cn } from '@renderer/lib/cn';
import type { RunConfigurationRecord } from '@renderer/store/use-run-configurations';

interface RunConfigurationDialogProps {
  open: boolean;
  configurations: RunConfigurationRecord[];
  selectedConfigurationId: string;
  onOpenChange: (open: boolean) => void;
  onSelectConfiguration: (configurationId: string) => void;
  onSaveConfiguration: (input: {
    id?: string;
    name: string;
    command: string;
  }) => RunConfigurationRecord | null;
  onDeleteConfiguration: (configurationId: string) => void;
}

interface DraftConfigurationRow {
  localId: string;
  id: string | null;
  name: string;
  command: string;
}

const createLocalRowId = (): string =>
  `run-config-row-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const createDraftRow = (
  configuration?: RunConfigurationRecord,
): DraftConfigurationRow => ({
  localId: configuration?.id ?? createLocalRowId(),
  id: configuration?.id ?? null,
  name: configuration?.name ?? '',
  command: configuration?.command ?? '',
});

const normalizeCommand = (value: string): string =>
  value
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trim();

export const RunConfigurationDialog = ({
  open,
  configurations,
  selectedConfigurationId,
  onOpenChange,
  onSelectConfiguration,
  onSaveConfiguration,
  onDeleteConfiguration,
}: RunConfigurationDialogProps): JSX.Element => {
  const [rows, setRows] = React.useState<DraftConfigurationRow[]>([]);
  const [expandedRowId, setExpandedRowId] = React.useState<string | null>(null);
  const saveTimeoutsRef = React.useRef<Record<string, number>>({});
  const wasOpenRef = React.useRef(false);

  const clearPendingSave = React.useCallback((localId: string): void => {
    const timeoutId = saveTimeoutsRef.current[localId];
    if (timeoutId !== undefined) {
      window.clearTimeout(timeoutId);
      delete saveTimeoutsRef.current[localId];
    }
  }, []);

  React.useEffect(() => {
    if (open && !wasOpenRef.current) {
      setRows(configurations.map((configuration) => createDraftRow(configuration)));
      setExpandedRowId(null);
    }

    if (!open && wasOpenRef.current) {
      Object.values(saveTimeoutsRef.current).forEach((timeoutId) => {
        window.clearTimeout(timeoutId);
      });
      saveTimeoutsRef.current = {};
      setRows([]);
      setExpandedRowId(null);
    }

    wasOpenRef.current = open;
  }, [configurations, open, selectedConfigurationId]);

  React.useEffect(
    () => () => {
      Object.values(saveTimeoutsRef.current).forEach((timeoutId) => {
        window.clearTimeout(timeoutId);
      });
    },
    [],
  );

  const persistRow = React.useCallback(
    (row: DraftConfigurationRow): RunConfigurationRecord | null => {
      const saved = onSaveConfiguration({
        id: row.id ?? undefined,
        name: row.name,
        command: row.command,
      });
      if (!saved) {
        return null;
      }

      setRows((previous) =>
        previous.some((candidate) => candidate.localId === row.localId)
          ? previous.map((candidate) =>
              candidate.localId === row.localId
                ? {
                    ...candidate,
                    localId: saved.id,
                    id: saved.id,
                    name: saved.name,
                    command: saved.command,
                  }
                : candidate,
            )
          : [
              ...previous,
              {
                localId: saved.id,
                id: saved.id,
                name: saved.name,
                command: saved.command,
              },
            ],
      );
      setExpandedRowId((previous) => (previous === row.localId ? saved.id : previous));
      onSelectConfiguration(saved.id);
      return saved;
    },
    [onSaveConfiguration, onSelectConfiguration],
  );

  const schedulePersist = React.useCallback(
    (row: DraftConfigurationRow): void => {
      clearPendingSave(row.localId);

      if (normalizeCommand(row.command).length === 0) {
        return;
      }

      saveTimeoutsRef.current[row.localId] = window.setTimeout(() => {
        delete saveTimeoutsRef.current[row.localId];
        persistRow(row);
      }, 250);
    },
    [clearPendingSave, persistRow],
  );

  const handleRowChange = React.useCallback(
    (localId: string, field: 'name' | 'command', value: string): void => {
      let nextRow: DraftConfigurationRow | null = null;

      setRows((previous) =>
        previous.map((row) => {
          if (row.localId !== localId) {
            return row;
          }

          nextRow = {
            ...row,
            [field]: value,
          };
          return nextRow;
        }),
      );

      if (nextRow) {
        schedulePersist(nextRow);
      }
    },
    [schedulePersist],
  );

  const handleDeleteRow = React.useCallback(
    (row: DraftConfigurationRow): void => {
      clearPendingSave(row.localId);

      if (row.id) {
        onDeleteConfiguration(row.id);
      }

      setRows((previous) => previous.filter((candidate) => candidate.localId !== row.localId));
      setExpandedRowId((previous) => (previous === row.localId ? null : previous));
    },
    [clearPendingSave, onDeleteConfiguration],
  );

  const handleAddRow = React.useCallback((): void => {
    const existingDraft = rows.find((row) => row.id === null);
    if (existingDraft) {
      setExpandedRowId(existingDraft.localId);
      return;
    }

    const nextRow = createDraftRow();
    setRows((previous) => [...previous, nextRow]);
    setExpandedRowId(nextRow.localId);
  }, [rows]);

  const renderConfigurationItem = (row: DraftConfigurationRow): JSX.Element => {
    const isExpanded = expandedRowId === row.localId;
    const showActions = true;

    return (
      <div
        key={row.localId}
        className={cn(
          'group/row rounded-xl bg-stone-50/80 transition-colors hover:bg-stone-100/80',
          isExpanded ? 'p-2' : 'px-2 py-1.5',
        )}
      >
        {isExpanded ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <input
                value={row.name}
                onChange={(event) => {
                  handleRowChange(row.localId, 'name', event.target.value);
                }}
                className="no-drag h-8 min-w-0 flex-1 rounded-[10px] border-transparent bg-stone-100/90 px-2.5 text-[13px] text-stone-800 placeholder:text-stone-400 focus:outline-none"
                placeholder="Name"
              />
              {showActions ? (
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    aria-label="Close configuration editor"
                    className="no-drag inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-stone-500 transition-[background-color,color] hover:bg-stone-100 hover:text-stone-700 focus:outline-none"
                    onClick={() => {
                      setExpandedRowId((previous) =>
                        previous === row.localId ? null : row.localId,
                      );
                    }}
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    aria-label="Delete configuration"
                    className="no-drag inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-rose-600 transition-[background-color,color] hover:bg-rose-50 focus:outline-none"
                    onClick={() => handleDeleteRow(row)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ) : null}
            </div>
            <input
              value={row.command}
              onChange={(event) => {
                handleRowChange(row.localId, 'command', event.target.value);
              }}
              spellCheck={false}
              className="no-drag h-8 w-full rounded-[10px] border-transparent bg-stone-100/90 px-2.5 font-mono text-[12px] text-stone-800 placeholder:text-stone-400 focus:outline-none"
              placeholder="Terminal command"
            />
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <div className="px-2.5 py-1">
                <div className="truncate text-[13px] font-medium leading-5 text-stone-900">
                  {row.name || 'Name'}
                </div>
                <div className="truncate font-mono text-[11px] leading-4 text-stone-500">
                  {row.command || 'Terminal command'}
                </div>
              </div>
            </div>
            {showActions ? (
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  aria-label="Edit configuration"
                  className="no-drag inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-stone-500 opacity-0 pointer-events-none transition-[opacity,background-color,color] group-hover/row:opacity-100 group-hover/row:pointer-events-auto hover:bg-stone-100 hover:text-stone-700 focus:outline-none"
                  onClick={() => {
                    setExpandedRowId((previous) =>
                      previous === row.localId ? null : row.localId,
                    );
                  }}
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  aria-label="Delete configuration"
                  className="no-drag inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-rose-600 opacity-0 pointer-events-none transition-[opacity,background-color,color] group-hover/row:opacity-100 group-hover/row:pointer-events-auto hover:bg-rose-50 focus:outline-none"
                  onClick={() => handleDeleteRow(row)}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ) : null}
          </div>
        )}
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[760px] overflow-hidden rounded-[20px] p-0">
        <div className="flex h-[420px] max-h-[78vh] flex-col overflow-hidden bg-white">
          <div className="px-4 py-3">
            <h2 className="text-[18px] font-semibold tracking-[-0.02em] text-stone-900">
              Run configurations
            </h2>
          </div>

          <ScrollArea className="min-h-0 flex-1">
            <div className="space-y-2 px-4 py-3">
              {rows.map((row) => renderConfigurationItem(row))}
              <button
                type="button"
                className="inline-flex h-9 items-center justify-center gap-1 rounded-xl bg-stone-50 px-3 text-[13px] font-medium leading-none text-stone-600 transition-colors hover:bg-stone-100 hover:text-stone-800"
                onClick={handleAddRow}
              >
                <Plus className="h-4 w-4 shrink-0" />
                Add
              </button>
            </div>
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  );
};
