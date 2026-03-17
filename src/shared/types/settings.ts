export interface WindowBoundsState {
  x?: number;
  y?: number;
  width: number;
  height: number;
  isMaximized: boolean;
}

export interface AppSettings {
  windowBounds?: WindowBoundsState;
}
