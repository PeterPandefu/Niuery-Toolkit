import { useState, useCallback, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { Upload, Download } from 'lucide-react';

type OutputFormat = 'image/png' | 'image/jpeg' | 'image/webp';

const FORMATS: { value: OutputFormat; label: string; ext: string }[] = [
  { value: 'image/png', label: 'PNG', ext: 'png' },
  { value: 'image/jpeg', label: 'JPEG', ext: 'jpg' },
  { value: 'image/webp', label: 'WebP', ext: 'webp' },
];

export default function ImageConverter() {
  const [originalImage, setOriginalImage] = useState<{
    url: string;
    name: string;
    size: number;
    width: number;
    height: number;
  } | null>(null);
  const [format, setFormat] = useState<OutputFormat>('image/png');
  const [quality, setQuality] = useState(90);
  const [newWidth, setNewWidth] = useState('');
  const [newHeight, setNewHeight] = useState('');
  const [convertedUrl, setConvertedUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const loadImage = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) {
      toast.error('请选择图片文件');
      return;
    }

    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      setOriginalImage({
        url,
        name: file.name,
        size: file.size,
        width: img.width,
        height: img.height,
      });
      setNewWidth(String(img.width));
      setNewHeight(String(img.height));
      setConvertedUrl(null);
    };
    img.src = url;
  }, []);

  const convert = useCallback(async () => {
    if (!originalImage) return;

    const img = new Image();
    await new Promise((resolve) => {
      img.onload = resolve;
      img.src = originalImage.url;
    });

    const canvas = canvasRef.current!;
    const width = parseInt(newWidth) || originalImage.width;
    const height = parseInt(newHeight) || originalImage.height;
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d')!;
    if (format === 'image/jpeg') {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
    }
    ctx.drawImage(img, 0, 0, width, height);

    const url = canvas.toDataURL(format, quality / 100);
    setConvertedUrl(url);
    toast.success('转换完成');
  }, [originalImage, format, quality, newWidth, newHeight]);

  const download = useCallback(() => {
    if (!convertedUrl || !originalImage) return;
    const ext = FORMATS.find((f) => f.value === format)?.ext || 'png';
    const link = document.createElement('a');
    link.download = `${originalImage.name.replace(/\.[^.]+$/, '')}.${ext}`;
    link.href = convertedUrl;
    link.click();
    toast.success('已下载');
  }, [convertedUrl, originalImage, format]);

  return (
    <div className="h-full overflow-y-auto p-6">
      <canvas ref={canvasRef} className="hidden" />
      <div className="mx-auto max-w-2xl space-y-6">
        {/* Upload */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) loadImage(file);
          }}
        />
        <div
          className="flex min-h-[150px] cursor-pointer flex-col items-center justify-center gap-4 rounded-lg border-2 border-dashed p-8 text-center transition-colors hover:border-primary/50 hover:bg-muted/50"
          onClick={() => fileInputRef.current?.click()}
          onDrop={(e) => {
            e.preventDefault();
            const file = e.dataTransfer.files[0];
            if (file) loadImage(file);
          }}
          onDragOver={(e) => e.preventDefault()}
        >
          <Upload className="h-10 w-10 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">点击或拖拽图片到此处</p>
        </div>

        {originalImage && (
          <>
            {/* Preview */}
            <div className="overflow-hidden rounded-lg border">
              <img
                src={originalImage.url}
                alt={originalImage.name}
                className="max-h-[200px] w-full object-contain bg-muted/30"
              />
            </div>

            {/* Settings */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>输出格式</Label>
                <Select
                  value={format}
                  onChange={(e) => setFormat(e.target.value as OutputFormat)}
                  options={FORMATS.map((f) => ({ value: f.value, label: f.label }))}
                />
              </div>
              {format !== 'image/png' && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>质量</Label>
                    <span className="text-sm">{quality}%</span>
                  </div>
                  <input
                    type="range"
                    min="10"
                    max="100"
                    value={quality}
                    onChange={(e) => setQuality(parseInt(e.target.value))}
                    className="w-full"
                  />
                </div>
              )}
            </div>

            {/* Resize */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>宽度 (px)</Label>
                <Input
                  type="number"
                  value={newWidth}
                  onChange={(e) => setNewWidth(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>高度 (px)</Label>
                <Input
                  type="number"
                  value={newHeight}
                  onChange={(e) => setNewHeight(e.target.value)}
                />
              </div>
            </div>

            {/* Convert Button */}
            <Button onClick={convert} className="w-full">
              转换
            </Button>

            {/* Result */}
            {convertedUrl && (
              <div className="space-y-4">
                <div className="overflow-hidden rounded-lg border">
                  <img
                    src={convertedUrl}
                    alt="转换结果"
                    className="max-h-[200px] w-full object-contain bg-muted/30"
                  />
                </div>
                <Button onClick={download} className="w-full" variant="outline">
                  <Download className="mr-2 h-4 w-4" />
                  下载
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
