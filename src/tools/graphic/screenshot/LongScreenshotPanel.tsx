import { useState } from 'react';
import { Check, ChevronDown, Layers3, Minus, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface LongScreenshotPanelProps {
  frames: HTMLImageElement[];
  busy: boolean;
  onCaptureFrame: () => void;
  onFinish: (overlap: number) => void;
  onCancel: () => void;
}

export function LongScreenshotPanel({ frames, busy, onCaptureFrame, onFinish, onCancel }: LongScreenshotPanelProps) {
  const [overlap, setOverlap] = useState(12);

  return (
    <div className="absolute inset-x-3 top-3 z-20 mx-auto max-w-xl rounded-xl border border-border/80 bg-background/95 p-3 shadow-xl backdrop-blur-md">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Layers3 className="h-4 w-4" /></span>
        <div className="min-w-0 flex-1"><h3 className="text-sm font-semibold text-foreground">长截图</h3><p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">滚动页面后，连续添加当前画面，完成后会自动纵向拼接。</p></div>
        <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={onCancel} aria-label="取消长截图"><X className="h-3.5 w-3.5" /></Button>
      </div>

      <div className="mt-3 flex items-center gap-2 rounded-lg bg-muted/50 px-2.5 py-2 text-xs text-muted-foreground"><span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground">{frames.length}</span><span className="flex-1">已采集片段</span><span className="flex items-center gap-1"><Minus className="h-3 w-3" /><input aria-label="重叠比例" type="range" min="0" max="30" value={overlap} onChange={(event) => setOverlap(Number(event.target.value))} className="h-1 w-20 accent-primary" /><Plus className="h-3 w-3" /> <span className="w-8 text-right font-mono">{overlap}%</span></span></div>

      {frames.length > 0 && <div className="mt-3 flex gap-1.5 overflow-x-auto pb-1">{frames.map((frame, index) => <div key={`${frame.src}-${index}`} className="relative h-14 w-20 shrink-0 overflow-hidden rounded border border-border bg-muted"><img src={frame.src} alt={`第 ${index + 1} 段`} className="h-full w-full object-cover object-top" /><span className="absolute bottom-0 left-0 rounded-tr bg-background/85 px-1 text-[9px] font-mono text-foreground">{index + 1}</span></div>)}</div>}

      <div className="mt-3 flex items-center justify-between gap-2"><div className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><ChevronDown className="h-3.5 w-3.5 text-primary" />每次滚动约一屏，并保留少量重叠</div><div className="flex gap-2"><Button variant="outline" size="sm" className="h-8 text-xs" onClick={onCaptureFrame} disabled={busy}>{busy ? '采集中…' : '添加当前画面'}</Button><Button variant="default" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => onFinish(overlap)} disabled={frames.length === 0 || busy}><Check className="h-3.5 w-3.5" />完成拼接</Button></div></div>
    </div>
  );
}
