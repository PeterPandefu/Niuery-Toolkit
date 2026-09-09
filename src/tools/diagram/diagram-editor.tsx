import '@/lib/monaco-setup';
import Editor from '@monaco-editor/react';
import { openTextDocument } from '@/lib/local-documents';
import { saveBytesWithFeedback } from '@/lib/file-save';
import { isTauri } from '@/lib/api-client';
import { generateExportHtml } from '@/lib/markdown-utils';
import { invoke } from '@tauri-apps/api/core';
import { Button } from '@/components/ui/button';
import { LoadingButton } from '@/components/ui/loading-button';
import { useTheme } from '@/hooks/use-theme';
import {
  Download,
  FileImage,
  FilePlus2,
  FileText,
  Printer,
  RefreshCw,
  Trash2,
  Upload,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  ensureDiagramBackground,
  ensureWhiteDiagramBackground,
  getDiagramDefaultSource,
  getDiagramExportName,
  getDiagramSourceMimeType,
  type DiagramKind,
} from './diagram-editor-utils';
import { ImageViewer } from '@/components/media/image-viewer';
import { getThemeTokens } from '@/lib/theme';

type DiagramScheme = 'light' | 'dark';

export interface DiagramRenderResult {
  svg: string;
  png?: Uint8Array;
}

export interface DiagramRenderer {
  render: (source: string, options: { scheme: DiagramScheme }) => Promise<DiagramRenderResult>;
  renderPng?: (source: string, options: { scheme: DiagramScheme }) => Promise<Uint8Array>;
}

interface DiagramEditorProps {
  kind: DiagramKind;
  renderer: DiagramRenderer;
}

function draftStorageKey(kind: DiagramKind) {
  return `niuery-${kind}-editor-draft`;
}

function followThemeStorageKey(kind: DiagramKind) {
  return `niuery-${kind}-editor-follow-theme`;
}

function readLocalStorage(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function readFollowTheme(kind: DiagramKind): boolean {
  return readLocalStorage(followThemeStorageKey(kind), 'true') !== 'false';
}

function writeLocalStorage(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Local persistence is optional when WebView storage is unavailable.
  }
}

