import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { Pipette, Copy, Check, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { copyToClipboard } from '@/lib/utils';
import {
  hexToRgb, rgbToHex, rgbToHsl, hslToRgb, rgbToHsv, rgbToCmyk, rgbToHsi, rgbToCielab,
  getComplementary, getContrastColors, getAnalogous, getSplitComplementary,
  formatHex, formatRgb, formatHsv, formatHsl, formatCmyk, formatHsi, formatCielab,
  type HSL,
} from './color-utils';

interface ColorWheelTabProps {
  onAddFavorite?: (hex: string) => void;
  removeHash?: boolean;
}

export default function ColorWheelTab({ onAddFavorite, removeHash = false }: ColorWheelTabProps) {
  const [hex, setHex] = useState('#908637');
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const wheelRef = useRef<HTMLCanvasElement>(null);
  const satSliderRef = useRef<HTMLCanvasElement>(null);
  const valSliderRef = useRef<HTMLCanvasElement>(null);
  const isDraggingWheel = useRef(false);
  const isDraggingSat = useRef(false);
  const isDraggingVal = useRef(false);

  const rgb = useMemo(() => hexToRgb(hex) || { r: 0, g: 0, b: 0 }, [hex]);
  const hsl = useMemo(() => rgbToHsl(rgb), [rgb]);
  const hsv = useMemo(() => rgbToHsv(rgb), [rgb]);
  const cmyk = useMemo(() => rgbToCmyk(rgb), [rgb]);
  const hsi = useMemo(() => rgbToHsi(rgb), [rgb]);
  const cielab = useMemo(() => rgbToCielab(rgb), [rgb]);

  // Draw color wheel
  useEffect(() => {
    const canvas = wheelRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const size = canvas.width;
    const cx = size / 2, cy = size / 2, radius = size / 2 - 4;

    // Draw wheel
    for (let angle = 0; angle < 360; angle++) {
      const startAngle = (angle - 1) * Math.PI / 180;
      const endAngle = (angle + 1) * Math.PI / 180;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, radius, startAngle, endAngle);
      ctx.closePath();
      const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
      gradient.addColorStop(0, `hsl(${angle}, 0%, 100%)`);
      gradient.addColorStop(1, `hsl(${angle}, 100%, 50%)`);
      ctx.fillStyle = gradient;
      ctx.fill();
    }
  }, []);

  // Draw saturation slider
  useEffect(() => {
    const canvas = satSliderRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = canvas.width, h = canvas.height;
    const gradient = ctx.createLinearGradient(0, 0, w, 0);
    gradient.addColorStop(0, `hsl(${hsl.h}, 0%, ${hsl.l}%)`);
    gradient.addColorStop(1, `hsl(${hsl.h}, 100%, ${hsl.l}%)`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);
  }, [hsl.h, hsl.l]);

  // Draw value/brightness slider
  useEffect(() => {
    const canvas = valSliderRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = canvas.width, h = canvas.height;
    const gradient = ctx.createLinearGradient(0, 0, w, 0);
    gradient.addColorStop(0, '#000000');
    gradient.addColorStop(1, `hsl(${hsl.h}, ${hsl.s}%, 50%)`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);
  }, [hsl.h, hsl.s]);

  const handleWheelInteraction = useCallback((e: React.MouseEvent<HTMLCanvasElement> | MouseEvent) => {
    const canvas = wheelRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left - rect.width / 2;
    const y = e.clientY - rect.top - rect.height / 2;
    const radius = rect.width / 2 - 4;
    const dist = Math.min(Math.sqrt(x * x + y * y), radius);
    let angle = Math.atan2(y, x) * 180 / Math.PI;
    if (angle < 0) angle += 360;
    const saturation = (dist / radius) * 100;
    const newHsl: HSL = { h: angle, s: saturation, l: hsl.l };
    setHex(rgbToHex(hslToRgb(newHsl)));
  }, [hsl.l]);

  const handleSatInteraction = useCallback((e: React.MouseEvent<HTMLCanvasElement> | MouseEvent) => {
    const canvas = satSliderRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const newHsl: HSL = { ...hsl, s: ratio * 100 };
    setHex(rgbToHex(hslToRgb(newHsl)));
  }, [hsl]);

  const handleValInteraction = useCallback((e: React.MouseEvent<HTMLCanvasElement> | MouseEvent) => {
    const canvas = valSliderRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const newHsl: HSL = { ...hsl, l: ratio * 100 };
    setHex(rgbToHex(hslToRgb(newHsl)));
  }, [hsl]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDraggingWheel.current) handleWheelInteraction(e);
      if (isDraggingSat.current) handleSatInteraction(e);
      if (isDraggingVal.current) handleValInteraction(e);
    };
    const handleMouseUp = () => {
      isDraggingWheel.current = false;
      isDraggingSat.current = false;
      isDraggingVal.current = false;
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [handleWheelInteraction, handleSatInteraction, handleValInteraction]);

  const handleEyeDropper = useCallback(async () => {
    try {
      // @ts-expect-error EyeDropper API
      const eyeDropper = new EyeDropper();
      const result = await eyeDropper.open();
      setHex(result.sRGBHex);
    } catch {
      toast.error('取色器不可用或已取消');
    }
  }, []);

  const handleCopy = useCallback(async (value: string, idx: number) => {
    await copyToClipboard(value);
    setCopiedIdx(idx);
    toast.success('已复制');
    setTimeout(() => setCopiedIdx(null), 1500);
  }, []);

  const formats = useMemo(() => [
    { label: 'HEX', value: formatHex(hex, removeHash) },
    { label: 'RGB', value: formatRgb(rgb) },
    { label: 'HSV/HSB', value: formatHsv(hsv) },
    { label: 'HSL', value: formatHsl(hsl) },
    { label: 'CMYK', value: formatCmyk(cmyk) },
    { label: 'HSI', value: formatHsi(hsi) },
    { label: 'CIE-LAB', value: formatCielab(cielab) },
  ], [hex, rgb, hsv, hsl, cmyk, hsi, cielab, removeHash]);

  const complementary = useMemo(() => getComplementary(hsl), [hsl]);
  const contrast = useMemo(() => getContrastColors(hsl), [hsl]);
  const analogous = useMemo(() => getAnalogous(hsl), [hsl]);
  const splitComp = useMemo(() => getSplitComplementary(hsl), [hsl]);

  // Wheel indicator position
  const wheelIndicator = useMemo(() => {
    const radius = 120;
    const dist = (hsl.s / 100) * radius;
    const angle = hsl.h * Math.PI / 180;
    return { x: 130 + dist * Math.cos(angle), y: 130 + dist * Math.sin(angle) };
  }, [hsl.h, hsl.s]);

  return (
    <div className="flex h-full gap-4 overflow-hidden p-4 transition-colors duration-300" style={{ backgroundColor: hex + '40' }}>
      {/* Left: Color Wheel */}
      <div className="flex flex-col items-center gap-4">
        {/* Eyedropper */}
        <button
          onClick={handleEyeDropper}
          className="flex h-10 w-10 items-center justify-center rounded-full shadow-md transition hover:scale-110"
          style={{ backgroundColor: hex }}
          title="屏幕取色"
        >
          <Pipette className="h-5 w-5 text-white" />
        </button>

        {/* Color Wheel */}
        <div className="relative">
          <canvas
            ref={wheelRef}
            width={260}
            height={260}
            className="cursor-crosshair rounded-full"
            style={{ width: 260, height: 260 }}
            onMouseDown={(e) => { isDraggingWheel.current = true; handleWheelInteraction(e); }}
          />
          {/* Indicator */}
          <div
            className="pointer-events-none absolute h-4 w-4 rounded-full border-2 border-white shadow-md"
            style={{ left: wheelIndicator.x - 8, top: wheelIndicator.y - 8 }}
          />
        </div>

        {/* Saturation Slider */}
        <div className="relative w-[260px]">
          <canvas
            ref={satSliderRef}
            width={260}
            height={20}
            className="h-5 w-full cursor-pointer rounded-full"
            onMouseDown={(e) => { isDraggingSat.current = true; handleSatInteraction(e); }}
          />
          <div
            className="pointer-events-none absolute top-1/2 h-5 w-5 -translate-y-1/2 rounded-full border-2 border-white shadow-md"
            style={{ left: `${hsl.s}%`, transform: 'translate(-50%, -50%)', background: `hsl(${hsl.h}, ${hsl.s}%, ${hsl.l}%)` }}
          />
        </div>

        {/* Value Slider */}
        <div className="relative w-[260px]">
          <canvas
            ref={valSliderRef}
            width={260}
            height={20}
            className="h-5 w-full cursor-pointer rounded-full"
            onMouseDown={(e) => { isDraggingVal.current = true; handleValInteraction(e); }}
          />
          <div
            className="pointer-events-none absolute top-1/2 h-5 w-5 -translate-y-1/2 rounded-full border-2 border-white shadow-md"
            style={{ left: `${hsl.l}%`, transform: 'translate(-50%, -50%)', background: `hsl(${hsl.h}, ${hsl.s}%, ${hsl.l}%)` }}
          />
        </div>
      </div>

      {/* Right: Color Info */}
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto">
        {/* Color Harmonies */}
        <div className="grid grid-cols-2 gap-x-8 gap-y-2 rounded-lg border p-3">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground w-14">互补色</span>
            {complementary.map((c, i) => (
              <div key={i} className="h-6 w-6 rounded cursor-pointer border" style={{ background: c }} onClick={() => setHex(c)} />
            ))}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground w-14">对比色</span>
            {contrast.map((c, i) => (
              <div key={i} className="h-6 w-6 rounded cursor-pointer border" style={{ background: c }} onClick={() => setHex(c)} />
            ))}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground w-14">类似色</span>
            {analogous.map((c, i) => (
              <div key={i} className="h-6 w-6 rounded cursor-pointer border" style={{ background: c }} onClick={() => setHex(c)} />
            ))}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground w-14">中差色</span>
            {splitComp.map((c, i) => (
              <div key={i} className="h-6 w-6 rounded cursor-pointer border" style={{ background: c }} onClick={() => setHex(c)} />
            ))}
          </div>
        </div>

        {/* Color Formats */}
        <div className="flex flex-col gap-2">
          {formats.map((fmt, idx) => (
            <div key={fmt.label} className="flex items-center gap-3">
              <span className="w-16 text-sm font-medium text-muted-foreground">{fmt.label}</span>
              <input
                type="text"
                value={fmt.value}
                readOnly
                className="flex-1 rounded border bg-background px-3 py-1.5 font-mono text-sm"
              />
              <button
                onClick={() => handleCopy(fmt.value, idx)}
                className="flex h-8 w-8 items-center justify-center rounded border text-muted-foreground hover:bg-muted"
              >
                {copiedIdx === idx ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
              </button>
            </div>
          ))}
        </div>

        {/* Bottom Actions */}
        <div className="flex items-center justify-end gap-2">
          <button
            onClick={() => toast.success('已确认')}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-white shadow"
            style={{ background: hex }}
            title="确认颜色"
          >
            <Check className="h-5 w-5" />
          </button>
          {onAddFavorite && (
            <button
              onClick={() => onAddFavorite(hex)}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-primary text-primary hover:bg-primary/10"
              title="收藏颜色"
            >
              <Plus className="h-5 w-5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
