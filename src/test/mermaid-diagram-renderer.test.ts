import { describe, expect, it, vi } from 'vitest';
import { renderMermaidDiagram } from '@/tools/diagram/mermaid-renderer';

const initialize = vi.fn();
const render = vi.fn();
const registerExternalDiagrams = vi.fn().mockResolvedValue(undefined);

vi.mock('mermaid', () => ({
  default: { initialize, render, registerExternalDiagrams },
}));

vi.mock('@mermaid-js/mermaid-zenuml', () => ({
  default: { id: 'zenuml' },
}));

describe('Mermaid diagram renderer', () => {
  it('renders locally with the requested color scheme and strict SVG security', async () => {
    render.mockResolvedValueOnce({ svg: '<svg>local mermaid</svg>' });

    await expect(renderMermaidDiagram('flowchart LR\nA --> B', { scheme: 'dark' })).resolves.toEqual({
      svg: '<svg>local mermaid</svg>',
    });

    expect(registerExternalDiagrams).toHaveBeenCalledWith([{ id: 'zenuml' }]);
    expect(initialize).toHaveBeenCalledWith(expect.objectContaining({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'dark',
    }));
    expect(render).toHaveBeenCalledWith(expect.stringMatching(/^niuery-mermaid-editor-/), 'flowchart LR\nA --> B');
  });

  it('passes ZenUML source through after registering the mermaid-zenuml plugin', async () => {
    const source = `zenuml
    title "下单"
    @Actor User
    User->Web: 提交订单
    Web.createOrder() {
      OrderService.create() {
        Inventory.lock()
        result = Pay.charge()
        return result
      }
    }`;
    render.mockResolvedValueOnce({ svg: '<svg>zenuml</svg>' });

    await expect(renderMermaidDiagram(source, { scheme: 'light' })).resolves.toEqual({
      svg: '<svg>zenuml</svg>',
    });
    expect(registerExternalDiagrams).toHaveBeenCalledWith([{ id: 'zenuml' }]);
    expect(render).toHaveBeenCalledWith(expect.stringMatching(/^niuery-mermaid-editor-/), source);
  });

  it('serializes HTML labels as XML-safe SVG before creating an image Blob', async () => {
    render.mockResolvedValueOnce({
      svg: '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div>接收结果<br>样本&nbsp;D</div></foreignObject></svg>',
    });

    const result = await renderMermaidDiagram('flowchart TD\nA --> B', { scheme: 'light' });

    expect(result.svg).toContain('<br />');
    expect(result.svg).not.toContain('<br>');
    expect(result.svg).not.toContain('&nbsp;');
  });
});
