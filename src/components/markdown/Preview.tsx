import { memo, useMemo, useEffect, useRef, useState, forwardRef, useImperativeHandle } from 'react';
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
import { ensureIntrinsicSvgDimensions, getMermaid } from '@/lib/mermaid';
import { getThemeTokens } from '@/lib/theme';
import { useAppStore } from '@/store/app-store';
import { ImageViewer } from '@/components/media/image-viewer';

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
  interactivePreview?: boolean;
  background?: string;
  foreground?: string;
}

interface MermaidLabels {
  diagram: string;
  error: string;
  previewAction: string;
}

const MERMAID_PREVIEW_TRIGGER_CLASSES = [
  'cursor-zoom-in',
  'focus-visible:outline-none',
  'focus-visible:ring-2',
  'focus-visible:ring-ring',
  'focus-visible:ring-offset-2',
] as const;

let diagramSequence = 0;

function getMermaidLabels(locale?: string): MermaidLabels {
  if (locale?.toLowerCase().startsWith('zh')) {
    return {
      diagram: 'Mermaid 图表',
      error: 'Mermaid 图表语法错误',
      previewAction: '放大查看 Mermaid 图表',
    };
  }
  return {
    diagram: 'Mermaid diagram',
    error: 'Mermaid diagram syntax error',
    previewAction: 'Open enlarged Mermaid diagram preview',
  };
}

function setMermaidPreviewAction(diagram: HTMLElement, label?: string) {
  if (!label) {
    diagram.removeAttribute('role');
    diagram.removeAttribute('tabindex');
    diagram.removeAttribute('aria-label');
    diagram.classList.remove(...MERMAID_PREVIEW_TRIGGER_CLASSES);
    return;
  }

  diagram.setAttribute('role', 'button');
  diagram.tabIndex = 0;
  diagram.setAttribute('aria-label', label);
  diagram.classList.add(...MERMAID_PREVIEW_TRIGGER_CLASSES);
}

