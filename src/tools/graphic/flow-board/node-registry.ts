import type { FlowNodeDefinition, FlowShape } from './types';

const COLORS = {
  fill: '#f5f7fb',
  stroke: '#526173',
  textColor: '#172033',
};

const definitions: FlowNodeDefinition[] = [
  { type: 'terminator', label: '开始/结束', shape: 'rounded', semanticType: 'terminator', createDefaultData: () => ({ label: '开始', shape: 'rounded', semanticType: 'terminator', ...COLORS, width: 150, height: 60 }) },
  { type: 'process', label: '处理', shape: 'rectangle', semanticType: 'process', createDefaultData: () => ({ label: '处理', shape: 'rectangle', semanticType: 'process', ...COLORS, width: 150, height: 72 }) },
  { type: 'decision', label: '判断', shape: 'diamond', semanticType: 'decision', createDefaultData: () => ({ label: '判断', shape: 'diamond', semanticType: 'decision', ...COLORS, width: 140, height: 96 }) },
  { type: 'io', label: '输入/输出', shape: 'parallelogram', semanticType: 'io', createDefaultData: () => ({ label: '输入/输出', shape: 'parallelogram', semanticType: 'io', ...COLORS, width: 160, height: 72 }) },
  { type: 'document', label: '文档', shape: 'rectangle', semanticType: 'document', createDefaultData: () => ({ label: '文档', shape: 'rectangle', semanticType: 'document', ...COLORS, width: 160, height: 78 }) },
  { type: 'database', label: '数据库', shape: 'circle', semanticType: 'database', createDefaultData: () => ({ label: '数据库', shape: 'circle', semanticType: 'database', ...COLORS, width: 130, height: 96 }) },
  { type: 'predefined', label: '预定义流程', shape: 'rectangle', semanticType: 'predefined', createDefaultData: () => ({ label: '子流程', shape: 'rectangle', semanticType: 'predefined', ...COLORS, width: 160, height: 72 }) },
  { type: 'connector', label: '连接符', shape: 'circle', semanticType: 'connector', createDefaultData: () => ({ label: 'A', shape: 'circle', semanticType: 'connector', ...COLORS, width: 56, height: 56 }) },
  { type: 'note', label: '注释', shape: 'text', semanticType: 'note', createDefaultData: () => ({ label: '说明文字', shape: 'text', semanticType: 'note', fill: 'transparent', stroke: 'transparent', textColor: '#172033', width: 180, height: 48 }) },
];

const legacyAliases: Record<string, string> = { rectangle: 'process', rounded: 'terminator', circle: 'connector', diamond: 'decision', text: 'note' };

const registry = new Map(definitions.map((definition) => [definition.type, definition]));

export function getFlowNodeDefinitions() {
  return definitions;
}

export function getFlowNodeDefinition(type: string) {
  return registry.get(type) ?? registry.get(legacyAliases[type] ?? '') ?? definitions[1];
}

export function isFlowShape(value: unknown): value is FlowShape {
  return ['rectangle', 'rounded', 'circle', 'diamond', 'text', 'parallelogram'].includes(String(value));
}
