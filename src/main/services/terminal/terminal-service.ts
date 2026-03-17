import { randomUUID } from 'node:crypto';
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

const resolveShell = (): string => {
  if (process.platform === 'win32') {
    return process.env.COMSPEC || 'powershell.exe';
  }

  return process.env.SHELL || '/bin/zsh';
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
    const shell = resolveShell();
    const terminalId = randomUUID();

    const ptyProcess = pty.spawn(shell, process.platform === 'win32' ? [] : ['-l'], {
      name: 'xterm-256color',
      cols: request.cols > 0 ? request.cols : DEFAULT_COLS,
      rows: request.rows > 0 ? request.rows : DEFAULT_ROWS,
      cwd: request.cwd || process.cwd(),
      env: {
        ...process.env,
        TERM: 'xterm-256color',
      },
    });

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
      shell,
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
