import { describe, it, expect, vi } from 'vitest';
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
  getDocStats,
  extractOutline,
  generateExportHtml,
  findRemoteResources,
  getMarkdownExportTitle,
  generateExportSvg,
  printHtmlInCurrentWindow,
  escapeHtml,
  MARKDOWN_TEMPLATES,
} from '@/lib/markdown-utils';

describe('wrapSelection', () => {
  it('应包裹选中文本', () => {
    const result = wrapSelection('hello world', 0, 5, '**');
    expect(result.text).toBe('**hello** world');
    expect(result.selectionStart).toBe(2);
    expect(result.selectionEnd).toBe(7);
  });

  it('无选中时应插入占位文本', () => {
    const result = wrapSelection('abc', 3, 3, '**');
    expect(result.text).toBe('abc**粗体文本**');
    expect(result.selectionStart).toBe(5);
    expect(result.selectionEnd).toBe(9);
  });

  it('已包裹的选中文本应取消包裹', () => {
    const result = wrapSelection('**hello** world', 0, 9, '**');
    expect(result.text).toBe('hello world');
    expect(result.selectionStart).toBe(0);
    expect(result.selectionEnd).toBe(5);
  });

  it('选区在标记内部时应取消包裹', () => {
    const result = wrapSelection('**hello** world', 2, 7, '**');
    expect(result.text).toBe('hello world');
    expect(result.selectionStart).toBe(0);
    expect(result.selectionEnd).toBe(5);
  });

  it('应支持斜体标记', () => {
    const result = wrapSelection('text', 0, 4, '*');
    expect(result.text).toBe('*text*');
  });

  it('应支持删除线标记', () => {
    const result = wrapSelection('text', 0, 4, '~~');
    expect(result.text).toBe('~~text~~');
  });

  it('应支持行内代码标记', () => {
    const result = wrapSelection('code', 0, 4, '`');
    expect(result.text).toBe('`code`');
  });
});

describe('toggleLinePrefix', () => {
  it('应为单行添加引用前缀', () => {
    const result = toggleLinePrefix('hello', 0, 5, '> ');
    expect(result.text).toBe('> hello');
  });

  it('应为多行添加引用前缀', () => {
    const result = toggleLinePrefix('line1\nline2', 0, 11, '> ');
    expect(result.text).toBe('> line1\n> line2');
  });

  it('已引用的行应取消引用', () => {
    const result = toggleLinePrefix('> hello', 0, 7, '> ');
    expect(result.text).toBe('hello');
  });

  it('应添加标题前缀并替换已有标题', () => {
    const result = toggleLinePrefix('## old title', 0, 12, '# ');
    expect(result.text).toBe('# old title');
  });

  it('应添加无序列表前缀', () => {
    const result = toggleLinePrefix('item', 0, 4, '- ');
    expect(result.text).toBe('- item');
  });

  it('已有列表前缀应替换为新前缀', () => {
    const result = toggleLinePrefix('* item', 0, 6, '- ');
    expect(result.text).toBe('- item');
  });

  it('应添加任务列表前缀', () => {
    const result = toggleLinePrefix('task', 0, 4, '- [ ] ');
    expect(result.text).toBe('- [ ] task');
  });
});

describe('insertCodeBlock', () => {
  it('应插入空代码块', () => {
    const result = insertCodeBlock('', 0, 0);
    expect(result.text).toBe('```\n// 代码\n```\n');
  });

  it('应包裹选中代码', () => {
    const result = insertCodeBlock('const a = 1;', 0, 12, 'javascript');
    expect(result.text).toBe('```javascript\nconst a = 1;\n```\n');
  });

  it('文本中间插入时应添加换行', () => {
    const result = insertCodeBlock('before', 6, 6);
    expect(result.text).toBe('before\n```\n// 代码\n```\n');
  });
});

