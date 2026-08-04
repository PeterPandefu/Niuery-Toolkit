export type CaptureMode = 'region' | 'window' | 'monitor';

export interface CaptureRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CaptureTarget {
  mode: CaptureMode;
  monitorId?: string;
  windowId?: number;
  rect?: CaptureRect;
}

export type RecordingStatus = 'idle' | 'countdown' | 'recording' | 'paused' | 'stopping' | 'stopped' | 'preview' | 'error';

export interface RecordingSettings {
  fps: 15 | 30 | 60;
  quality: 'high' | 'balanced' | 'small';
  countdownSec: 0 | 3 | 5;
  cursorHighlight: boolean;
  audio: {
    microphone: boolean;
    system: boolean;
    microphoneId?: string;
    systemId?: string;
  };
}

export interface MonitorInfo {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  scaleFactor: number;
  primary: boolean;
}

export interface WindowInfo {
  id: number;
  title: string;
  appName: string;
  x: number;
  y: number;
  width: number;
  height: number;
  monitorId?: string;
}

export interface AudioSource {
  id: string;
  name: string;
  kind: 'microphone' | 'system';
}

export interface RecordingSession {
  id: string;
  width: number;
  height: number;
  startedAt: number;
}

export interface RecordingArtifact {
  path: string;
  durationMs: number;
  width: number;
  height: number;
  sizeBytes?: number;
}

export interface RecordingStatusEvent {
  sessionId: string;
  status: RecordingStatus;
  elapsedMs: number;
  fps: number;
  droppedFrames: number;
  error?: string;
  artifact?: RecordingArtifact;
}

export interface GifAnnotation {
  id: string;
  type: 'text' | 'arrow' | 'rect' | 'mosaic';
  x: number;
  y: number;
  width?: number;
  height?: number;
  text?: string;
  color?: string;
  points?: number[];
}

export interface GifFrame {
  id: string;
  delayMs: number;
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
  annotations: GifAnnotation[];
}

export interface GifProject {
  width: number;
  height: number;
  loopCount: number;
  frames: GifFrame[];
  selectedIndex: number;
}

export type RecorderAction =
  | { type: 'started'; session: RecordingSession }
  | { type: 'countdown' }
  | { type: 'paused' }
  | { type: 'resumed' }
  | { type: 'stopping' }
  | { type: 'stopped'; artifact: RecordingArtifact }
  | { type: 'cancelled' }
  | { type: 'error'; message: string }
  | { type: 'gifLoaded'; frames: GifFrame[]; width: number; height: number; loopCount?: number }
  | { type: 'gifSelected'; index: number }
  | { type: 'gifDeleted'; index: number }
  | { type: 'gifDuplicated'; index: number }
  | { type: 'gifReordered'; from: number; to: number }
  | { type: 'gifDelayChanged'; index: number; delayMs: number }
  | { type: 'gifLoopChanged'; loopCount: number }
  | { type: 'gifAnnotationAdded'; annotation: GifAnnotation; applyToAll: boolean }
  | { type: 'gifResized'; width: number; height: number }
  | { type: 'gifCleared' };

export interface RecorderState {
  status: RecordingStatus;
  session: RecordingSession | null;
  artifact: RecordingArtifact | null;
  error: string | null;
  gif: GifProject;
}

export const DEFAULT_RECORDING_SETTINGS: RecordingSettings = {
  fps: 30,
  quality: 'balanced',
  countdownSec: 3,
  cursorHighlight: true,
  audio: { microphone: false, system: false },
};
