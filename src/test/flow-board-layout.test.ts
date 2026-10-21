import { describe, expect, it } from 'vitest';
import { createNode } from '@/tools/graphic/flow-board/document';
import { addPage, autoLayout, createContainerNode, renamePage, setLayerState, groupNodes, ungroupNodes, getPageNodes, duplicateSelection } from '@/tools/graphic/flow-board/operations';
import { absolutePosition } from '@/tools/graphic/flow-board/geometry';
import type { FlowPage } from '@/tools/graphic/flow-board/types';

function page(): FlowPage {
  const a = createNode('process', 0, 0, 'A');
  const b = createNode('process', 0, 0, 'B');
  return { id: 'page-1', name: '第 1 页', nodes: [a, b], edges: [{ id: 'ab', source: a.id, target: b.id }], viewport: { x: 0, y: 0, zoom: 1 }, layers: [{ id: 'base', name: '默认图层', visible: true, locked: false }] };
}

describe('flow board pages, layers and layout', () => {
  it('adds and renames pages without mutating the original page list', () => {
    const first = page();
    const pages = addPage([first], 'page-2', '异常分支');
    expect(pages).toHaveLength(2);
    expect(renamePage(pages, 'page-2', '错误路径')[1].name).toBe('错误路径');
    expect(pages[0].name).toBe('第 1 页');
  });

  it('changes layer visibility and lock state immutably', () => {
    const updated = setLayerState(page(), 'base', { visible: false, locked: true });
    expect(updated.layers[0]).toMatchObject({ visible: false, locked: true });
  });

  it('creates a container node around selected nodes', () => {
    const current = page();
    const container = createContainerNode(current.nodes, ['missing'], '泳道', 'swimlane');
    expect(container.data.containerType).toBe('swimlane');
    expect(container.data.label).toBe('泳道');
  });

  it('lays out connected nodes in graph order', () => {
    const current = page();
    const laidOut = autoLayout(current.nodes, current.edges, 'horizontal');
    expect(laidOut[0].position.x).toBeLessThan(laidOut[1].position.x);
  });
  it('groups nodes using parent-relative positions, then restores absolute positions when ungrouped', () => {
    const current = page();
    current.nodes[0].position = { x: 120, y: 80 };
    current.nodes[1].position = { x: 320, y: 160 };
    const grouped = groupNodes(current.nodes, current.nodes.map((node) => node.id), '审批组', 'container');
    const group = grouped.find((node) => node.data.containerType)!;
    const child = grouped.find((node) => node.id === current.nodes[0].id)!;
    expect(child.parentId).toBe(group.id);
    expect(grouped.indexOf(group)).toBeLessThan(grouped.indexOf(child));
    expect(absolutePosition(child, grouped)).toEqual({ x: 120, y: 80 });
    const restored = ungroupNodes(grouped, [group.id]);
    expect(restored.find((node) => node.id === child.id)?.position).toEqual({ x: 120, y: 80 });
    expect(restored.every((node) => !node.parentId)).toBe(true);
  });
  it('makes hidden or locked layers affect actual canvas nodes', () => {
    const current = page();
    current.nodes.forEach((node) => { node.data.layerId = 'base'; });
    const projected = getPageNodes(setLayerState(current, 'base', { visible: false, locked: true }));
    expect(projected.every((node) => node.hidden && node.draggable === false && node.connectable === false)).toBe(true);
    expect(current.nodes[0].hidden).toBeUndefined();
  });
  it('copies selected nodes with internal edges and new endpoint IDs', () => {
    const current = page();
    const copied = duplicateSelection(current.nodes, current.edges, current.nodes.map((node) => node.id));
    expect(copied.nodes).toHaveLength(4);
    expect(copied.edges).toHaveLength(2);
    const edge = copied.edges[1];
    expect(edge.source).not.toBe(current.edges[0].source);
    expect(copied.nodes.some((node) => node.id === edge.source)).toBe(true);
    expect(copied.nodes.some((node) => node.id === edge.target)).toBe(true);
  });
});
