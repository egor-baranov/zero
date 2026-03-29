import type {
  VoiceTranscriptionRequest,
  VoiceTranscriptionResult,
} from '@shared/types/voice';
import type { SettingsStore } from '../settings/settings-store';

const DEFAULT_TRANSCRIPTION_MODEL = 'gpt-4o-mini-transcribe';
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

const MIME_TYPE_EXTENSIONS: Array<[pattern: RegExp, extension: string]> = [
  [/webm/i, 'webm'],
  [/wav/i, 'wav'],
  [/mpeg|mp3/i, 'mp3'],
  [/mp4|m4a|aac/i, 'm4a'],
  [/ogg|opus/i, 'ogg'],
];

const getEnvVoiceApiKey = (): string | null => {
  const openAiKey = process.env.OPENAI_API_KEY?.trim();
  if (openAiKey) {
    return openAiKey;
  }

  // Reuse the credential users often already have configured for Codex sessions.
  const codexKey = process.env.CODEX_API_KEY?.trim();
  return codexKey && codexKey.length > 0 ? codexKey : null;
};

const getVoiceModel = (): string => {
  const configured = process.env.ZEROADE_VOICE_TRANSCRIPTION_MODEL?.trim();
  return configured && configured.length > 0 ? configured : DEFAULT_TRANSCRIPTION_MODEL;
};

const getAudioExtension = (mimeType: string): string => {
  for (const [pattern, extension] of MIME_TYPE_EXTENSIONS) {
    if (pattern.test(mimeType)) {
      return extension;
    }
  }

  return 'webm';
};

const toResponseErrorMessage = async (response: Response): Promise<string> => {
  const fallback = `Voice transcription failed with ${response.status}.`;
  const contentType = response.headers.get('content-type') ?? '';

  try {
    if (contentType.includes('application/json')) {
      const payload = (await response.json()) as {
        error?: { message?: string };
      };
      const message = payload.error?.message?.trim();
      return message && message.length > 0 ? message : fallback;
    }

    const rawText = (await response.text()).trim();
    return rawText.length > 0 ? rawText : fallback;
  } catch {
    return fallback;
  }
};

const toTranscribedText = async (response: Response): Promise<string | null> => {
  const contentType = response.headers.get('content-type') ?? '';

  if (contentType.includes('application/json')) {
    const payload = (await response.json()) as { text?: string };
    const text = payload.text?.trim();
    return text && text.length > 0 ? text : null;
  }

  const text = (await response.text()).trim();
  return text.length > 0 ? text : null;
};

export class VoiceService {
  constructor(private readonly settingsStore: SettingsStore) {}

  private async getVoiceApiKey(): Promise<string | null> {
    const voiceSettings = await this.settingsStore.getVoiceSettings();
    const savedOpenAiKey = voiceSettings.openAiApiKey.trim();
    if (savedOpenAiKey) {
      return savedOpenAiKey;
    }

    return getEnvVoiceApiKey();
  }

  async transcribe(request: VoiceTranscriptionRequest): Promise<VoiceTranscriptionResult> {
    const apiKey = await this.getVoiceApiKey();
    if (!apiKey) {
      return {
        ok: false,
        text: '',
        error: 'Add an OpenAI API key in Settings, or set OPENAI_API_KEY / CODEX_API_KEY.',
      };
    }

    const audioBase64 = request.audioBase64.trim();
    if (!audioBase64) {
      return {
        ok: false,
        text: '',
        error: 'No audio was captured.',
      };
    }

    const audioBuffer = Buffer.from(audioBase64, 'base64');
    if (audioBuffer.length === 0) {
      return {
        ok: false,
        text: '',
        error: 'No audio was captured.',
      };
    }

    if (audioBuffer.length > MAX_AUDIO_BYTES) {
      return {
        ok: false,
        text: '',
        error: 'Voice input is too large to transcribe.',
      };
    }

    const mimeType = request.mimeType.trim() || 'audio/webm';
    const formData = new FormData();
    formData.append(
      'file',
      new Blob([audioBuffer], { type: mimeType }),
      `voice-input.${getAudioExtension(mimeType)}`,
    );
    formData.append('model', getVoiceModel());

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: formData,
    });

    if (!response.ok) {
      return {
        ok: false,
        text: '',
        error: await toResponseErrorMessage(response),
      };
    }

    const text = await toTranscribedText(response);
    if (!text) {
      return {
        ok: false,
        text: '',
        error: 'Voice input returned an empty transcript.',
      };
    }

    return {
      ok: true,
      text,
      error: null,
    };
  }
}
