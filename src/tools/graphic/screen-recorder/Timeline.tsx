import { Copy, GripVertical, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { GifFrame } from './types';

interface TimelineProps {
  frames: GifFrame[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  onDelete: (index: number) => void;
  onDuplicate: (index: number) => void;
  onReorder: (from: number, to: number) => void;
  onDelayChange: (index: number, delayMs: number) => void;
}

export function Timeline({ frames, selectedIndex, onSelect, onDelete, onDuplicate, onReorder, onDelayChange }: TimelineProps) {
  let dragIndex: number | null = null;
  return (
    <div className="border-t border-border/70 bg-card/70 p-3">
      <div className="mb-2 flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold text-foreground">时间线</p>
          <p className="text-[10px] text-muted-foreground">{frames.length} 帧 · 可拖动排序</p>
        </div>
        {frames[selectedIndex] && (
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground">帧延迟</span>
            <Input
              className="h-7 w-20 text-xs"
              type="number"
              min={10}
              step={10}
              value={frames[selectedIndex].delayMs}
              onChange={(event) => onDelayChange(selectedIndex, Number(event.target.value))}
              aria-label="帧延迟（毫秒）"
            />
            <span className="text-[10px] text-muted-foreground">ms</span>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onDuplicate(selectedIndex)} title="复制帧" aria-label="复制帧">
              <Copy className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => onDelete(selectedIndex)} disabled={frames.length <= 1} title="删除帧" aria-label="删除帧">
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      </div>
      <div className="flex min-w-0 gap-2 overflow-x-auto pb-1">
        {frames.map((frame, index) => (
          <button
            key={frame.id}
            draggable
            onDragStart={() => { dragIndex = index; }}
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => {
              if (dragIndex !== null) onReorder(dragIndex, index);
              dragIndex = null;
            }}
            onClick={() => onSelect(index)}
            className={`group relative flex h-20 w-28 shrink-0 flex-col overflow-hidden rounded-md border text-left transition ${index === selectedIndex ? 'border-primary ring-2 ring-primary/20' : 'border-border hover:border-primary/50'}`}
            aria-label={`第 ${index + 1} 帧`}
          >
            <div className="absolute left-1 top-1 z-10 rounded bg-black/60 px-1 text-[10px] text-white">{index + 1}</div>
            <GripVertical className="absolute right-1 top-1 z-10 h-3 w-3 text-white/70 opacity-0 transition group-hover:opacity-100" />
            <div
              className="min-h-0 flex-1 bg-checkerboard bg-[length:12px_12px]"
              style={{
                backgroundImage: `url(${rgbaToDataUrl(frame)})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
              }}
            />
            <span className="bg-background/90 px-1.5 py-0.5 text-[9px] text-muted-foreground">{frame.delayMs}ms</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function rgbaToDataUrl(frame: GifFrame): string {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = frame.width;
    canvas.height = frame.height;
    canvas.getContext('2d')?.putImageData(new ImageData(frame.rgba, frame.width, frame.height), 0, 0);
    return canvas.toDataURL('image/png');
  } catch {
    return '';
  }
}

