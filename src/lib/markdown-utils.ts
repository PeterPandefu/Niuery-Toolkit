/**
 * Markdown 编辑器工具函数
 * 提供文本操作、统计、导出等能力
 */

/** 编辑器操作结果 */
export interface EditResult {
  /** 操作后的完整文本 */
  text: string;
  /** 新的选区起始位置 */
  selectionStart: number;
  /** 新的选区结束位置 */
  selectionEnd: number;
}

/** 文档统计信息 */
export interface DocStats {
  /** 字符数 */
  chars: number;
  /** 单词数 */
  words: number;
  /** 行数 */
  lines: number;
  /** 预计阅读时间（分钟） */
  readingTime: number;
}

/** 大纲条目 */
export interface OutlineItem {
  /** 标题级别 1-6 */
  level: number;
  /** 标题文本 */
  text: string;
  /** 所在行号（0-based） */
  line: number;
}

/**
 * 包裹选中文本（粗体、斜体、删除线、行内代码）
 * 如果选中文本已被相同标记包裹，则取消包裹
 */
export function wrapSelection(
  text: string,
  selectionStart: number,
  selectionEnd: number,
  marker: string
): EditResult {
  const selected = text.slice(selectionStart, selectionEnd);

  // 检查选中文本是否已被包裹
  if (
    selected.startsWith(marker) &&
    selected.endsWith(marker) &&
    selected.length > marker.length * 2
  ) {
    const unwrapped = selected.slice(marker.length, selected.length - marker.length);
    const newText = text.slice(0, selectionStart) + unwrapped + text.slice(selectionEnd);
    return {
      text: newText,
      selectionStart,
      selectionEnd: selectionStart + unwrapped.length,
    };
  }

  // 检查选区两侧是否已被包裹（光标在标记内部的情况）
  const before = text.slice(Math.max(0, selectionStart - marker.length), selectionStart);
  const after = text.slice(selectionEnd, selectionEnd + marker.length);
  if (before === marker && after === marker) {
    const newText =
      text.slice(0, selectionStart - marker.length) +
      selected +
      text.slice(selectionEnd + marker.length);
    return {
      text: newText,
      selectionStart: selectionStart - marker.length,
      selectionEnd: selectionEnd - marker.length,
    };
  }

  const placeholder = selected || getPlaceholderForMarker(marker);
  const wrapped = marker + placeholder + marker;
  const newText = text.slice(0, selectionStart) + wrapped + text.slice(selectionEnd);
  return {
    text: newText,
    selectionStart: selectionStart + marker.length,
    selectionEnd: selectionStart + marker.length + placeholder.length,
  };
}

/** 根据标记获取占位文本 */
function getPlaceholderForMarker(marker: string): string {
  switch (marker) {
    case '**': return '粗体文本';
    case '*': return '斜体文本';
    case '~~': return '删除线文本';
    case '`': return '代码';
    default: return '文本';
  }
}

/**
 * 行前缀操作（引用、列表、标题）
 * 对选区覆盖的每一行添加/切换前缀
 */
