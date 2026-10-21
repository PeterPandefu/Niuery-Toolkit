import type { Edge, Node, Viewport } from '@xyflow/react';
import { getFlowNodeDefinition } from './node-registry';
import type { FlowDocument, FlowEdge, FlowLayer, FlowNode, FlowNodeData, FlowPage } from './types';

export const FLOW_SCHEMA_VERSION = 2 as const;

const DEFAULT_LAYER: FlowLayer = { id: 'layer-default', name: '默认图层', visible: true, locked: false };

function createPage(id: string, name: string, nodes: FlowNode[] = [], edges: FlowEdge[] = [], viewport = { x: 0, y: 0, zoom: 1 }): FlowPage {
  return { id, name, nodes, edges, viewport, layers: [{ ...DEFAULT_LAYER }] };
}

function mirrorPage(page: FlowPage): FlowDocument {
  return { schemaVersion: FLOW_SCHEMA_VERSION, pages: [page], activePageId: page.id, nodes: page.nodes, edges: page.edges, viewport: page.viewport };
}

function assertPosition(position: unknown) {
  if (!position || typeof position !== 'object' || !Number.isFinite(Number((position as { x?: unknown }).x)) || !Number.isFinite(Number((position as { y?: unknown }).y))) throw new Error('节点坐标无效');
}
function assertPage(page: FlowPage) {
  const ids = new Set<string>();
  for (const node of page.nodes) {
    if (ids.has(node.id)) throw new Error('页面节点标识重复');
    ids.add(node.id); assertPosition(node.position);
  }
  for (const node of page.nodes) {
    const seen = new Set<string>(); let parent = node.parentId;
    while (parent) {
      if (seen.has(parent)) throw new Error('节点父级存在循环');
      seen.add(parent); parent = page.nodes.find((item) => item.id === parent)?.parentId;
    }
  }
  const edgeIds = new Set<string>();
  for (const edge of page.edges) {
    if (edgeIds.has(edge.id)) throw new Error('页面连接标识重复');
    edgeIds.add(edge.id);
    if (!ids.has(edge.source) || !ids.has(edge.target)) throw new Error('连接引用了不存在的节点');
  }
  if (!Number.isFinite(page.viewport.x) || !Number.isFinite(page.viewport.y) || !Number.isFinite(page.viewport.zoom)) throw new Error('页面视口无效');
}

function stripRuntime<T extends FlowNode | FlowEdge>(value: T): T {
  const clone = structuredClone(value) as T & Record<string, unknown>;
  delete clone.selected; delete clone.hidden; delete clone.dragging; delete clone.resizing;
  return clone;
}

export function syncActivePage(document: FlowDocument): FlowDocument {
  const activeId = document.activePageId || document.pages[0]?.id || 'page-1';
  const pages = (document.pages?.length ? document.pages : [createPage(activeId, '第 1 页')]).map((page) => page.id === activeId
    ? { ...page, nodes: document.nodes, edges: document.edges, viewport: document.viewport }
    : page);
  const active = pages.find((page) => page.id === activeId) ?? pages[0];
  return { ...document, schemaVersion: FLOW_SCHEMA_VERSION, pages, activePageId: active.id, nodes: active.nodes, edges: active.edges, viewport: active.viewport };
}

export function createEmptyFlowDocument(): FlowDocument {
  return mirrorPage(createPage('page-1', '第 1 页'));
}

export function createDefaultFlowDocument(): FlowDocument {
  const first = createNode('rounded', 80, 130);
  const second = createNode('diamond', 360, 118);
  const third = createNode('rectangle', 650, 130);
  return mirrorPage(createPage('page-1', '第 1 页', [first, second, third], [
      { id: 'edge-start-decision', source: first.id, target: second.id, type: 'smoothstep', markerEnd: { type: 'arrowclosed' }, data: { routing: 'orthogonal', endMarker: 'closed-arrow' } },
      { id: 'edge-decision-finish', source: second.id, target: third.id, type: 'smoothstep', markerEnd: { type: 'arrowclosed' }, data: { routing: 'orthogonal', endMarker: 'closed-arrow' } },
    ]));
}

