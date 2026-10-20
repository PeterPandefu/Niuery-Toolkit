import type { Edge, Node, Viewport } from '@xyflow/react';
import { getFlowNodeDefinition } from './node-registry';
import type { FlowDocument, FlowEdge, FlowNode, FlowNodeData } from './types';

export const FLOW_SCHEMA_VERSION = 1 as const;

export function createEmptyFlowDocument(): FlowDocument {
  return { schemaVersion: FLOW_SCHEMA_VERSION, nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } };
}

export function createDefaultFlowDocument(): FlowDocument {
  const first = createNode('rounded', 80, 130);
  const second = createNode('diamond', 360, 118);
  const third = createNode('rectangle', 650, 130);
  return {
    schemaVersion: FLOW_SCHEMA_VERSION,
    nodes: [first, second, third],
    edges: [
      { id: 'edge-start-decision', source: first.id, target: second.id, type: 'smoothstep', markerEnd: { type: 'arrowclosed' } },
      { id: 'edge-decision-finish', source: second.id, target: third.id, type: 'smoothstep', markerEnd: { type: 'arrowclosed' } },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

export function createNode(type: string, x: number, y: number, label?: string): FlowNode {
  const definition = getFlowNodeDefinition(type);
  const data = definition.createDefaultData();
  if (label) data.label = label;
  return { id: `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, type: definition.type, position: { x, y }, data };
}

function normalizeNode(node: Partial<FlowNode> & { id: string }): FlowNode {
  const originalType = typeof node.type === 'string' ? node.type : undefined;
  const definition = getFlowNodeDefinition(originalType ?? 'rectangle');
  const defaults = definition.createDefaultData();
  const input = (node.data ?? {}) as Partial<FlowNodeData>;
  return {
    ...node,
    id: node.id,
    type: definition.type,
    position: node.position ?? { x: 0, y: 0 },
    data: { ...defaults, ...input, shape: input.shape ?? definition.shape, ...(originalType && originalType !== definition.type ? { originalType } : {}) },
  } as FlowNode;
}

export function parseFlowDocument(source: string): FlowDocument {
  const parsed: unknown = JSON.parse(source);
  if (!parsed || typeof parsed !== 'object') throw new Error('图表文件必须是 JSON 对象');
  const value = parsed as Partial<FlowDocument>;
  if (!Array.isArray(value.nodes) || !Array.isArray(value.edges)) throw new Error('图表文件缺少 nodes 或 edges');
  const nodes = value.nodes.filter((node): node is FlowNode & { id: string } => Boolean(node && typeof node === 'object' && typeof (node as FlowNode).id === 'string')).map(normalizeNode);
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = value.edges.filter((edge): edge is FlowEdge => Boolean(edge && typeof edge === 'object' && typeof (edge as FlowEdge).id === 'string' && nodeIds.has((edge as FlowEdge).source) && nodeIds.has((edge as FlowEdge).target))).map((edge) => ({ ...edge, markerEnd: edge.markerEnd ?? { type: 'arrowclosed' } }));
  const viewport: Viewport = value.viewport && typeof value.viewport === 'object'
    ? { x: Number(value.viewport.x) || 0, y: Number(value.viewport.y) || 0, zoom: Math.max(0.1, Math.min(4, Number(value.viewport.zoom) || 1)) }
    : { x: 0, y: 0, zoom: 1 };
  return { schemaVersion: FLOW_SCHEMA_VERSION, nodes, edges, viewport };
}

export function serializeFlowDocument(document: FlowDocument) {
  return JSON.stringify({ ...document, schemaVersion: FLOW_SCHEMA_VERSION }, null, 2);
}

export function cloneFlowState(nodes: Node[], edges: Edge[], viewport: Viewport): FlowDocument {
  return JSON.parse(JSON.stringify({ schemaVersion: FLOW_SCHEMA_VERSION, nodes, edges, viewport })) as FlowDocument;
}
