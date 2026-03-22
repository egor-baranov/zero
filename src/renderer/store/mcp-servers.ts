import type { McpServer } from '@agentclientprotocol/sdk/dist/schema';

const MCP_SERVERS_STORAGE_KEY = 'zeroade.mcp.servers.v1';
const MCP_SERVERS_UPDATED_EVENT = 'zeroade.mcp-servers-updated';

export interface StoredMcpNameValueEntry {
  name: string;
  value: string;
}

interface StoredMcpServerBase {
  id: string;
  name: string;
}

export interface StoredMcpStdioServer extends StoredMcpServerBase {
  transport: 'stdio';
  command: string;
  args: string[];
  env: StoredMcpNameValueEntry[];
}

export interface StoredMcpHttpServer extends StoredMcpServerBase {
  transport: 'http';
  url: string;
  headers: StoredMcpNameValueEntry[];
}

export type StoredMcpServer = StoredMcpStdioServer | StoredMcpHttpServer;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const normalizeText = (value: string): string => value.trim();

const normalizeNameValueEntries = (value: unknown): StoredMcpNameValueEntry[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .flatMap((entry) => {
      if (!isRecord(entry)) {
        return [];
      }

      const name = typeof entry.name === 'string' ? entry.name.trim() : '';
      const rawValue = typeof entry.value === 'string' ? entry.value : '';
      if (!name) {
        return [];
      }

      return [
        {
          name,
          value: rawValue,
        },
      ];
    });
};

const normalizeStringList = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
};

const normalizeStoredServer = (value: unknown): StoredMcpServer | null => {
  if (!isRecord(value)) {
    return null;
  }

  const id = typeof value.id === 'string' ? value.id.trim() : '';
  const name = typeof value.name === 'string' ? value.name.trim() : '';
  const transport = value.transport;

  if (!id || !name) {
    return null;
  }

  if (transport === 'stdio') {
    const command = typeof value.command === 'string' ? value.command.trim() : '';
    if (!command) {
      return null;
    }

    return {
      id,
      name,
      transport: 'stdio',
      command,
      args: normalizeStringList(value.args),
      env: normalizeNameValueEntries(value.env),
    };
  }

  if (transport === 'http') {
    const url = typeof value.url === 'string' ? value.url.trim() : '';
    if (!url) {
      return null;
    }

    return {
      id,
      name,
      transport: 'http',
      url,
      headers: normalizeNameValueEntries(value.headers),
    };
  }

  return null;
};

export const createStoredMcpServerId = (): string =>
  `mcp-server-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export const readStoredMcpServers = (): StoredMcpServer[] => {
  const raw = window.localStorage.getItem(MCP_SERVERS_STORAGE_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((entry) => normalizeStoredServer(entry))
      .filter((entry): entry is StoredMcpServer => entry !== null);
  } catch {
    return [];
  }
};

export const writeStoredMcpServers = (servers: StoredMcpServer[]): void => {
  const normalized = servers
    .map((server) => normalizeStoredServer(server))
    .filter((server): server is StoredMcpServer => server !== null);

  window.localStorage.setItem(MCP_SERVERS_STORAGE_KEY, JSON.stringify(normalized));
  window.dispatchEvent(new CustomEvent(MCP_SERVERS_UPDATED_EVENT));
};

export const onStoredMcpServersChanged = (listener: () => void): (() => void) => {
  const handleCustomEvent = (): void => {
    listener();
  };

  const handleStorage = (event: StorageEvent): void => {
    if (event.key === MCP_SERVERS_STORAGE_KEY) {
      listener();
    }
  };

  window.addEventListener(MCP_SERVERS_UPDATED_EVENT, handleCustomEvent);
  window.addEventListener('storage', handleStorage);

  return () => {
    window.removeEventListener(MCP_SERVERS_UPDATED_EVENT, handleCustomEvent);
    window.removeEventListener('storage', handleStorage);
  };
};

export const toAcpMcpServers = (servers: StoredMcpServer[]): McpServer[] =>
  servers.map((server) => {
    if (server.transport === 'http') {
      return {
        type: 'http',
        name: normalizeText(server.name),
        url: normalizeText(server.url),
        headers: server.headers.map((entry) => ({
          name: normalizeText(entry.name),
          value: entry.value,
        })),
      };
    }

    return {
      name: normalizeText(server.name),
      command: normalizeText(server.command),
      args: server.args.map((entry) => entry.trim()).filter((entry) => entry.length > 0),
      env: server.env.map((entry) => ({
        name: normalizeText(entry.name),
        value: entry.value,
      })),
    };
  });
