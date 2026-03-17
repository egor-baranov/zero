import { dialog, ipcMain } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { IPC_CHANNELS } from '@shared/contracts/ipc';
import type {
  OpenAttachmentFileRequest,
  OpenAttachmentFileResult,
  OpenFolderResult,
  ReadAttachmentPreviewRequest,
  ReadAttachmentPreviewResult,
} from '@shared/types/preload';

const MAX_ATTACHMENT_PREVIEW_BYTES = 10 * 1024 * 1024;

const toImageMimeType = (filePath: string): string | null => {
  const extension = path.extname(filePath).toLowerCase();

  if (extension === '.png') {
    return 'image/png';
  }
  if (extension === '.jpg' || extension === '.jpeg') {
    return 'image/jpeg';
  }
  if (extension === '.gif') {
    return 'image/gif';
  }
  if (extension === '.webp') {
    return 'image/webp';
  }
  if (extension === '.bmp') {
    return 'image/bmp';
  }
  if (extension === '.svg') {
    return 'image/svg+xml';
  }
  if (extension === '.ico') {
    return 'image/x-icon';
  }
  if (extension === '.tif' || extension === '.tiff') {
    return 'image/tiff';
  }
  if (extension === '.avif') {
    return 'image/avif';
  }
  if (extension === '.heic') {
    return 'image/heic';
  }
  if (extension === '.heif') {
    return 'image/heif';
  }

  return null;
};

export const registerShellIpc = (): void => {
  ipcMain.handle(IPC_CHANNELS.shellOpenFolder, async (): Promise<OpenFolderResult> => {
    const result = await dialog.showOpenDialog({
      title: 'Open Workspace Folder',
      properties: ['openDirectory', 'createDirectory'],
    });

    if (result.canceled) {
      return { canceled: true, path: null };
    }

    return {
      canceled: false,
      path: result.filePaths[0] ?? null,
    };
  });

  ipcMain.handle(
    IPC_CHANNELS.shellOpenAttachmentFile,
    async (_event, request: OpenAttachmentFileRequest): Promise<OpenAttachmentFileResult> => {
      const workspacePath = request.workspacePath.trim();
      const defaultPath = workspacePath && workspacePath !== '/' ? workspacePath : undefined;

      const result = await dialog.showOpenDialog({
        title: 'Attach File',
        defaultPath,
        properties: ['openFile'],
      });

      if (result.canceled) {
        return { canceled: true, absolutePath: null, relativePath: null };
      }

      const absolutePath = result.filePaths[0] ?? null;
      if (!absolutePath) {
        return { canceled: true, absolutePath: null, relativePath: null };
      }

      if (!defaultPath) {
        return {
          canceled: false,
          absolutePath,
          relativePath: path.basename(absolutePath),
        };
      }

      const normalizedWorkspacePath = path.resolve(defaultPath);
      const normalizedFilePath = path.resolve(absolutePath);
      const relativePath = path.relative(normalizedWorkspacePath, normalizedFilePath);
      const isInsideWorkspace =
        relativePath.length > 0 && !relativePath.startsWith('..') && !path.isAbsolute(relativePath);

      return {
        canceled: false,
        absolutePath: normalizedFilePath,
        relativePath: isInsideWorkspace
          ? relativePath.split(path.sep).join('/')
          : path.basename(normalizedFilePath),
      };
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.shellReadAttachmentPreview,
    async (
      _event,
      request: ReadAttachmentPreviewRequest,
    ): Promise<ReadAttachmentPreviewResult> => {
      const absolutePath = path.resolve(request.absolutePath);
      const mimeType = toImageMimeType(absolutePath);
      if (!mimeType) {
        return {
          dataUrl: null,
          mimeType: null,
        };
      }

      try {
        const fileStat = await fs.stat(absolutePath);
        if (!fileStat.isFile() || fileStat.size <= 0 || fileStat.size > MAX_ATTACHMENT_PREVIEW_BYTES) {
          return {
            dataUrl: null,
            mimeType: null,
          };
        }

        const fileBuffer = await fs.readFile(absolutePath);
        const base64 = fileBuffer.toString('base64');

        return {
          dataUrl: `data:${mimeType};base64,${base64}`,
          mimeType,
        };
      } catch {
        return {
          dataUrl: null,
          mimeType: null,
        };
      }
    },
  );
};
