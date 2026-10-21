import { createContext } from 'react';
import type { FlowEdge, FlowNodeData } from './types';

export interface CanvasActions { begin(): void; finish(): void; updateNode(id: string, patch: Partial<FlowNodeData>): void; updateEdge(id: string, patch: NonNullable<FlowEdge['data']>): void; }
export const CanvasActionsContext = createContext<CanvasActions | null>(null);
