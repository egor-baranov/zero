import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@shared/contracts/ipc';
import type { VoiceTranscriptionRequest } from '@shared/types/voice';
import type { VoiceService } from '../services/voice/voice-service';

export const registerVoiceIpc = (voiceService: VoiceService): void => {
  ipcMain.handle(
    IPC_CHANNELS.voiceTranscribe,
    (_event, request: VoiceTranscriptionRequest) => voiceService.transcribe(request),
  );
};
