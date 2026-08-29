import { memo, useMemo, useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import MarkdownIt from 'markdown-it';
import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import css from 'highlight.js/lib/languages/css';
import json from 'highlight.js/lib/languages/json';
import python from 'highlight.js/lib/languages/python';
import bash from 'highlight.js/lib/languages/bash';
import sql from 'highlight.js/lib/languages/sql';
import yaml from 'highlight.js/lib/languages/yaml';
import markdown from 'highlight.js/lib/languages/markdown';
import rust from 'highlight.js/lib/languages/rust';
import go from 'highlight.js/lib/languages/go';
import java from 'highlight.js/lib/languages/java';
import cpp from 'highlight.js/lib/languages/cpp';
import taskLists from 'markdown-it-task-list';
import { useTranslation } from 'react-i18next';
import { useResolvedTheme } from '@/hooks/use-theme';

// 注册常用语言
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('js', javascript);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('ts', typescript);
hljs.registerLanguage('html', xml);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('css', css);
hljs.registerLanguage('json', json);
hljs.registerLanguage('python', python);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('shell', bash);
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('yaml', yaml);
hljs.registerLanguage('yml', yaml);
hljs.registerLanguage('markdown', markdown);
hljs.registerLanguage('md', markdown);
hljs.registerLanguage('rust', rust);
hljs.registerLanguage('go', go);
hljs.registerLanguage('java', java);
hljs.registerLanguage('cpp', cpp);
hljs.registerLanguage('c', cpp);

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

type ColorScheme = 'light' | 'dark';

interface MermaidRenderOptions {
  scheme?: ColorScheme;
  locale?: string;
  preserveSourceAttribute?: boolean;
}

interface MermaidLabels {
  diagram: string;
  source: string;
  error: string;
}

let mermaidPromise: Promise<typeof import('mermaid').default> | null = null;
let diagramSequence = 0;

function getMermaidLabels(locale?: string): MermaidLabels {
  if (locale?.toLowerCase().startsWith('zh')) {
    return { diagram: 'Mermaid 图表', source: '显示 Mermaid 源码', error: 'Mermaid 图表语法错误' };
  }
  return { diagram: 'Mermaid diagram', source: 'Show Mermaid source', error: 'Mermaid diagram syntax error' };
}

function createMermaidPlaceholder(source: string): string {
  return `<section class="mermaid-diagram" data-mermaid-source="${escapeHtml(source)}" aria-busy="true"><span class="text-sm text-muted-foreground">正在渲染 Mermaid 图表…</span></section>`;
}

function createMermaidSourceDetails(source: string, labels: MermaidLabels): string {
  return `<details class="mermaid-source"><summary>${labels.source}</summary><pre><code>${escapeHtml(source)}</code></pre></details>`;
}

async function getMermaid() {
  mermaidPromise ??= import('mermaid').then(({ default: mermaid }) => mermaid);
  return mermaidPromise;
}

async function renderMermaidSvg(source: string, scheme: ColorScheme): Promise<string> {
  const mermaid = await getMermaid();
  mermaid.initialize({
    startOnLoad: false,
    // 错误由调用方渲染为可控的错误卡片，避免 Mermaid 将错误 SVG 注入 document.body。
    suppressErrorRendering: true,
    securityLevel: 'strict',
    theme: scheme === 'dark' ? 'dark' : 'default',
    fontFamily: 'IBM Plex Sans, Noto Sans SC, sans-serif',
  });
  const id = `niuery-mermaid-${++diagramSequence}`;
  const container = document.createElement('div');
  container.setAttribute('aria-hidden', 'true');
  container.style.display = 'none';
  document.body.appendChild(container);
  try {
    const { svg } = await mermaid.render(id, source, container);
    return svg;
  } finally {
    container.remove();
  }
}

/** 将 Markdown 生成的 Mermaid 占位符替换为本地、安全的 SVG。 */
// eslint-disable-next-line react-refresh/only-export-components
export async function renderMermaidInElement(
  root: ParentNode,
  { scheme = 'light', locale, preserveSourceAttribute = false }: MermaidRenderOptions = {},
  isCancelled: () => boolean = () => false
): Promise<void> {
  const labels = getMermaidLabels(locale);
  const diagrams = Array.from(root.querySelectorAll<HTMLElement>('.mermaid-diagram[data-mermaid-source]'));
  const renderKey = `${scheme}|${locale ?? ''}`;

  for (const diagram of diagrams) {
    if (isCancelled()) return;
    const source = diagram.dataset.mermaidSource;
    if (!source) continue;
    if (
      diagram.getAttribute('aria-busy') !== 'true' &&
      diagram.dataset.mermaidRenderedSource === source &&
      diagram.dataset.mermaidRenderedKey === renderKey
    ) {
      continue;
    }

    try {
      const svg = await renderMermaidSvg(source, scheme);
      if (isCancelled()) return;
      diagram.innerHTML = `<div class="mermaid-svg" role="img" aria-label="${labels.diagram}">${svg}</div>${createMermaidSourceDetails(source, labels)}`;
      diagram.dataset.mermaidRenderedSource = source;
      diagram.dataset.mermaidRenderedKey = renderKey;
      if (!preserveSourceAttribute) diagram.removeAttribute('data-mermaid-source');
      if (!preserveSourceAttribute) {
        diagram.removeAttribute('data-mermaid-rendered-source');
        diagram.removeAttribute('data-mermaid-rendered-key');
      }
      diagram.removeAttribute('aria-busy');
    } catch (error) {
      if (isCancelled()) return;
      const message = error instanceof Error ? error.message : String(error);
      diagram.innerHTML = `<div class="mermaid-error" role="alert"><strong>${labels.error}</strong><pre>${escapeHtml(message)}</pre></div>${createMermaidSourceDetails(source, labels)}`;
      diagram.dataset.mermaidRenderedSource = source;
      diagram.dataset.mermaidRenderedKey = renderKey;
      if (!preserveSourceAttribute) diagram.removeAttribute('data-mermaid-source');
      if (!preserveSourceAttribute) {
        diagram.removeAttribute('data-mermaid-rendered-source');
        diagram.removeAttribute('data-mermaid-rendered-key');
      }
      diagram.removeAttribute('aria-busy');
    }
  }
}

const md: MarkdownIt = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: true,
  breaks: true,
  highlight(str: string, lang: string): string {
    if (lang.toLowerCase() === 'mermaid') return createMermaidPlaceholder(str);
    if (lang && hljs.getLanguage(lang)) {
      try {
        return `<pre class="hljs"><code>${hljs.highlight(str, { language: lang }).value}</code></pre>`;
      } catch {
        /* fallback */
      }
    }
    return `<pre class="hljs"><code>${escapeHtml(str)}</code></pre>`;
  },
});

