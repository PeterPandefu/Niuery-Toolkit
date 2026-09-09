import { ReactNode, useState, useCallback, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
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
  /** 内容区贴边铺满，适合代码编辑器 */
  flush?: boolean;
  className?: string;
}

const paneIconButtonClass =
  'h-7 w-7 text-muted-foreground hover:text-foreground';

function PaneHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
      <span className="flex min-w-0 items-center gap-2 text-xs font-medium text-muted-foreground">
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true" />
        <span className="truncate">{title}</span>
      </span>
      {children ? (
        <div className="ml-auto flex min-w-0 items-center gap-0.5 overflow-x-auto">{children}</div>
      ) : null}
    </div>
  );
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
  flush = false,
  className,
}: ToolLayoutProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [vertical, setVertical] = useState(false);
  const [isWideLayout, setIsWideLayout] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(min-width: 1024px)').matches
  );
  const [splitRatio, setSplitRatio] = useState(50);
  const [dragOver, setDragOver] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const isVertical = vertical || !isWideLayout;
  const hasToolbar = Boolean(inputActions);
  const contentClassName = cn('min-h-0 flex-1 overflow-hidden', !flush && 'p-2');

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mediaQuery = window.matchMedia('(min-width: 1024px)');
    const updateLayout = () => setIsWideLayout(mediaQuery.matches);
    updateLayout();
    mediaQuery.addEventListener('change', updateLayout);
    return () => mediaQuery.removeEventListener('change', updateLayout);
  }, []);

  const handleCopy = useCallback(async () => {
    if (outputValue) {
      const success = await copyToClipboard(outputValue);
      if (success) {
        setCopied(true);
        toast.success(t('actions.copied'));
        setTimeout(() => setCopied(false), 2000);
      } else {
        toast.error(t('actions.copyFailed'));
      }
    }
  }, [outputValue, t]);

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
    document.body.style.cursor = isVertical ? 'row-resize' : 'col-resize';
    document.body.style.userSelect = 'none';

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!isDragging.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      let ratio: number;
      if (isVertical) {
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
  }, [isVertical]);

  return (
    <div className={cn('flex h-full min-h-0 min-w-0 flex-col bg-background p-2 sm:p-2.5', className)}>
      {hasToolbar ? (
        <div
          role="toolbar"
          className="mb-2 flex min-h-9 shrink-0 flex-wrap items-center gap-1.5 overflow-x-auto rounded-lg border border-border bg-card px-2.5 py-1 shadow-tinted-sm"
        >
          {inputActions}
        </div>
      ) : null}

      <div
        ref={containerRef}
        className={cn('flex min-h-0 min-w-0 flex-1', isVertical ? 'flex-col' : 'flex-row')}
      >
        <div
          className="relative flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-card shadow-tinted-sm"
          style={isVertical ? { height: `${splitRatio}%` } : { width: `${splitRatio}%` }}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={async (e) => {
            e.preventDefault();
            setDragOver(false);
            if (!onDrop) return;
            const files = Array.from(e.dataTransfer.files);
            const text = e.dataTransfer.getData('text');
            if (files.length > 0) {
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
              <span className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground shadow-tinted">{t('actions.dropHint')}</span>
            </div>
          )}
          <PaneHeader title={inputTitle}>
            {onSwap && (
              <Button variant="ghost" size="icon" className={paneIconButtonClass} onClick={onSwap} title={t('actions.swap')} aria-label={t('actions.swap')}>
                <ArrowDownUp className="h-3.5 w-3.5" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className={paneIconButtonClass}
              onClick={() => setVertical(!vertical)}
              disabled={!isWideLayout}
              title={isWideLayout ? (vertical ? t('actions.horizontalLayout') : t('actions.verticalLayout')) : t('actions.layoutAuto')}
              aria-label={isWideLayout ? (vertical ? t('actions.horizontalLayout') : t('actions.verticalLayout')) : t('actions.layoutAuto')}
            >
              {isVertical ? <Columns2 className="h-3.5 w-3.5" /> : <Rows2 className="h-3.5 w-3.5" />}
            </Button>
            {onClear && (
              <Button variant="ghost" size="icon" className={cn(paneIconButtonClass, 'hover:text-destructive')} onClick={onClear} title={t('actions.clearInput')} aria-label={t('actions.clearInput')}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </PaneHeader>
          <div className={contentClassName}>{input}</div>
        </div>

        <div
          onMouseDown={handleDragStart}
          className={cn(
            'group relative flex shrink-0 items-center justify-center',
            isVertical ? 'h-3 w-full cursor-row-resize' : 'w-3 h-full cursor-col-resize'
          )}
        >
          <div
            className={cn(
              'rounded-full bg-border transition-colors duration-150 group-hover:bg-primary/55',
              isVertical ? 'h-0.5 w-8 group-hover:w-12' : 'w-0.5 h-8 group-hover:h-12'
            )}
          />
        </div>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-card shadow-tinted-sm">
          <PaneHeader title={outputTitle}>
            {outputActions}
            {outputValue !== undefined && (
              <Button
                variant="ghost"
                size="icon"
                className={paneIconButtonClass}
                onClick={handleCopy}
                disabled={!outputValue}
                title={t('actions.copyOutput')}
                aria-label={copied ? t('actions.copied') : t('actions.copyOutput')}
              >
                {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
              </Button>
            )}
          </PaneHeader>
          <div className={contentClassName}>{output}</div>
        </div>
      </div>
    </div>
  );
}
