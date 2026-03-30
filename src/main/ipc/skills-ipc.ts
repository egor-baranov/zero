import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@shared/contracts/ipc';
import type {
  SkillsCatalogDetailRequest,
  SkillsDeleteRequest,
  SkillsInstallRequest,
  SkillsReadRequest,
  SkillsWriteRequest,
} from '@shared/types/skills';
import type { SkillsService } from '../services/skills/skills-service';

export const registerSkillsIpc = (skillsService: SkillsService): void => {
  ipcMain.handle(IPC_CHANNELS.skillsList, () => skillsService.list());
  ipcMain.handle(IPC_CHANNELS.skillsCatalog, () => skillsService.catalog());

  ipcMain.handle(IPC_CHANNELS.skillsCatalogDetail, (_event, request: SkillsCatalogDetailRequest) =>
    skillsService.catalogDetail(request),
  );

  ipcMain.handle(IPC_CHANNELS.skillsRead, (_event, request: SkillsReadRequest) =>
    skillsService.read(request),
  );

  ipcMain.handle(IPC_CHANNELS.skillsWrite, (_event, request: SkillsWriteRequest) =>
    skillsService.write(request),
  );

  ipcMain.handle(IPC_CHANNELS.skillsDelete, (_event, request: SkillsDeleteRequest) =>
    skillsService.delete(request),
  );

  ipcMain.handle(IPC_CHANNELS.skillsInstall, (_event, request: SkillsInstallRequest) =>
    skillsService.install(request),
  );
};
