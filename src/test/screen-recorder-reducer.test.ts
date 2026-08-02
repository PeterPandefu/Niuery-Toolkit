import { describe, expect, it } from 'vitest';
import {
  createInitialRecorderState,
  recorderReducer,
  type GifFrame,
} from '@/tools/graphic/screen-recorder/recorder-reducer';

const frame = (id: string, delayMs = 100): GifFrame => ({
  id,
  delayMs,
  width: 2,
  height: 2,
  rgba: new Uint8ClampedArray(16),
  annotations: [],
});

describe('screen recorder reducer', () => {
  it('transitions through recording, paused and stopped states', () => {
    const initial = createInitialRecorderState();
    const recording = recorderReducer(initial, {
      type: 'started',
      session: { id: 'session-1', width: 1280, height: 720, startedAt: 10 },
    });
    expect(recording.status).toBe('recording');
    expect(recording.session?.id).toBe('session-1');

    const paused = recorderReducer(recording, { type: 'paused' });
    expect(paused.status).toBe('paused');

    const resumed = recorderReducer(paused, { type: 'resumed' });
    expect(resumed.status).toBe('recording');

    const stopped = recorderReducer(resumed, {
      type: 'stopped',
      artifact: { path: 'recording.mp4', durationMs: 1000, width: 1280, height: 720 },
    });
    expect(stopped.status).toBe('preview');
    expect(stopped.artifact?.path).toBe('recording.mp4');
  });

  it('deletes and reorders GIF frames without mutating the source list', () => {
    const state = createInitialRecorderState();
    const withFrames = recorderReducer(state, {
      type: 'gifLoaded',
      frames: [frame('a'), frame('b'), frame('c')],
      width: 2,
      height: 2,
    });
    const reordered = recorderReducer(withFrames, {
      type: 'gifReordered',
      from: 0,
      to: 2,
    });
    expect(reordered.gif.frames.map((item) => item.id)).toEqual(['b', 'c', 'a']);
    expect(withFrames.gif.frames.map((item) => item.id)).toEqual(['a', 'b', 'c']);

    const deleted = recorderReducer(reordered, { type: 'gifDeleted', index: 1 });
    expect(deleted.gif.frames.map((item) => item.id)).toEqual(['b', 'a']);
  });

  it('updates selected frame delay and keeps it non-negative', () => {
    const loaded = recorderReducer(createInitialRecorderState(), {
      type: 'gifLoaded',
      frames: [frame('a', 100), frame('b', 200)],
      width: 2,
      height: 2,
    });
    const updated = recorderReducer(loaded, { type: 'gifDelayChanged', index: 1, delayMs: -50 });
    expect(updated.gif.frames[1].delayMs).toBe(10);
  });
});
