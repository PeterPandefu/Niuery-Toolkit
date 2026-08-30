import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render as renderComponent, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { generateExportHtml } from '@/lib/markdown-utils';

const initialize = vi.fn();
const render = vi.fn();

vi.mock('mermaid', () => ({
  default: { initialize, render },
}));

import { Preview, renderMarkdown } from '@/components/markdown/Preview';

describe('Mermaid Markdown 渲染', () => {
  beforeEach(() => {
    initialize.mockReset();
    render.mockReset();
  });

  it('将 Mermaid 围栏代码块转换为严格安全的内联 SVG', async () => {
    render.mockResolvedValue({ svg: '<svg data-mermaid="flowchart"><rect class="background" fill="#202938"></rect></svg>' });

    const html = await renderMarkdown('```mermaid\nflowchart TD\n  A --> B\n```', { scheme: 'dark', locale: 'zh-CN' });

    expect(initialize).toHaveBeenCalledWith(expect.objectContaining({
      securityLevel: 'strict',
      startOnLoad: false,
      suppressErrorRendering: true,
      theme: 'dark',
      themeVariables: expect.objectContaining({ background: expect.any(String), textColor: expect.any(String) }),
    }));
    expect(render).toHaveBeenCalledWith(expect.stringMatching(/^niuery-mermaid-\d+$/), 'flowchart TD\n  A --> B\n', expect.any(HTMLElement));
    expect(html).toContain('<svg data-mermaid="flowchart"');
    expect(html).toContain('<pre class="mermaid-block"><code>');
    expect(html).not.toContain('<pre><code class="language-mermaid">');
    expect(html).toContain('Mermaid 图表');
    expect(html).not.toContain('mermaid-source');
    expect(html).not.toContain('data-mermaid-source');
    const exported = generateExportHtml(html);
    expect(exported).toContain('<svg data-mermaid="flowchart"');
    expect(exported).toContain('pre.mermaid-block');
    expect(exported).toContain('background: transparent');
  });

  it('在 Mermaid 解析失败时显示英文错误卡片', async () => {
    render.mockRejectedValue(new Error('Parse error on line 2'));

    const html = await renderMarkdown('```mermaid\nnot valid\n```', { locale: 'en' });

    expect(html).toContain('Mermaid diagram syntax error');
    expect(html).toContain('Parse error on line 2');
    expect(html).not.toContain('mermaid-source');
  });

  it('合法 Mermaid 图表会成功渲染', async () => {
    render.mockImplementation((_id: string, _source: string, container?: HTMLElement) => {
      if (!container?.isConnected) return Promise.reject(new Error("Cannot read properties of null (reading 'getAttribute')"));
      return Promise.resolve({ svg: '<svg data-mermaid="flowchart"></svg>' });
    });

    const html = await renderMarkdown('```mermaid\nflowchart TD\n  A --> B\n```');

    expect(html).toContain('<svg data-mermaid="flowchart"');
    expect(html).not.toContain('fill="#202938"');
    expect(html).not.toContain('Mermaid diagram syntax error');
  });

  it('Mermaid 解析失败时不会把全局错误图表注入页面', async () => {
    render.mockImplementation((_id: string, _source: string, container?: HTMLElement) => {
      const target = container ?? document.body;
      target.insertAdjacentHTML('beforeend', '<svg class="mermaid-global-error"><text>Syntax error in text</text></svg>');
      return Promise.reject(new Error('Parse error on line 2'));
    });

    const html = await renderMarkdown('```mermaid\nnot valid\n```\n\n```mermaid\nalso not valid\n```', { locale: 'en' });

    expect(document.body.querySelectorAll('.mermaid-global-error')).toHaveLength(0);
    expect((html.match(/class="mermaid-error"/g) ?? [])).toHaveLength(2);
  });

  it('预览副作用重复执行时不会重新渲染已经完成的图表', async () => {
    render.mockResolvedValue({ svg: '<svg data-mermaid="flowchart"></svg>' });
    const source = '```mermaid\nflowchart TD\n  A --> B\n```';
    const { container } = renderComponent(createElement(Preview, { source }));

    await waitFor(() => expect(container.querySelector('.mermaid-svg')).toBeInTheDocument());
    const firstRenderCount = render.mock.calls.length;

    const diagram = container.querySelector<HTMLElement>('.mermaid-diagram');
    expect(diagram?.dataset.mermaidSource).toBe('flowchart TD\n  A --> B\n');
    expect(diagram?.getAttribute('aria-busy')).toBeNull();

    // 同一个节点再次进入渲染流程时，已完成的图表不应再次调用 Mermaid。
    const { renderMermaidInElement } = await import('@/components/markdown/Preview');
    await renderMermaidInElement(container);

    expect(render.mock.calls.length).toBe(firstRenderCount);
    expect(container.querySelector('.mermaid-svg')).toBeInTheDocument();
  });

  it('预览父组件重渲染后仍会恢复已生成的图表', async () => {
    render.mockResolvedValue({ svg: '<svg data-mermaid="flowchart"></svg>' });
    const source = '```mermaid\nflowchart TD\n  A --> B\n```';
    const view = renderComponent(createElement(Preview, { source }));

    await waitFor(() => expect(view.container.querySelector('.mermaid-svg')).toBeInTheDocument());
    const firstRenderCount = render.mock.calls.length;
    view.rerender(createElement(Preview, { source }));

    expect(view.container.querySelector('.mermaid-svg')).toBeInTheDocument();
    expect(render.mock.calls.length).toBe(firstRenderCount);
  });
});
