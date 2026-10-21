import type { Edge, Node, Viewport } from '@xyflow/react';

export type FlowShape = 'rectangle' | 'rounded' | 'circle' | 'diamond' | 'text' | 'parallelogram';
export type FlowSemanticType = 'terminator' | 'process' | 'decision' | 'io' | 'document' | 'database' | 'predefined' | 'connector' | 'note';
export type FlowContainerType = 'container' | 'swimlane';
export type FlowRouting = 'straight' | 'orthogonal' | 'smoothstep' | 'curve' | 'polyline';
export type FlowMarker = 'none' | 'arrow' | 'closed-arrow';

export interface FlowNodeData extends Record<string, unknown> {
  label: string;
  shape: FlowShape;
  semanticType: FlowSemanticType;
  fill: string;
  stroke: string;
  textColor: string;
  width: number;
  height: number;
  originalType?: string;
  layerId?: string;
  containerType?: FlowContainerType;
  laneTitle?: string;
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
  textAlign?: 'left' | 'center' | 'right';
  strokeWidth?: number;
  dashed?: boolean;
}

export type FlowNode = Node<FlowNodeData, string>;
export interface FlowPoint { x: number; y: number }
export interface FlowEdgeData extends Record<string, unknown> {
  label?: string;
  routing?: FlowRouting;
  startMarker?: FlowMarker;
  endMarker?: FlowMarker;
  dashed?: boolean;
  stroke?: string;
  strokeWidth?: number;
  waypoints?: FlowPoint[];
}
export type FlowEdge = Edge<FlowEdgeData>;

export interface FlowLayer {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
}

export interface FlowPage {
  id: string;
  name: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
  viewport: Viewport;
  layers: FlowLayer[];
}

export interface FlowDocument {
  schemaVersion: 2;
  pages: FlowPage[];
  activePageId: string;
  /** Current-page mirrors kept for existing callers and old exports. */
  nodes: FlowNode[];
  edges: FlowEdge[];
  viewport: Viewport;
}

export interface FlowNodeDefinition {
  type: string;
  label: string;
  shape: FlowShape;
  semanticType: FlowSemanticType;
  createDefaultData: () => FlowNodeData;
}
