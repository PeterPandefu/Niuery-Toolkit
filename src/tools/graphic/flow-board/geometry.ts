import type { FlowEdge, FlowNode, FlowNodeData, FlowPoint } from './types';

export function absolutePosition(node: FlowNode, nodes: FlowNode[]): FlowPoint {
  let position = { ...node.position };
  let parentId = node.parentId;
  const visited = new Set([node.id]);
  while (parentId && !visited.has(parentId)) {
    visited.add(parentId);
    const parent = nodes.find((item) => item.id === parentId);
    if (!parent) break;
    position = { x: position.x + parent.position.x, y: position.y + parent.position.y };
    parentId = parent.parentId;
  }
  return position;
}

export function getNodeShape(data: FlowNodeData): { paths: string[]; fill: boolean } {
  const w = data.width; const h = data.height;
  if (data.containerType) return { paths: [`M 0 0 H ${w} V ${h} H 0 Z`, `M 0 32 H ${w}`], fill: true };
  if (data.semanticType === 'document') return { paths: [`M 0 0 H ${w} V ${h - 12} Q ${w * .75} ${h - 28} ${w / 2} ${h - 12} Q ${w * .25} ${h + 4} 0 ${h - 12} Z`], fill: true };
  if (data.semanticType === 'database') return { paths: [`M 0 14 C 0 -4 ${w} -4 ${w} 14 V ${h - 14} C ${w} ${h + 4} 0 ${h + 4} 0 ${h - 14} Z`, `M 0 14 C 0 32 ${w} 32 ${w} 14`], fill: true };
  if (data.semanticType === 'predefined') return { paths: [`M 0 0 H ${w} V ${h} H 0 Z`, `M 14 0 V ${h} M ${w - 14} 0 V ${h}`], fill: true };
  if (data.shape === 'diamond') return { paths: [`M ${w / 2} 0 L ${w} ${h / 2} L ${w / 2} ${h} L 0 ${h / 2} Z`], fill: true };
  if (data.shape === 'parallelogram') return { paths: [`M 18 0 H ${w} L ${w - 18} ${h} H 0 Z`], fill: true };
  if (data.shape === 'circle') return { paths: [`M 0 ${h / 2} A ${w / 2} ${h / 2} 0 1 0 ${w} ${h / 2} A ${w / 2} ${h / 2} 0 1 0 0 ${h / 2} Z`], fill: true };
  if (data.shape === 'text') return { paths: [], fill: false };
  const r = data.shape === 'rounded' ? Math.min(h / 2, w / 2) : 2;
  return { paths: [`M ${r} 0 H ${w - r} Q ${w} 0 ${w} ${r} V ${h - r} Q ${w} ${h} ${w - r} ${h} H ${r} Q 0 ${h} 0 ${h - r} V ${r} Q 0 0 ${r} 0 Z`], fill: true };
}

type Side = 'left' | 'right' | 'top' | 'bottom';
interface Rect { left: number; top: number; right: number; bottom: number }
const directions: Record<Side, FlowPoint> = { left: { x: -1, y: 0 }, right: { x: 1, y: 0 }, top: { x: 0, y: -1 }, bottom: { x: 0, y: 1 } };
function side(value: string | null | undefined, fallback: Side): Side { return value && value in directions ? value as Side : fallback; }
function port(node: FlowNode, nodes: FlowNode[], direction: Side) {
  const p = absolutePosition(node, nodes); const w = node.data.width; const h = node.data.height;
  return { x: p.x + (direction === 'left' ? 0 : direction === 'right' ? w : w / 2), y: p.y + (direction === 'top' ? 0 : direction === 'bottom' ? h : h / 2) };
}
function add(p: FlowPoint, d: FlowPoint, amount: number) { return { x: p.x + d.x * amount, y: p.y + d.y * amount }; }
function isClear(a: FlowPoint, b: FlowPoint, obstacles: Rect[]) {
  return !obstacles.some((r) => a.x === b.x
    ? a.x > r.left && a.x < r.right && Math.max(a.y, b.y) > r.top && Math.min(a.y, b.y) < r.bottom
    : a.y > r.top && a.y < r.bottom && Math.max(a.x, b.x) > r.left && Math.min(a.x, b.x) < r.right);
}
function simplify(points: FlowPoint[]) {
  const result: FlowPoint[] = [];
  for (const p of points) {
    const last = result[result.length - 1];
    if (last?.x === p.x && last.y === p.y) continue;
    const before = result[result.length - 2];
    if (before && ((before.x === last.x && last.x === p.x) || (before.y === last.y && last.y === p.y))) result.pop();
    result.push(p);
  }
  return result;
}

