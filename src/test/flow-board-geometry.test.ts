import { describe, expect, it } from 'vitest';
import { createNode } from '@/tools/graphic/flow-board/document';
import { getNodeShape, getEdgeGeometry, absolutePosition } from '@/tools/graphic/flow-board/geometry';
import type { FlowEdge } from '@/tools/graphic/flow-board/types';

describe('flowchart geometry shared by canvas and export', () => {
  it('draws the database cylinder and document wave independently of the generic shape', () => {
    expect(getNodeShape(createNode('database', 0, 0).data).paths).toHaveLength(2);
    expect(getNodeShape(createNode('document', 0, 0).data).paths[0]).toContain('Q');
    expect(getNodeShape(createNode('predefined', 0, 0).data).paths).toHaveLength(2);
  });
  it('places diamond vertices on its actual rectangular bounds without rotating the handles', () => {
    const result = getNodeShape(createNode('decision', 0, 0).data);
    expect(result.paths[0]).toContain('70 0');
    expect(result.paths[0]).toContain('140 48');
  });
  it('resolves nested positions for connector and export coordinates', () => {
    const parent = { ...createNode('process', 100, 200), id: 'parent' };
    const child = { ...createNode('process', 20, 30), id: 'child', parentId: 'parent' };
    expect(absolutePosition(child, [parent, child])).toEqual({ x: 120, y: 230 });
  });
  it('distinguishes straight, curved and orthogonal paths and preserves explicit ports', () => {
    const a = { ...createNode('process', 0, 0), id: 'a' };
    const b = { ...createNode('process', 300, 180), id: 'b' };
    const edge: FlowEdge = { id: 'e', source: 'a', target: 'b', sourceHandle: 'bottom', targetHandle: 'top', data: { routing: 'straight' } };
    const straight = getEdgeGeometry([a, b], edge);
    expect(straight.points[0]).toEqual({ x: 75, y: 72 });
    expect(straight.points[straight.points.length - 1]).toEqual({ x: 375, y: 180 });
    expect(straight.path).not.toContain('C');
    expect(getEdgeGeometry([a, b], { ...edge, data: { routing: 'curve' } }).path).toContain('C');
    const orthogonal = getEdgeGeometry([a, b], { ...edge, data: { routing: 'orthogonal' } });
    expect(orthogonal.points.every((p, i, points) => i === 0 || p.x === points[i - 1].x || p.y === points[i - 1].y)).toBe(true);
  });
  it('routes an orthogonal connection around a blocking shape', () => {
    const nodes = [
      { ...createNode('process', 0, 0), id: 'a' },
      { ...createNode('process', 400, 0), id: 'b' },
      { ...createNode('process', 200, -20), id: 'block' },
    ];
    const edge: FlowEdge = { id: 'e', source: 'a', target: 'b', sourceHandle: 'right', targetHandle: 'left', data: { routing: 'orthogonal' } };
    const result = getEdgeGeometry(nodes, edge);
    expect(result.points.some((point) => point.y < -20 || point.y > 52)).toBe(true);
  });
  it('keeps manual waypoints and uses them for polyline routing', () => {
    const nodes = [{ ...createNode('process', 0, 0), id: 'a' }, { ...createNode('process', 400, 0), id: 'b' }];
    const result = getEdgeGeometry(nodes, { id: 'e', source: 'a', target: 'b', data: { routing: 'polyline', waypoints: [{ x: 250, y: -80 }] } });
    expect(result.points).toContainEqual({ x: 250, y: -80 });
    expect(result.path).toContain('250 -80');
  });
});