describe('insertMermaidTemplate', () => {
  it('应插入流程图 Mermaid 围栏代码块并选中图表源码', () => {
    const result = insertMermaidTemplate('', 0, 0, 'flowchart');

    expect(result.text).toBe('```mermaid\nflowchart TD\n  Start([开始]) --> End([结束])\n```\n');
    expect(result.selectionStart).toBe('```mermaid\n'.length);
    expect(result.selectionEnd).toBe(result.text.indexOf('\n```'));
  });

  it('应以模板替换当前选区', () => {
    const result = insertMermaidTemplate('前缀旧内容后缀', 2, 5, 'state');

    expect(result.text).toContain('前缀\n```mermaid\nstateDiagram-v2');
    expect(result.text).toContain('\n```\n后缀');
    expect(result.text).not.toContain('旧内容');
  });
});

describe('insertLink', () => {
  it('应插入链接模板并选中 URL', () => {
    const result = insertLink('', 0, 0);
    expect(result.text).toBe('[链接文本](https://)');
    expect(result.text.slice(result.selectionStart, result.selectionEnd)).toBe('https://');
  });

  it('选中文本应作为链接文本', () => {
    const result = insertLink('click here', 0, 10);
    expect(result.text).toBe('[click here](https://)');
  });
});

describe('insertImage', () => {
  it('应插入图片模板', () => {
    const result = insertImage('', 0, 0);
    expect(result.text).toBe('![图片描述](https://)');
    expect(result.text.slice(result.selectionStart, result.selectionEnd)).toBe('https://');
  });
});

describe('insertTable', () => {
  it('应插入表格模板', () => {
    const result = insertTable('', 0, 0);
    expect(result.text).toContain('| 列 1 | 列 2 | 列 3 |');
    expect(result.text).toContain('|------|------|------|');
  });
});

describe('insertHorizontalRule', () => {
  it('应插入水平线', () => {
    const result = insertHorizontalRule('', 0, 0);
    expect(result.text).toBe('\n---\n\n');
  });

  it('文本后插入应有换行分隔', () => {
    const result = insertHorizontalRule('text', 4, 4);
    expect(result.text).toBe('text\n\n---\n\n');
  });
});

describe('indentLines', () => {
  it('应缩进所有选中行', () => {
    const result = indentLines('a\nb', 0, 3);
    expect(result.text).toBe('  a\n  b');
  });
});

describe('outdentLines', () => {
  it('应反缩进所有选中行', () => {
    const result = outdentLines('  a\n  b', 0, 7);
    expect(result.text).toBe('a\nb');
  });

  it('只有部分缩进时只移除存在的空格', () => {
    const result = outdentLines(' a\n   b', 0, 7);
    expect(result.text).toBe('a\n b');
  });
});

describe('getDocStats', () => {
  it('应正确统计空文档', () => {
    const stats = getDocStats('');
    expect(stats.chars).toBe(0);
    expect(stats.words).toBe(0);
    expect(stats.lines).toBe(0);
    expect(stats.readingTime).toBe(0);
  });

  it('应正确统计英文', () => {
    const stats = getDocStats('hello world foo');
    expect(stats.words).toBe(3);
    expect(stats.lines).toBe(1);
    expect(stats.chars).toBe(15);
  });

  it('应正确统计中文', () => {
    const stats = getDocStats('你好世界');
    expect(stats.words).toBe(4);
    expect(stats.chars).toBe(4);
  });

  it('应正确统计混合文本', () => {
    const stats = getDocStats('你好 hello\n世界 world');
    expect(stats.words).toBe(6);
    expect(stats.lines).toBe(2);
  });

  it('应计算阅读时间', () => {
    const stats = getDocStats('word '.repeat(400));
    expect(stats.readingTime).toBe(2);
  });
});

