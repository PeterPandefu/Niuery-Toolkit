import { useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { FileImage, FileText } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { LoadingButton } from '@/components/ui/loading-button';
import { saveBytesWithFeedback } from '@/lib/file-save';
import { isTauri } from '@/lib/api-client';
import { escapeHtml, generateExportHtml } from '@/lib/markdown-utils';

const SAMPLE = `[
  { "名称": "示例项目", "状态": "完成", "数量": 12 },
  { "名称": "另一个项目", "状态": "进行中", "数量": 7 }
]`;

// eslint-disable-next-line react-refresh/only-export-components
export function tableFromJson(source: string): { html: string; error?: string } {
  try {
    const value: unknown = JSON.parse(source);
    if (!Array.isArray(value) || value.some((row) => !row || typeof row !== 'object' || Array.isArray(row))) {
      return { html: '', error: '请输入对象数组，例如 [{"名称":"示例","数量":1}]' };
    }
    const rows = value as Record<string, unknown>[];
    const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
    if (columns.length === 0) return { html: '<p>暂无数据</p>' };
    const head = columns.map((column) => `<th>${escapeHtml(column)}</th>`).join('');
    const body = rows.map((row) => `<tr>${columns.map((column) => `<td>${escapeHtml(String(row[column] ?? ''))}</td>`).join('')}</tr>`).join('');
    return { html: `<h1>数据报告</h1><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>` };
  } catch (error) {
    return { html: '', error: error instanceof Error ? error.message : 'JSON 格式错误' };
  }
}

export default function ReportGenerator() {
  const [source, setSource] = useState(SAMPLE);
  const [isRendering, setIsRendering] = useState(false);
  const result = useMemo(() => tableFromJson(source), [source]);
  const html = useMemo(() => generateExportHtml(result.html, '数据报告'), [result.html]);

  const exportReport = async (format: 'pdf' | 'png') => {
    if (result.error) return;
    if (!isTauri) {
      toast.error('报告导出仅支持 Tauri 桌面应用');
      return;
    }
    setIsRendering(true);
    try {
      const bytes = await invoke<number[]>(format === 'pdf' ? 'render_html_to_pdf' : 'render_html_to_png', { html, width: 1440, height: 10000 });
      await saveBytesWithFeedback(`data-report.${format}`, new Uint8Array(bytes), format === 'pdf' ? 'PDF 文件' : 'PNG 图像', [format]);
    } catch (error) {
      toast.error(`报告导出失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsRendering(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <header className="flex min-h-11 items-center justify-between border-b px-3 py-2">
        <h1 className="text-sm font-semibold">数据报告生成器</h1>
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" onClick={() => setSource(SAMPLE)}>示例</Button>
          <LoadingButton variant="ghost" size="sm" onClick={() => void exportReport('pdf')} loading={isRendering} disabled={Boolean(result.error)}><FileText />PDF</LoadingButton>
          <LoadingButton variant="ghost" size="sm" onClick={() => void exportReport('png')} loading={isRendering} disabled={Boolean(result.error)}><FileImage />PNG</LoadingButton>
        </div>
      </header>
      {result.error && <div role="alert" className="border-b border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">{result.error}</div>}
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <textarea className="min-h-0 flex-1 resize-none border-b bg-background p-4 font-mono text-sm outline-none lg:border-b-0 lg:border-r" value={source} onChange={(event) => setSource(event.target.value)} aria-label="JSON 数据" />
        <iframe title="报告预览" sandbox="allow-scripts" srcDoc={html} className="min-h-0 flex-1 border-0 bg-white" />
      </div>
    </div>
  );
}
