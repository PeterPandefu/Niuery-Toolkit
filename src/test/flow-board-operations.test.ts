import { describe, expect, it } from 'vitest';
import { createNode } from '@/tools/graphic/flow-board/document';
import { alignNodes, distributeNodes, removeNodes, reorderNodes, updateEdges } from '@/tools/graphic/flow-board/operations';
import type { FlowEdge, FlowNode } from '@/tools/graphic/flow-board/types';

function node(id: string, x: number, y: number): FlowNode {
  return { ...createNode('process', x, y, id), id };
}

describe('flow board operations', () => {
  it('aligns selected nodes to a shared edge or center', () => {
    const nodes = [node('a', 10, 20), node('b', 100, 80), node('c', 230, 140)];
    expect(alignNodes(nodes, ['a', 'b', 'c'], 'top').map((item) => item.position.y)).toEqual([20, 20, 20]);
    expect(alignNodes(nodes, ['a', 'b', 'c'], 'center').map((item) => item.position.x)).toEqual([120, 120, 120]);
  });

  it('distributes selected nodes evenly on an axis', () => {
    const nodes = [node('a', 0, 0), node('b', 80, 30), node('c', 260, 60)];
    const result = distributeNodes(nodes, ['a', 'b', 'c'], 'horizontal');
    expect(result.map((item) => item.position.x)).toEqual([0, 130, 260]);
  });

  it('removes selected nodes and their connected edges', () => {
    const nodes = [node('a', 0, 0), node('b', 100, 0), node('c', 200, 0)];
    const edges: FlowEdge[] = [
      { id: 'ab', source: 'a', target: 'b' },
      { id: 'bc', source: 'b', target: 'c' },
    ];
    const result = removeNodes(nodes, edges, ['b']);
    expect(result.nodes.map((item) => item.id)).toEqual(['a', 'c']);
    expect(result.edges).toEqual([]);
  });

  it('reorders nodes to implement bring-to-front and send-to-back', () => {
    const nodes = [node('a', 0, 0), node('b', 100, 0), node('c', 200, 0)];
    expect(reorderNodes(nodes, ['a'], 'front').map((item) => item.id)).toEqual(['b', 'c', 'a']);
    expect(reorderNodes(nodes, ['c'], 'back').map((item) => item.id)).toEqual(['c', 'a', 'b']);
    expect(reorderNodes(nodes, ['a'], 'front')[2].zIndex).toBeGreaterThan(reorderNodes(nodes, ['a'], 'front')[0].zIndex!);
  });

  it('updates edge presentation without changing its endpoints', () => {
    const edges: FlowEdge[] = [{ id: 'e', source: 'a', target: 'b' }];
    const result = updateEdges(edges, ['e'], { label: '是', routing: 'orthogonal', dashed: true });
    expect(result[0]).toMatchObject({ source: 'a', target: 'b', data: { label: '是', routing: 'orthogonal', dashed: true } });
    expect(updateEdges(edges, ['e'], { routing: 'straight' })[0].type).toBe('flow-edge');
  });
});
