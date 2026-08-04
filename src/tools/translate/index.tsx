import { useCallback, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { useTranslateStore } from '@/store/translate-store';
import { BAIDU_LANGUAGES, resolveFetch, translateWithBaidu } from '@/lib/translate-utils';
import { TranslateSettingsDialog } from './translate-settings';
import { ArrowRightLeft, Check, Copy, Loader2, PawPrint, Settings2 } from 'lucide-react';
import { cn, copyToClipboard } from '@/lib/utils';
import { toast } from 'sonner';

/** 翻译工具：百度翻译，手动触发，上输入下结果，中间语言栏 */
export default function TranslatorTool() {
  const { baiduAppId, baiduSecret } = useTranslateStore();
  const configured = Boolean(baiduAppId && baiduSecret);

  const [input, setInput] = useState('');
  const [output, setOutput] = useState('');
  const [fromLang, setFromLang] = useState('auto');
  const [toLang, setToLang] = useState('zh');
  const [loading, setLoading] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [splitRatio, setSplitRatio] = useState(45);

  const containerRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  const handleTranslate = useCallback(async () => {
    const text = input.trim();
    if (!text) return;
    if (!configured) {
      toast.error('请先配置百度翻译 APP ID 与密钥');
      setSettingsOpen(true);
      return;
    }
    setLoading(true);
    try {
      const fetchFn = await resolveFetch();
      const result = await translateWithBaidu(
        text,
        fromLang,
        toLang,
        { appId: baiduAppId, secret: baiduSecret },
        fetchFn
      );
      setOutput(result.text);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '翻译失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  }, [input, configured, fromLang, toLang, baiduAppId, baiduSecret]);

  const handleSwap = useCallback(() => {
    const newFrom = toLang;
    const newTo = fromLang === 'auto' ? (toLang === 'zh' ? 'en' : 'zh') : fromLang;
    setFromLang(newFrom);
    setToLang(newTo);
    if (output) {
      setInput(output);
      setOutput(input);
    }
  }, [fromLang, toLang, input, output]);

  const handleCopy = useCallback(async () => {
    if (!output) return;
    if (await copyToClipboard(output)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [output]);

  // 拖拽调整上下比例
  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!isDragging.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const ratio = ((moveEvent.clientY - rect.top) / rect.height) * 100;
      setSplitRatio(Math.min(Math.max(ratio, 20), 70));
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
  }, []);

  const targetLanguages = BAIDU_LANGUAGES.filter((l) => l.code !== 'auto');

  return (
    <div ref={containerRef} className="flex h-full flex-col">
      {/* 输入区 */}
      <div className="flex min-h-0 flex-col px-4 pt-3" style={{ height: `${splitRatio}%` }}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
              e.preventDefault();
              void handleTranslate();
            }
          }}
          placeholder="请输入要翻译的内容，可右键点击文本框粘贴"
          className="min-h-0 flex-1 resize-none rounded-md border border-input bg-muted/30 p-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        />
      </div>

      {/* 中间操作栏 */}
      <div className="flex flex-wrap items-center gap-2 px-4 py-2">
        <span className="flex items-center gap-1.5 rounded-md border border-border bg-muted/50 px-2.5 py-1 text-xs font-medium text-primary">
          <PawPrint className="h-3.5 w-3.5" />
          百度翻译
        </span>
        <div className="ml-auto flex items-center gap-2">
          <Select
            value={fromLang}
            onChange={(e) => setFromLang(e.target.value)}
            options={BAIDU_LANGUAGES.map((l) => ({ value: l.code, label: l.label }))}
            className="h-8 w-28"
          />
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleSwap} title="交换语言与文本">
            <ArrowRightLeft className="h-3.5 w-3.5" />
          </Button>
          <Select
            value={toLang}
            onChange={(e) => setToLang(e.target.value)}
            options={targetLanguages.map((l) => ({ value: l.code, label: l.label }))}
            className="h-8 w-28"
          />
          <Button size="sm" onClick={() => void handleTranslate()} disabled={loading || !input.trim()}>
            {loading && <Loader2 className="animate-spin" />}
            翻译
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setSettingsOpen(true)} title="翻译设置">
            <Settings2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* 拖拽手柄 */}
      <div
        onMouseDown={handleDragStart}
        className="group relative flex h-2 w-full shrink-0 cursor-row-resize items-center justify-center transition-colors hover:bg-primary/15"
      >
        <div className="h-0.5 w-10 rounded-full bg-muted-foreground/25 transition-all duration-200 group-hover:w-14 group-hover:bg-primary/60" />
      </div>

      {/* 结果区 */}
      <div className="flex min-h-0 flex-1 flex-col px-4 pb-3 pt-1">
        {!configured && (
          <div className="mb-2 flex items-center justify-between gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-600">
            <span>尚未配置翻译服务，需先填写百度翻译 APP ID 与密钥</span>
            <Button size="sm" variant="outline" className="h-6 px-2 text-xs" onClick={() => setSettingsOpen(true)}>
              去设置
            </Button>
          </div>
        )}
        <div className="mb-1 flex items-center justify-between">
          <span className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            <span className="h-[3px] w-[3px] rounded-full bg-primary/70" />
            翻译结果
          </span>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => void handleCopy()} title="复制结果">
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
          </Button>
        </div>
        <div
          className={cn(
            'min-h-0 flex-1 overflow-auto whitespace-pre-wrap rounded-md border border-input bg-muted/30 p-3 text-sm',
            !output && 'text-muted-foreground'
          )}
        >
          {output || '翻译结果'}
        </div>
      </div>

      {settingsOpen && <TranslateSettingsDialog onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
