import { decompressFrames, parseGIF, type ParsedFrame } from 'gifuct-js';
import { GIFEncoder, applyPalette, quantize } from 'gifenc';
import type { GifAnnotation, GifFrame } from './types';

export interface DecodedGif {
  width: number;
  height: number;
  loopCount: number;
  frames: GifFrame[];
}

function applyPatch(canvas: Uint8ClampedArray, frame: ParsedFrame, width: number) {
  const patch = frame.patch;
  for (let row = 0; row < frame.dims.height; row += 1) {
    const sourceStart = row * frame.dims.width * 4;
    const targetStart = ((frame.dims.top + row) * width + frame.dims.left) * 4;
    canvas.set(patch.subarray(sourceStart, sourceStart + frame.dims.width * 4), targetStart);
  }
}

export function decodeGif(arrayBuffer: ArrayBuffer): DecodedGif {
  const parsed = parseGIF(arrayBuffer);
  const frames = decompressFrames(parsed, true);
  const width = parsed.lsd.width;
  const height = parsed.lsd.height;
  const canvas = new Uint8ClampedArray(width * height * 4);
  canvas.fill(255);
  const decoded: GifFrame[] = [];

  frames.forEach((frame, index) => {
    const previous = new Uint8ClampedArray(canvas);
    applyPatch(canvas, frame, width);
    decoded.push({
      id: `gif-${index}-${Date.now()}`,
      delayMs: Math.max(10, frame.delay * 10),
      width,
      height,
      rgba: new Uint8ClampedArray(canvas),
      annotations: [] as GifAnnotation[],
    });
    if (frame.disposalType === 2) canvas.fill(0);
    else if (frame.disposalType === 3) canvas.set(previous);
  });

  return { width, height, loopCount: 0, frames: decoded };
}

function renderAnnotations(frame: GifFrame): Uint8Array {
  const canvas = document.createElement('canvas');
  canvas.width = frame.width;
  canvas.height = frame.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new Uint8Array(frame.rgba);
  const image = new ImageData(new Uint8ClampedArray(frame.rgba), frame.width, frame.height);
  ctx.putImageData(image, 0, 0);
  frame.annotations.forEach((annotation) => {
    ctx.strokeStyle = annotation.color ?? '#ff3b30';
    ctx.fillStyle = annotation.color ?? '#ff3b30';
    ctx.lineWidth = 3;
    if (annotation.type === 'rect') {
      ctx.strokeRect(annotation.x, annotation.y, annotation.width ?? 0, annotation.height ?? 0);
    } else if (annotation.type === 'arrow' && annotation.points && annotation.points.length >= 4) {
      ctx.beginPath();
      ctx.moveTo(annotation.points[0], annotation.points[1]);
      ctx.lineTo(annotation.points[2], annotation.points[3]);
      ctx.stroke();
    } else if (annotation.type === 'text') {
      ctx.font = 'bold 20px sans-serif';
      ctx.fillText(annotation.text ?? '', annotation.x, annotation.y);
    } else if (annotation.type === 'mosaic') {
      ctx.fillStyle = 'rgba(0,0,0,.45)';
      ctx.fillRect(annotation.x, annotation.y, annotation.width ?? 40, annotation.height ?? 40);
    }
  });
  return new Uint8Array(ctx.getImageData(0, 0, frame.width, frame.height).data);
}

export function encodeGif(frames: GifFrame[], loopCount = 0, maxWidth = 800): Blob {
  if (!frames.length) throw new Error('至少需要一帧才能导出 GIF');
  const source = frames[0];
  const scale = source.width > maxWidth ? maxWidth / source.width : 1;
  const width = Math.max(1, Math.round(source.width * scale));
  const height = Math.max(1, Math.round(source.height * scale));
  const encoder = GIFEncoder();

  frames.forEach((frame) => {
    const rgba = renderAnnotations(frame);
    let data = rgba;
    if (scale !== 1) {
      const sourceCanvas = document.createElement('canvas');
      sourceCanvas.width = frame.width;
      sourceCanvas.height = frame.height;
      sourceCanvas.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(rgba), frame.width, frame.height), 0, 0);
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('无法初始化 GIF 画布');
      ctx.drawImage(sourceCanvas, 0, 0, width, height);
      data = new Uint8Array(ctx.getImageData(0, 0, width, height).data);
    }
    const palette = quantize(data, 256, { format: 'rgba4444' });
    const index = applyPalette(data, palette);
    encoder.writeFrame(index, width, height, {
      palette,
      delay: frame.delayMs,
      repeat: loopCount,
      transparent: true,
    });
  });
  encoder.finish();
  return new Blob([encoder.bytes()], { type: 'image/gif' });
}

export interface GifWorkerRequest {
  type: 'decode' | 'encode';
  id: string;
  buffer?: ArrayBuffer;
  frames?: GifFrame[];
  loopCount?: number;
  maxWidth?: number;
}

export interface GifWorkerResponse {
  id: string;
  type: 'decoded' | 'encoded' | 'error';
  payload?: DecodedGif | ArrayBuffer;
  error?: string;
}

const workerScope = globalThis as typeof globalThis & {
  postMessage?: (message: GifWorkerResponse) => void;
  onmessage?: (event: MessageEvent<GifWorkerRequest>) => void;
};

if (typeof self !== 'undefined' && !('document' in self)) {
  workerScope.onmessage = (event) => {
    const request = event.data;
    try {
      if (request.type === 'decode' && request.buffer) {
        const decoded = decodeGif(request.buffer);
        workerScope.postMessage?.({ id: request.id, type: 'decoded', payload: decoded });
      }
    } catch (reason) {
      workerScope.postMessage?.({ id: request.id, type: 'error', error: reason instanceof Error ? reason.message : String(reason) });
    }
  };
}
