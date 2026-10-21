import { describe, expect, it } from 'vitest';
import { flowToDrawioXml, parseDrawioXml, parseMermaidFlowchart } from '@/tools/graphic/flow-board/interop';

describe('draw.io flowchart interchange', () => {
  it('round-trips the editable nodes and edges through basic XML', () => {
    const source = flowToDrawioXml(parseMermaidFlowchart('flowchart LR\nA[开始] --> B[结束]'));
    const restored = parseDrawioXml(source);
    expect(restored.nodes).toHaveLength(2);
    expect(restored.edges).toHaveLength(1);
    expect(restored.nodes[0].data.label).toBe('开始');
  });
});
