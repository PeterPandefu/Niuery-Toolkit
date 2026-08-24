import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MindMapSurface } from '@/tools/graphic/mind-map/MindMapSurface';
import { createMindMapDocument } from '@/tools/graphic/mind-map/document';

const resize = vi.fn();
const observerCallbacks: ResizeObserverCallback[] = [];

vi.mock('simple-mind-map', () => {
  class MockMindMap {
    static usePlugin = vi.fn();
    view = { fit: vi.fn() };
    on = vi.fn();
    off = vi.fn();
    getData = vi.fn(() => createMindMapDocument());
    setFullData = vi.fn();
    execCommand = vi.fn();
    export = vi.fn();
    resize = resize;
    destroy = vi.fn();
  }
  return { default: MockMindMap };
});

vi.mock('simple-mind-map/src/plugins/Export', () => ({ default: {} }));
vi.mock('simple-mind-map/src/plugins/Search', () => ({ default: {} }));
vi.mock('simple-mind-map/src/plugins/KeyboardNavigation', () => ({ default: {} }));

describe('MindMapSurface viewport', () => {
  afterEach(() => {
    resize.mockClear();
    observerCallbacks.length = 0;
    vi.unstubAllGlobals();
  });

  it('resizes the library viewport when the canvas container changes size', () => {
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: ResizeObserverCallback) {
        observerCallbacks.push(callback);
      }
      observe() {}
      disconnect() {}
      unobserve() {}
    });

    render(
      <MindMapSurface
        document={createMindMapDocument('画布尺寸')}
        documentVersion={0}
        onChange={vi.fn()}
      />,
    );

    expect(observerCallbacks).toHaveLength(1);
    observerCallbacks[0]([], {} as ResizeObserver);
    expect(resize).toHaveBeenCalledTimes(1);
  });
});