/** Manhattan visibility grid; obstacle boundaries are routing channels. */
function orthogonalRoute(a: FlowPoint, b: FlowPoint, obstacles: Rect[]): FlowPoint[] {
  const xs = [...new Set([a.x, b.x, ...obstacles.flatMap((r) => [r.left, r.right])])].sort((x, y) => x - y);
  const ys = [...new Set([a.y, b.y, ...obstacles.flatMap((r) => [r.top, r.bottom])])].sort((x, y) => x - y);
  const key = (p: FlowPoint) => `${p.x},${p.y}`;
  const start = key(a); const end = key(b);
  const distance = new Map<string, number>([[start, 0]]);
  const previous = new Map<string, FlowPoint>();
  const queue: FlowPoint[] = [a]; const visited = new Set<string>();
  while (queue.length) {
    queue.sort((p, q) => (distance.get(key(p)) ?? Infinity) - (distance.get(key(q)) ?? Infinity));
    const p = queue.shift()!; const id = key(p);
    if (visited.has(id)) continue;
    visited.add(id);
    if (id === end) {
      const result = [b]; let current = end;
      while (current !== start) { const prev = previous.get(current); if (!prev) break; result.unshift(prev); current = key(prev); }
      return simplify(result);
    }
    const xi = xs.indexOf(p.x); const yi = ys.indexOf(p.y);
    const neighbors = [{ x: xs[xi - 1], y: p.y }, { x: xs[xi + 1], y: p.y }, { x: p.x, y: ys[yi - 1] }, { x: p.x, y: ys[yi + 1] }];
    for (const next of neighbors) {
      if (next.x == null || next.y == null || !isClear(p, next, obstacles)) continue;
      const nextId = key(next);
      const cost = distance.get(id)! + Math.abs(p.x - next.x) + Math.abs(p.y - next.y);
      if (cost >= (distance.get(nextId) ?? Infinity)) continue;
      distance.set(nextId, cost); previous.set(nextId, p); queue.push(next);
    }
  }
  return [a, { x: b.x, y: a.y }, b];
}

export function getEdgeGeometry(nodes: FlowNode[], edge: FlowEdge): { path: string; points: FlowPoint[]; label: FlowPoint } {
  const source = nodes.find((n) => n.id === edge.source); const target = nodes.find((n) => n.id === edge.target);
  if (!source || !target) return { path: '', points: [], label: { x: 0, y: 0 } };
  const sourceSide = side(edge.sourceHandle, 'right'); const targetSide = side(edge.targetHandle, 'left');
  const a = port(source, nodes, sourceSide); const b = port(target, nodes, targetSide);
  const routing = edge.data?.routing ?? 'orthogonal';
  const waypoints = edge.data?.waypoints ?? [];
  let points: FlowPoint[];
  if (routing === 'straight') points = [a, b];
  else if (routing === 'curve') {
    const controlA = add(a, directions[sourceSide], 80); const controlB = add(b, directions[targetSide], 80);
    return { path: `M ${a.x} ${a.y} C ${controlA.x} ${controlA.y} ${controlB.x} ${controlB.y} ${b.x} ${b.y}`, points: [a, b], label: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
  } else if (routing === 'polyline') points = [a, ...waypoints, b];
  else {
    const obstacles = nodes.filter((n) => !n.data.containerType && !n.hidden).map((n) => {
      const p = absolutePosition(n, nodes); return { left: p.x - 12, right: p.x + n.data.width + 12, top: p.y - 12, bottom: p.y + n.data.height + 12 };
    });
    const exits = [add(a, directions[sourceSide], 24), ...waypoints, add(b, directions[targetSide], 24)];
    points = simplify([a, ...exits.flatMap((p, i) => i === exits.length - 1 ? [p] : orthogonalRoute(p, exits[i + 1], obstacles)), b]);
  }
  const middle = Math.floor((points.length - 1) / 2); const p = points[middle]; const q = points[middle + 1] ?? p;
  return { points, path: roundedPath(points, routing === 'smoothstep' ? 10 : 0), label: { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 } };
}

function roundedPath(points: FlowPoint[], radius: number) {
  if (!points.length) return '';
  let path = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    const p = points[i]; const prev = points[i - 1]; const next = points[i + 1];
    if (!radius || !next) { path += ` L ${p.x} ${p.y}`; continue; }
    const beforeLength = Math.hypot(p.x - prev.x, p.y - prev.y); const afterLength = Math.hypot(next.x - p.x, next.y - p.y);
    const r = Math.min(radius, beforeLength / 2, afterLength / 2);
    const before = { x: p.x + (prev.x - p.x) * r / beforeLength, y: p.y + (prev.y - p.y) * r / beforeLength };
    const after = { x: p.x + (next.x - p.x) * r / afterLength, y: p.y + (next.y - p.y) * r / afterLength };
    path += ` L ${before.x} ${before.y} Q ${p.x} ${p.y} ${after.x} ${after.y}`;
  }
  return path;
}
