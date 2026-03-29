export interface VoiceTranscriptionRequest {
  audioBase64: string;
  mimeType: string;
}

export interface VoiceTranscriptionResult {
  ok: boolean;
  text: string;
  error: string | null;
}
