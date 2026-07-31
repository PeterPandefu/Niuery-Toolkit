import { useState, useCallback, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Upload, Download, Loader2 } from 'lucide-react';

interface IconSize {
  name: string;
  size: number;
}

interface IconPreset {
  id: string;
  label: string;
  sizes: IconSize[];
}

const PRESETS: IconPreset[] = [
  {
    id: 'favicon',
    label: 'Favicon',
    sizes: [
      { name: 'favicon-16', size: 16 },
      { name: 'favicon-32', size: 32 },
      { name: 'favicon-48', size: 48 },
    ],
  },
  {
    id: 'ios',
    label: 'iOS',
    sizes: [
      { name: 'icon-20', size: 20 },
      { name: 'icon-29', size: 29 },
      { name: 'icon-40', size: 40 },
      { name: 'icon-58', size: 58 },
      { name: 'icon-60', size: 60 },
      { name: 'icon-76', size: 76 },
      { name: 'icon-80', size: 80 },
      { name: 'icon-87', size: 87 },
      { name: 'icon-120', size: 120 },
      { name: 'icon-152', size: 152 },
      { name: 'icon-167', size: 167 },
      { name: 'icon-180', size: 180 },
      { name: 'icon-1024', size: 1024 },
    ],
  },
  {
    id: 'android',
    label: 'Android',
    sizes: [
      { name: 'mipmap-mdpi', size: 48 },
      { name: 'mipmap-hdpi', size: 72 },
      { name: 'mipmap-xhdpi', size: 96 },
      { name: 'mipmap-xxhdpi', size: 144 },
      { name: 'mipmap-xxxhdpi', size: 192 },
      { name: 'play-store-512', size: 512 },
    ],
  },
  {
    id: 'windows',
    label: 'Windows',
    sizes: [
      { name: 'icon-16', size: 16 },
      { name: 'icon-24', size: 24 },
      { name: 'icon-32', size: 32 },
      { name: 'icon-48', size: 48 },
      { name: 'icon-64', size: 64 },
      { name: 'icon-256', size: 256 },
    ],
  },
];

