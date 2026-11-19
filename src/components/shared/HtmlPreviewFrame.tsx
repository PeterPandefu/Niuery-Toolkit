import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { HTML_PREVIEW_HARNESS_FILE, HTML_PREVIEW_METRICS, buildPreviewDocument, computePreviewFrame, type HtmlPreviewMode } from '@/lib/html-preview';

const MAX_WIDTH_GROWTH = 4;

interface HtmlPreviewFrameProps {
  html: string;
  title: string;
}

/** 以文档真实宽度渲染 iframe，再整体缩放到面板内，避免固定宽内容右侧被裁剪。 */
export function HtmlPreviewFrame({ html, title }: HtmlPreviewFrameProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const widthRef = useRef(0);
  const growthRef = useRef(0);
  const [mode, setMode] = useState<HtmlPreviewMode>('fit');
  const [pane, setPane] = useState({ width: 0, height: 0 });
  const [contentWidth, setContentWidth] = useState(0);
  const previewDocument = useMemo(
    () => buildPreviewDocument(html, new URL(HTML_PREVIEW_HARNESS_FILE, window.location.href).href),
    [html],
  );

  useEffect(() => {
    widthRef.current = 0;
    growthRef.current = 0;
    setContentWidth(0);
  }, [previewDocument, pane.width]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setPane((current) => (
        Math.floor(current.width) === Math.floor(width) && Math.floor(current.height) === Math.floor(height)
          ? current
          : { width, height }
      ));
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frameRef.current?.contentWindow) return;
      const data = event.data as { type?: string; width?: number } | null;
      if (!data || data.type !== HTML_PREVIEW_METRICS || typeof data.width !== 'number' || !Number.isFinite(data.width)) return;
      const width = Math.ceil(Math.max(0, data.width));
      if (width <= widthRef.current || growthRef.current >= MAX_WIDTH_GROWTH) return;
      widthRef.current = width;
      growthRef.current += 1;
      setContentWidth(width);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const frame = computePreviewFrame({ paneWidth: pane.width, paneHeight: pane.height, contentWidth, mode });

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-white">
      <div className="flex items-center justify-between gap-2 border-b bg-background px-2 py-1">
        <span className="text-[11px] text-muted-foreground">预览缩放 {Math.round(frame.scale * 100)}%</span>
        <div className="flex items-center gap-1">
          <Button variant={mode === 'fit' ? 'secondary' : 'ghost'} size="sm" aria-label="预览适应宽度" aria-pressed={mode === 'fit'} onClick={() => setMode('fit')}>适应宽度</Button>
          <Button variant={mode === 'actual' ? 'secondary' : 'ghost'} size="sm" aria-label="预览原始尺寸" aria-pressed={mode === 'actual'} onClick={() => setMode('actual')}>原始尺寸</Button>
        </div>
      </div>
      <div ref={containerRef} className="relative min-h-0 min-w-0 flex-1 overflow-x-auto overflow-y-hidden">
        <div style={{ width: frame.width * frame.scale, height: '100%' }}>
          <iframe
            ref={frameRef}
            title={title}
            sandbox="allow-scripts"
            srcDoc={previewDocument}
            className="border-0"
            style={{ width: frame.width, height: frame.height, transform: `scale(${frame.scale})`, transformOrigin: 'top left' }}
          />
        </div>
      </div>
    </section>
  );
}