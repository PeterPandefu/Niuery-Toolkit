import { useState, useMemo, useCallback } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { copyToClipboard } from '@/lib/utils';
import { Copy, Pipette } from 'lucide-react';

interface RGB {
  r: number;
  g: number;
  b: number;
}

interface HSL {
  h: number;
  s: number;
  l: number;
}

interface CMYK {
  c: number;
  m: number;
  y: number;
  k: number;
}

function hexToRgb(hex: string): RGB | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
      }
    : null;
}

function rgbToHex({ r, g, b }: RGB): string {
  return '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

function rgbToHsl({ r, g, b }: RGB): HSL {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        break;
      case g:
        h = ((b - r) / d + 2) / 6;
        break;
      case b:
        h = ((r - g) / d + 4) / 6;
        break;
    }
  }

  return {
    h: Math.round(h * 360),
    s: Math.round(s * 100),
    l: Math.round(l * 100),
  };
}

function rgbToCmyk({ r, g, b }: RGB): CMYK {
  r /= 255;
  g /= 255;
  b /= 255;
  const k = 1 - Math.max(r, g, b);
  if (k === 1) return { c: 0, m: 0, y: 0, k: 100 };
  return {
    c: Math.round(((1 - r - k) / (1 - k)) * 100),
    m: Math.round(((1 - g - k) / (1 - k)) * 100),
    y: Math.round(((1 - b - k) / (1 - k)) * 100),
    k: Math.round(k * 100),
  };
}

function getContrastRatio(rgb: RGB): { ratio: number; level: string } {
  const luminance = (r: number, g: number, b: number) => {
    const [rs, gs, bs] = [r, g, b].map((c) => {
      c /= 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
  };

  const l1 = luminance(rgb.r, rgb.g, rgb.b);
  const l2 = luminance(255, 255, 255);
  const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);

  let level = 'AAA';
  if (ratio < 4.5) level = 'AA Large';
  if (ratio < 3) level = 'Fail';

  return { ratio: Math.round(ratio * 100) / 100, level };
}

export default function ColorPicker() {
  const [hex, setHex] = useState('#3b82f6');

  const rgb = useMemo(() => hexToRgb(hex), [hex]);
  const hsl = useMemo(() => (rgb ? rgbToHsl(rgb) : null), [rgb]);
  const cmyk = useMemo(() => (rgb ? rgbToCmyk(rgb) : null), [rgb]);
  const contrast = useMemo(() => (rgb ? getContrastRatio(rgb) : null), [rgb]);

  const handleCopy = useCallback(
    async (value: string) => {
      await copyToClipboard(value);
      toast.success(`已复制: ${value}`);
    },
    []
  );

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

  const formats = rgb
    ? [
        { label: 'HEX', value: hex.toUpperCase() },
        { label: 'RGB', value: `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})` },
        { label: 'HSL', value: hsl ? `hsl(${hsl.h}, ${hsl.s}%, ${hsl.l}%)` : '' },
        {
          label: 'CMYK',
          value: cmyk ? `cmyk(${cmyk.c}%, ${cmyk.m}%, ${cmyk.y}%, ${cmyk.k}%)` : '',
        },
      ]
    : [];

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto max-w-2xl space-y-8">
        {/* Color Preview & Input */}
        <div className="flex items-center gap-6">
          <div
            className="h-32 w-32 rounded-xl border shadow-inner"
            style={{ backgroundColor: hex }}
          />
          <div className="flex-1 space-y-4">
            <div className="space-y-2">
              <Label>HEX 颜色值</Label>
              <div className="flex gap-2">
                <Input
                  value={hex}
                  onChange={(e) => setHex(e.target.value)}
                  placeholder="#000000"
                  className="font-mono"
                />
                <input
                  type="color"
                  value={hex}
                  onChange={(e) => setHex(e.target.value)}
                  className="h-9 w-12 cursor-pointer rounded border"
                />
                <Button variant="outline" size="icon" onClick={handleEyeDropper} title="屏幕取色">
                  <Pipette className="h-4 w-4" />
                </Button>
              </div>
            </div>
            {contrast && (
              <div className="text-sm text-muted-foreground">
                与白色对比度: <strong>{contrast.ratio}:1</strong>
                <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs">
                  WCAG {contrast.level}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Format Outputs */}
        <div className="grid gap-3">
          {formats.map((format) => (
            <div
              key={format.label}
              className="flex items-center justify-between rounded-lg border p-4"
            >
              <div>
                <div className="text-sm text-muted-foreground">{format.label}</div>
                <code className="font-mono">{format.value}</code>
              </div>
              <Button variant="ghost" size="icon" onClick={() => handleCopy(format.value)}>
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>

        {/* RGB Sliders */}
        {rgb && (
          <div className="space-y-4 rounded-lg border p-4">
            <Label>RGB 滑块</Label>
            {(['r', 'g', 'b'] as const).map((channel) => (
              <div key={channel} className="flex items-center gap-4">
                <span className="w-4 text-sm font-medium uppercase">{channel}</span>
                <input
                  type="range"
                  min="0"
                  max="255"
                  value={rgb[channel]}
                  onChange={(e) => {
                    const newRgb = { ...rgb, [channel]: parseInt(e.target.value) };
                    setHex(rgbToHex(newRgb));
                  }}
                  className="flex-1"
                />
                <span className="w-10 text-right font-mono text-sm">{rgb[channel]}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