async function rasterizeSvg(svg: string): Promise<Blob> {
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('无法将 SVG 转换为 PNG'));
      element.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, image.naturalWidth);
    canvas.height = Math.max(1, image.naturalHeight);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('当前环境不支持 PNG 导出');
    context.drawImage(image, 0, 0);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((result) => result ? resolve(result) : reject(new Error('无法生成 PNG 文件')), 'image/png');
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function DiagramEditor({ kind, renderer }: DiagramEditorProps) {
  const labels = useMemo(() => kind === 'mermaid'
    ? { title: 'Mermaid 实时编辑器', source: 'Mermaid 源码', extension: 'mmd' }
    : { title: 'PlantUML 实时编辑器', source: 'PlantUML 源码', extension: 'puml' }, [kind]);
  const { monacoTheme, scheme, skin = 'forge' } = useTheme();
  const [source, setSource] = useState(() => readLocalStorage(draftStorageKey(kind), getDiagramDefaultSource(kind)));
  const [debouncedSource, setDebouncedSource] = useState(source);
  const [followTheme, setFollowTheme] = useState(() => readFollowTheme(kind));
  const [preview, setPreview] = useState<DiagramRenderResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRendering, setIsRendering] = useState(false);
  const [refreshRevision, setRefreshRevision] = useState(0);
  const [pendingImport, setPendingImport] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const renderRequestRef = useRef(0);

  const effectiveScheme: DiagramScheme = followTheme ? scheme : 'light';
  const themeBackground = followTheme
    ? `hsl(${getThemeTokens(skin, effectiveScheme).background})`
    : '#ffffff';
  const previewSource = useMemo(
    () => preview ? new Blob([preview.svg], { type: 'image/svg+xml;charset=utf-8' }) : null,
    [preview],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSource(source), 400);
    return () => window.clearTimeout(timer);
  }, [source]);

  useEffect(() => {
    const timer = window.setTimeout(() => writeLocalStorage(draftStorageKey(kind), source), 500);
    return () => window.clearTimeout(timer);
  }, [kind, source]);

  useEffect(() => {
    writeLocalStorage(followThemeStorageKey(kind), String(followTheme));
  }, [followTheme, kind]);

  const render = useCallback(async () => {
    const requestId = ++renderRequestRef.current;
    if (!debouncedSource.trim()) {
      setError('请输入图表源码后再预览。');
      return;
    }
    setIsRendering(true);
    try {
      const result = await renderer.render(debouncedSource, { scheme: effectiveScheme });
      if (requestId !== renderRequestRef.current) return;
      setPreview({
        ...result,
        svg: followTheme ? ensureDiagramBackground(result.svg, themeBackground) : ensureWhiteDiagramBackground(result.svg),
      });
      setError(null);
    } catch (renderError) {
      if (requestId !== renderRequestRef.current) return;
      setError(renderError instanceof Error ? renderError.message : String(renderError));
    } finally {
      if (requestId === renderRequestRef.current) setIsRendering(false);
    }
  }, [debouncedSource, effectiveScheme, followTheme, renderer, themeBackground]);

  useEffect(() => {
    void render();
  }, [render, refreshRevision]);

  const replaceSource = useCallback((contents: string) => {
    setSource(contents);
    setPendingImport(null);
    toast.success('已替换当前草稿');
  }, []);

  const handleImport = useCallback(async () => {
    const opened = await openTextDocument(`${labels.title} 源文件`, [labels.extension]);
    if (opened) {
      setPendingImport(opened.contents);
      return;
    }
    fileInputRef.current?.click();
  }, [labels.extension, labels.title]);

  const handleBrowserImport = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) setPendingImport(await file.text());
  }, []);

  const exportSource = useCallback(async () => {
    await saveBytesWithFeedback(
      getDiagramExportName(kind, 'source'),
      new Blob([source], { type: getDiagramSourceMimeType(kind) }),
      `${labels.title} 源文件`,
      [labels.extension],
    );
  }, [kind, labels.extension, labels.title, source]);

  const exportSvg = useCallback(async () => {
    if (!preview) return;
    await saveBytesWithFeedback(getDiagramExportName(kind, 'svg'), new Blob([preview.svg], { type: 'image/svg+xml;charset=utf-8' }), 'SVG 图像', ['svg']);
  }, [kind, preview]);

  const exportPng = useCallback(async () => {
    if (!preview) return;
    // PlantUML 暗色 PNG 默认是透明的；跟随主题时从已注入背景的 SVG 栅格化，
    // 避免透明区域在 WebView 或图片查看器中再次显示为黑色。
    const png = followTheme
      ? await rasterizeSvg(preview.svg)
      : preview.png ?? await renderer.renderPng?.(debouncedSource, { scheme: effectiveScheme });
    await saveBytesWithFeedback(
      getDiagramExportName(kind, 'png'),
      png ?? await rasterizeSvg(preview.svg),
      'PNG 图像',
      ['png'],
    );
  }, [debouncedSource, effectiveScheme, followTheme, kind, preview, renderer]);

  const exportPdf = useCallback(async () => {
    if (!preview) return;
    if (!isTauri) {
      toast.error('PDF 导出仅支持 Tauri 桌面应用');
      return;
    }
    try {
      const html = generateExportHtml(`<main class="diagram-pdf">${preview.svg}</main>`, labels.title);
      const bytes = await invoke<number[]>('render_html_to_pdf', { html });
      await saveBytesWithFeedback(getDiagramExportName(kind, 'pdf'), new Uint8Array(bytes), 'PDF 文件', ['pdf']);
    } catch (error) {
      toast.error(`PDF 导出失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }, [kind, labels.title, preview]);

  const resetSource = useCallback((clear = false) => {
    setSource(clear ? '' : getDiagramDefaultSource(kind));
    setPreview(null);
    setError(null);
  }, [kind]);

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <header className="flex min-h-11 flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
        <h1 className="text-sm font-semibold">{labels.title}</h1>
        <div className="flex flex-wrap items-center gap-1">
          <label className="flex h-8 items-center gap-1.5 rounded px-2 text-xs hover:bg-accent">
            <input
              type="checkbox"
              checked={followTheme}
              onChange={(event) => setFollowTheme(event.target.checked)}
              aria-label="跟随主题"
            />
            跟随主题
          </label>
          <Button variant="ghost" size="sm" onClick={() => resetSource()} aria-label="新建图表"><FilePlus2 />新建</Button>
          <Button variant="ghost" size="sm" onClick={() => resetSource(true)} aria-label="清空图表"><Trash2 />清空</Button>
          <LoadingButton variant="ghost" size="sm" onClick={handleImport} aria-label="导入源文件"><Upload />导入</LoadingButton>
          <LoadingButton variant="ghost" size="sm" onClick={exportSource} aria-label="导出源文件"><FileText />导出</LoadingButton>
          <LoadingButton variant="ghost" size="sm" onClick={exportSvg} disabled={!preview} aria-label="导出 SVG"><Download />SVG</LoadingButton>
          <LoadingButton variant="ghost" size="sm" onClick={exportPng} disabled={!preview} aria-label="导出 PNG"><FileImage />PNG</LoadingButton>
          <LoadingButton variant="ghost" size="sm" onClick={exportPdf} disabled={!preview} aria-label="导出 PDF"><Printer />PDF</LoadingButton>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              setDebouncedSource(source);
              setRefreshRevision((revision) => revision + 1);
            }}
            disabled={isRendering}
            aria-label="立即刷新"
          ><RefreshCw className={isRendering ? 'animate-spin' : ''} /></Button>
        </div>
      </header>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col lg:flex-row">
        <section className="min-h-0 min-w-0 flex-1 border-b lg:w-1/2 lg:border-b-0 lg:border-r">
          <Editor
            height="100%"
            language="plaintext"
            theme={monacoTheme}
            value={source}
            onChange={(value) => setSource(value ?? '')}
            options={{ wordWrap: 'on', minimap: { enabled: false }, fontSize: 14, lineNumbers: 'on', scrollBeyondLastLine: false, automaticLayout: true, tabSize: 2, padding: { top: 12 } }}
          />
        </section>

        <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-muted/20 lg:w-1/2">
          {error && (
            <div role="alert" className="border-b border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              当前内容未成功渲染，预览保留上一成功版本：{error}
            </div>
          )}
          <ImageViewer
            source={previewSource ?? undefined}
            alt={`${labels.title} 预览`}
            title={isRendering ? '正在渲染…' : error ? '预览未更新' : '实时预览'}
            mode="inline"
            wheelZoom="always"
            className={followTheme ? 'bg-muted/20' : 'bg-white'}
          />
        </section>
      </div>

      <input ref={fileInputRef} type="file" accept={`.${labels.extension}`} className="hidden" onChange={(event) => void handleBrowserImport(event)} />
      {pendingImport !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="flex max-h-[80vh] w-full max-w-2xl flex-col rounded-lg border bg-background shadow-xl">
            <div className="border-b px-4 py-3"><h2 className="text-sm font-semibold">确认替换当前草稿</h2></div>
            <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap p-4 font-mono text-xs">{pendingImport}</pre>
            <div className="flex justify-end gap-2 border-t px-4 py-3">
              <Button variant="outline" onClick={() => setPendingImport(null)}>取消</Button>
              <Button onClick={() => replaceSource(pendingImport)}>确认替换</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
