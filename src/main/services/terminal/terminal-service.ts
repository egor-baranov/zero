import { randomUUID } from 'node:crypto';
import os from 'node:os';
import { statSync } from 'node:fs';
import * as pty from 'node-pty';
import type { IPty } from 'node-pty';
import type {
  TerminalCloseRequest,
  TerminalCreateRequest,
  TerminalCreateResult,
  TerminalEvent,
  TerminalResizeRequest,
  TerminalWriteRequest,
} from '@shared/types/terminal';

const DEFAULT_COLS = 120;
const DEFAULT_ROWS = 30;

const getShellCandidates = (): string[] => {
  if (process.platform === 'win32') {
    return Array.from(
      new Set(
        [process.env.COMSPEC, 'powershell.exe', 'cmd.exe']
          .map((value) => value?.trim())
          .filter((value): value is string => Boolean(value)),
      ),
    );
  }

  return Array.from(
    new Set(
      [process.env.SHELL, '/bin/zsh', '/bin/bash', '/bin/sh']
        .map((value) => value?.trim())
        .filter((value): value is string => Boolean(value)),
    ),
  );
};

const resolveCwd = (requestedCwd?: string): string => {
  const candidates = [requestedCwd, process.cwd(), os.homedir(), '/'].filter(
    (value): value is string => Boolean(value && value.trim()),
  );

  for (const candidate of candidates) {
    try {
      if (statSync(candidate).isDirectory()) {
        return candidate;
      }
    } catch {
      // Try the next candidate.
    }
  }

  return process.cwd();
};

interface TerminalSession {
  id: string;
  ptyProcess: IPty;
}

export class TerminalService {
  private readonly sessions = new Map<string, TerminalSession>();
  private readonly listeners = new Set<(event: TerminalEvent) => void>();

  public onEvent(listener: (event: TerminalEvent) => void): () => void {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  }

  public create(request: TerminalCreateRequest): TerminalCreateResult {
    const shellCandidates = getShellCandidates();
    const launchCwd = resolveCwd(request.cwd);
    const terminalId = randomUUID();
    const spawnArgs = process.platform === 'win32' ? [] : ['-l'];
    const spawnOptions = {
      name: 'xterm-256color',
      cols: request.cols > 0 ? request.cols : DEFAULT_COLS,
      rows: request.rows > 0 ? request.rows : DEFAULT_ROWS,
      cwd: launchCwd,
      env: {
        ...process.env,
        TERM: 'xterm-256color',
      },
    };

    let selectedShell = shellCandidates[0] ?? (process.platform === 'win32' ? 'cmd.exe' : '/bin/sh');
    let ptyProcess: IPty | null = null;
    let lastError: unknown = null;

    for (const shellCandidate of shellCandidates) {
      try {
        ptyProcess = pty.spawn(shellCandidate, spawnArgs, spawnOptions);
        selectedShell = shellCandidate;
        break;
      } catch (error) {
        lastError = error;
      }
    }

    if (!ptyProcess) {
      throw lastError instanceof Error
        ? lastError
        : new Error('Failed to create terminal session.');
    }

    ptyProcess.onData((data) => {
      this.emit({
        type: 'data',
        terminalId,
        data,
      });
    });

    ptyProcess.onExit(({ exitCode }) => {
      this.sessions.delete(terminalId);
      this.emit({
        type: 'exit',
        terminalId,
        exitCode,
      });
    });

    this.sessions.set(terminalId, {
      id: terminalId,
      ptyProcess,
    });

    return {
      terminalId,
      shell: selectedShell,
    };
  }

  public write(request: TerminalWriteRequest): void {
    const session = this.sessions.get(request.terminalId);
    if (!session) {
      return;
    }

    session.ptyProcess.write(request.data);
  }

  public resize(request: TerminalResizeRequest): void {
    const session = this.sessions.get(request.terminalId);
    if (!session) {
      return;
    }

    const cols = request.cols > 0 ? request.cols : DEFAULT_COLS;
    const rows = request.rows > 0 ? request.rows : DEFAULT_ROWS;

    session.ptyProcess.resize(cols, rows);
  }

  public close(request: TerminalCloseRequest): void {
    const session = this.sessions.get(request.terminalId);
    if (!session) {
      return;
    }

    this.sessions.delete(request.terminalId);
    session.ptyProcess.kill();
  }

  public disposeAll(): void {
    for (const session of this.sessions.values()) {
      session.ptyProcess.kill();
    }

    this.sessions.clear();
  }

  private emit(event: TerminalEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}
