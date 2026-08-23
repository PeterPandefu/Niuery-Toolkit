import { useState, useMemo, useCallback } from 'react';
import { ToolLayout } from '@/components/shared/ToolLayout';
import { Textarea } from '@/components/ui/textarea';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { AlertCircle, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { base64Encode, base64Decode } from '@/lib/codec-utils';
import { useToolLogger } from '@/hooks/use-tool-logger';
import { ImageViewer } from '@/components/media/image-viewer';

type Mode = 'encode' | 'decode';
type Variant = 'standard' | 'urlsafe';

export default function Base64Tool() {
  const log = useToolLogger('base64');
  const [input, setInput] = useState('');
  const [mode, setMode] = useState<Mode>('encode');
  const [variant, setVariant] = useState<Variant>('standard');
  const [previewOpen, setPreviewOpen] = useState(false);

  const { output, error } = useMemo(() => {
    if (!input.trim()) return { output: '', error: null };

    try {
      const result =
        mode === 'encode'
          ? base64Encode(input, variant === 'urlsafe')
          : base64Decode(input, variant === 'urlsafe');
      log.info(mode === 'encode' ? 'Base64 编码成功' : 'Base64 解码成功', {
        variant,
        inputLength: input.length,
        outputLength: result.length,
      });
      return { output: result, error: null };
    } catch (e) {
      log.warn('Base64 解码失败：无效字符串', { variant, inputLength: input.length, error: (e as Error).message });
      return { output: '', error: (e as Error).message };
    }
  }, [input, mode, variant, log]);

  const handleFileDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (!file) return;

      if (file.size > 10 * 1024 * 1024) {
        toast.error('文件大小不能超过 10MB');
        log.warn('文件超出大小限制', { name: file.name, size: file.size });
        return;
      }

      const reader = new FileReader();
      reader.onload = () => {
        const base64 = (reader.result as string).split(',')[1];
        setInput(base64);
        setMode('decode');
        toast.success(`已加载文件: ${file.name}`);
        log.info('加载文件为 Base64', { name: file.name, size: file.size });
      };
      reader.readAsDataURL(file);
    },
    [log]
  );

  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      if (file.size > 10 * 1024 * 1024) {
        toast.error('文件大小不能超过 10MB');
        log.warn('文件超出大小限制', { name: file.name, size: file.size });
        return;
      }

      const reader = new FileReader();
      reader.onload = () => {
        const base64 = (reader.result as string).split(',')[1];
        setInput(base64);
        setMode('decode');
        toast.success(`已加载文件: ${file.name}`);
        log.info('加载文件为 Base64', { name: file.name, size: file.size });
      };
      reader.readAsDataURL(file);
    },
    [log]
  );

  // 检测是否为图片 Base64
  const isImageBase64 = useMemo(() => {
    if (mode !== 'decode' || !output) return false;
    return output.startsWith('data:image/') || /^\/9j\/|^iVBOR|^R0lGOD/.test(input);
  }, [mode, output, input]);

  return (
    <ToolLayout
      inputTitle={mode === 'encode' ? '原始文本' : 'Base64'}
      outputTitle={mode === 'encode' ? 'Base64' : '解码结果'}
      outputValue={output}
      onClear={() => {
        setInput('');
        log.info('清空输入');
      }}
      onSwap={() => {
        if (output) {
          setInput(output);
          setMode(mode === 'encode' ? 'decode' : 'encode');
          log.info('交换输入输出', { newMode: mode === 'encode' ? 'decode' : 'encode' });
        }
      }}
      inputActions={
        <div className="flex items-center gap-2">
          <Select
            value={mode}
            onChange={(e) => {
              setMode(e.target.value as Mode);
              log.info(`切换模式: ${e.target.value === 'encode' ? '编码' : '解码'}`);
            }}
            options={[
              { value: 'encode', label: '编码' },
              { value: 'decode', label: '解码' },
            ]}
            className="h-8 w-20 text-xs"
          />
          <Select
            value={variant}
            onChange={(e) => {
              setVariant(e.target.value as Variant);
              log.info(`切换变体: ${e.target.value}`);
            }}
            options={[
              { value: 'standard', label: '标准' },
              { value: 'urlsafe', label: 'URL安全' },
            ]}
            className="h-8 w-24 text-xs"
          />
          <label className="cursor-pointer">
            <input type="file" className="hidden" onChange={handleFileSelect} />
            <Button variant="ghost" size="sm">
              <Upload className="mr-1 h-3 w-3" />
              文件
            </Button>
          </label>
        </div>
      }
      input={
        <div className="h-full" onDrop={handleFileDrop} onDragOver={(e) => e.preventDefault()}>
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={mode === 'encode' ? '输入要编码的文本...' : '输入 Base64 字符串...'}
            className="h-full resize-none font-mono text-sm"
            spellCheck={false}
          />
        </div>
      }
      output={
        <div className="relative h-full">
          {error ? (
            <div className="flex h-full items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-4">
              <AlertCircle className="h-5 w-5 shrink-0 text-destructive" />
              <div>
                <p className="font-medium text-destructive">解码错误</p>
                <p className="mt-1 text-sm text-muted-foreground">无效的 Base64 字符串</p>
              </div>
            </div>
          ) : isImageBase64 ? (
            <div className="flex h-full items-center justify-center rounded-md border bg-muted/50 p-4">
              <button
                type="button"
                className="max-h-full max-w-full rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => setPreviewOpen(true)}
                title="放大查看解码图片"
                aria-label="放大查看解码图片"
              >
                <img
                  src={output.startsWith('data:') ? output : `data:image/png;base64,${input}`}
                  alt="解码图片"
                  className="max-h-full max-w-full object-contain"
                />
              </button>
              {previewOpen && (
                <ImageViewer
                  source={output.startsWith('data:') ? output : `data:image/png;base64,${input}`}
                  alt="解码图片"
                  title="解码图片"
                  mode="dialog"
                  onClose={() => setPreviewOpen(false)}
                />
              )}
            </div>
          ) : (
            <Textarea
              value={output}
              readOnly
              placeholder="结果..."
              className="h-full resize-none bg-muted/50 font-mono text-sm"
              spellCheck={false}
            />
          )}
        </div>
      }
    />
  );
}