describe('extractOutline', () => {
  it('应提取标题大纲', () => {
    const outline = extractOutline('# Title\n## Sub\n### Deep');
    expect(outline).toEqual([
      { level: 1, text: 'Title', line: 0 },
      { level: 2, text: 'Sub', line: 1 },
      { level: 3, text: 'Deep', line: 2 },
    ]);
  });

  it('应忽略代码块中的标题', () => {
    const outline = extractOutline('# Real\n```\n# Not a heading\n```\n## Also real');
    expect(outline).toHaveLength(2);
    expect(outline[1].text).toBe('Also real');
  });

  it('应清理标题中的格式标记', () => {
    const outline = extractOutline('# **Bold** title');
    expect(outline[0].text).toBe('Bold title');
  });

  it('空文档应返回空数组', () => {
    expect(extractOutline('')).toEqual([]);
  });
});

describe('generateExportHtml', () => {
  it('应生成完整 HTML 文档', () => {
    const html = generateExportHtml('<h1>Hello</h1>');
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<h1>Hello</h1>');
    expect(html).toContain('charset="UTF-8"');
    expect(html).toContain('@page { size: A4 portrait; margin: 18mm; }');
  });

  it('应转义标题中的特殊字符', () => {
    const html = generateExportHtml('', 'A <B> & "C"');
    expect(html).toContain('A &lt;B&gt; &amp; &quot;C&quot;');
  });
});

describe('PDF 导出辅助函数', () => {
  it('应识别会联网加载的远程资源并去重', () => {
    const resources = findRemoteResources(
      '<img src="https://example.com/a.png"><img src="https://example.com/a.png"><div style="background:url(https://cdn.example.com/bg.png)"></div>'
    );
    expect(resources).toEqual(['https://example.com/a.png', 'https://cdn.example.com/bg.png']);
  });

  it('应允许本地和 data 资源', () => {
    expect(findRemoteResources('<img src="./a.png"><img src="data:image/png;base64,abc">')).toEqual([]);
  });

  it('应从首个一级标题推导打印标题', () => {
    expect(getMarkdownExportTitle('## 子标题\n# 我的文档 #')).toBe('我的文档');
    expect(getMarkdownExportTitle('没有标题')).toBe('Markdown Export');
    expect(getMarkdownExportTitle('没有标题', '未命名')).toBe('未命名');
  });

  it('应生成包含正文的独立 SVG 快照', () => {
    const svg = generateExportSvg('<h1>文档</h1>', '标题');
    expect(svg).toContain('<foreignObject');
    expect(svg).toContain('<h1>文档</h1>');
    expect(svg).toContain('aria-label="标题"');
  });

  it('应在当前窗口打印正文并在清理后恢复页面', () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    const cleanup = printHtmlInCurrentWindow('<h1>打印正文</h1>');
    expect(print).toHaveBeenCalledOnce();
    expect(document.querySelector('#markdown-pdf-print-root')?.textContent).toContain('打印正文');
    expect(document.body.dataset.markdownPdfPrinting).toBe('true');
    cleanup();
    expect(document.querySelector('#markdown-pdf-print-root')).toBeNull();
    expect(document.body.dataset.markdownPdfPrinting).toBeUndefined();
    print.mockRestore();
  });
});

describe('escapeHtml', () => {
  it('应转义 HTML 特殊字符', () => {
    expect(escapeHtml('<script>"a" & \'b\'</script>')).toBe(
      '&lt;script&gt;&quot;a&quot; &amp; \'b\'&lt;/script&gt;'
    );
  });
});

describe('MARKDOWN_TEMPLATES', () => {
  it('应包含至少 3 个模板', () => {
    expect(MARKDOWN_TEMPLATES.length).toBeGreaterThanOrEqual(3);
  });

  it('每个模板应有 id、name 和 content', () => {
    for (const tpl of MARKDOWN_TEMPLATES) {
      expect(tpl.id).toBeTruthy();
      expect(tpl.name).toBeTruthy();
      expect(tpl.content.length).toBeGreaterThan(50);
    }
  });
});
