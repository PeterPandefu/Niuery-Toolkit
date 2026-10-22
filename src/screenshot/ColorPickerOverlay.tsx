import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { emitTo } from '@tauri-apps/api/event';

interface Props {
  generation: number;
  image: HTMLImageElement;
  scaleFactor: number;
}

const PIXEL_SIZE = 12;
const PIXEL_RADIUS = 5;
const PREVIEW_SIZE = (PIXEL_RADIUS * 2 + 1) * PIXEL_SIZE;
const HUD_WIDTH = PREVIEW_SIZE + 2;
const HUD_HEIGHT = HUD_WIDTH + 30;

/** Samples the unscaled capture; the preview and HUD never affect the selected pixel. */
export function ColorPickerOverlay({ generation, image, scaleFactor }: Props) {
  const [sample, setSample] = useState<{ x: number; y: number; px: number; py: number; hex: string } | null>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState('');
  const closing = useRef(false);
  const context = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx?.drawImage(image, 0, 0);
    return ctx;
  }, [image]);

  useEffect(() => {
    const preview = previewRef.current?.getContext('2d');
    if (!preview || !context || !sample) return;
    const left = sample.px - PIXEL_RADIUS;
    const top = sample.py - PIXEL_RADIUS;
    const sx = Math.max(0, left);
    const sy = Math.max(0, top);
    const width = Math.min(image.naturalWidth, sample.px + PIXEL_RADIUS + 1) - sx;
    const height = Math.min(image.naturalHeight, sample.py + PIXEL_RADIUS + 1) - sy;
    preview.clearRect(0, 0, PREVIEW_SIZE, PREVIEW_SIZE);
    preview.imageSmoothingEnabled = false;
    // Keep the selected pixel in the middle even when the crop reaches an image edge.
    preview.drawImage(context.canvas, sx, sy, width, height,
      (sx - left) * PIXEL_SIZE, (sy - top) * PIXEL_SIZE, width * PIXEL_SIZE, height * PIXEL_SIZE);
  }, [context, image, sample]);

  const close = useCallback(async () => {
    if (closing.current) return;
    closing.current = true;
    try { await invoke('close_screenshot_window', { generation }); }
    catch (reason) { closing.current = false; setError(`取消失败：${String(reason)}`); }
  }, [generation]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); void close(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  const read = (x: number, y: number) => {
    if (!context) throw new Error('无法读取屏幕像素，请取消后重试');
    const px = Math.max(0, Math.min(image.naturalWidth - 1, Math.floor(x * scaleFactor)));
    const py = Math.max(0, Math.min(image.naturalHeight - 1, Math.floor(y * scaleFactor)));
    const { data } = context.getImageData(px, py, 1, 1);
    const hex = '#' + Array.from(data.slice(0, 3), (value) => value.toString(16).padStart(2, '0')).join('');
    return { px, py, hex };
  };

  const position = sample ? {
    left: Math.max(0, Math.min(sample.x + 20 + HUD_WIDTH <= window.innerWidth
      ? sample.x + 20 : sample.x - HUD_WIDTH - 20, window.innerWidth - HUD_WIDTH)),
    top: Math.max(0, Math.min(sample.y + 20 + HUD_HEIGHT <= window.innerHeight
      ? sample.y + 20 : sample.y - HUD_HEIGHT - 20, window.innerHeight - HUD_HEIGHT)),
  } : undefined;

  return (
    <div role="application" aria-label="屏幕取色" className="fixed inset-0 cursor-crosshair overflow-hidden"
      onContextMenu={(event) => { event.preventDefault(); void close(); }}
      onMouseMove={(event) => {
        try { setSample({ x: event.clientX, y: event.clientY, ...read(event.clientX, event.clientY) }); }
        catch (reason) { setError(String(reason)); }
      }}
      onMouseDown={async (event) => {
        if (event.button !== 0 || closing.current) return;
        event.preventDefault();
        try {
          const { hex } = read(event.clientX, event.clientY);
          closing.current = true;
          await emitTo('main', 'screen-color-picked', hex);
          await invoke('close_screenshot_window', { generation });
        } catch (reason) { closing.current = false; setError(`取色失败：${String(reason)}`); }
      }}>
      <img src={image.src} alt="" draggable={false} className="pointer-events-none fixed left-0 top-0 select-none"
        style={{ width: image.naturalWidth / scaleFactor, height: image.naturalHeight / scaleFactor }} />
      <div className="pointer-events-none fixed inset-x-0 top-8 flex justify-center">
        <div className="flex items-center gap-3 rounded-xl border border-white/15 bg-black/90 px-4 py-3 text-sm text-white shadow-2xl">
          <span>{error || '点击选取颜色 · Esc / 右键取消'}</span>
          <button type="button" className="pointer-events-auto rounded bg-white/15 px-2 py-1" onMouseDown={(event) => event.stopPropagation()} onClick={() => void close()}>取消取色</button>
        </div>
      </div>
      {sample && <div role="group" aria-label="像素放大镜" className="pointer-events-none fixed z-50 overflow-hidden rounded-md border border-white/60 bg-neutral-900 text-white shadow-xl"
        style={{ ...position, width: HUD_WIDTH }}>
        <div className="relative" style={{ width: PREVIEW_SIZE, height: PREVIEW_SIZE }}>
          <canvas ref={previewRef} role="img" aria-label="像素放大预览" width={PREVIEW_SIZE} height={PREVIEW_SIZE}
            className="block" style={{ imageRendering: 'pixelated' }} />
          <div aria-hidden="true" className="absolute inset-0" style={{
            backgroundImage: 'linear-gradient(to right, rgba(0,0,0,0.25) 1px, transparent 1px), linear-gradient(to bottom, rgba(0,0,0,0.25) 1px, transparent 1px)',
            backgroundSize: `${PIXEL_SIZE}px ${PIXEL_SIZE}px`,
          }} />
          <div aria-hidden="true" className="absolute border-2 border-white" style={{
            left: PIXEL_RADIUS * PIXEL_SIZE, top: PIXEL_RADIUS * PIXEL_SIZE,
            width: PIXEL_SIZE, height: PIXEL_SIZE, boxShadow: '0 0 0 1px #000, inset 0 0 0 1px #000',
          }} />
        </div>
        <div className="flex h-[30px] items-center justify-center gap-2 font-mono text-xs">
          <span aria-hidden="true" className="h-3 w-3 rounded-sm border border-white/60" style={{ backgroundColor: sample.hex }} />{sample.hex.toUpperCase()}
        </div>
      </div>}
    </div>
  );
}
