export interface TerminalCreateRequest {
  cwd?: string;
  cols: number;
  rows: number;
}

export interface TerminalCreateResult {
  terminalId: string;
  shell: string;
}

export interface TerminalWriteRequest {
  terminalId: string;
  data: string;
}

export interface TerminalResizeRequest {
  terminalId: string;
  cols: number;
  rows: number;
}

export interface TerminalCloseRequest {
  terminalId: string;
}

export type TerminalEvent =
  | {
      type: 'data';
      terminalId: string;
      data: string;
    }
  | {
      type: 'exit';
      terminalId: string;
      exitCode: number | undefined;
    };
