import Editor from '@monaco-editor/react';
import { useCallback, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Download, FileImage, FileText, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { LoadingButton } from '@/components/ui/loading-button';
import { saveBytesWithFeedback } from '@/lib/file-save';
import { isTauri } from '@/lib/api-client';
import { useTheme } from '@/hooks/use-theme';
import { diagnoseHtml } from '@/lib/html-diagnostics';
import { compareImageBlobs } from '@/lib/image-diff';

const DEFAULT_HTML = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>离线 HTML 预览</title>
    <style>
      body { font-family: system-ui, sans-serif; line-height: 1.7; max-width: 760px; margin: 0 auto; padding: 48px 24px; color: #172033; }
      h1 { color: #2563eb; } code { background: #eef2ff; padding: 2px 6px; border-radius: 4px; }
    </style>
  </head>
  <body><h1>离线 HTML 预览</h1><p>编辑左侧 HTML，右侧会实时更新。</p></body>
</html>`;

const BASELINE_STORAGE_KEY = 'niuery-html-renderer-baseline-png';

function loadBaseline(): Uint8Array | null {
  try {
    const encoded = localStorage.getItem(BASELINE_STORAGE_KEY);
    if (!encoded) return null;
    const binary = atob(encoded);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

function saveBaseline(bytes: Uint8Array) {
  try {
    let binary = '';
    for (let index = 0; index < bytes.length; index += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
    }
    localStorage.setItem(BASELINE_STORAGE_KEY, btoa(binary));
  } catch {
    // 本地存储空间不足时仍保留当前会话基线。
  }
}

export default function HtmlRenderer() {
  const { monacoTheme } = useTheme();
  const [source, setSource] = useState(DEFAULT_HTML);
  const [isRendering, setIsRendering] = useState(false);
  const [viewport, setViewport] = useState({ width: 1440, height: 10000 });
  const [baselinePng, setBaselinePng] = useState<Uint8Array | null>(loadBaseline);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const diagnostics = useMemo(() => diagnoseHtml(source), [source]);
  const remoteResources = diagnostics.remoteResources;
  const preview = useMemo(() => source, [source]);

  const render = useCallback(async (format: 'pdf' | 'png') => {
    if (!isTauri) {
      toast.error('高质量导出仅支持 Tauri 桌面应用');
      return;
    }
    if (remoteResources.length > 0) {
      toast.error(`导出已阻止：检测到远程资源 ${remoteResources.join('、')}`);
      return;
    }
    setIsRendering(true);
    try {
      const bytes = await invoke<number[]>(format === 'pdf' ? 'render_html_to_pdf' : 'render_html_to_png', {
        html: source,
        ...(format === 'png' ? viewport : {}),
      });
      const extension = format;
      await saveBytesWithFeedback(`document.${extension}`, new Uint8Array(bytes), format === 'pdf' ? 'PDF 文件' : 'PNG 图像', [extension]);
    } catch (error) {
      toast.error(`渲染失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsRendering(false);
    }
  }, [remoteResources, source, viewport]);

  const importHtml = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setSource(await file.text());
  }, []);

  const exportSnapshot = useCallback(async () => {
    if (remoteResources.length > 0) {
      toast.error(`快照导出已阻止：检测到远程资源 ${remoteResources.join('、')}`);
      return;
    }
    await saveBytesWithFeedback('document.html', new TextEncoder().encode(source), 'HTML 文件', ['html', 'htm']);
  }, [remoteResources, source]);

  const renderPng = useCallback(async () => {
    if (!isTauri) throw new Error('视觉回归仅支持 Tauri 桌面应用');
    const bytes = await invoke<number[]>('render_html_to_png', { html: source, ...viewport });
    return new Uint8Array(bytes);
  }, [source, viewport]);

  const captureBaseline = useCallback(async () => {
    try {
      const bytes = await renderPng();
      setBaselinePng(bytes);
      saveBaseline(bytes);
      toast.success('已保存当前 PNG 视觉基线');
    } catch (error) {
      toast.error(`保存视觉基线失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }, [renderPng]);

  const compareBaseline = useCallback(async () => {
    if (!baselinePng) {
      toast.info('请先保存视觉基线');
      return;
    }
    try {
      const current = await renderPng();
      const result = await compareImageBlobs(new Blob([current]), new Blob([baselinePng]));
      toast.info(`视觉差异 ${(result.ratio * 100).toFixed(2)}%，${result.dimensionsMatch ? '尺寸一致' : '尺寸不一致'}`);
    } catch (error) {
      toast.error(`视觉比较失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }, [baselinePng, renderPng]);

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <header className="flex min-h-11 flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
        <h1 className="text-sm font-semibold">HTML 离线渲染器</h1>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => fileInputRef.current?.click()} aria-label="导入 HTML"><Upload />导入</Button>
          <Button variant="ghost" size="sm" onClick={() => void exportSnapshot()} aria-label="导出离线快照"><FileText />快照</Button>
          <Button variant="ghost" size="sm" onClick={() => void captureBaseline()} aria-label="保存视觉基线">基线</Button>
          <Button variant="ghost" size="sm" onClick={() => void compareBaseline()} disabled={!baselinePng} aria-label="比较视觉基线">比较</Button>
          <select
            className="h-8 rounded border bg-background px-2 text-xs"
            value={`${viewport.width}x${viewport.height}`}
            onChange={(event) => {
              const [width, height] = event.target.value.split('x').map(Number);
              setViewport({ width, height });
            }}
            aria-label="截图视口"
          >
            <option value="1440x10000">桌面长图</option>
            <option value="1024x768">平板 1024×768</option>
            <option value="390x844">手机 390×844</option>
          </select>
          <LoadingButton variant="ghost" size="sm" onClick={() => void render('pdf')} loading={isRendering} aria-label="导出 PDF"><FileText />PDF</LoadingButton>
          <LoadingButton variant="ghost" size="sm" onClick={() => void render('png')} loading={isRendering} aria-label="导出 PNG"><FileImage />PNG</LoadingButton>
          <Button variant="ghost" size="icon" onClick={() => setSource(DEFAULT_HTML)} aria-label="恢复示例"><Download className="h-4 w-4" /></Button>
        </div>
      </header>
      {diagnostics.warnings.length > 0 && (
        <div role="status" className="border-b border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700">
          <div>{diagnostics.warnings.join('；')}</div>
          <div className="mt-1 text-[11px] opacity-80">图片 {diagnostics.imageCount} 张，脚本 {diagnostics.scriptCount} 个</div>
        </div>
      )}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col lg:flex-row">
        <section className="min-h-0 min-w-0 flex-1 border-b lg:border-b-0 lg:border-r">
          <Editor height="100%" language="html" theme={monacoTheme} value={source} onChange={(value) => setSource(value ?? '')} options={{ minimap: { enabled: false }, wordWrap: 'on', automaticLayout: true, padding: { top: 12 } }} />
        </section>
        <section className="min-h-0 min-w-0 flex-1 bg-white">
          <iframe title="HTML 本地预览" sandbox="allow-scripts" srcDoc={preview} className="h-full w-full border-0" />
        </section>
      </div>
      <input ref={fileInputRef} type="file" accept=".html,.htm" className="hidden" onChange={(event) => void importHtml(event)} />
    </div>
  );
}
