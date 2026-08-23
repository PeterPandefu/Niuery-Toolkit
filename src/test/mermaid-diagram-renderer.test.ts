import { describe, expect, it, vi } from 'vitest';
import { renderMermaidDiagram } from '@/tools/diagram/mermaid-renderer';

const initialize = vi.fn();
const render = vi.fn();

vi.mock('mermaid', () => ({
  default: { initialize, render },
}));

describe('Mermaid diagram renderer', () => {
  it('renders locally with the requested color scheme and strict SVG security', async () => {
    render.mockResolvedValueOnce({ svg: '<svg>local mermaid</svg>' });

    await expect(renderMermaidDiagram('flowchart LR\nA --> B', { scheme: 'dark' })).resolves.toEqual({
      svg: '<svg>local mermaid</svg>',
    });

    expect(initialize).toHaveBeenCalledWith(expect.objectContaining({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'dark',
    }));
    expect(render).toHaveBeenCalledWith(expect.stringMatching(/^niuery-mermaid-editor-/), 'flowchart LR\nA --> B');
  });
});
