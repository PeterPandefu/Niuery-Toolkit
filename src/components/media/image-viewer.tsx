import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type SyntheticEvent } from 'react';
import { Maximize, Minimize, Minus, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  clampImageViewerZoom,
  IMAGE_VIEWER_ZOOM_STEP,
} from './image-viewer-utils';

export interface ImageViewerProps {
  source?: string | Blob;
  alt: string;
  title?: string;
  mode?: 'inline' | 'dialog';
  wheelZoom?: 'always' | 'ctrl';
  className?: string;
  onClose?: () => void;
  onLoad?: (event: SyntheticEvent<HTMLImageElement>) => void;
}

interface Offset {
  x: number;
  y: number;
}

function useImageSource(source?: string | Blob): string | null {
  const [url, setUrl] = useState<string | null>(typeof source === 'string' ? source : null);

  useEffect(() => {
    if (!source) {
      setUrl(null);
      return;
    }
    if (typeof source === 'string') {
      setUrl(source);
      return;
    }
    const nextUrl = URL.createObjectURL(source);
    setUrl(nextUrl);
    return () => URL.revokeObjectURL(nextUrl);
  }, [source]);

  return url;
}

function ViewerControls({
  zoom,
  onZoomChange,
  onFit,
  onOriginal,
}: {
  zoom: number;
  onZoomChange: (delta: number) => void;
  onFit: () => void;
  onOriginal: () => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onZoomChange(-IMAGE_VIEWER_ZOOM_STEP)} aria-label="缩小预览">
        <Minus />
      </Button>
      <button className="min-w-12 rounded px-1 text-xs hover:bg-accent" onClick={onFit} aria-label="重置预览缩放">
        {Math.round(zoom * 100)}%
      </button>
      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onZoomChange(IMAGE_VIEWER_ZOOM_STEP)} aria-label="放大预览">
        <Plus />
      </Button>
      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onFit} aria-label="适应窗口" title="适应窗口">
        <Minimize />
      </Button>
      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onOriginal} aria-label="原始大小" title="原始大小">
        <Maximize />
      </Button>
    </div>
  );
}

export function ImageViewer({
  source,
  alt,
  title,
  mode = 'inline',
  wheelZoom = mode === 'dialog' ? 'always' : 'ctrl',
  className,
  onClose,
  onLoad,
}: ImageViewerProps) {
  const url = useImageSource(source);
  const [zoom, setZoom] = useState(1);
  const [fitToWindow, setFitToWindow] = useState(true);
  const [offset, setOffset] = useState<Offset>({ x: 0, y: 0 });
  const [open, setOpen] = useState(true);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ pointerId: number; x: number; y: number; offset: Offset } | null>(null);

  const resetViewport = useCallback((fit: boolean) => {
    setZoom(1);
    setFitToWindow(fit);
    setOffset({ x: 0, y: 0 });
  }, []);

  const changeZoom = useCallback((delta: number) => {
    setFitToWindow(false);
    setZoom((value) => clampImageViewerZoom(value + delta));
  }, []);

  useEffect(() => {
    setZoom(1);
    setFitToWindow(true);
    setOffset({ x: 0, y: 0 });
    setDragging(false);
    setOpen(true);
  }, [source]);

  useEffect(() => {
    if (mode !== 'dialog') return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        onClose?.();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [mode, onClose]);

  const close = () => {
    setOpen(false);
    onClose?.();
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, offset };
    setDragging(true);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setOffset({ x: drag.offset.x + event.clientX - drag.x, y: drag.offset.y + event.clientY - drag.y });
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null;
      setDragging(false);
    }
  };

  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    if (wheelZoom === 'ctrl' && !event.ctrlKey) return;
    event.preventDefault();
    changeZoom(event.deltaY < 0 ? IMAGE_VIEWER_ZOOM_STEP : -IMAGE_VIEWER_ZOOM_STEP);
  };

  if (mode === 'dialog' && !open) return null;

  const viewport = (
    <div
      role="region"
      aria-label="图片预览区域"
      className={`relative min-h-0 flex-1 overflow-hidden bg-black/90 p-4 ${className ?? ''}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onWheel={handleWheel}
      style={{ cursor: dragging ? 'grabbing' : 'grab' }}
    >
      {url ? (
        <div className="flex h-full w-full items-center justify-center">
          <img
            src={url}
            alt={alt}
            draggable={false}
            onLoad={onLoad}
            className={fitToWindow ? 'max-h-full max-w-full select-none object-contain' : 'max-w-none select-none'}
            style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`, transformOrigin: 'center', transition: dragRef.current ? 'none' : 'transform 100ms ease-out' }}
          />
        </div>
      ) : <span className="flex h-full items-center justify-center text-sm text-white/70">正在加载预览…</span>}
    </div>
  );

  if (mode === 'dialog') {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="图片预览">
        <button className="absolute inset-0 bg-black/75 backdrop-blur-sm" aria-label="关闭预览" onClick={close} />
        <section className="relative flex h-full max-h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl border border-border bg-popover shadow-tinted-lg">
          <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
            <h3 className="min-w-0 truncate text-sm font-semibold">{title ?? alt}</h3>
            <div className="flex shrink-0 items-center gap-1">
              <ViewerControls zoom={zoom} onZoomChange={changeZoom} onFit={() => resetViewport(true)} onOriginal={() => resetViewport(false)} />
              <Button variant="ghost" size="icon" onClick={close} title="关闭预览（Esc）" aria-label="关闭预览"><X /></Button>
            </div>
          </header>
          {viewport}
          <footer className="border-t border-border px-4 py-2 text-center text-xs text-muted-foreground">拖动平移 · 滚轮缩放 · Esc 关闭</footer>
        </section>
      </div>
    );
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label="图片预览">
      <div className="flex shrink-0 items-center justify-between border-b px-2 py-1.5">
        <span className="text-xs text-muted-foreground">{title ?? '图片预览'}</span>
        <ViewerControls zoom={zoom} onZoomChange={changeZoom} onFit={() => resetViewport(true)} onOriginal={() => resetViewport(false)} />
      </div>
      {viewport}
    </section>
  );
}
