import type { Edge, Node, Viewport } from '@xyflow/react';

export type FlowShape = 'rectangle' | 'rounded' | 'circle' | 'diamond' | 'text';

export interface FlowNodeData extends Record<string, unknown> {
  label: string;
  shape: FlowShape;
  fill: string;
  stroke: string;
  textColor: string;
  width: number;
  height: number;
  originalType?: string;
}

export type FlowNode = Node<FlowNodeData, string>;
export type FlowEdge = Edge<{ label?: string }>;

export interface FlowDocument {
  schemaVersion: 1;
  nodes: FlowNode[];
  edges: FlowEdge[];
  viewport: Viewport;
}

export interface FlowNodeDefinition {
  type: string;
  label: string;
  shape: FlowShape;
  createDefaultData: () => FlowNodeData;
}
