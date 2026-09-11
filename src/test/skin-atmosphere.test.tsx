import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AtmosphereLayer } from '@/components/layout/SkinAtmosphere';
import { useAppStore } from '@/store/app-store';

describe('SkinAtmosphere', () => {
  const context = {
    arc: vi.fn(),
    beginPath: vi.fn(),
    clearRect: vi.fn(),
    fill: vi.fn(),
    fillRect: vi.fn(),
    restore: vi.fn(),
    save: vi.fn(),
    setTransform: vi.fn(),
    translate: vi.fn(),
  } as unknown as CanvasRenderingContext2D;

  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context);
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      disconnect() {}
    });
    vi.stubGlobal('matchMedia', vi.fn().mockImplementation(() => ({
      matches: true,
      media: '(prefers-reduced-motion: reduce)',
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })));
    useAppStore.setState({ atmosphere: 'on', skin: 'forge' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('在减少动态效果偏好下保留静态氛围粒子', () => {
    const { container } = render(
      <div className="relative h-20 w-20 bg-background">
        <AtmosphereLayer />
      </div>
    );

    expect(container.querySelector('canvas')).toBeInTheDocument();
    expect(context.setTransform).toHaveBeenCalled();
    expect(context.fill).toHaveBeenCalled();
  });
});
