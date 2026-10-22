import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ColorPickerOverlay } from '@/screenshot/ColorPickerOverlay';

const { emitTo, invoke } = vi.hoisted(() => ({ emitTo: vi.fn(), invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('@tauri-apps/api/event', () => ({ emitTo }));

const source = {
  canvas: document.createElement('canvas'),
  drawImage: vi.fn(),
  getImageData: vi.fn(() => ({ data: new Uint8ClampedArray([18, 52, 86, 255]) })),
};
const preview = { drawImage: vi.fn(), clearRect: vi.fn(), imageSmoothingEnabled: true };
const image = { naturalWidth: 200, naturalHeight: 160, src: 'capture.png' } as HTMLImageElement;

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
    return (this.getAttribute('aria-label') === '像素放大预览' ? preview : source) as unknown as CanvasRenderingContext2D;
  });
  preview.imageSmoothingEnabled = true;
  emitTo.mockResolvedValue(undefined);
  invoke.mockResolvedValue(undefined);
  vi.stubGlobal('innerWidth', 800);
  vi.stubGlobal('innerHeight', 600);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

it('magnifies physical pixels without interpolation and selects the displayed center color', async () => {
  render(<ColorPickerOverlay generation={3} image={image} scaleFactor={2} />);
  const picker = screen.getByRole('application', { name: '屏幕取色' });
  fireEvent.mouseMove(picker, { clientX: 20.75, clientY: 15.5 });
  expect(screen.getByRole('img', { name: '像素放大预览' })).toBeInTheDocument();
  expect(source.getImageData).toHaveBeenCalledWith(41, 31, 1, 1);
  expect(preview.drawImage).toHaveBeenCalledWith(source.canvas, 36, 26, 11, 11, 0, 0, 132, 132);
  expect(preview.imageSmoothingEnabled).toBe(false);
  expect(screen.getByText('#123456')).toBeInTheDocument();
  await act(async () => fireEvent.mouseDown(picker, { button: 0, clientX: 20.75, clientY: 15.5 }));
  expect(emitTo).toHaveBeenCalledWith('main', 'screen-color-picked', '#123456');
});

it.each([
  [0, 0, 0, 0, 6, 6, 60, 60, 72, 72],
  [199, 0, 194, 0, 6, 6, 0, 60, 72, 72],
  [0, 159, 0, 154, 6, 6, 60, 0, 72, 72],
  [199, 159, 194, 154, 6, 6, 0, 0, 72, 72],
])('keeps the selected pixel centered at screen corner (%i, %i)', (x, y, ...crop) => {
  render(<ColorPickerOverlay generation={3} image={image} scaleFactor={1} />);
  fireEvent.mouseMove(screen.getByRole('application', { name: '屏幕取色' }), { clientX: x, clientY: y });
  expect(screen.getByRole('img', { name: '像素放大预览' })).toBeInTheDocument();
  expect(preview.drawImage).toHaveBeenCalledWith(source.canvas, ...crop);
});

it('flips the magnifier above and left near the viewport corner', () => {
  render(<ColorPickerOverlay generation={3} image={image} scaleFactor={1} />);
  fireEvent.mouseMove(screen.getByRole('application', { name: '屏幕取色' }), { clientX: 790, clientY: 590 });
  const hud = screen.getByRole('group', { name: '像素放大镜' });
  expect(hud).toHaveStyle({ left: '636px', top: '406px' });
});
