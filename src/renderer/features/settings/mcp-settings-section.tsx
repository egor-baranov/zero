import * as React from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { Button } from '@renderer/components/ui/button';
import { cn } from '@renderer/lib/cn';
import {
  createStoredMcpServerId,
  onStoredMcpServersChanged,
  readStoredMcpServers,
  writeStoredMcpServers,
  type StoredMcpServer,
} from '@renderer/store/mcp-servers';

interface DraftStringEntry {
  id: string;
  value: string;
}

interface DraftNameValueEntry {
  id: string;
  name: string;
  value: string;
}

interface McpServerDraft {
  id: string | null;
  name: string;
  transport: 'stdio' | 'http';
  command: string;
  url: string;
  args: DraftStringEntry[];
  env: DraftNameValueEntry[];
  headers: DraftNameValueEntry[];
}

const createDraftEntryId = (): string =>
  `mcp-draft-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const createDraftStringEntry = (value = ''): DraftStringEntry => ({
  id: createDraftEntryId(),
  value,
});

const createDraftNameValueEntry = (name = '', value = ''): DraftNameValueEntry => ({
  id: createDraftEntryId(),
  name,
  value,
});

const createDraft = (server?: StoredMcpServer): McpServerDraft => {
  if (!server) {
    return {
      id: null,
      name: '',
      transport: 'stdio',
      command: '',
      url: '',
      args: [],
      env: [],
      headers: [],
    };
  }

  if (server.transport === 'http') {
    return {
      id: server.id,
      name: server.name,
      transport: 'http',
      command: '',
      url: server.url,
      args: [],
      env: [],
      headers: server.headers.map((entry) => createDraftNameValueEntry(entry.name, entry.value)),
    };
  }

  return {
    id: server.id,
    name: server.name,
    transport: 'stdio',
    command: server.command,
    url: '',
    args: server.args.map((entry) => createDraftStringEntry(entry)),
    env: server.env.map((entry) => createDraftNameValueEntry(entry.name, entry.value)),
    headers: [],
  };
};

const normalizeText = (value: string): string => value.trim();

const toDraftPreview = (server: StoredMcpServer): string => {
  if (server.transport === 'http') {
    return server.url;
  }

  const preview = [server.command, ...server.args].filter(Boolean).join(' ').trim();
  return preview || server.command;
};

const isValidDraft = (draft: McpServerDraft): boolean => {
  const name = normalizeText(draft.name);
  if (!name) {
    return false;
  }

  if (draft.transport === 'http') {
    return normalizeText(draft.url).length > 0;
  }

  return normalizeText(draft.command).length > 0;
};

const toStoredServer = (draft: McpServerDraft): StoredMcpServer => {
  if (draft.transport === 'http') {
    return {
      id: draft.id ?? createStoredMcpServerId(),
      name: normalizeText(draft.name),
      transport: 'http',
      url: normalizeText(draft.url),
      headers: draft.headers
        .map((entry) => ({
          name: normalizeText(entry.name),
          value: entry.value,
        }))
        .filter((entry) => entry.name.length > 0),
    };
  }

  return {
    id: draft.id ?? createStoredMcpServerId(),
    name: normalizeText(draft.name),
    transport: 'stdio',
    command: normalizeText(draft.command),
    args: draft.args
      .map((entry) => entry.value.trim())
      .filter((entry) => entry.length > 0),
    env: draft.env
      .map((entry) => ({
        name: normalizeText(entry.name),
        value: entry.value,
      }))
      .filter((entry) => entry.name.length > 0),
  };
};

export const McpSettingsSection = (): JSX.Element => {
  const [servers, setServers] = React.useState<StoredMcpServer[]>(() => readStoredMcpServers());
  const [draft, setDraft] = React.useState<McpServerDraft | null>(null);

  React.useEffect(() => {
    setServers(readStoredMcpServers());
    return onStoredMcpServersChanged(() => {
      setServers(readStoredMcpServers());
    });
  }, []);

  const handleSave = React.useCallback(() => {
    if (!draft || !isValidDraft(draft)) {
      return;
    }

    const nextServer = toStoredServer(draft);
    const nextServers = draft.id
      ? servers.map((server) => (server.id === draft.id ? nextServer : server))
      : [...servers, nextServer];

    writeStoredMcpServers(nextServers);
    setServers(nextServers);
    setDraft(null);
  }, [draft, servers]);

  const handleDelete = React.useCallback(
    (serverId: string) => {
      const nextServers = servers.filter((server) => server.id !== serverId);
      writeStoredMcpServers(nextServers);
      setServers(nextServers);
      setDraft((previous) => (previous?.id === serverId ? null : previous));
    },
    [servers],
  );

  return (
    <div className="space-y-6">
      <p className="max-w-[620px] text-[14px] text-stone-600">
        Connect external tools and data sources. Saved MCP servers are sent to ACP when a session
        starts or reloads.
      </p>

      <section>
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-[20px] font-semibold text-stone-900">Custom servers</h3>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="h-8 rounded-full border-stone-200 bg-white/95 px-3"
            onClick={() => {
              setDraft(createDraft());
            }}
          >
            <Plus className="mr-1 h-4 w-4" />
            Add server
          </Button>
        </div>

        <div className="mt-3 rounded-2xl border border-stone-200/80 bg-white">
          {servers.length === 0 ? (
            <div className="px-4 py-4 text-[14px] text-stone-500">
              No custom MCP servers connected yet.
            </div>
          ) : (
            servers.map((server, index) => (
              <div
                key={server.id}
                className={cn(
                  'group/server flex items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-stone-50/70',
                  index > 0 && 'border-t border-stone-200/75',
                )}
              >
                <div className="min-w-0">
                  <div className="text-[14px] font-medium text-stone-900">{server.name}</div>
                  <div className="mt-0.5 truncate text-[13px] text-stone-500">
                    {toDraftPreview(server)}
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <span className="inline-flex h-7 items-center rounded-full bg-stone-100 px-2.5 text-[12px] text-stone-600">
                    {server.transport === 'http' ? 'Streamable HTTP' : 'Stdio'}
                  </span>
                  <button
                    type="button"
                    aria-label="Edit MCP server"
                    className="no-drag inline-flex h-8 w-8 items-center justify-center rounded-full text-stone-500 transition-[background-color,color] hover:bg-stone-100 hover:text-stone-700"
                    onClick={() => {
                      setDraft(createDraft(server));
                    }}
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    aria-label="Delete MCP server"
                    className="no-drag inline-flex h-8 w-8 items-center justify-center rounded-full text-rose-600 transition-[background-color,color] hover:bg-rose-50"
                    onClick={() => {
                      handleDelete(server.id);
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      {draft ? (
        <section>
          <h3 className="text-[20px] font-semibold text-stone-900">
            {draft.id ? 'Edit server' : 'Add server'}
          </h3>

          <div className="mt-3 rounded-2xl border border-stone-200/80 bg-white p-4">
            <div className="space-y-4">
              <FieldBlock label="Name">
                <SoftInput
                  value={draft.name}
                  onChange={(event) => {
                    setDraft((previous) =>
                      previous
                        ? {
                            ...previous,
                            name: event.target.value,
                          }
                        : previous,
                    );
                  }}
                  placeholder="MCP server name"
                />
              </FieldBlock>

              <FieldBlock label="Transport">
                <div className="inline-flex w-full items-center gap-1 rounded-xl bg-stone-100 p-1">
                  <TransportChip
                    active={draft.transport === 'stdio'}
                    onClick={() => {
                      setDraft((previous) =>
                        previous
                          ? {
                              ...previous,
                              transport: 'stdio',
                            }
                          : previous,
                      );
                    }}
                  >
                    Stdio
                  </TransportChip>
                  <TransportChip
                    active={draft.transport === 'http'}
                    onClick={() => {
                      setDraft((previous) =>
                        previous
                          ? {
                              ...previous,
                              transport: 'http',
                            }
                          : previous,
                      );
                    }}
                  >
                    Streamable HTTP
                  </TransportChip>
                </div>
              </FieldBlock>

              {draft.transport === 'stdio' ? (
                <>
                  <FieldBlock label="Command to launch">
                    <SoftInput
                      value={draft.command}
                      onChange={(event) => {
                        setDraft((previous) =>
                          previous
                            ? {
                                ...previous,
                                command: event.target.value,
                              }
                            : previous,
                        );
                      }}
                      placeholder="openai-dev-mcp serve-sqlite"
                      spellCheck={false}
                    />
                  </FieldBlock>

                  <FieldBlock label="Arguments">
                    <StringEntryList
                      entries={draft.args}
                      placeholder="Argument"
                      onAdd={() => {
                        setDraft((previous) =>
                          previous
                            ? {
                                ...previous,
                                args: [...previous.args, createDraftStringEntry()],
                              }
                            : previous,
                        );
                      }}
                      onChange={(entryId, value) => {
                        setDraft((previous) =>
                          previous
                            ? {
                                ...previous,
                                args: previous.args.map((entry) =>
                                  entry.id === entryId ? { ...entry, value } : entry,
                                ),
                              }
                            : previous,
                        );
                      }}
                      onDelete={(entryId) => {
                        setDraft((previous) =>
                          previous
                            ? {
                                ...previous,
                                args: previous.args.filter((entry) => entry.id !== entryId),
                              }
                            : previous,
                        );
                      }}
                      addLabel="Add argument"
                    />
                  </FieldBlock>

                  <FieldBlock label="Environment variables">
                    <NameValueEntryList
                      entries={draft.env}
                      namePlaceholder="Key"
                      valuePlaceholder="Value"
                      onAdd={() => {
                        setDraft((previous) =>
                          previous
                            ? {
                                ...previous,
                                env: [...previous.env, createDraftNameValueEntry()],
                              }
                            : previous,
                        );
                      }}
                      onChange={(entryId, field, value) => {
                        setDraft((previous) =>
                          previous
                            ? {
                                ...previous,
                                env: previous.env.map((entry) =>
                                  entry.id === entryId ? { ...entry, [field]: value } : entry,
                                ),
                              }
                            : previous,
                        );
                      }}
                      onDelete={(entryId) => {
                        setDraft((previous) =>
                          previous
                            ? {
                                ...previous,
                                env: previous.env.filter((entry) => entry.id !== entryId),
                              }
                            : previous,
                        );
                      }}
                      addLabel="Add environment variable"
                    />
                  </FieldBlock>
                </>
              ) : (
                <>
                  <FieldBlock label="Server URL">
                    <SoftInput
                      value={draft.url}
                      onChange={(event) => {
                        setDraft((previous) =>
                          previous
                            ? {
                                ...previous,
                                url: event.target.value,
                              }
                            : previous,
                        );
                      }}
                      placeholder="https://example.com/mcp"
                      spellCheck={false}
                    />
                  </FieldBlock>

                  <FieldBlock label="HTTP headers">
                    <NameValueEntryList
                      entries={draft.headers}
                      namePlaceholder="Header"
                      valuePlaceholder="Value"
                      onAdd={() => {
                        setDraft((previous) =>
                          previous
                            ? {
                                ...previous,
                                headers: [...previous.headers, createDraftNameValueEntry()],
                              }
                            : previous,
                        );
                      }}
                      onChange={(entryId, field, value) => {
                        setDraft((previous) =>
                          previous
                            ? {
                                ...previous,
                                headers: previous.headers.map((entry) =>
                                  entry.id === entryId ? { ...entry, [field]: value } : entry,
                                ),
                              }
                            : previous,
                        );
                      }}
                      onDelete={(entryId) => {
                        setDraft((previous) =>
                          previous
                            ? {
                                ...previous,
                                headers: previous.headers.filter((entry) => entry.id !== entryId),
                              }
                            : previous,
                        );
                      }}
                      addLabel="Add header"
                    />
                  </FieldBlock>
                </>
              )}

              <div className="flex items-center justify-end gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="h-8 rounded-full px-3"
                  onClick={() => {
                    setDraft(null);
                  }}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  className="h-8 rounded-full px-3"
                  disabled={!isValidDraft(draft)}
                  onClick={handleSave}
                >
                  Save server
                </Button>
              </div>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
};

const FieldBlock = ({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): JSX.Element => (
  <div>
    <label className="block text-[14px] font-medium text-stone-800">{label}</label>
    <div className="mt-2">{children}</div>
  </div>
);

const SoftInput = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      {...props}
      className={cn(
        'no-drag h-10 w-full rounded-[12px] border border-stone-200/70 bg-stone-50 px-3 text-[14px] text-stone-800 placeholder:text-stone-400 focus:border-stone-300 focus:outline-none',
        className,
      )}
    />
  ),
);

SoftInput.displayName = 'SoftInput';

const TransportChip = ({
  children,
  active,
  onClick,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
}): JSX.Element => (
  <button
    type="button"
    className={cn(
      'inline-flex h-8 flex-1 items-center justify-center rounded-[10px] px-3 text-[13px] text-stone-600 transition-colors',
      active && 'bg-white text-stone-900 shadow-sm',
    )}
    onClick={onClick}
  >
    {children}
  </button>
);

const StringEntryList = ({
  entries,
  placeholder,
  onAdd,
  onChange,
  onDelete,
  addLabel,
}: {
  entries: DraftStringEntry[];
  placeholder: string;
  onAdd: () => void;
  onChange: (entryId: string, value: string) => void;
  onDelete: (entryId: string) => void;
  addLabel: string;
}): JSX.Element => (
  <div className="space-y-2">
    {entries.map((entry) => (
      <div key={entry.id} className="flex items-center gap-2">
        <SoftInput
          value={entry.value}
          onChange={(event) => {
            onChange(entry.id, event.target.value);
          }}
          placeholder={placeholder}
          spellCheck={false}
        />
        <IconDeleteButton
          label="Remove row"
          onClick={() => {
            onDelete(entry.id);
          }}
        />
      </div>
    ))}

    <button
      type="button"
      className="no-drag inline-flex h-9 items-center justify-center gap-1 rounded-xl bg-stone-50 px-3 text-[13px] font-medium text-stone-600 transition-colors hover:bg-stone-100 hover:text-stone-800"
      onClick={onAdd}
    >
      <Plus className="h-4 w-4" />
      {addLabel}
    </button>
  </div>
);

const NameValueEntryList = ({
  entries,
  namePlaceholder,
  valuePlaceholder,
  onAdd,
  onChange,
  onDelete,
  addLabel,
}: {
  entries: DraftNameValueEntry[];
  namePlaceholder: string;
  valuePlaceholder: string;
  onAdd: () => void;
  onChange: (entryId: string, field: 'name' | 'value', value: string) => void;
  onDelete: (entryId: string) => void;
  addLabel: string;
}): JSX.Element => (
  <div className="space-y-2">
    {entries.map((entry) => (
      <div key={entry.id} className="flex items-center gap-2">
        <SoftInput
          value={entry.name}
          onChange={(event) => {
            onChange(entry.id, 'name', event.target.value);
          }}
          placeholder={namePlaceholder}
          spellCheck={false}
        />
        <SoftInput
          value={entry.value}
          onChange={(event) => {
            onChange(entry.id, 'value', event.target.value);
          }}
          placeholder={valuePlaceholder}
          spellCheck={false}
        />
        <IconDeleteButton
          label="Remove row"
          onClick={() => {
            onDelete(entry.id);
          }}
        />
      </div>
    ))}

    <button
      type="button"
      className="no-drag inline-flex h-9 items-center justify-center gap-1 rounded-xl bg-stone-50 px-3 text-[13px] font-medium text-stone-600 transition-colors hover:bg-stone-100 hover:text-stone-800"
      onClick={onAdd}
    >
      <Plus className="h-4 w-4" />
      {addLabel}
    </button>
  </div>
);

const IconDeleteButton = ({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}): JSX.Element => (
  <button
    type="button"
    aria-label={label}
    className="no-drag inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-stone-400 transition-[background-color,color] hover:bg-stone-100 hover:text-rose-600"
    onClick={onClick}
  >
    <Trash2 className="h-4 w-4" />
  </button>
);
