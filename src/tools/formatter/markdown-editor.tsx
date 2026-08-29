import { useState, useCallback, useRef, useEffect } from 'react';
import Editor, { OnMount } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import { useTranslation } from 'react-i18next';
import { Toolbar, ToolbarAction } from '@/components/markdown/Toolbar';
import type { MermaidTemplateKind } from '@/lib/markdown-utils';
import { Preview, PreviewHandle, renderMarkdown } from '@/components/markdown/Preview';
import { StatusBar } from '@/components/markdown/StatusBar';
import { Outline } from '@/components/markdown/Outline';
import { Button } from '@/components/ui/button';
import { useTheme } from '@/hooks/use-theme';
import { useToolLogger } from '@/hooks/use-tool-logger';
import { toast } from 'sonner';
import { saveBytes } from '@/lib/file-save';
import { isTauri } from '@/lib/api-client';
import {
  Columns2,
  Eye,
  PenLine,
  Download,
  FileCode2,
  Copy,
  Upload,
  FileText,
  ListTree,
  PanelLeftClose,
  Printer,
} from 'lucide-react';
import {
  wrapSelection,
  toggleLinePrefix,
  insertCodeBlock,
  insertMermaidTemplate,
  insertLink,
  insertImage,
  insertTable,
  insertHorizontalRule,
  indentLines,
  outdentLines,
  generateExportHtml,
  findRemoteResources,
  getMarkdownExportTitle,
  MARKDOWN_TEMPLATES,
} from '@/lib/markdown-utils';
import { copyToClipboard } from '@/lib/utils';

type ViewMode = 'split' | 'editor' | 'preview';

const STORAGE_KEY = 'niuery-markdown-editor-draft';

