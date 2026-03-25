import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@shared/contracts/ipc';
import type {
  SkillsDeleteRequest,
  SkillsReadRequest,
  SkillsWriteRequest,
} from '@shared/types/skills';
import type { SkillsService } from '../services/skills/skills-service';

export const registerSkillsIpc = (skillsService: SkillsService): void => {
  ipcMain.handle(IPC_CHANNELS.skillsList, () => skillsService.list());

  ipcMain.handle(IPC_CHANNELS.skillsRead, (_event, request: SkillsReadRequest) =>
    skillsService.read(request),
  );

  ipcMain.handle(IPC_CHANNELS.skillsWrite, (_event, request: SkillsWriteRequest) =>
    skillsService.write(request),
  );

  ipcMain.handle(IPC_CHANNELS.skillsDelete, (_event, request: SkillsDeleteRequest) =>
    skillsService.delete(request),
  );
};
