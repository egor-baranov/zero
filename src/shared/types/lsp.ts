export interface LspPosition {
  line: number;
  character: number;
}

export interface LspRange {
  start: LspPosition;
  end: LspPosition;
}

export type LspServerStatus = 'ready' | 'starting' | 'unsupported' | 'error';

export interface LspDocumentSyncRequest {
  workspacePath: string;
  relativePath: string;
  languageId: string;
  content: string;
  version: number;
}

export interface LspDocumentSyncResult {
  supported: boolean;
  serverId: string | null;
  status: LspServerStatus;
  detail: string | null;
}

export interface LspDocumentCloseRequest {
  workspacePath: string;
  relativePath: string;
  languageId: string;
}

export interface LspTextDocumentPositionRequest {
  workspacePath: string;
  relativePath: string;
  languageId: string;
  position: LspPosition;
}

export interface LspHoverResult {
  markdown: string | null;
  range: LspRange | null;
}

export interface LspLocation {
  relativePath: string;
  range: LspRange;
}

export interface LspDefinitionResult {
  locations: LspLocation[];
}

export interface LspReferencesRequest extends LspTextDocumentPositionRequest {
  includeDeclaration?: boolean;
}

export interface LspReferencesResult {
  locations: LspLocation[];
}

export interface LspCompletionRequest extends LspTextDocumentPositionRequest {
  triggerCharacter?: string;
  triggerKind?: number;
}

export interface LspTextEdit {
  range: LspRange;
  newText: string;
}

export interface LspCompletionItem {
  label: string;
  kind?: number;
  detail?: string;
  documentation?: string;
  insertText?: string;
  sortText?: string;
  filterText?: string;
  preselect?: boolean;
  insertTextFormat?: number;
  textEdit?: LspTextEdit | null;
  additionalTextEdits?: LspTextEdit[];
  commitCharacters?: string[];
}

export interface LspCompletionResult {
  items: LspCompletionItem[];
  isIncomplete: boolean;
}

export type LspDiagnosticSeverity = 'error' | 'warning' | 'information' | 'hint';

export interface LspDiagnostic {
  range: LspRange;
  severity: LspDiagnosticSeverity;
  message: string;
  source?: string | null;
  code?: string | number | null;
}

export type LspRendererEvent =
  | {
      kind: 'diagnostics';
      workspacePath: string;
      relativePath: string;
      diagnostics: LspDiagnostic[];
    }
  | {
      kind: 'status';
      workspacePath: string;
      languageId: string;
      serverId: string | null;
      status: LspServerStatus;
      detail: string | null;
    };