export default function IconGeneratorTool() {
  const [sourceImage, setSourceImage] = useState<HTMLImageElement | null>(null);
  const [sourceUrl, setSourceUrl] = useState<string>('');
  const [preset, setPreset] = useState('favicon');
  const [bgColor, setBgColor] = useState('transparent');
  const [borderRadius, setBorderRadius] = useState(0);
  const [generating, setGenerating] = useState(false);
  const [generatedIcons, setGeneratedIcons] = useState<{ name: string; size: number; url: string }[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const loadImage = useCallback((file: File) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      setSourceImage(img);
      setSourceUrl(url);
      setGeneratedIcons([]);
    };
    img.src = url;
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) {
      loadImage(file);
    }
  }, [loadImage]);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) loadImage(file);
  }, [loadImage]);

  const generateIcons = useCallback(async () => {
    if (!sourceImage) return;
    setGenerating(true);
    setGeneratedIcons([]);

    const selectedPreset = PRESETS.find((p) => p.id === preset);
    if (!selectedPreset) return;

    const icons: { name: string; size: number; url: string }[] = [];

    for (const iconSize of selectedPreset.sizes) {
      const canvas = document.createElement('canvas');
      canvas.width = iconSize.size;
      canvas.height = iconSize.size;
      const ctx = canvas.getContext('2d');
      if (!ctx) continue;

      // 背景
      if (bgColor !== 'transparent') {
        ctx.fillStyle = bgColor;
        if (borderRadius > 0) {
          const r = (borderRadius / 100) * iconSize.size;
          ctx.beginPath();
          ctx.moveTo(r, 0);
          ctx.lineTo(iconSize.size - r, 0);
          ctx.quadraticCurveTo(iconSize.size, 0, iconSize.size, r);
          ctx.lineTo(iconSize.size, iconSize.size - r);
          ctx.quadraticCurveTo(iconSize.size, iconSize.size, iconSize.size - r, iconSize.size);
          ctx.lineTo(r, iconSize.size);
          ctx.quadraticCurveTo(0, iconSize.size, 0, iconSize.size - r);
          ctx.lineTo(0, r);
          ctx.quadraticCurveTo(0, 0, r, 0);
          ctx.closePath();
          ctx.fill();
          ctx.clip();
        } else {
          ctx.fillRect(0, 0, iconSize.size, iconSize.size);
        }
      }

      // 绘制图片（居中、覆盖）
      const srcAspect = sourceImage.width / sourceImage.height;
      let drawW: number, drawH: number, drawX: number, drawY: number;
      if (srcAspect > 1) {
        drawH = iconSize.size;
        drawW = iconSize.size * srcAspect;
        drawX = -(drawW - iconSize.size) / 2;
        drawY = 0;
      } else {
        drawW = iconSize.size;
        drawH = iconSize.size / srcAspect;
        drawX = 0;
        drawY = -(drawH - iconSize.size) / 2;
      }
      ctx.drawImage(sourceImage, drawX, drawY, drawW, drawH);

      const url = canvas.toDataURL('image/png');
      icons.push({ name: iconSize.name, size: iconSize.size, url });
    }

    setGeneratedIcons(icons);
    setGenerating(false);
  }, [sourceImage, preset, bgColor, borderRadius]);

  const downloadIcon = useCallback((icon: { name: string; size: number; url: string }) => {
    const a = document.createElement('a');
    a.href = icon.url;
    a.download = `${icon.name}-${icon.size}x${icon.size}.png`;
    a.click();
  }, []);

  const downloadAll = useCallback(() => {
    generatedIcons.forEach((icon, i) => {
      setTimeout(() => downloadIcon(icon), i * 200);
    });
  }, [generatedIcons, downloadIcon]);

  return (
    <div className="flex h-full flex-col gap-4 p-4 overflow-y-auto">
      <canvas ref={canvasRef} className="hidden" />

      {/* 上传区域 */}
      {!sourceImage ? (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          className={`flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-12 transition-colors ${
            dragOver ? 'border-primary bg-primary/5' : 'border-muted-foreground/25 hover:border-primary/50'
          }`}
        >
          <Upload className="h-10 w-10 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">拖拽图片到此处，或</p>
          <label>
            <input type="file" accept="image/*" onChange={handleFileInput} className="hidden" />
            <Button variant="outline" size="sm" onClick={() => (document.querySelector('input[accept]') as HTMLElement)?.click()}>
              选择图片
            </Button>
          </label>
          <p className="text-xs text-muted-foreground">建议使用 1024×1024 以上的正方形图片</p>
        </div>
      ) : (
        <div className="flex gap-6">
          {/* 配置面板 */}
          <div className="w-64 space-y-4 shrink-0">
            <div className="space-y-2">
              <Label>源图片</Label>
              <div className="relative rounded-lg border overflow-hidden">
                <img src={sourceUrl} alt="source" className="w-full h-32 object-contain bg-muted/30" />
              </div>
              <Button variant="ghost" size="sm" className="w-full" onClick={() => { setSourceImage(null); setSourceUrl(''); setGeneratedIcons([]); }}>
                更换图片
              </Button>
            </div>

            <div className="space-y-2">
              <Label>预设模板</Label>
              <Select
                value={preset}
                onChange={(e) => setPreset(e.target.value)}
                options={PRESETS.map((p) => ({ value: p.id, label: p.label }))}
              />
            </div>

            <div className="space-y-2">
              <Label>背景色</Label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={bgColor === 'transparent' ? '#ffffff' : bgColor}
                  onChange={(e) => setBgColor(e.target.value)}
                  className="h-8 w-8 rounded border cursor-pointer"
                />
                <Select
                  value={bgColor === 'transparent' ? 'transparent' : 'custom'}
                  onChange={(e) => {
                    if (e.target.value === 'transparent') setBgColor('transparent');
                  }}
                  options={[
                    { value: 'transparent', label: '透明' },
                    { value: 'custom', label: '自定义颜色' },
                  ]}
                  className="flex-1"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>圆角 ({borderRadius}%)</Label>
              <input
                type="range"
                min="0"
                max="50"
                value={borderRadius}
                onChange={(e) => setBorderRadius(parseInt(e.target.value))}
                className="w-full accent-primary"
              />
            </div>

            <Button onClick={generateIcons} disabled={generating} className="w-full">
              {generating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              生成图标
            </Button>
          </div>

          {/* 结果区域 */}
          <div className="flex-1">
            {generatedIcons.length > 0 ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">
                    生成结果 ({generatedIcons.length} 个图标)
                  </p>
                  <Button variant="outline" size="sm" onClick={downloadAll}>
                    <Download className="h-3.5 w-3.5 mr-1" />
                    全部下载
                  </Button>
                </div>
                <div className="grid grid-cols-4 gap-3">
                  {generatedIcons.map((icon) => (
                    <div key={icon.name} className="flex flex-col items-center gap-1.5 rounded-lg border p-3">
                      <div
                        className="flex items-center justify-center overflow-hidden rounded bg-[repeating-conic-gradient(#80808020_0%_25%,transparent_0%_50%)] bg-[length:12px_12px]"
                        style={{ width: Math.min(icon.size, 80), height: Math.min(icon.size, 80) }}
                      >
                        <img
                          src={icon.url}
                          alt={icon.name}
                          style={{ width: Math.min(icon.size, 80), height: Math.min(icon.size, 80) }}
                        />
                      </div>
                      <span className="text-xs text-muted-foreground">{icon.size}×{icon.size}</span>
                      <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => downloadIcon(icon)}>
                        下载
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                配置参数后点击"生成图标"
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