export function toggleLinePrefix(
  text: string,
  selectionStart: number,
  selectionEnd: number,
  prefix: string
): EditResult {
  const lineStart = text.lastIndexOf('\n', selectionStart - 1) + 1;
  let lineEnd = text.indexOf('\n', selectionEnd);
  if (lineEnd === -1) lineEnd = text.length;

  const block = text.slice(lineStart, lineEnd);
  const lines = block.split('\n');

  // 检查所有行是否都已有该前缀
  const allPrefixed = lines.every((line) => line.startsWith(prefix));

  const newLines = allPrefixed
    ? lines.map((line) => line.slice(prefix.length))
    : lines.map((line) => {
        // 如果是标题前缀，先移除已有标题标记
        if (prefix.startsWith('#')) {
          return prefix + line.replace(/^#{1,6}\s+/, '');
        }
        // 其他前缀（引用、列表），如果已有同类前缀则替换
        if (prefix === '> ' && line.startsWith('> ')) return line;
        if ((prefix === '- ' || prefix === '1. ') && /^([-*+]|\d+\.)\s/.test(line)) {
          return prefix + line.replace(/^([-*+]|\d+\.)\s/, '');
        }
        if (prefix === '- [ ] ' && /^([-*+]|\d+\.)\s(\[[ x]\]\s)?/.test(line)) {
          return prefix + line.replace(/^([-*+]|\d+\.)\s(\[[ x]\]\s)?/, '');
        }
        return prefix + line;
      });

  const newBlock = newLines.join('\n');
  const newText = text.slice(0, lineStart) + newBlock + text.slice(lineEnd);
  const delta = newBlock.length - block.length;

  return {
    text: newText,
    selectionStart: lineStart,
    selectionEnd: Math.max(lineStart, selectionEnd + delta),
  };
}

/**
 * 插入代码块
 */
export function insertCodeBlock(
  text: string,
  selectionStart: number,
  selectionEnd: number,
  language = ''
): EditResult {
  const selected = text.slice(selectionStart, selectionEnd);
  const before = text.slice(0, selectionStart);
  const after = text.slice(selectionEnd);

  const needsNewlineBefore = before.length > 0 && !before.endsWith('\n');
  const prefix = needsNewlineBefore ? '\n' : '';

  const block = `${prefix}\`\`\`${language}\n${selected || '// 代码'}\n\`\`\`\n`;
  const contentStart = selectionStart + prefix.length + 3 + language.length + 1;

  return {
    text: before + block + after,
    selectionStart: contentStart,
    selectionEnd: contentStart + (selected || '// 代码').length,
  };
}

export const MERMAID_TEMPLATES = {
  flowchart: 'flowchart TD\n  Start([开始]) --> End([结束])',
  sequence: 'sequenceDiagram\n  participant A as 用户\n  participant B as 服务\n  A->>B: 发起请求\n  B-->>A: 返回结果',
  class: 'classDiagram\n  class User {\n    +String name\n    +login()\n  }\n  class Session {\n    +String token\n  }\n  User --> Session',
  state: 'stateDiagram-v2\n  [*] --> 待处理\n  待处理 --> 已完成\n  已完成 --> [*]',
} as const;

export type MermaidTemplateKind = keyof typeof MERMAID_TEMPLATES;

/** 插入 Mermaid 模板，选中的内容会被模板替换。 */
export function insertMermaidTemplate(
  text: string,
  selectionStart: number,
  selectionEnd: number,
  template: MermaidTemplateKind
): EditResult {
  const before = text.slice(0, selectionStart);
  const after = text.slice(selectionEnd);
  const prefix = before.length > 0 && !before.endsWith('\n') ? '\n' : '';
  const diagram = MERMAID_TEMPLATES[template];
  const block = `${prefix}\`\`\`mermaid\n${diagram}\n\`\`\`\n`;
  const contentStart = selectionStart + prefix.length + '```mermaid\n'.length;

  return {
    text: before + block + after,
    selectionStart: contentStart,
    selectionEnd: contentStart + diagram.length,
  };
}

/**
 * 插入链接
 */
export function insertLink(
  text: string,
  selectionStart: number,
  selectionEnd: number
): EditResult {
  const selected = text.slice(selectionStart, selectionEnd);
  const linkText = selected || '链接文本';
  const snippet = `[${linkText}](https://)`;
  const newText = text.slice(0, selectionStart) + snippet + text.slice(selectionEnd);

  // 选中 URL 部分方便替换
  const urlStart = selectionStart + linkText.length + 3;
  return {
    text: newText,
    selectionStart: urlStart,
    selectionEnd: urlStart + 8,
  };
}

/**
 * 插入图片
 */
export function insertImage(
  text: string,
  selectionStart: number,
  selectionEnd: number
): EditResult {
  const selected = text.slice(selectionStart, selectionEnd);
  const altText = selected || '图片描述';
  const snippet = `![${altText}](https://)`;
  const newText = text.slice(0, selectionStart) + snippet + text.slice(selectionEnd);

  const urlStart = selectionStart + altText.length + 4;
  return {
    text: newText,
    selectionStart: urlStart,
    selectionEnd: urlStart + 8,
  };
}

/**
 * 插入表格
 */
export function insertTable(
  text: string,
  selectionStart: number,
  _selectionEnd: number
): EditResult {
  const before = text.slice(0, selectionStart);
  const after = text.slice(_selectionEnd);
  const needsNewline = before.length > 0 && !before.endsWith('\n');
  const prefix = needsNewline ? '\n' : '';

  const table = `${prefix}| 列 1 | 列 2 | 列 3 |\n|------|------|------|\n| 内容 | 内容 | 内容 |\n| 内容 | 内容 | 内容 |\n`;
  const newText = before + table + after;

  // 选中第一个单元格
  const cellStart = selectionStart + prefix.length + 2;
  return {
    text: newText,
    selectionStart: cellStart,
    selectionEnd: cellStart + 4,
  };
}

/**
 * 插入水平线
 */
export function insertHorizontalRule(
  text: string,
  selectionStart: number,
  selectionEnd: number
): EditResult {
  const before = text.slice(0, selectionStart);
  const after = text.slice(selectionEnd);
  const needsNewline = before.length > 0 && !before.endsWith('\n');
  const prefix = needsNewline ? '\n' : '';

  const snippet = `${prefix}\n---\n\n`;
  const newText = before + snippet + after;
  const cursor = selectionStart + snippet.length;

  return {
    text: newText,
    selectionStart: cursor,
    selectionEnd: cursor,
  };
}

/**
 * 列表缩进
 */
export function indentLines(
  text: string,
  selectionStart: number,
  selectionEnd: number,
  indent = '  '
): EditResult {
  const lineStart = text.lastIndexOf('\n', selectionStart - 1) + 1;
  let lineEnd = text.indexOf('\n', selectionEnd);
  if (lineEnd === -1) lineEnd = text.length;

  const block = text.slice(lineStart, lineEnd);
  const lines = block.split('\n');
  const newBlock = lines.map((line) => indent + line).join('\n');
  const newText = text.slice(0, lineStart) + newBlock + text.slice(lineEnd);

  return {
    text: newText,
    selectionStart: selectionStart + indent.length,
    selectionEnd: selectionEnd + indent.length * lines.length,
  };
}

/**
 * 列表反缩进
 */
export function outdentLines(
  text: string,
  selectionStart: number,
  selectionEnd: number,
  indent = '  '
): EditResult {
  const lineStart = text.lastIndexOf('\n', selectionStart - 1) + 1;
  let lineEnd = text.indexOf('\n', selectionEnd);
  if (lineEnd === -1) lineEnd = text.length;

  const block = text.slice(lineStart, lineEnd);
  const lines = block.split('\n');
  let removedFirst = 0;
  let removedTotal = 0;

  const newLines = lines.map((line, i) => {
    const match = line.match(new RegExp(`^ {1,${indent.length}}`));
    const removed = match ? match[0].length : 0;
    if (i === 0) removedFirst = removed;
    removedTotal += removed;
    return line.slice(removed);
  });

  const newBlock = newLines.join('\n');
  const newText = text.slice(0, lineStart) + newBlock + text.slice(lineEnd);

  return {
    text: newText,
    selectionStart: Math.max(lineStart, selectionStart - removedFirst),
    selectionEnd: Math.max(lineStart, selectionEnd - removedTotal),
  };
}

/**
 * 统计文档信息
 */
export function getDocStats(text: string): DocStats {
  const chars = text.length;
  const lines = text ? text.split('\n').length : 0;

  // 统计单词：中文字符每个算一个词，英文按空格分
  const chineseChars = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length;
  const englishWords = text
    .replace(/[\u4e00-\u9fff\u3400-\u4dbf]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 0 && /[a-zA-Z0-9]/.test(w)).length;
  const words = chineseChars + englishWords;

  // 中文约 300 字/分钟，英文约 200 词/分钟
  const readingTime = Math.max(1, Math.ceil(chineseChars / 300 + englishWords / 200));

  return { chars, words, lines, readingTime: text.trim() ? readingTime : 0 };
}

/**
 * 提取文档大纲（标题列表）
 */
export function extractOutline(text: string): OutlineItem[] {
  const items: OutlineItem[] = [];
  const lines = text.split('\n');
  let inCodeBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trimStart().startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;

    const match = line.match(/^(#{1,6})\s+(.+)$/);
    if (match) {
      items.push({
        level: match[1].length,
        text: match[2].replace(/[#*_`~[\]]/g, '').trim(),
        line: i,
      });
    }
  }

  return items;
}

/**
 * 生成导出用 HTML 文档
 */
export function generateExportHtml(renderedBody: string, title = 'Markdown Export'): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<style>
  :root { --bg: #ffffff; --fg: #1a1a2e; --muted: #6b7280; --border: #e5e7eb; --code-bg: #f3f4f6; --quote-bg: #f9fafb; }
  @media (prefers-color-scheme: dark) {
    :root { --bg: #1a1a2e; --fg: #e5e7eb; --muted: #9ca3af; --border: #374151; --code-bg: #252540; --quote-bg: #20203a; }
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans SC", sans-serif;
    background: var(--bg); color: var(--fg);
    line-height: 1.75; padding: 3rem 1.5rem; max-width: 52rem; margin: 0 auto;
  }
  h1, h2, h3, h4, h5, h6 { margin: 1.5em 0 0.5em; font-weight: 700; line-height: 1.3; }
  h1 { font-size: 2em; border-bottom: 2px solid var(--border); padding-bottom: 0.3em; }
  h2 { font-size: 1.5em; border-bottom: 1px solid var(--border); padding-bottom: 0.25em; }
  h3 { font-size: 1.25em; }
  p { margin: 0.75em 0; }
  a { color: #3b82f6; text-decoration: none; }
  a:hover { text-decoration: underline; }
  code {
    font-family: "JetBrains Mono", "Fira Code", Consolas, monospace;
    background: var(--code-bg); padding: 0.15em 0.4em; border-radius: 4px; font-size: 0.875em;
  }
  pre { background: var(--code-bg); border: 1px solid var(--border); border-radius: 8px; padding: 1em; overflow-x: auto; margin: 1em 0; }
  pre code { background: none; padding: 0; }
  blockquote { border-left: 4px solid #3b82f6; background: var(--quote-bg); padding: 0.75em 1em; margin: 1em 0; border-radius: 0 8px 8px 0; }
  blockquote p { margin: 0.25em 0; }
  table { border-collapse: collapse; width: 100%; margin: 1em 0; }
  th, td { border: 1px solid var(--border); padding: 0.5em 0.75em; text-align: left; }
  th { background: var(--code-bg); font-weight: 600; }
  img { max-width: 100%; border-radius: 8px; }
  hr { border: none; border-top: 2px solid var(--border); margin: 2em 0; }
  ul, ol { padding-left: 1.5em; margin: 0.75em 0; }
  li { margin: 0.25em 0; }
  input[type="checkbox"] { margin-right: 0.5em; }
  del { color: var(--muted); }
  .mermaid-diagram { margin: 1em 0; overflow-x: auto; border: 1px solid var(--border); border-radius: 8px; background: var(--code-bg); }
  .mermaid-svg { display: flex; width: max-content; min-width: 100%; justify-content: center; padding: 1rem; }
  .mermaid-svg svg { max-width: none; height: auto; }
  .mermaid-source { border-top: 1px solid var(--border); padding: 0.5rem 0.75rem; color: var(--muted); font-size: 0.75rem; }
  .mermaid-source summary { cursor: pointer; }
  .mermaid-source pre { margin: 0.5rem 0 0; white-space: pre-wrap; }
  .mermaid-error { margin: 0.75rem; border: 1px solid #ef4444; border-radius: 6px; background: #fef2f2; color: #b91c1c; padding: 0.75rem; }
  @media (prefers-color-scheme: dark) { .mermaid-error { background: #450a0a; color: #fecaca; } }
  @page { size: A4 portrait; margin: 18mm; }
  @media print {
    :root { --bg: #ffffff; --fg: #111827; --muted: #4b5563; --border: #d1d5db; --code-bg: #f3f4f6; --quote-bg: #f9fafb; }
    body { max-width: none; padding: 0; background: #ffffff; color: #111827; font-size: 11pt; }
    a { color: inherit; text-decoration: underline; }
    pre, blockquote, table, img, .mermaid-diagram { break-inside: avoid; page-break-inside: avoid; }
    h1, h2, h3, h4, h5, h6 { break-after: avoid; page-break-after: avoid; }
    .mermaid-diagram { overflow: visible; border-color: #d1d5db; }
    .mermaid-svg { width: 100%; min-width: 0; }
    .mermaid-svg svg { max-width: 100%; height: auto; }
  }
</style>
</head>
<body>
${renderedBody}
</body>
</html>`;
}

/** 查找导出 HTML 中会触发联网加载的远程资源。 */
export function findRemoteResources(html: string): string[] {
  if (typeof DOMParser === 'undefined') return [];
  const document = new DOMParser().parseFromString(html, 'text/html');
  const resources = new Set<string>();
  const selectors = [
    '[src]',
    '[href]',
    '[data]',
    '[style]',
  ];
  const urlPattern = /(?:https?:)?\/\/[^\s"'<>)]*/gi;
  document.querySelectorAll<HTMLElement>(selectors.join(',')).forEach((element) => {
    for (const attribute of ['src', 'href', 'data', 'style']) {
      const value = element.getAttribute(attribute);
      if (!value) continue;
      for (const match of value.matchAll(urlPattern)) {
        const url = match[0].replace(/[),.;]+$/, '');
        if (/^https?:\/\//i.test(url)) resources.add(url);
      }
    }
  });
  return [...resources];
}

/** 从 Markdown 首个一级标题推导打印标题，找不到时使用默认标题。 */
export function getMarkdownExportTitle(source: string, fallback = 'Markdown Export'): string {
  const heading = source.match(/^\s*#\s+(.+?)\s*#*\s*$/m)?.[1]?.trim();
  return heading || fallback;
}

/**
 * HTML 转义
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * 保存文本文件
 */
export async function downloadFile(content: string, filename: string, mimeType = 'text/plain'): Promise<string | null> {
  const { saveBytesWithFeedback } = await import('@/lib/file-save');
  return saveBytesWithFeedback(filename, new Blob([content], { type: `${mimeType};charset=utf-8` }), '文本文件', [filename.split('.').pop() || 'txt']);
}

// ==================== 模板 ====================

export interface MarkdownTemplate {
  id: string;
  name: string;
  content: string;
}

export const MARKDOWN_TEMPLATES: MarkdownTemplate[] = [
  {
    id: 'readme',
    name: 'README',
    content: `# 项目名称

> 一句话描述你的项目。

## 功能特性

- ✨ 特性一
- 🚀 特性二
- 🔒 特性三

## 快速开始

### 安装

\`\`\`bash
npm install your-package
\`\`\`

### 使用

\`\`\`javascript
import { something } from 'your-package';

something();
\`\`\`

## API 文档

| 方法 | 描述 | 参数 |
|------|------|------|
| \`init()\` | 初始化 | \`options: Options\` |
| \`run()\` | 运行 | \`input: string\` |

## 贡献指南

1. Fork 本仓库
2. 创建特性分支 (\`git checkout -b feature/amazing\`)
3. 提交更改 (\`git commit -m 'feat: add amazing feature'\`)
4. 推送分支 (\`git push origin feature/amazing\`)
5. 创建 Pull Request

## 许可证

[MIT](LICENSE) © Your Name
`,
  },
  {
    id: 'blog',
    name: '博客文章',
    content: `# 文章标题

> 发布日期：2024-01-01 | 作者：你的名字

## 引言

在这里写一段引人入胜的开头，概述文章将要讨论的内容...

## 第一部分

正文内容。可以使用 **粗体** 和 *斜体* 来强调重点。

### 小节标题

- 要点一
- 要点二
- 要点三

## 第二部分

引用他人的观点：

> 这是一段引用文字，用来引述他人的观点或文献内容。

### 代码示例

\`\`\`typescript
function greet(name: string): string {
  return \`Hello, \${name}!\`;
}
\`\`\`

## 总结

总结文章的核心观点，给读者留下思考空间。

---

*感谢阅读！如有问题欢迎留言讨论。*
`,
  },
  {
    id: 'meeting',
    name: '会议纪要',
    content: `# 会议纪要

| 项目 | 内容 |
|------|------|
| 日期 | 2024-01-01 |
| 时间 | 14:00 - 15:00 |
| 地点 | 会议室 A / 线上 |
| 主持人 | 张三 |
| 记录人 | 李四 |

## 参会人员

- 张三（产品）
- 李四（开发）
- 王五（设计）

## 议题与讨论

### 1. 议题一：XXX 方案评审

**讨论内容：**
- 观点 A：...
- 观点 B：...

**结论：** 采用方案 A

### 2. 议题二：排期确认

**讨论内容：**
- 前端预计 5 个工作日
- 后端预计 3 个工作日

**结论：** 下周三前完成联调

## 待办事项

- [ ] 张三：输出需求文档终稿（截止：周五）
- [ ] 李四：完成接口开发（截止：下周二）
- [ ] 王五：提供设计切图（截止：周四）

## 下次会议

- 时间：下周三 14:00
- 议题：联调进度同步
`,
  },
];
