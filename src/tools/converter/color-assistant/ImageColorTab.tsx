import { useState, useRef, useCallback } from 'react';
import { ImageIcon, Crop } from 'lucide-react';
import { toast } from 'sonner';
import { copyToClipboard } from '@/lib/utils';
import { extractColorsFromCanvas } from './color-utils';

export default function ImageColorTab() {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [mainColor, setMainColor] = useState<string | null>(null);
  const [palette, setPalette] = useState<string[]>([]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processImage = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const url = e.target?.result as string;
      setImageUrl(url);
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        // Scale down for performance
        const maxDim = 200;
        const scale = Math.min(maxDim / img.width, maxDim / img.height, 1);
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const colors = extractColorsFromCanvas(canvas, 10);
        if (colors.length > 0) {
          setMainColor(colors[0]);
          setPalette(colors.slice(1));
        }
      };
      img.src = url;
    };
    reader.readAsDataURL(file);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) {
      processImage(file);
    }
  }, [processImage]);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processImage(file);
  }, [processImage]);

  const handleCopyColor = async (hex: string) => {
    await copyToClipboard(hex);
    toast.success(`已复制: ${hex}`);
  };

  return (
    <div className="flex h-full gap-4 overflow-hidden p-4 transition-colors duration-300" style={{ backgroundColor: mainColor ? mainColor + '20' : undefined }}>
      {/* Main Area */}
      <div className="flex flex-1 flex-col items-center justify-center">
        <div
          className="flex flex-1 w-full items-center justify-center rounded-lg border-2 border-dashed border-muted-foreground/30 bg-muted/20"
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          {imageUrl ? (
            <img src={imageUrl} alt="uploaded" className="max-h-full max-w-full object-contain p-4" />
          ) : (
            <div className="text-center text-muted-foreground">
              <ImageIcon className="mx-auto h-12 w-12 mb-2 opacity-50" />
              <p className="text-sm">点击或拖拽图片到此处</p>
              <p className="text-xs mt-1">支持 PNG、JPG、WebP 格式</p>
            </div>
          )}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFileChange}
        />
        {/* Bottom buttons */}
        <div className="flex items-center gap-3 mt-3">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-muted hover:bg-muted/80 transition"
            title="选择图片"
          >
            <ImageIcon className="h-5 w-5 text-muted-foreground" />
          </button>
          <button
            className="flex h-10 w-10 items-center justify-center rounded-full bg-muted hover:bg-muted/80 transition"
            title="裁剪"
          >
            <Crop className="h-5 w-5 text-muted-foreground" />
          </button>
        </div>
      </div>

      {/* Right: Extracted Colors */}
      <div className="w-48 flex flex-col gap-4 overflow-y-auto">
        {mainColor && (
          <>
            <div>
              <h4 className="text-sm font-medium mb-2">主色</h4>
              <div
                className="h-16 w-full rounded-lg cursor-pointer border shadow-sm"
                style={{ backgroundColor: mainColor }}
                onClick={() => handleCopyColor(mainColor)}
                title={mainColor}
              />
            </div>
            <div>
              <h4 className="text-sm font-medium mb-2">配色</h4>
              <div className="grid grid-cols-2 gap-2">
                {palette.map((color, idx) => (
                  <div
                    key={idx}
                    className="h-12 rounded-lg cursor-pointer border shadow-sm transition-transform hover:scale-105"
                    style={{ backgroundColor: color }}
                    onClick={() => handleCopyColor(color)}
                    title={color}
                  />
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Hidden canvas for processing */}
      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}
