import type { FlowNodeDefinition, FlowShape } from './types';

const COLORS = {
  fill: '#f5f7fb',
  stroke: '#526173',
  textColor: '#172033',
};

const definitions: FlowNodeDefinition[] = [
  { type: 'rectangle', label: '矩形', shape: 'rectangle', createDefaultData: () => ({ label: '步骤', shape: 'rectangle', ...COLORS, width: 150, height: 72 }) },
  { type: 'rounded', label: '圆角矩形', shape: 'rounded', createDefaultData: () => ({ label: '服务', shape: 'rounded', ...COLORS, width: 150, height: 72 }) },
  { type: 'circle', label: '圆形', shape: 'circle', createDefaultData: () => ({ label: '状态', shape: 'circle', ...COLORS, width: 96, height: 96 }) },
  { type: 'diamond', label: '菱形', shape: 'diamond', createDefaultData: () => ({ label: '判断', shape: 'diamond', ...COLORS, width: 140, height: 96 }) },
  { type: 'text', label: '文本', shape: 'text', createDefaultData: () => ({ label: '说明文字', shape: 'text', fill: 'transparent', stroke: 'transparent', textColor: '#172033', width: 180, height: 48 }) },
];

const registry = new Map(definitions.map((definition) => [definition.type, definition]));

export function getFlowNodeDefinitions() {
  return definitions;
}

export function getFlowNodeDefinition(type: string) {
  return registry.get(type) ?? definitions[0];
}

export function isFlowShape(value: unknown): value is FlowShape {
  return definitions.some((definition) => definition.shape === value);
}
