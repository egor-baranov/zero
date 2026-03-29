export interface WindowBoundsState {
  x?: number;
  y?: number;
  width: number;
  height: number;
  isMaximized: boolean;
}

export interface VoiceSettings {
  openAiApiKey: string;
}

export interface AppSettings {
  windowBounds?: WindowBoundsState;
  voice?: {
    openAiApiKey?: string;
  };
}
