import type {
  GifFrame,
  RecorderAction,
  RecorderState,
} from './types';

export type { GifFrame } from './types';

const EMPTY_GIF = {
  width: 0,
  height: 0,
  loopCount: 0,
  frames: [] as GifFrame[],
  selectedIndex: 0,
};

export function createInitialRecorderState(): RecorderState {
  return {
    status: 'idle',
    session: null,
    artifact: null,
    error: null,
    gif: { ...EMPTY_GIF, frames: [] },
  };
}

function clampDelay(delayMs: number): number {
  return Math.max(10, Math.round(delayMs));
}

export function recorderReducer(state: RecorderState, action: RecorderAction): RecorderState {
  switch (action.type) {
    case 'countdown':
      return { ...state, status: 'countdown', error: null };
    case 'started':
      return { ...state, status: 'recording', session: action.session, artifact: null, error: null };
    case 'paused':
      return state.status === 'recording' ? { ...state, status: 'paused' } : state;
    case 'resumed':
      return state.status === 'paused' ? { ...state, status: 'recording' } : state;
    case 'stopping':
      return { ...state, status: 'stopping' };
    case 'stopped':
      return { ...state, status: 'preview', artifact: action.artifact, session: null, error: null };
    case 'cancelled':
      return { ...createInitialRecorderState(), gif: state.gif };
    case 'error':
      return { ...state, status: 'error', error: action.message };
    case 'gifLoaded':
      return {
        ...state,
        gif: {
          width: action.width,
          height: action.height,
          loopCount: action.loopCount ?? 0,
          frames: action.frames.slice(),
          selectedIndex: 0,
        },
      };
    case 'gifSelected':
      return action.index >= 0 && action.index < state.gif.frames.length
        ? { ...state, gif: { ...state.gif, selectedIndex: action.index } }
        : state;
    case 'gifDeleted': {
      if (state.gif.frames.length <= 1 || action.index < 0 || action.index >= state.gif.frames.length) return state;
      const frames = state.gif.frames.filter((_, index) => index !== action.index);
      return {
        ...state,
        gif: {
          ...state.gif,
          frames,
          selectedIndex: Math.min(state.gif.selectedIndex, frames.length - 1),
        },
      };
    }
    case 'gifDuplicated': {
      const source = state.gif.frames[action.index];
      if (!source) return state;
      const copy = { ...source, id: `${source.id}-copy-${Date.now()}`, rgba: new Uint8ClampedArray(source.rgba), annotations: source.annotations.map((item) => ({ ...item })) };
      const frames = state.gif.frames.slice();
      frames.splice(action.index + 1, 0, copy);
      return { ...state, gif: { ...state.gif, frames, selectedIndex: action.index + 1 } };
    }
    case 'gifReordered': {
      const { from, to } = action;
      if (from < 0 || to < 0 || from >= state.gif.frames.length || to >= state.gif.frames.length || from === to) return state;
      const frames = state.gif.frames.slice();
      const [moved] = frames.splice(from, 1);
      frames.splice(to, 0, moved);
      return { ...state, gif: { ...state.gif, frames, selectedIndex: to } };
    }
    case 'gifDelayChanged':
      return action.index >= 0 && action.index < state.gif.frames.length
        ? {
            ...state,
            gif: {
              ...state.gif,
              frames: state.gif.frames.map((frame, index) => index === action.index ? { ...frame, delayMs: clampDelay(action.delayMs) } : frame),
            },
          }
        : state;
    case 'gifLoopChanged':
      return { ...state, gif: { ...state.gif, loopCount: Math.max(0, Math.round(action.loopCount)) } };
    case 'gifAnnotationAdded':
      return {
        ...state,
        gif: {
          ...state.gif,
          frames: state.gif.frames.map((frame, index) => (
            action.applyToAll || index === state.gif.selectedIndex
              ? { ...frame, annotations: [...frame.annotations, { ...action.annotation }] }
              : frame
          )),
        },
      };
    case 'gifResized':
      return action.width > 0 && action.height > 0
        ? {
            ...state,
            gif: {
              ...state.gif,
              width: action.width,
              height: action.height,
              frames: state.gif.frames.map((frame) => ({ ...frame, width: action.width, height: action.height })),
            },
          }
        : state;
    case 'gifCleared':
      return { ...state, gif: { ...EMPTY_GIF, frames: [] } };
    default:
      return state;
  }
}
