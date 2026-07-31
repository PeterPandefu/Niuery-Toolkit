import { useMemo, useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
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

const md: MarkdownIt = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: true,
  breaks: true,
  highlight(str: string, lang: string): string {
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

export const Preview = forwardRef<PreviewHandle, PreviewProps>(
  ({ source, onScroll, className }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const isSyncScrolling = useRef(false);

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
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }
);

Preview.displayName = 'Preview';

/** 获取 markdown-it 实例（用于导出 HTML） */
export function renderMarkdown(source: string): string {
  return md.render(source);
}
