import { describe, expect, it } from 'vitest';
import { createDefaultFlowDocument, parseFlowDocument, serializeFlowDocument, syncActivePage } from '@/tools/graphic/flow-board/document';

describe('flow board document', () => {
  it('serializes and restores the default graph', () => {
    const source = serializeFlowDocument(createDefaultFlowDocument());
    const restored = parseFlowDocument(source);
    expect(restored.schemaVersion).toBe(2);
    expect(restored.pages).toHaveLength(1);
    expect(restored.activePageId).toBe('page-1');
    expect(restored.nodes).toHaveLength(3);
    expect(restored.edges).toHaveLength(2);
    expect(restored.viewport.zoom).toBe(1);
    expect(restored.nodes[0].data.semanticType).toBe('terminator');
    expect(restored.nodes[1].data.semanticType).toBe('decision');
    expect(restored.edges[0].data?.routing).toBe('orthogonal');
  });

  it('drops edges that point to missing nodes and normalizes unknown nodes', () => {
    const restored = parseFlowDocument(JSON.stringify({
      schemaVersion: 1,
      nodes: [{ id: 'custom', type: 'future-shape', position: { x: 12, y: 18 }, data: { label: '保留数据' } }],
      edges: [{ id: 'bad', source: 'custom', target: 'missing' }],
    }));
    expect(restored.schemaVersion).toBe(2);
    expect(restored.nodes[0].type).toBe('process');
    expect(restored.nodes[0].data.label).toBe('保留数据');
    expect(restored.edges).toHaveLength(0);
  });

  it('migrates legacy shapes to standard flowchart semantics', () => {
    const restored = parseFlowDocument(JSON.stringify({
      schemaVersion: 1,
      nodes: [
        { id: 'start', type: 'rounded', position: { x: 0, y: 0 }, data: { label: '开始' } },
        { id: 'step', type: 'rectangle', position: { x: 200, y: 0 }, data: { label: '处理' } },
        { id: 'choice', type: 'diamond', position: { x: 400, y: 0 }, data: { label: '判断' } },
        { id: 'text', type: 'text', position: { x: 600, y: 0 }, data: { label: '说明' } },
      ],
      edges: [],
    }));
    expect(restored.nodes.map((node) => node.data.semanticType)).toEqual(['terminator', 'process', 'decision', 'note']);
  });

  it('preserves multiple pages and layer metadata', () => {
    const restored = parseFlowDocument(JSON.stringify({
      schemaVersion: 2,
      activePageId: 'page-2',
      pages: [
        { id: 'page-1', name: '流程', nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 }, layers: [{ id: 'base', name: '基础', visible: true, locked: false }] },
        { id: 'page-2', name: '异常分支', nodes: [], edges: [], viewport: { x: 2, y: 3, zoom: 1.2 }, layers: [{ id: 'base', name: '基础', visible: false, locked: true }] },
      ],
      nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 },
    }));
    expect(restored.pages[1].name).toBe('异常分支');
    expect(restored.pages[1].layers[0]).toMatchObject({ visible: false, locked: true });
    expect(restored.nodes).toEqual([]);
    expect(restored.viewport.zoom).toBe(1.2);
  });

  it('keeps the active page mirror synchronized after a current-page edit', () => {
    const document = createDefaultFlowDocument();
    const nodes = document.nodes.map((node) => node.id === document.nodes[0].id ? { ...node, data: { ...node.data, label: '已修改' } } : node);
    const synced = syncActivePage({ ...document, nodes });
    expect(synced.pages[0].nodes[0].data.label).toBe('已修改');
    expect(synced.nodes[0].data.label).toBe('已修改');
  });
  it('rejects future schemas without silently downgrading them', () => {
    expect(() => parseFlowDocument('{"schemaVersion":99,"nodes":[],"edges":[]}')).toThrow('版本');
  });
  it('rejects invalid geometry and duplicate IDs rather than dropping user data', () => {
    expect(() => parseFlowDocument(JSON.stringify({ schemaVersion: 2, nodes: [{ id: 'bad', position: { x: 'invalid', y: 0 } }], edges: [] }))).toThrow('坐标');
    expect(() => parseFlowDocument(JSON.stringify({ schemaVersion: 1, nodes: [{ id: 'a', position: { x: 0, y: 0 } }, { id: 'a', position: { x: 10, y: 10 } }], edges: [] }))).toThrow('重复');
  });
  it('rejects cyclic parents and preserves valid parent-relative geometry', () => {
    const a = { id: 'a', type: 'process', parentId: 'b', position: { x: 1, y: 2 }, data: {} };
    const b = { id: 'b', type: 'process', parentId: 'a', position: { x: 3, y: 4 }, data: {} };
    expect(() => parseFlowDocument(JSON.stringify({ nodes: [a, b], edges: [] }))).toThrow('循环');
  });
  it('validates multi-page viewports and supplies a usable default page', () => {
    const empty = parseFlowDocument('{"schemaVersion":2,"pages":[],"activePageId":"missing"}');
    expect(empty.pages).toHaveLength(1);
    expect(empty.pages[0].id).toBe(empty.activePageId);
  });
  it('serializes the current node mirror and cleans runtime selection state', () => {
    const doc = createDefaultFlowDocument();
    const node = { ...doc.nodes[0], selected: true, data: { ...doc.nodes[0].data, label: '新标签' } };
    const json = JSON.parse(serializeFlowDocument({ ...doc, nodes: [node], edges: [] }));
    expect(json.pages[0].nodes[0].data.label).toBe('新标签');
    expect(json.pages[0].nodes[0].selected).toBeUndefined();
  });
});
