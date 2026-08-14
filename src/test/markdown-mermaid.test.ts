import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generateExportHtml } from '@/lib/markdown-utils';

const initialize = vi.fn();
const render = vi.fn();

vi.mock('mermaid', () => ({
  default: { initialize, render },
}));

import { renderMarkdown } from '@/components/markdown/Preview';

describe('Mermaid Markdown 渲染', () => {
  beforeEach(() => {
    initialize.mockReset();
    render.mockReset();
  });

  it('将 Mermaid 围栏代码块转换为严格安全的内联 SVG', async () => {
    render.mockResolvedValue({ svg: '<svg data-mermaid="flowchart"></svg>' });

    const html = await renderMarkdown('```mermaid\nflowchart TD\n  A --> B\n```', { scheme: 'dark', locale: 'zh-CN' });

    expect(initialize).toHaveBeenCalledWith(expect.objectContaining({ securityLevel: 'strict', startOnLoad: false, theme: 'dark' }));
    expect(render).toHaveBeenCalledWith(expect.stringMatching(/^niuery-mermaid-\d+$/), 'flowchart TD\n  A --> B\n');
    expect(html).toContain('<svg data-mermaid="flowchart"></svg>');
    expect(html).toContain('Mermaid 图表');
    expect(html).toContain('显示 Mermaid 源码');
    expect(html).not.toContain('data-mermaid-source');
    expect(generateExportHtml(html)).toContain('<svg data-mermaid="flowchart"></svg>');
  });

  it('在 Mermaid 解析失败时保留源码并显示英文错误卡片', async () => {
    render.mockRejectedValue(new Error('Parse error on line 2'));

    const html = await renderMarkdown('```mermaid\nnot valid\n```', { locale: 'en' });

    expect(html).toContain('Mermaid diagram syntax error');
    expect(html).toContain('Parse error on line 2');
    expect(html).toContain('not valid');
  });
});
