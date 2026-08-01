import { useState, useRef, useCallback } from 'react';
import { Code2, ImageIcon } from 'lucide-react';
import { toast } from 'sonner';
import { copyToClipboard } from '@/lib/utils';
import { gradientPresets, colorFilterDots, type GradientPreset } from './color-data';

export default function GradientTab() {
  const [activeFilter, setActiveFilter] = useState<number | null>(null);
  const [selectedGradient, setSelectedGradient] = useState<GradientPreset | null>(null);
  const [angle, setAngle] = useState(135);
  const [imgWidth, setImgWidth] = useState(1000);
  const [imgHeight, setImgHeight] = useState(1000);
  const angleRef = useRef<HTMLDivElement>(null);
  const isDraggingAngle = useRef(false);

  const cssCode = selectedGradient
    ? `linear-gradient(${angle}deg,${selectedGradient.colors[0]},${selectedGradient.colors[1]})`
    : '';

  const handleCopyCode = async () => {
    await copyToClipboard(cssCode);
    toast.success('已复制 CSS 代码');
  };

  const handleCopyImage = useCallback(async () => {
    if (!selectedGradient) return;
    const canvas = document.createElement('canvas');
    canvas.width = imgWidth;
    canvas.height = imgHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const gradient = ctx.createLinearGradient(
      0, 0,
      imgWidth * Math.cos(angle * Math.PI / 180),
      imgHeight * Math.sin(angle * Math.PI / 180)
    );
    gradient.addColorStop(0, selectedGradient.colors[0]);
    gradient.addColorStop(1, selectedGradient.colors[1]);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, imgWidth, imgHeight);
    canvas.toBlob(async (blob) => {
      if (!blob) return;
      try {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        toast.success('已复制渐变图片');
      } catch {
        // Fallback: download
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'gradient.png';
        a.click();
        URL.revokeObjectURL(url);
        toast.success('已下载渐变图片');
      }
    });
  }, [selectedGradient, angle, imgWidth, imgHeight]);

  const handleAngleDrag = useCallback((e: React.MouseEvent | MouseEvent) => {
    const el = angleRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const x = (e as MouseEvent).clientX - cx;
    const y = (e as MouseEvent).clientY - cy;
    let deg = Math.atan2(y, x) * 180 / Math.PI + 90;
    if (deg < 0) deg += 360;
    setAngle(Math.round(deg));
  }, []);

  const handleAngleMouseDown = useCallback((e: React.MouseEvent) => {
    isDraggingAngle.current = true;
    handleAngleDrag(e);
    const onMove = (ev: MouseEvent) => { if (isDraggingAngle.current) handleAngleDrag(ev); };
    const onUp = () => { isDraggingAngle.current = false; window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [handleAngleDrag]);

  // Simple hue filter for gradients
  const matchesFilter = (preset: GradientPreset, filterIdx: number | null): boolean => {
    if (filterIdx === null) return true;
    const hex = preset.colors[0];
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0;
    if (max !== min) {
      const d = max - min;
      switch (max) {
        case r: h = ((g - b) / d + (g < b ? 6 : 0)) * 60; break;
        case g: h = ((b - r) / d + 2) * 60; break;
        case b: h = ((r - g) / d + 4) * 60; break;
      }
    }
    const ranges = [[330, 30], [15, 45], [45, 70], [70, 170], [170, 250], [160, 200], [250, 330], [0, 360], [0, 360], [0, 360]];
    if (filterIdx >= 7) return true;
    const [lo, hi] = ranges[filterIdx];
    if (lo > hi) return h >= lo || h <= hi;
    return h >= lo && h <= hi;
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Color filter dots */}
      <div className="flex items-center gap-2 border-b px-4 py-2">
        {colorFilterDots.map((color, idx) => (
          <button
            key={idx}
            onClick={() => setActiveFilter(activeFilter === idx ? null : idx)}
            className={`h-5 w-5 rounded-full border-2 transition ${activeFilter === idx ? 'border-foreground scale-125' : 'border-transparent'}`}
            style={{ backgroundColor: color }}
          />
        ))}
      </div>

      {/* Gradient Grid */}
      <div className="flex-1 overflow-auto p-4">
        <div className="grid grid-cols-4 gap-4">
          {gradientPresets
            .filter(p => matchesFilter(p, activeFilter))
            .map((preset, idx) => (
            <div
              key={idx}
              className="cursor-pointer rounded-lg overflow-hidden shadow-sm transition-transform hover:scale-105 hover:shadow-md"
              onClick={() => { setSelectedGradient(preset); setAngle(preset.angle); }}
            >
              <div
                className="h-32 w-full"
                style={{ background: `linear-gradient(${preset.angle}deg, ${preset.colors[0]}, ${preset.colors[1]})` }}
              />
              <div className="flex items-center justify-between px-2 py-1.5 bg-background">
                <div className="h-4 w-4 rounded" style={{ backgroundColor: preset.colors[0] }} />
                <div className="h-4 w-4 rounded" style={{ backgroundColor: preset.colors[1] }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Gradient Detail Modal */}
      {selectedGradient && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setSelectedGradient(null)}>
          <div className="bg-background rounded-xl shadow-2xl w-[600px] overflow-hidden" onClick={(e) => e.stopPropagation()}>
            {/* Preview */}
            <div
              className="h-48 w-full"
              style={{ background: `linear-gradient(${angle}deg, ${selectedGradient.colors[0]}, ${selectedGradient.colors[1]})` }}
            />
            {/* Controls */}
            <div className="flex items-center gap-6 p-6">
              {/* Angle Selector */}
              <div
                ref={angleRef}
                className="relative h-24 w-24 rounded-full border-2 border-primary/50 cursor-pointer flex-shrink-0"
                onMouseDown={handleAngleMouseDown}
              >
                <div
                  className="absolute h-3 w-3 rounded-full bg-primary border-2 border-white shadow"
                  style={{
                    left: `${50 + 40 * Math.sin(angle * Math.PI / 180)}%`,
                    top: `${50 - 40 * Math.cos(angle * Math.PI / 180)}%`,
                    transform: 'translate(-50%, -50%)',
                  }}
                />
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="h-0.5 w-10 bg-muted-foreground/30 rotate-45" />
                </div>
              </div>

              {/* CSS Code & Actions */}
              <div className="flex-1 space-y-3">
                <div>
                  <label className="text-xs text-muted-foreground">CSS 代码</label>
                  <div className="flex gap-2 mt-1">
                    <input
                      type="text"
                      value={cssCode}
                      readOnly
                      className="flex-1 rounded border bg-muted/30 px-3 py-2 font-mono text-sm"
                    />
                    <button
                      onClick={handleCopyCode}
                      className="flex items-center gap-1 rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground hover:bg-primary/90"
                    >
                      <Code2 className="h-4 w-4" />
                      复制代码
                    </button>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div>
                    <label className="text-xs text-muted-foreground">图片宽度</label>
                    <input
                      type="number"
                      value={imgWidth}
                      onChange={(e) => setImgWidth(Number(e.target.value))}
                      className="mt-1 w-24 rounded border bg-background px-3 py-1.5 text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">图片高度</label>
                    <input
                      type="number"
                      value={imgHeight}
                      onChange={(e) => setImgHeight(Number(e.target.value))}
                      className="mt-1 w-24 rounded border bg-background px-3 py-1.5 text-sm"
                    />
                  </div>
                  <button
                    onClick={handleCopyImage}
                    className="mt-4 flex items-center gap-1 rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground hover:bg-primary/90"
                  >
                    <ImageIcon className="h-4 w-4" />
                    复制图片
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