export function createNode(type: string, x: number, y: number, label?: string): FlowNode {
  const definition = getFlowNodeDefinition(type);
  const data = definition.createDefaultData();
  if (label) data.label = label;
  return { id: `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, type: definition.type, position: { x, y }, data };
}

function normalizeNode(node: Partial<FlowNode> & { id: string }): FlowNode {
  const originalType = typeof node.type === 'string' ? node.type : undefined;
  const definition = getFlowNodeDefinition(originalType ?? 'process');
  const defaults = definition.createDefaultData();
  const input = (node.data ?? {}) as Partial<FlowNodeData>;
  return {
    ...node,
    id: node.id,
    type: definition.type,
    position: node.position ?? { x: 0, y: 0 },
    data: { ...defaults, ...input, shape: input.shape ?? definition.shape, semanticType: input.semanticType ?? definition.semanticType, ...(originalType && originalType !== definition.type ? { originalType } : {}) },
  } as FlowNode;
}

export function parseFlowDocument(source: string): FlowDocument {
  const parsed: unknown = JSON.parse(source);
  if (!parsed || typeof parsed !== 'object') throw new Error('图表文件必须是 JSON 对象');
  const value = parsed as Partial<FlowDocument> & { schemaVersion?: number };
  if (typeof value.schemaVersion === 'number' && value.schemaVersion > FLOW_SCHEMA_VERSION) throw new Error('流程图数据版本过新，无法打开');
  if (Array.isArray(value.pages) && typeof value.activePageId === 'string') {
    const rawPages = value.pages.length ? value.pages : [createPage('page-1', '第 1 页')];
    const pages = rawPages.map((page) => normalizePage(page)); pages.forEach(assertPage);
    const active = pages.find((page) => page.id === value.activePageId) ?? pages[0] ?? createPage('page-1', '第 1 页');
    return { schemaVersion: FLOW_SCHEMA_VERSION, pages, activePageId: active.id, nodes: active.nodes, edges: active.edges, viewport: active.viewport };
  }
  if (!Array.isArray(value.nodes) || !Array.isArray(value.edges)) throw new Error('图表文件缺少 nodes 或 edges');
  const rawNodes = value.nodes.filter((node): node is FlowNode & { id: string } => Boolean(node && typeof node === 'object' && typeof (node as FlowNode).id === 'string'));
  const nodeIds = new Set<string>();
  for (const node of rawNodes) { if (nodeIds.has(node.id)) throw new Error('节点标识重复'); nodeIds.add(node.id); assertPosition(node.position); }
  const nodes = rawNodes.map(normalizeNode);
  const edges = value.edges.filter((edge): edge is FlowEdge => Boolean(edge && typeof edge === 'object' && typeof (edge as FlowEdge).id === 'string' && nodeIds.has((edge as FlowEdge).source) && nodeIds.has((edge as FlowEdge).target))).map((edge) => ({ ...edge, type: edge.type ?? 'smoothstep', markerEnd: edge.markerEnd ?? { type: 'arrowclosed' }, data: { routing: 'orthogonal' as const, endMarker: 'closed-arrow' as const, ...edge.data } }));
  const viewport: Viewport = value.viewport && typeof value.viewport === 'object'
    ? { x: Number(value.viewport.x) || 0, y: Number(value.viewport.y) || 0, zoom: Math.max(0.1, Math.min(4, Number(value.viewport.zoom) || 1)) }
    : { x: 0, y: 0, zoom: 1 };
  const page = createPage('page-1', '第 1 页', nodes, edges, viewport);
  assertPage(page);
  return mirrorPage(page);
}

function normalizePage(page: FlowPage): FlowPage {
  const nodes = Array.isArray(page.nodes) ? page.nodes.filter((node): node is FlowNode & { id: string } => Boolean(node && typeof node === 'object' && typeof (node as FlowNode).id === 'string')).map(normalizeNode) : [];
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = Array.isArray(page.edges) ? page.edges.filter((edge): edge is FlowEdge => Boolean(edge && typeof edge === 'object' && typeof (edge as FlowEdge).id === 'string' && nodeIds.has((edge as FlowEdge).source) && nodeIds.has((edge as FlowEdge).target))).map((edge) => ({ ...edge, type: edge.type ?? 'smoothstep', markerEnd: edge.markerEnd ?? { type: 'arrowclosed' }, data: { routing: 'orthogonal' as const, endMarker: 'closed-arrow' as const, ...edge.data } })) : [];
  const normalized = { id: typeof page.id === 'string' ? page.id : `page-${Date.now()}`, name: typeof page.name === 'string' ? page.name : '未命名页面', nodes, edges, viewport: page.viewport ?? { x: 0, y: 0, zoom: 1 }, layers: Array.isArray(page.layers) && page.layers.length ? page.layers : [{ ...DEFAULT_LAYER }] };
  assertPage(normalized); return normalized;
}

export function serializeFlowDocument(document: FlowDocument) {
  const synced = syncActivePage(document);
  const pages = synced.pages.map((page) => ({ ...page, nodes: page.nodes.map((node) => stripRuntime(node)), edges: page.edges.map((edge) => stripRuntime(edge)) }));
  return JSON.stringify({ ...synced, schemaVersion: FLOW_SCHEMA_VERSION, pages, nodes: pages.find((page) => page.id === synced.activePageId)?.nodes ?? [], edges: pages.find((page) => page.id === synced.activePageId)?.edges ?? [] }, null, 2);
}

export function cloneFlowState(nodes: Node[], edges: Edge[], viewport: Viewport): FlowDocument {
  const page = createPage('page-1', '第 1 页', nodes as FlowNode[], edges as FlowEdge[], viewport);
  return mirrorPage(page);
}
