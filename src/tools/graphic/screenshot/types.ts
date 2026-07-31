/** 截图编辑器类型定义 */

/** 标注工具类型 */
export type ToolType =
  | 'select'
  | 'arrow'
  | 'rect'
  | 'ellipse'
  | 'line'
  | 'pen'
  | 'text'
  | 'mosaic'
  | 'highlight'
  | 'number'
  | 'crop';

/** 工具快捷键映射 */
export const TOOL_SHORTCUTS: Record<string, ToolType> = {
  v: 'select',
  a: 'arrow',
  r: 'rect',
  o: 'ellipse',
  l: 'line',
  b: 'pen',
  t: 'text',
  m: 'mosaic',
  h: 'highlight',
  n: 'number',
  c: 'crop',
};

/** 标注对象类型 */
export type AnnotationType =
  | 'arrow'
  | 'rect'
  | 'ellipse'
  | 'line'
  | 'pen'
  | 'text'
  | 'mosaic'
  | 'highlight'
  | 'number';

/** 标注对象数据 */
export interface AnnotationData {
  id: string;
  type: AnnotationType;
  name: string;
  visible: boolean;
  /** Konva 节点属性 */
  props: Record<string, unknown>;
}

/** 工具属性配置 */
export interface ToolSettings {
  color: string;
  strokeWidth: number;
  fontSize: number;
  opacity: number;
  /** 矩形/椭圆是否填充 */
  filled: boolean;
  fillColor: string;
}

/** 默认工具配置 */
export const DEFAULT_TOOL_SETTINGS: ToolSettings = {
  color: '#ef4444',
  strokeWidth: 3,
  fontSize: 24,
  opacity: 0.4,
  filled: false,
  fillColor: '#ef4444',
};

/** 预设色板 */
export const COLOR_PRESETS = [
  '#ef4444', // red
  '#f97316', // orange
  '#eab308', // yellow
  '#22c55e', // green
  '#3b82f6', // blue
  '#8b5cf6', // purple
  '#ec4899', // pink
  '#ffffff', // white
  '#000000', // black
  '#6b7280', // gray
];

/** 裁剪比例预设 */
export type CropRatio = 'free' | '1:1' | '4:3' | '16:9';

export const CROP_RATIOS: { label: string; value: CropRatio; ratio?: number }[] = [
  { label: '自由', value: 'free' },
  { label: '1:1', value: '1:1', ratio: 1 },
  { label: '4:3', value: '4:3', ratio: 4 / 3 },
  { label: '16:9', value: '16:9', ratio: 16 / 9 },
];

/** 导出格式 */
export type ExportFormat = 'png' | 'jpeg' | 'webp';

/** 历史操作命令 */
export interface HistoryCommand {
  /** 执行 */
  execute: () => void;
  /** 撤销 */
  undo: () => void;
  /** 描述 */
  label: string;
}

/** 画布尺寸 */
export interface CanvasSize {
  width: number;
  height: number;
}

/** 最大画布尺寸 */
export const MAX_CANVAS_SIZE = 4096;

/** 历史记录上限 */
export const MAX_HISTORY = 50;
