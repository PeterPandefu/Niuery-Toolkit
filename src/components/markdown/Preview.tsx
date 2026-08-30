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
import { getThemeTokens } from '@/lib/theme';
import { useAppStore } from '@/store/app-store';

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
  background?: string;
  foreground?: string;
}

interface MermaidLabels {
  diagram: string;
  error: string;
}

let mermaidPromise: Promise<typeof import('mermaid').default> | null = null;
let diagramSequence = 0;

function getMermaidLabels(locale?: string): MermaidLabels {
  if (locale?.toLowerCase().startsWith('zh')) {
    return { diagram: 'Mermaid 图表', error: 'Mermaid 图表语法错误' };
  }
  return { diagram: 'Mermaid diagram', error: 'Mermaid diagram syntax error' };
}

function createMermaidPlaceholder(source: string): string {
  // markdown-it 会把未以 `<pre` 开头的高亮结果再次包进默认的
  // `<pre><code class="language-mermaid">`。显式返回一个可控的代码块，
  // 这样 Mermaid 预览不会继承普通代码块的深色背景和内边距。
  return `<pre class="mermaid-block"><code><section class="mermaid-diagram" data-mermaid-source="${escapeHtml(source)}" aria-busy="true"><span class="text-sm text-muted-foreground">正在渲染 Mermaid 图表…</span></section></code></pre>`;
}

async function getMermaid() {
  mermaidPromise ??= import('mermaid').then(({ default: mermaid }) => mermaid);
  return mermaidPromise;
}

function readThemeColor(variable: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(variable).trim();
  return value ? `hsl(${value})` : fallback;
}

async function renderMermaidSvg(source: string, scheme: ColorScheme, background?: string, foreground?: string): Promise<string> {
  const mermaid = await getMermaid();
  const themeBackground = background ?? (scheme === 'dark' ? '#21170f' : '#fffdf5');
  const themeForeground = foreground ?? (scheme === 'dark' ? '#f9edd3' : '#38251b');
  mermaid.initialize({
    startOnLoad: false,
    // 错误由调用方渲染为可控的错误卡片，避免 Mermaid 将错误 SVG 注入 document.body。
    suppressErrorRendering: true,
    securityLevel: 'strict',
    theme: scheme === 'dark' ? 'dark' : 'default',
    fontFamily: 'IBM Plex Sans, Noto Sans SC, sans-serif',
    // 显式设置背景和前景色，避免透明 SVG 在 WebView/PDF 中退化为黑色，
    // 同时保证暗色主题下文字和连线具有足够对比度。
    themeVariables: {
      background: themeBackground,
      mainBkg: themeBackground,
      textColor: themeForeground,
      primaryTextColor: themeForeground,
      secondaryTextColor: themeForeground,
      tertiaryTextColor: themeForeground,
      lineColor: themeForeground,
    },
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

/** 统一 Mermaid 生成的根背景矩形，避免主题默认背景覆盖应用主题。 */
function normalizeMermaidSvg(svg: string, background: string): string {
  if (typeof DOMParser === 'undefined') return svg;
  const document = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const root = document.documentElement;
  if (root.tagName.toLowerCase() !== 'svg') return svg;
  const rootStyle = root.getAttribute('style') ?? '';
  root.setAttribute('style', `${rootStyle}${rootStyle ? ';' : ''}background-color:${background}`);
  root.querySelectorAll<SVGRectElement>('rect.background, rect[class*="background"], rect[width="100%"][height="100%"]').forEach((rect) => {
    rect.setAttribute('fill', background);
    const rectStyle = rect.getAttribute('style') ?? '';
    rect.setAttribute('style', `${rectStyle}${rectStyle ? ';' : ''}fill:${background}`);
  });
  return root.outerHTML;
}

/** 将 Markdown 生成的 Mermaid 占位符替换为本地、安全的 SVG。 */
// eslint-disable-next-line react-refresh/only-export-components
export async function renderMermaidInElement(
  root: ParentNode,
  {
    scheme = 'light',
    locale,
    preserveSourceAttribute = false,
    background,
    foreground,
  }: MermaidRenderOptions = {},
  isCancelled: () => boolean = () => false
): Promise<void> {
  const labels = getMermaidLabels(locale);
  const diagrams = Array.from(root.querySelectorAll<HTMLElement>('.mermaid-diagram[data-mermaid-source]'));
  const resolvedBackground = background ?? readThemeColor('--background', scheme === 'dark' ? '#21170f' : '#fffdf5');
  const resolvedForeground = foreground ?? readThemeColor('--foreground', scheme === 'dark' ? '#f9edd3' : '#38251b');
  const renderKey = `${scheme}|${locale ?? ''}|${resolvedBackground}|${resolvedForeground}`;
  const hasExplicitTheme = Boolean(background || foreground);

  for (const diagram of diagrams) {
    if (isCancelled()) return;
    const source = diagram.dataset.mermaidSource;
    if (!source) continue;
    if (
      diagram.getAttribute('aria-busy') !== 'true' &&
      diagram.dataset.mermaidRenderedSource === source &&
      (!hasExplicitTheme || diagram.dataset.mermaidRenderedKey === renderKey)
    ) {
      continue;
    }

    try {
      const svg = await renderMermaidSvg(
        source,
        scheme,
        resolvedBackground,
        resolvedForeground,
      );
      if (isCancelled()) return;
      diagram.innerHTML = `<div class="mermaid-svg" role="img" aria-label="${labels.diagram}">${normalizeMermaidSvg(svg, resolvedBackground)}</div>`;
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
      diagram.innerHTML = `<div class="mermaid-error" role="alert"><strong>${labels.error}</strong><pre>${escapeHtml(message)}</pre></div>`;
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
    const skin = useAppStore((state) => state.skin);
    const themeTokens = getThemeTokens(skin, scheme);
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
        {
          scheme,
          locale: i18n.resolvedLanguage ?? i18n.language,
          preserveSourceAttribute: true,
          // 直接使用当前皮肤令牌，避免根节点主题副作用尚未完成时读到旧 CSS 变量。
          background: `hsl(${themeTokens.background})`,
          foreground: `hsl(${themeTokens.foreground})`,
        },
        () => cancelled
      );
      return () => {
        cancelled = true;
      };
    }, [html, i18n.language, i18n.resolvedLanguage, scheme, skin, themeTokens.background, themeTokens.foreground]);

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
