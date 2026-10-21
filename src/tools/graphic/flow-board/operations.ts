import { graphlib, layout } from '@dagrejs/dagre';
import { createNode } from './document';
import { absolutePosition } from './geometry';
import type { FlowEdge, FlowLayer, FlowNode, FlowPage } from './types';

type Alignment = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';
type Distribution = 'horizontal' | 'vertical';

function width(node: FlowNode) { return node.measured?.width ?? node.width ?? node.data.width; }
function height(node: FlowNode) { return node.measured?.height ?? node.height ?? node.data.height; }
function selected(nodes: FlowNode[], ids: string[]) { return nodes.filter((node) => ids.includes(node.id)); }

export function alignNodes(nodes: FlowNode[], ids: string[], alignment: Alignment): FlowNode[] {
  const targets = selected(nodes, ids);
  if (targets.length < 2) return nodes;
  const value = alignment === 'left' ? Math.min(...targets.map((node) => node.position.x))
    : alignment === 'right' ? Math.max(...targets.map((node) => node.position.x + width(node)))
      : alignment === 'top' ? Math.min(...targets.map((node) => node.position.y))
        : alignment === 'bottom' ? Math.max(...targets.map((node) => node.position.y + height(node)))
          : alignment === 'center' ? (Math.min(...targets.map((node) => node.position.x)) + Math.max(...targets.map((node) => node.position.x + width(node)))) / 2
            : (Math.min(...targets.map((node) => node.position.y)) + Math.max(...targets.map((node) => node.position.y + height(node)))) / 2;
  return nodes.map((node) => {
    if (!ids.includes(node.id)) return node;
    if (alignment === 'left') return { ...node, position: { ...node.position, x: value } };
    if (alignment === 'right') return { ...node, position: { ...node.position, x: value - width(node) } };
    if (alignment === 'top') return { ...node, position: { ...node.position, y: value } };
    if (alignment === 'bottom') return { ...node, position: { ...node.position, y: value - height(node) } };
    if (alignment === 'center') return { ...node, position: { ...node.position, x: value - width(node) / 2 } };
    return { ...node, position: { ...node.position, y: value - height(node) / 2 } };
  });
}

export function distributeNodes(nodes: FlowNode[], ids: string[], axis: Distribution): FlowNode[] {
  const targets = selected(nodes, ids).sort((a, b) => axis === 'horizontal' ? a.position.x - b.position.x : a.position.y - b.position.y);
  if (targets.length < 3) return nodes;
  const first = targets[0];
  const last = targets[targets.length - 1];
  const firstPosition = axis === 'horizontal' ? first.position.x : first.position.y;
  const lastPosition = axis === 'horizontal' ? last.position.x : last.position.y;
  const step = (lastPosition - firstPosition) / (targets.length - 1);
  const positions = new Map(targets.map((node, index) => [node.id, firstPosition + index * step]));
  return nodes.map((node) => {
    const position = positions.get(node.id);
    if (position == null || node.id === first.id || node.id === last.id) return node;
    return axis === 'horizontal' ? { ...node, position: { ...node.position, x: position } } : { ...node, position: { ...node.position, y: position } };
  });
}

export function removeNodes(nodes: FlowNode[], edges: FlowEdge[], ids: string[]) {
  const idSet = new Set(ids);
  return { nodes: nodes.filter((node) => !idSet.has(node.id)), edges: edges.filter((edge) => !idSet.has(edge.source) && !idSet.has(edge.target)) };
}

export function reorderNodes(nodes: FlowNode[], ids: string[], direction: 'front' | 'back') {
  const idSet = new Set(ids);
  const selectedNodes = nodes.filter((node) => idSet.has(node.id));
  const remaining = nodes.filter((node) => !idSet.has(node.id));
  return (direction === 'front' ? [...remaining, ...selectedNodes] : [...selectedNodes, ...remaining]).map((node, index) => ({ ...node, zIndex: index }));
}

export function updateEdges(edges: FlowEdge[], ids: string[], patch: NonNullable<FlowEdge['data']>) {
  const idSet = new Set(ids);
  return edges.map((edge) => idSet.has(edge.id) ? { ...edge, data: { ...edge.data, ...patch }, type: 'flow-edge' } : edge);
}

export function addPage(pages: FlowPage[], id: string, name: string): FlowPage[] {
  return [...pages, { id, name, nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 }, layers: [{ id: `${id}-layer`, name: '默认图层', visible: true, locked: false }] }];
}

export function renamePage(pages: FlowPage[], id: string, name: string): FlowPage[] {
  return pages.map((page) => page.id === id ? { ...page, name } : page);
}

export function setLayerState(page: FlowPage, layerId: string, patch: Partial<Pick<FlowLayer, 'visible' | 'locked' | 'name'>>): FlowPage {
  return { ...page, layers: page.layers.map((layer) => layer.id === layerId ? { ...layer, ...patch } : layer) };
}

