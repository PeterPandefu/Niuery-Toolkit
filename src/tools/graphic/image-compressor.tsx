import { useState, useCallback, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { cn, formatBytes } from '@/lib/utils';
import { toast } from 'sonner';
import { Upload, Download, Image as ImageIcon } from 'lucide-react';

interface ImageInfo {
  name: string;
  originalSize: number;
  compressedSize: number;
  url: string;
  width: number;
  height: number;
}

export default function ImageCompressor() {
  const [image, setImage] = useState<ImageInfo | null>(null);
  const [quality, setQuality] = useState(80);
  const [processing, setProcessing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const processImage = useCallback(
    async (file: File) => {
      if (!file.type.startsWith('image/')) {
        toast.error('请选择图片文件');
        return;
      }

      setProcessing(true);
      try {
        const img = new Image();
        const url = URL.createObjectURL(file);

        await new Promise((resolve, reject) => {
          img.onload = resolve;
          img.onerror = reject;
          img.src = url;
        });

        const canvas = canvasRef.current!;
        canvas.width = img.width;
        canvas.height = img.height;

        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0);

        const compressedUrl = canvas.toDataURL('image/jpeg', quality / 100);
        const compressedSize = Math.round((compressedUrl.length * 3) / 4);

        setImage({
          name: file.name,
          originalSize: file.size,
          compressedSize,
          url: compressedUrl,
          width: img.width,
          height: img.height,
        });

        URL.revokeObjectURL(url);
        toast.success('压缩完成');
      } catch {
        toast.error('处理失败');
      } finally {
        setProcessing(false);
      }
    },
    [quality]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file) processImage(file);
    },
    [processImage]
  );

  const handleDownload = useCallback(() => {
    if (!image) return;
    const link = document.createElement('a');
    link.download = `compressed_${image.name.replace(/\.[^.]+$/, '')}.jpg`;
    link.href = image.url;
    link.click();
    toast.success('已下载');
  }, [image]);

  const savings = image
    ? Math.round((1 - image.compressedSize / image.originalSize) * 100)
    : 0;

  return (
    <div className="h-full overflow-y-auto p-6">
      <canvas ref={canvasRef} className="hidden" />
      <div className="mx-auto max-w-2xl space-y-6">
        {/* Upload Area */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) processImage(file);
          }}
        />
        <div
          className={cn(
            'flex min-h-[200px] cursor-pointer flex-col items-center justify-center gap-4 rounded-lg border-2 border-dashed p-8 text-center transition-colors',
            'hover:border-primary/50 hover:bg-muted/50'
          )}
          onClick={() => fileInputRef.current?.click()}
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
        >
          <Upload className="h-10 w-10 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            点击或拖拽图片到此处
            <br />
            支持 PNG、JPG、WebP 格式
          </p>
        </div>

        {/* Quality Slider */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>压缩质量</Label>
            <span className="font-mono text-sm">{quality}%</span>
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

        {/* Result */}
        {image && (
          <div className="space-y-4">
            {/* Preview */}
            <div className="overflow-hidden rounded-lg border">
              <img
                src={image.url}
                alt={image.name}
                className="max-h-[300px] w-full object-contain bg-muted/30"
              />
            </div>

            {/* Stats */}
            <div className="grid grid-cols-3 gap-4">
              <div className="rounded-lg border p-4 text-center">
                <div className="text-lg font-bold">{formatBytes(image.originalSize)}</div>
                <div className="text-xs text-muted-foreground">原始大小</div>
              </div>
              <div className="rounded-lg border p-4 text-center">
                <div className="text-lg font-bold">{formatBytes(image.compressedSize)}</div>
                <div className="text-xs text-muted-foreground">压缩后</div>
              </div>
              <div
                className={cn(
                  'rounded-lg border p-4 text-center',
                  savings > 0 && 'border-green-500/50 bg-green-500/10'
                )}
              >
                <div className="text-lg font-bold text-green-500">
                  {savings > 0 ? `-${savings}%` : '+0%'}
                </div>
                <div className="text-xs text-muted-foreground">节省</div>
              </div>
            </div>

            <div className="text-center text-sm text-muted-foreground">
              {image.width} × {image.height} px
            </div>

            {/* Download */}
            <Button onClick={handleDownload} className="w-full">
              <Download className="mr-2 h-4 w-4" />
              下载压缩图片
            </Button>
          </div>
        )}

        {processing && (
          <div className="flex items-center justify-center gap-2 text-muted-foreground">
            <ImageIcon className="h-5 w-5 animate-pulse" />
            处理中...
          </div>
        )}
      </div>
    </div>
  );
}