md.use(taskLists, { enabled: true });

export interface PreviewHandle {
  /** 获取预览容器元素 */
  getElement: () => HTMLDivElement | null;
  /** 滚动到指定百分比 */
  scrollToPercent: (percent: number) => void;
  /** 获取当前滚动百分比 */
  getScrollPercent: () => number;
}

interface PreviewProps {
  /** Markdown 源码 */
  source: string;
  /** 滚动同步回调 */
  onScroll?: (percent: number) => void;
  className?: string;
}

/**
 * Mermaid mutates the generated markup after it is committed. Keep that DOM
 * subtree memoized so unrelated parent renders (such as cursor movement in
 * Monaco) do not overwrite the rendered SVG with the Markdown placeholder.
 */
const MarkdownMarkup = memo(
  forwardRef<HTMLDivElement, { html: string }>(({ html }, ref) => (
    <div ref={ref} dangerouslySetInnerHTML={{ __html: html }} />
  ))
);
MarkdownMarkup.displayName = 'MarkdownMarkup';

export const Preview = forwardRef<PreviewHandle, PreviewProps>(
  ({ source, onScroll, className }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const markupRef = useRef<HTMLDivElement>(null);
    const isSyncScrolling = useRef(false);
    const scheme = useResolvedTheme();
    const { i18n } = useTranslation();

    const html = useMemo(() => {
      if (!source.trim()) return '';
      return md.render(source);
    }, [source]);

    useImperativeHandle(ref, () => ({
      getElement: () => containerRef.current,
      scrollToPercent: (percent: number) => {
        const el = containerRef.current;
        if (!el) return;
        isSyncScrolling.current = true;
        el.scrollTop = percent * (el.scrollHeight - el.clientHeight);
        requestAnimationFrame(() => {
          isSyncScrolling.current = false;
        });
      },
      getScrollPercent: () => {
        const el = containerRef.current;
        if (!el || el.scrollHeight <= el.clientHeight) return 0;
        return el.scrollTop / (el.scrollHeight - el.clientHeight);
      },
    }));

    // 处理链接点击：新窗口打开
    useEffect(() => {
      const el = containerRef.current;
      if (!el) return;
      const handler = (e: MouseEvent) => {
        const target = (e.target as HTMLElement).closest('a');
        if (target && target.href) {
          e.preventDefault();
          window.open(target.href, '_blank', 'noopener,noreferrer');
        }
      };
      el.addEventListener('click', handler);
      return () => el.removeEventListener('click', handler);
    }, []);

    useEffect(() => {
      const el = markupRef.current;
      if (!el) return;
      let cancelled = false;
      void renderMermaidInElement(
        el,
        { scheme, locale: i18n.resolvedLanguage ?? i18n.language, preserveSourceAttribute: true },
        () => cancelled
      );
      return () => {
        cancelled = true;
      };
    }, [html, i18n.language, i18n.resolvedLanguage, scheme]);

    const handleScroll = () => {
      if (isSyncScrolling.current || !onScroll) return;
      const el = containerRef.current;
      if (!el || el.scrollHeight <= el.clientHeight) return;
      onScroll(el.scrollTop / (el.scrollHeight - el.clientHeight));
    };

    return (
      <div
        ref={containerRef}
        className={`markdown-preview prose prose-sm dark:prose-invert h-full max-w-none overflow-y-auto rounded-md border bg-muted/30 p-4 ${className ?? ''}`}
        onScroll={handleScroll}
      >
        <MarkdownMarkup ref={markupRef} html={html} />
      </div>
    );
  }
);

Preview.displayName = 'Preview';

/** 将 Markdown 渲染为可独立使用的 HTML，Mermaid 会被内联为 SVG。 */
export async function renderMarkdown(source: string, options: MermaidRenderOptions = {}): Promise<string> {
  const container = document.createElement('div');
  container.innerHTML = md.render(source);
  await renderMermaidInElement(container, options);
  return container.innerHTML;
}