export function createContainerNode(nodes: FlowNode[], ids: string[], label: string, containerType: 'container' | 'swimlane' = 'container'): FlowNode {
  const targets = nodes.filter((node) => ids.includes(node.id));
  const minX = targets.length ? Math.min(...targets.map((node) => node.position.x)) - 24 : 0;
  const minY = targets.length ? Math.min(...targets.map((node) => node.position.y)) - 48 : 0;
  const maxX = targets.length ? Math.max(...targets.map((node) => node.position.x + node.data.width)) + 24 : 300;
  const maxY = targets.length ? Math.max(...targets.map((node) => node.position.y + node.data.height)) + 24 : 200;
  const container = createNode('process', minX, minY, label);
  return { ...container, id: `${containerType}-${Date.now()}`, data: { ...container.data, label, containerType, laneTitle: containerType === 'swimlane' ? label : undefined, width: Math.max(120, maxX - minX), height: Math.max(100, maxY - minY), fill: containerType === 'swimlane' ? '#f6f3ff' : '#eef4ff', stroke: containerType === 'swimlane' ? '#ad96df' : '#8bb3f0', layerId: 'layer-default' } };
}

export function autoLayout(nodes: FlowNode[], edges: FlowEdge[], direction: 'horizontal' | 'vertical' = 'horizontal'): FlowNode[] {
  const graph = new graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  graph.setGraph({ rankdir: direction === 'horizontal' ? 'LR' : 'TB', nodesep: 48, ranksep: 96, marginx: 24, marginy: 24 });
  nodes.forEach((node) => graph.setNode(node.id, { width: node.data.width, height: node.data.height }));
  edges.forEach((edge) => graph.setEdge(edge.source, edge.target));
  layout(graph);
  return nodes.map((node) => {
    const positioned = graph.node(node.id) as { x: number; y: number } | undefined;
    if (!positioned) return node;
    return { ...node, position: { x: positioned.x - node.data.width / 2, y: positioned.y - node.data.height / 2 } };
  });
}

export function groupNodes(nodes: FlowNode[], ids: string[], label: string, kind: 'container' | 'swimlane'): FlowNode[] {
  const roots = nodes.filter((node) => ids.includes(node.id) && (!node.parentId || !ids.includes(node.parentId)));
  const positioned = roots.map((node) => ({ ...node, position: absolutePosition(node, nodes) }));
  const container = createContainerNode(positioned, positioned.map((node) => node.id), label, kind);
  container.zIndex = Math.min(0, ...nodes.map((node) => node.zIndex ?? 0)) - 1;
  container.selected = true;
  return [container, ...nodes.map((node) => {
    const target = positioned.find((item) => item.id === node.id);
    return target ? { ...node, selected: false, parentId: container.id, extent: 'parent' as const, position: { x: target.position.x - container.position.x, y: target.position.y - container.position.y } } : { ...node, selected: false };
  })];
}

export function ungroupNodes(nodes: FlowNode[], ids: string[]): FlowNode[] {
  const groups = new Set(nodes.filter((node) => ids.includes(node.id) && node.data.containerType).map((node) => node.id));
  return nodes.filter((node) => !groups.has(node.id)).map((node) => {
    if (!node.parentId || !groups.has(node.parentId)) return node;
    const result = { ...node, position: absolutePosition(node, nodes) };
    delete result.parentId; delete result.extent;
    return result;
  });
}

export function getPageNodes(page: FlowPage): FlowNode[] {
  const hiddenIds = new Set<string>();
  return page.nodes.map((node) => {
    const layer = page.layers.find((item) => item.id === (node.data.layerId ?? page.layers[0]?.id));
    const hidden = node.hidden || layer?.visible === false || Boolean(node.parentId && hiddenIds.has(node.parentId));
    if (hidden) hiddenIds.add(node.id);
    return { ...node, hidden, draggable: layer?.locked ? false : node.draggable, connectable: layer?.locked ? false : node.connectable, selectable: layer?.locked ? false : node.selectable };
  });
}

export function duplicateSelection(nodes: FlowNode[], edges: FlowEdge[], ids: string[]) {
  const included = new Set(ids);
  for (const node of nodes) if (node.parentId && included.has(node.parentId)) included.add(node.id);
  const idMap = new Map(nodes.filter((node) => included.has(node.id)).map((node) => [node.id, `${node.type}-${crypto.randomUUID()}`]));
  const copies = nodes.filter((node) => included.has(node.id)).map((node) => ({
    ...node, id: idMap.get(node.id)!, selected: true, parentId: node.parentId ? idMap.get(node.parentId) : undefined,
    extent: node.parentId && idMap.has(node.parentId) ? node.extent : undefined,
    position: node.parentId && idMap.has(node.parentId) ? { ...node.position } : { x: absolutePosition(node, nodes).x + 32, y: absolutePosition(node, nodes).y + 32 }, data: { ...node.data },
  }));
  const copiedEdges = edges.filter((edge) => included.has(edge.source) && included.has(edge.target)).map((edge) => ({ ...edge, id: `edge-${crypto.randomUUID()}`, source: idMap.get(edge.source)!, target: idMap.get(edge.target)!, data: { ...edge.data, waypoints: edge.data?.waypoints?.map((p) => ({ x: p.x + 32, y: p.y + 32 })) } }));
  return { nodes: [...nodes.map((node) => ({ ...node, selected: false })), ...copies], edges: [...edges, ...copiedEdges] };
}
