import { createDefaultFlowDocument } from './document';
import type { FlowDocument } from './types';

export interface FlowTemplate { id: string; name: string; description: string; create: () => FlowDocument; }

export const FLOW_TEMPLATES: FlowTemplate[] = [
  { id: 'basic-flow', name: '基础流程', description: '开始、处理、判断、结束', create: createDefaultFlowDocument },
  { id: 'approval-flow', name: '审批流程', description: '提交、审批、通过或驳回', create: () => { const document = createDefaultFlowDocument(); document.nodes[0].data.label = '提交'; document.nodes[1].data.label = '审批'; document.nodes[2].data.label = '通过'; return document; } },
];