function createMermaidPlaceholder(source: string): string {
  // markdown-it 会把未以 `<pre` 开头的高亮结果再次包进默认的
  // `<pre><code class="language-mermaid">`。显式返回一个可控的代码块，
  // 这样 Mermaid 预览不会继承普通代码块的深色背景和内边距。
  return `<pre class="mermaid-block"><code><section class="mermaid-diagram" data-mermaid-source="${escapeHtml(source)}" aria-busy="true"><span class="text-sm text-muted-foreground">正在渲染 Mermaid 图表…</span></section></code></pre>`;
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
  // Mermaid 的状态图和 ER 图会在渲染时读取 SVG 的布局尺寸；`display: none`
  // 会使这些尺寸为 0，进而导致 dagre 抛出 “suitable point” 异常。视觉隐藏但
  // 保留布局能力，待 SVG 生成后再移除该临时容器。
  container.style.cssText = 'position:fixed;inset:0 auto auto 0;visibility:hidden;pointer-events:none;';
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
    interactivePreview = false,
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
      const hasRenderedSvg = diagram.querySelector('.mermaid-svg svg');
      setMermaidPreviewAction(diagram, interactivePreview && hasRenderedSvg ? labels.previewAction : undefined);
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
      setMermaidPreviewAction(diagram, interactivePreview ? labels.previewAction : undefined);
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
      setMermaidPreviewAction(diagram);
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

// 使用源码行定位标题，重复标题也能准确跳转；导出不携带定位属性。
md.renderer.rules.heading_open = (tokens, index, options, env, renderer) => {
  const token = tokens[index];
  if (env?.includeSourceLines && token.map) {
    token.attrSet('data-source-line', String(token.map[0]));
  }
  return renderer.renderToken(tokens, index, options);
};

export interface PreviewScrollTarget {
  line: number;
  source: string;
}

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
  /** 每次点击创建新对象，在对应版本的预览渲染后跳转。 */
  scrollTarget?: PreviewScrollTarget | null;
  /** 预览基础字号（px），未传入时使用默认排版样式 */
  fontSize?: number;
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
  ({ source, onScroll, scrollTarget, fontSize, className }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const markupRef = useRef<HTMLDivElement>(null);
    const isSyncScrolling = useRef(false);
    const handledScrollTarget = useRef<PreviewScrollTarget | null>(null);
    const [mermaidPreview, setMermaidPreview] = useState<Blob | null>(null);
    const scheme = useResolvedTheme();
    const skin = useAppStore((state) => state.skin);
    const themeTokens = getThemeTokens(skin, scheme);
    const { i18n } = useTranslation();
    const locale = i18n.resolvedLanguage ?? i18n.language;
    const mermaidLabels = getMermaidLabels(locale);

    const html = useMemo(() => {
      if (!source.trim()) return '';
      return md.render(source, { includeSourceLines: true });
    }, [source]);

    useEffect(() => {
      if (!scrollTarget || handledScrollTarget.current === scrollTarget || scrollTarget.source !== source) return;
      const container = containerRef.current;
      const heading = markupRef.current?.querySelector<HTMLElement>(`[data-source-line="${scrollTarget.line}"]`);
      if (!container || !heading) return;

      handledScrollTarget.current = scrollTarget;
      isSyncScrolling.current = true;
      const padding = parseFloat(getComputedStyle(container).paddingTop) || 0;
      container.scrollTop += heading.getBoundingClientRect().top - container.getBoundingClientRect().top - container.clientTop - padding;
      const frame = requestAnimationFrame(() => { isSyncScrolling.current = false; });
      return () => {
        cancelAnimationFrame(frame);
        isSyncScrolling.current = false;
      };
    }, [html, source, scrollTarget]);

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
      const openDiagramPreview = (diagram: HTMLElement | null) => {
        const svg = diagram?.querySelector('.mermaid-svg svg');
        if (!svg) return;
        // 内联 SVG 的百分比尺寸不能直接用于 WebView2 的图片预览。
        const previewSvg = ensureIntrinsicSvgDimensions(svg.outerHTML);
        setMermaidPreview(new Blob([previewSvg], { type: 'image/svg+xml;charset=utf-8' }));
      };
      const handleClick = (event: MouseEvent) => {
        if (!(event.target instanceof Element) || event.target.closest('a')) return;
        const diagram = event.target.closest<HTMLElement>('.mermaid-diagram[role="button"]');
        if (diagram && el.contains(diagram)) openDiagramPreview(diagram);
      };
      const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        if (!(event.target instanceof HTMLElement) || !event.target.matches('.mermaid-diagram[role="button"]')) return;
        event.preventDefault();
        openDiagramPreview(event.target);
      };
      el.addEventListener('click', handleClick);
      el.addEventListener('keydown', handleKeyDown);
      return () => {
        el.removeEventListener('click', handleClick);
        el.removeEventListener('keydown', handleKeyDown);
      };
    }, []);

    useEffect(() => {
      const el = markupRef.current;
      if (!el) return;
      let cancelled = false;
      void renderMermaidInElement(
        el,
        {
          scheme,
          locale,
          preserveSourceAttribute: true,
          interactivePreview: true,
          // 直接使用当前皮肤令牌，避免根节点主题副作用尚未完成时读到旧 CSS 变量。
          background: `hsl(${themeTokens.background})`,
          foreground: `hsl(${themeTokens.foreground})`,
        },
        () => cancelled
      );
      return () => {
        cancelled = true;
      };
    }, [html, locale, scheme, skin, themeTokens.background, themeTokens.foreground]);

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
        style={{ fontSize }}
        data-font-size={fontSize}
        onScroll={handleScroll}
      >
        <MarkdownMarkup ref={markupRef} html={html} />
        {mermaidPreview && (
          <ImageViewer
            source={mermaidPreview}
            alt={mermaidLabels.diagram}
            title={mermaidLabels.diagram}
            mode="dialog"
            wheelZoom="always"
            onClose={() => setMermaidPreview(null)}
          />
        )}
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
