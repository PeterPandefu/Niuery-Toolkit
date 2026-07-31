import { useState, useMemo } from 'react';
import { ToolLayout } from '@/components/shared/ToolLayout';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { cn, formatBytes } from '@/lib/utils';
import { toast } from 'sonner';
import { copyToClipboard } from '@/lib/utils';
import { Copy, Download } from 'lucide-react';
import { optimizeSvg, getSvgStats } from '@/lib/text-utils';

export default function SvgOptimizer() {
  const [input, setInput] = useState('');
  const [options, setOptions] = useState({
    removeComments: true,
    removeMetadata: true,
    cleanupIds: false,
    minifyWhitespace: true,
  });

  const output = useMemo(() => {
    if (!input.trim()) return '';
    try {
      return optimizeSvg(input, options);
    } catch {
      return '';
    }
  }, [input, options]);

  const stats = useMemo(() => {
    if (!input || !output) return null;
    return getSvgStats(input, output);
  }, [input, output]);

  const handleDownload = () => {
    if (!output) return;
    const blob = new Blob([output], { type: 'image/svg+xml' });
    const link = document.createElement('a');
    link.download = 'optimized.svg';
    link.href = URL.createObjectURL(blob);
    link.click();
    URL.revokeObjectURL(link.href);
    toast.success('已下载');
  };

  const handleCopy = async () => {
    if (output) {
      await copyToClipboard(output);
      toast.success('已复制');
    }
  };

  const sampleSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <!-- This is a comment -->
  <metadata>Created with Editor</metadata>
  <title>Sample Icon</title>
  <desc>A sample SVG icon</desc>
  <circle cx="50" cy="50" r="40" fill="#3b82f6"/>
  <path d="M30 50 L45 65 L70 35" stroke="white" stroke-width="8" fill="none" stroke-linecap="round"/>
</svg>`;

  return (
    <ToolLayout
      inputTitle="SVG 输入"
      outputTitle="优化结果"
      outputValue={output}
      onClear={() => setInput('')}
      inputActions={
        <Button variant="ghost" size="sm" onClick={() => setInput(sampleSvg)}>
          示例
        </Button>
      }
      outputActions={
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" onClick={handleCopy} disabled={!output}>
            <Copy className="mr-1 h-3 w-3" />
            复制
          </Button>
          <Button variant="ghost" size="sm" onClick={handleDownload} disabled={!output}>
            <Download className="mr-1 h-3 w-3" />
            下载
          </Button>
        </div>
      }
      input={
        <div className="flex h-full flex-col gap-4">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="粘贴 SVG 代码..."
            className="flex-1 resize-none font-mono text-sm"
            spellCheck={false}
          />
          <div className="space-y-2">
            <Label>优化选项</Label>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  ['removeComments', '移除注释'],
                  ['removeMetadata', '移除元数据'],
                  ['cleanupIds', '简化 ID'],
                  ['minifyWhitespace', '压缩空白'],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={options[key]}
                    onChange={(e) =>
                      setOptions({ ...options, [key]: e.target.checked })
                    }
                    className="h-4 w-4 rounded border"
                  />
                  <span className="text-sm">{label}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
      }
      output={
        <div className="flex h-full flex-col gap-4">
          <Textarea
            value={output}
            readOnly
            placeholder="优化结果..."
            className="flex-1 resize-none bg-muted/50 font-mono text-sm"
            spellCheck={false}
          />
          {stats && (
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-md border p-2 text-center">
                <div className="text-sm font-medium">{formatBytes(stats.originalSize)}</div>
                <div className="text-xs text-muted-foreground">原始</div>
              </div>
              <div className="rounded-md border p-2 text-center">
                <div className="text-sm font-medium">{formatBytes(stats.optimizedSize)}</div>
                <div className="text-xs text-muted-foreground">优化后</div>
              </div>
              <div
                className={cn(
                  'rounded-md border p-2 text-center',
                  stats.savings > 0 && 'border-green-500/50 bg-green-500/10'
                )}
              >
                <div className="text-sm font-medium text-green-500">-{stats.savings}%</div>
                <div className="text-xs text-muted-foreground">节省</div>
              </div>
            </div>
          )}
        </div>
      }
    />
  );
}