function loadDraft(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

function saveDraft(content: string) {
  try {
    localStorage.setItem(STORAGE_KEY, content);
  } catch {
    /* ignore */
  }
}

/** debounce hook：延迟更新值 */
function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

export default function MarkdownEditor() {
  const { t, i18n } = useTranslation();
  const [content, setContent] = useState(loadDraft);
  const [viewMode, setViewMode] = useState<ViewMode>('split');
  const [cursorPos, setCursorPos] = useState({ line: 1, column: 1 });
  const [showOutline, setShowOutline] = useState(false);
  const [isExportingPdf, setIsExportingPdf] = useState(false);

  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const previewRef = useRef<PreviewHandle>(null);
  const isEditorScrolling = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(null);
  const { monacoTheme, scheme } = useTheme();
  const log = useToolLogger('markdown-editor');

  // 预览使用 debounce 150ms (NF-02)
  const debouncedContent = useDebouncedValue(content, 150);

  // 自动保存（debounce 1s）
  useEffect(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => saveDraft(content), 1000);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [content]);

  // Monaco 编辑器挂载
  const handleEditorMount: OnMount = useCallback(
    (ed, monaco) => {
      editorRef.current = ed;

      // 光标位置追踪
      ed.onDidChangeCursorPosition((e) => {
        setCursorPos({ line: e.position.lineNumber, column: e.position.column });
      });

      // 滚动同步：编辑器 → 预览
      ed.onDidScrollChange(() => {
        if (isEditorScrolling.current) return;
        const model = ed.getModel();
        if (!model || !previewRef.current) return;
        const totalLines = model.getLineCount();
        const visibleLine = ed.getVisibleRanges()[0]?.startLineNumber ?? 1;
        const percent = Math.min(1, visibleLine / totalLines);
        previewRef.current.scrollToPercent(percent);
      });

      // 注册快捷键
      const addCommand = (
        keybinding: number,
        handler: () => void
      ) => {
        ed.addCommand(keybinding, handler);
      };

      const KM = monaco.KeyMod;
      const KC = monaco.KeyCode;

      addCommand(KM.CtrlCmd | KC.KeyB, () => applyAction('bold'));
      addCommand(KM.CtrlCmd | KC.KeyI, () => applyAction('italic'));
      addCommand(KM.CtrlCmd | KC.KeyK, () => applyAction('link'));
      addCommand(KM.CtrlCmd | KM.Shift | KC.KeyK, () => applyAction('codeBlock'));
      addCommand(KM.CtrlCmd | KM.Shift | KC.KeyP, () => cycleViewMode());

      // Tab 缩进
      addCommand(KC.Tab, () => {
        const sel = ed.getSelection();
        if (sel && !sel.isEmpty()) {
          applyEdit(indentLines);
        } else {
          ed.trigger('keyboard', 'type', { text: '  ' });
        }
      });
      addCommand(KM.Shift | KC.Tab, () => {
        applyEdit(outdentLines);
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // 应用编辑操作
  const applyEdit = useCallback(
    (
      fn: (
        text: string,
        start: number,
        end: number,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...args: any[]
      ) => { text: string; selectionStart: number; selectionEnd: number },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...args: any[]
    ) => {
      const ed = editorRef.current;
      if (!ed) return;
      const model = ed.getModel();
      if (!model) return;

      const sel = ed.getSelection();
      if (!sel) return;

      const text = model.getValue();
      const start = model.getOffsetAt({ lineNumber: sel.startLineNumber, column: sel.startColumn });
      const end = model.getOffsetAt({ lineNumber: sel.endLineNumber, column: sel.endColumn });

      const result = fn(text, start, end, ...args);

      ed.executeEdits('markdown-toolbar', [
        {
          range: model.getFullModelRange(),
          text: result.text,
        },
      ]);

      // 恢复选区
      const startPos = model.getPositionAt(result.selectionStart);
      const endPos = model.getPositionAt(result.selectionEnd);
      ed.setSelection({
        startLineNumber: startPos.lineNumber,
        startColumn: startPos.column,
        endLineNumber: endPos.lineNumber,
        endColumn: endPos.column,
      });
      ed.focus();
    },
    []
  );

  // 工具栏动作分发
  const applyAction = useCallback(
    (action: ToolbarAction) => {
      switch (action) {
        case 'bold':
          applyEdit(wrapSelection, '**');
          break;
        case 'italic':
          applyEdit(wrapSelection, '*');
          break;
        case 'strikethrough':
          applyEdit(wrapSelection, '~~');
          break;
        case 'inlineCode':
          applyEdit(wrapSelection, '`');
          break;
        case 'codeBlock':
          applyEdit(insertCodeBlock);
          break;
        case 'quote':
          applyEdit(toggleLinePrefix, '> ');
          break;
        case 'h1':
          applyEdit(toggleLinePrefix, '# ');
          break;
        case 'h2':
          applyEdit(toggleLinePrefix, '## ');
          break;
        case 'h3':
          applyEdit(toggleLinePrefix, '### ');
          break;
        case 'ul':
          applyEdit(toggleLinePrefix, '- ');
          break;
        case 'ol':
          applyEdit(toggleLinePrefix, '1. ');
          break;
        case 'taskList':
          applyEdit(toggleLinePrefix, '- [ ] ');
          break;
        case 'link':
          applyEdit(insertLink);
          break;
        case 'image':
          applyEdit(insertImage);
          break;
        case 'table':
          applyEdit(insertTable);
          break;
        case 'hr':
          applyEdit(insertHorizontalRule);
          break;
      }
    },
    [applyEdit]
  );

  const handleMermaidTemplate = useCallback(
    (template: MermaidTemplateKind) => {
      applyEdit(insertMermaidTemplate, template);
    },
    [applyEdit]
  );

  // 循环切换视图模式
  const cycleViewMode = useCallback(() => {
    setViewMode((prev) => {
      const modes: ViewMode[] = ['split', 'editor', 'preview'];
      const idx = modes.indexOf(prev);
      return modes[(idx + 1) % modes.length];
    });
  }, []);

  // 文件导入
  const handleImport = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.md,.markdown,.txt';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const text = await file.text();
      setContent(text);
      log.info('导入文件成功', { name: file.name, size: file.size });
      toast.success(t('markdownEditor.imported', { name: file.name }));
    };
    input.click();
  }, [t, log]);

  // 导出 Markdown
  const handleExportMd = useCallback(async () => {
    const path = await saveBytes(
      'document.md',
      new TextEncoder().encode(content),
      'Markdown 文件',
      ['md', 'markdown'],
    );
    if (!path) {
      toast.info(t('markdownEditor.exportCancelled'));
      return;
    }
    log.info('导出 Markdown 文件', { length: content.length });
    toast.success(t('markdownEditor.exportedMd', {
      path: isTauri ? path : t('markdownEditor.browserDownloadLocation'),
    }));
  }, [content, t, log]);

  // 导出 HTML
  const handleExportHtml = useCallback(async () => {
    const rendered = await renderMarkdown(content, { scheme, locale: i18n.resolvedLanguage ?? i18n.language });
    const html = generateExportHtml(rendered);
    const path = await saveBytes(
      'document.html',
      new TextEncoder().encode(html),
      'HTML 文件',
      ['html', 'htm'],
    );
    if (!path) {
      toast.info(t('markdownEditor.exportCancelled'));
      return;
    }
    log.info('导出 HTML 文件', { length: html.length });
    toast.success(t('markdownEditor.exportedHtml', {
      path: isTauri ? path : t('markdownEditor.browserDownloadLocation'),
    }));
  }, [content, i18n.language, i18n.resolvedLanguage, log, scheme, t]);

  // 通过系统打印对话框导出 PDF
  const handleExportPdf = useCallback(async () => {
    if (isExportingPdf) return;
    setIsExportingPdf(true);
    try {
      const rendered = await renderMarkdown(content, {
        scheme,
        locale: i18n.resolvedLanguage ?? i18n.language,
      });
      const remoteResources = findRemoteResources(rendered);
      if (remoteResources.length > 0) {
        toast.error(t('markdownEditor.pdfExportBlocked', { resources: remoteResources.join('\n') }));
        return;
      }

      const title = getMarkdownExportTitle(content);
      const html = generateExportHtml(rendered, title);
      const frame = document.createElement('iframe');
      frame.setAttribute('title', t('markdownEditor.pdfPrintFrame'));
      frame.setAttribute('aria-hidden', 'true');
      frame.style.position = 'fixed';
      frame.style.width = '1px';
      frame.style.height = '1px';
      frame.style.border = '0';
      frame.style.opacity = '0';
      frame.style.pointerEvents = 'none';

      let cleaned = false;
      const cleanup = () => {
        if (cleaned) return;
        cleaned = true;
        frame.remove();
      };
      frame.onload = () => {
        try {
          const printWindow = frame.contentWindow;
          if (!printWindow) throw new Error('打印窗口不可用');
          printWindow.addEventListener('afterprint', cleanup, { once: true });
          printWindow.focus();
          printWindow.print();
          window.setTimeout(cleanup, 10000);
          toast.info(t('markdownEditor.pdfPrintOpened'));
          log.info('打开 PDF 打印对话框', { length: html.length });
        } catch (error) {
          cleanup();
          const details = error instanceof Error ? error.message : String(error);
          toast.error(t('markdownEditor.pdfExportFailed', { details }));
          log.error('打开 PDF 打印对话框失败', { error: details });
        }
      };
      document.body.appendChild(frame);
      frame.srcdoc = html;
    } catch (error) {
      const details = error instanceof Error ? error.message : String(error);
      toast.error(t('markdownEditor.pdfExportFailed', { details }));
      log.error('生成 PDF 打印内容失败', { error: details });
    } finally {
      setIsExportingPdf(false);
    }
  }, [content, i18n.language, i18n.resolvedLanguage, isExportingPdf, log, scheme, t]);

  // 复制 HTML
  const handleCopyHtml = useCallback(async () => {
    const html = await renderMarkdown(content, { scheme, locale: i18n.resolvedLanguage ?? i18n.language });
    const success = await copyToClipboard(html);
    if (success) {
      log.info('复制 HTML 到剪贴板', { length: html.length });
      toast.success(t('markdownEditor.copiedHtml'));
    } else {
      log.warn('复制 HTML 失败');
    }
  }, [content, i18n.language, i18n.resolvedLanguage, log, scheme, t]);

  // 拖放导入
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file && /\.(md|markdown|txt)$/i.test(file.name)) {
      file.text().then((text) => {
        setContent(text);
        log.info('拖拽导入文件成功', { name: file.name, size: file.size });
        toast.success(t('markdownEditor.imported', { name: file.name }));
      });
    }
  }, [t, log]);

  // 大纲跳转
  const handleJumpToLine = useCallback((line: number) => {
    const ed = editorRef.current;
    if (!ed) return;
    ed.revealLineInCenter(line + 1);
    ed.setPosition({ lineNumber: line + 1, column: 1 });
    ed.focus();
  }, []);

  const showEditor = viewMode === 'split' || viewMode === 'editor';
  const showPreview = viewMode === 'split' || viewMode === 'preview';

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col" onDrop={handleDrop} onDragOver={(e) => e.preventDefault()}>
      {/* 顶部操作栏 */}
      <div className="flex min-h-9 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b px-3 py-1">
        <div className="flex items-center gap-1">
          {/* 视图切换 */}
          <Button
            variant={viewMode === 'split' ? 'secondary' : 'ghost'}
            size="icon"
            className="h-7 w-7"
            onClick={() => setViewMode('split')}
            title={t('markdownEditor.splitView')}
          >
            <Columns2 className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant={viewMode === 'editor' ? 'secondary' : 'ghost'}
            size="icon"
            className="h-7 w-7"
            onClick={() => setViewMode('editor')}
            title={t('markdownEditor.editorOnly')}
          >
            <PenLine className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant={viewMode === 'preview' ? 'secondary' : 'ghost'}
            size="icon"
            className="h-7 w-7"
            onClick={() => setViewMode('preview')}
            title={t('markdownEditor.previewOnly')}
          >
            <Eye className="h-3.5 w-3.5" />
          </Button>
          <div className="mx-1 h-4 w-px bg-border" />
          <Button
            variant={showOutline ? 'secondary' : 'ghost'}
            size="icon"
            className="h-7 w-7"
            onClick={() => setShowOutline(!showOutline)}
            title={t('markdownEditor.outline')}
          >
            {showOutline ? <PanelLeftClose className="h-3.5 w-3.5" /> : <ListTree className="h-3.5 w-3.5" />}
          </Button>
        </div>

        <div className="flex items-center gap-1">
          {/* 模板 */}
          {MARKDOWN_TEMPLATES.map((tpl) => (
            <Button
              key={tpl.id}
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => {
                setContent(tpl.content);
                toast.success(t('markdownEditor.templateLoaded', { name: tpl.name }));
              }}
            >
              <FileText className="mr-1 h-3 w-3" />
              {tpl.name}
            </Button>
          ))}

          <div className="mx-1 h-4 w-px bg-border" />

          {/* 导入导出 */}
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleImport} title={t('markdownEditor.import')}>
            <Upload className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleExportMd} title={t('markdownEditor.exportMd')}>
            <Download className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleExportHtml} title={t('markdownEditor.exportHtml')}>
            <FileCode2 className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={handleExportPdf}
            disabled={isExportingPdf}
            title={t('markdownEditor.exportPdf')}
            aria-label={t('markdownEditor.exportPdf')}
          >
            <Printer className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleCopyHtml} title={t('markdownEditor.copyHtml')}>
            <Copy className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* 工具栏 */}
      {showEditor && <Toolbar onAction={applyAction} onMermaidTemplate={handleMermaidTemplate} />}

      {/* 主内容区 */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col lg:flex-row">
        {/* 大纲侧栏 */}
        {showOutline && (
          <div className="w-full shrink-0 border-b lg:w-48 lg:border-b-0 lg:border-r">
            <Outline content={content} onJumpToLine={handleJumpToLine} />
          </div>
        )}
        {showEditor && (
          <div className={`min-h-0 min-w-0 ${showPreview ? 'flex-1 w-full border-b lg:w-1/2 lg:border-b-0 lg:border-r' : 'flex-1'}`}>
            <Editor
              height="100%"
              language="markdown"
              theme={monacoTheme}
              value={content}
              onChange={(value) => setContent(value ?? '')}
              onMount={handleEditorMount}
              options={{
                wordWrap: 'on',
                minimap: { enabled: false },
                fontSize: 14,
                lineNumbers: 'on',
                scrollBeyondLastLine: false,
                automaticLayout: true,
                tabSize: 2,
                renderWhitespace: 'boundary',
                padding: { top: 12 },
                smoothScrolling: true,
              }}
            />
          </div>
        )}
        {showPreview && (
          <div className={`min-h-0 min-w-0 p-2 ${showEditor ? 'flex-1 w-full lg:w-1/2' : 'flex-1'}`}>
            <Preview ref={previewRef} source={debouncedContent} />
          </div>
        )}
      </div>

      {/* 状态栏 */}
      <StatusBar content={content} cursorLine={cursorPos.line} cursorColumn={cursorPos.column} />
    </div>
  );
}
