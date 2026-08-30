import { useState, useRef, useCallback, useEffect } from 'react';
import QRCode from 'qrcode';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Download, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { useToolLogger } from '@/hooks/use-tool-logger';
import { saveBytesWithFeedback } from '@/lib/file-save';

export default function QrCodeTool() {
  const log = useToolLogger('qrcode');
  const [text, setText] = useState('');
  const [size, setSize] = useState('256');
  const [errorLevel, setErrorLevel] = useState<'L' | 'M' | 'Q' | 'H'>('M');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [decodedText, setDecodedText] = useState('');

  // 生成二维码
  useEffect(() => {
    if (!text || !canvasRef.current) return;

    QRCode.toCanvas(
      canvasRef.current,
      text,
      {
        width: parseInt(size),
        margin: 2,
        errorCorrectionLevel: errorLevel,
        color: {
          dark: '#000000',
          light: '#ffffff',
        },
      },
      (error) => {
        if (error) {
          log.error('二维码生成失败', error);
        } else {
          log.info('二维码生成成功', {
            textLength: text.length,
            size: parseInt(size),
            errorLevel,
          });
        }
      }
    );
  }, [text, size, errorLevel, log]);

  const handleDownload = useCallback(
    async (format: 'png' | 'svg') => {
      if (!text) {
        toast.error('请先输入内容');
        log.warn('下载二维码失败：内容为空');
        return;
      }

      if (format === 'png' && canvasRef.current) {
        const blob = await new Promise<Blob>((resolve, reject) => canvasRef.current!.toBlob((value) => value ? resolve(value) : reject(new Error('PNG 生成失败')), 'image/png'));
        await saveBytesWithFeedback('qrcode.png', blob, 'PNG 图像', ['png']);
        log.info('下载二维码', { format: 'png', textLength: text.length });
      } else if (format === 'svg') {
        const svg = await QRCode.toString(text, { type: 'svg', errorCorrectionLevel: errorLevel });
        await saveBytesWithFeedback('qrcode.svg', new Blob([svg], { type: 'image/svg+xml' }), 'SVG 图像', ['svg']);
        log.info('下载二维码', { format: 'svg', textLength: text.length });
      }
    },
    [text, errorLevel, log]
  );

  const handleDecode = useCallback(
    async (file: File) => {
      log.info('开始识别二维码', { name: file.name, size: file.size });
      try {
        const bitmap = await createImageBitmap(file);
        if ('BarcodeDetector' in window) {
          // @ts-expect-error BarcodeDetector API
          const detector = new BarcodeDetector({ formats: ['qr_code'] });
          const results = await detector.detect(bitmap);
          if (results.length > 0) {
            setDecodedText(results[0].rawValue);
            toast.success('识别成功');
            log.info('二维码识别成功', { resultLength: String(results[0].rawValue).length });
          } else {
            toast.error('未检测到二维码');
            log.warn('未检测到二维码', { name: file.name });
          }
        } else {
          toast.error('浏览器不支持 BarcodeDetector API');
          log.warn('浏览器不支持 BarcodeDetector API');
        }
      } catch (e) {
        toast.error('识别失败');
        log.error('二维码识别失败', e);
      }
    },
    [log]
  );

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto grid max-w-4xl gap-8 lg:grid-cols-2">
        {/* Generate Section */}
        <div className="space-y-4">
          <h3 className="font-medium">生成二维码</h3>
          <div className="space-y-2">
            <Label>内容</Label>
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="输入文本、URL 等..."
              className="min-h-[100px] resize-none"
            />
          </div>
          <div className="flex gap-4">
            <div className="flex-1 space-y-2">
              <Label>尺寸</Label>
              <Input
                type="number"
                value={size}
                onChange={(e) => setSize(e.target.value)}
                min="128"
                max="1024"
              />
            </div>
            <div className="flex-1 space-y-2">
              <Label>容错级别</Label>
              <Select
                value={errorLevel}
                onChange={(e) => setErrorLevel(e.target.value as 'L' | 'M' | 'Q' | 'H')}
                options={[
                  { value: 'L', label: 'L (7%)' },
                  { value: 'M', label: 'M (15%)' },
                  { value: 'Q', label: 'Q (25%)' },
                  { value: 'H', label: 'H (30%)' },
                ]}
              />
            </div>
          </div>

          {/* Preview */}
          <div className="flex justify-center rounded-lg border bg-white p-4">
            <canvas ref={canvasRef} className="max-w-full" />
          </div>

          {/* Download Buttons */}
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => handleDownload('png')} disabled={!text}>
              <Download className="mr-2 h-4 w-4" />
              PNG
            </Button>
            <Button variant="outline" onClick={() => handleDownload('svg')} disabled={!text}>
              <Download className="mr-2 h-4 w-4" />
              SVG
            </Button>
          </div>
        </div>

        {/* Decode Section */}
        <div className="space-y-4">
          <h3 className="font-medium">识别二维码</h3>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleDecode(file);
            }}
          />
          <div
            className="flex min-h-[200px] cursor-pointer flex-col items-center justify-center gap-4 rounded-lg border-2 border-dashed p-8 text-center transition-colors hover:border-primary/50 hover:bg-muted/50"
            onClick={() => fileInputRef.current?.click()}
            onDrop={(e) => {
              e.preventDefault();
              const file = e.dataTransfer.files[0];
              if (file) handleDecode(file);
            }}
            onDragOver={(e) => e.preventDefault()}
          >
            <Upload className="h-10 w-10 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              点击或拖拽图片到此处
              <br />
              支持 PNG、JPG 等格式
            </p>
          </div>

          {decodedText && (
            <div className="space-y-2">
              <Label>识别结果</Label>
              <Textarea value={decodedText} readOnly className="min-h-[100px] resize-none" />
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            注意：二维码识别需要浏览器支持 BarcodeDetector API（Chrome/Edge 支持）
          </p>
        </div>
      </div>
    </div>
  );
}
