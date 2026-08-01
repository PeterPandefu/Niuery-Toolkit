import { ReactNode, useState, useCallback, useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Copy, Check, Trash2, ArrowDownUp, Columns2, Rows2 } from 'lucide-react';
import { toast } from 'sonner';
import { copyToClipboard } from '@/lib/utils';

interface ToolLayoutProps {
  /** 左侧/上方输入面板 */
  input: ReactNode;
  /** 右侧/下方输出面板 */
  output: ReactNode;
  /** 输入面板标题 */
  inputTitle?: string;
  /** 输出面板标题 */
  outputTitle?: string;
  /** 输入面板操作按钮 */
  inputActions?: ReactNode;
  /** 输出面板操作按钮 */
  outputActions?: ReactNode;
  /** 输出内容（用于复制） */
  outputValue?: string;
  /** 清空输入回调 */
  onClear?: () => void;
  /** 交换输入输出回调 */
  onSwap?: () => void;
  /** 文件/文本拖放回调 */
  onDrop?: (content: string, files: File[]) => void;
  className?: string;
}

export function ToolLayout({
  input,
  output,
  inputTitle = '输入',
  outputTitle = '输出',
  inputActions,
  outputActions,
  outputValue,
  onClear,
  onSwap,
  onDrop,
  className,
}: ToolLayoutProps) {
  const [copied, setCopied] = useState(false);
  const [vertical, setVertical] = useState(false);
  const [splitRatio, setSplitRatio] = useState(50);
  const [dragOver, setDragOver] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  const handleCopy = useCallback(async () => {
    if (outputValue) {
      const success = await copyToClipboard(outputValue);
      if (success) {
        setCopied(true);
        toast.success('已复制到剪贴板');
        setTimeout(() => setCopied(false), 2000);
      }
    }
  }, [outputValue]);

  // Ctrl+Shift+C 快捷键复制输出
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'C') {
        e.preventDefault();
        handleCopy();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleCopy]);

  // 拖拽调整比例
  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    document.body.style.cursor = vertical ? 'row-resize' : 'col-resize';
    document.body.style.userSelect = 'none';

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!isDragging.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      let ratio: number;
      if (vertical) {
        ratio = ((moveEvent.clientY - rect.top) / rect.height) * 100;
      } else {
        ratio = ((moveEvent.clientX - rect.left) / rect.width) * 100;
      }
      setSplitRatio(Math.min(Math.max(ratio, 20), 80));
    };

    const handleMouseUp = () => {
      isDragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }, [vertical]);

  return (
    <div className={cn('flex h-full flex-col', className)}>
      {/* 工具栏 */}
      <div className="flex items-center justify-end gap-1 border-b border-border/70 bg-background/50 px-4 py-1">
        {onSwap && (
          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground" onClick={onSwap} title="交换输入输出">
            <ArrowDownUp className="h-3.5 w-3.5" />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-foreground"
          onClick={() => setVertical(!vertical)}
          title={vertical ? '切换为水平布局' : '切换为垂直布局'}
        >
          {vertical ? <Columns2 className="h-3.5 w-3.5" /> : <Rows2 className="h-3.5 w-3.5" />}
        </Button>
      </div>

      {/* Panels */}
      <div
        ref={containerRef}
        className={cn('flex min-h-0 flex-1', vertical ? 'flex-col' : 'flex-row')}
      >
        {/* Input Panel */}
        <div
          className="relative flex min-h-0 flex-col overflow-hidden"
          style={vertical ? { height: `${splitRatio}%` } : { width: `${splitRatio}%` }}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={async (e) => {
            e.preventDefault();
            setDragOver(false);
            if (!onDrop) return;
            const files = Array.from(e.dataTransfer.files);
            const text = e.dataTransfer.getData('text');
            if (files.length > 0) {
              // 读取第一个文本文件内容
              const textFiles = files.filter(f => f.type.startsWith('text/') || f.name.match(/\.(json|xml|yaml|yml|csv|txt|md|sql|html|css|js|ts)$/i));
              if (textFiles.length > 0) {
                const content = await textFiles[0].text();
                onDrop(content, files);
              } else {
                onDrop('', files);
              }
            } else if (text) {
              onDrop(text, []);
            }
          }}
        >
          {dragOver && (
            <div className="absolute inset-0 z-10 flex items-center justify-center rounded-md border-2 border-dashed border-primary bg-primary/8">
              <span className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground shadow-tinted">拖放文件或文本到此处</span>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-4 py-1.5">
            <span className="flex shrink-0 items-center gap-2 whitespace-nowrap text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              <span className="h-[3px] w-[3px] rounded-full bg-primary/70" />
              {inputTitle}
            </span>
            <div className="ml-auto flex items-center gap-1">
              {inputActions}
              {onClear && (
                <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-destructive" onClick={onClear} title="清空">
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          </div>
          <div className="min-h-0 flex-1 px-4 pb-2">{input}</div>
        </div>

        {/* 拖拽手柄 */}
        <div
          onMouseDown={handleDragStart}
          className={cn(
            'group relative flex shrink-0 items-center justify-center transition-colors hover:bg-primary/15',
            vertical ? 'h-2 w-full cursor-row-resize' : 'w-2 h-full cursor-col-resize'
          )}
        >
          <div
            className={cn(
              'rounded-full bg-muted-foreground/25 transition-all duration-200 group-hover:bg-primary/60',
              vertical ? 'h-0.5 w-10 group-hover:w-14' : 'w-0.5 h-10 group-hover:h-14'
            )}
          />
        </div>

        {/* 输出面板 */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-4 py-1.5">
            <span className="flex shrink-0 items-center gap-2 whitespace-nowrap text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              <span className="h-[3px] w-[3px] rounded-full bg-primary/70" />
              {outputTitle}
            </span>
            <div className="ml-auto flex items-center gap-1">
              {outputActions}
              {outputValue !== undefined && (
                <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-foreground" onClick={handleCopy} title="复制输出 (Ctrl+Shift+C)">
                  {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                </Button>
              )}
            </div>
          </div>
          <div className="min-h-0 flex-1 px-4 pb-2">{output}</div>
        </div>
      </div>
    </div>
  );
}
