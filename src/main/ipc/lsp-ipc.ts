import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@shared/contracts/ipc';
import type {
  LspCompletionRequest,
  LspDocumentCloseRequest,
  LspReferencesRequest,
  LspDocumentSyncRequest,
  LspTextDocumentPositionRequest,
} from '@shared/types/lsp';
import type { LspService } from '../services/lsp/lsp-service';

export const registerLspIpc = (lspService: LspService): void => {
  ipcMain.handle(
    IPC_CHANNELS.lspDocumentSync,
    (_event, request: LspDocumentSyncRequest) => lspService.syncDocument(request),
  );

  ipcMain.handle(
    IPC_CHANNELS.lspDocumentClose,
    (_event, request: LspDocumentCloseRequest) => lspService.closeDocument(request),
  );

  ipcMain.handle(
    IPC_CHANNELS.lspHover,
    (_event, request: LspTextDocumentPositionRequest) => lspService.hover(request),
  );

  ipcMain.handle(
    IPC_CHANNELS.lspCompletion,
    (_event, request: LspCompletionRequest) => lspService.completion(request),
  );

  ipcMain.handle(
    IPC_CHANNELS.lspDefinition,
    (_event, request: LspTextDocumentPositionRequest) =>
      lspService.definition(request, 'textDocument/definition'),
  );

  ipcMain.handle(
    IPC_CHANNELS.lspDeclaration,
    (_event, request: LspTextDocumentPositionRequest) =>
      lspService.definition(request, 'textDocument/declaration'),
  );

  ipcMain.handle(
    IPC_CHANNELS.lspReferences,
    (_event, request: LspReferencesRequest) => lspService.references(request),
  );
};
