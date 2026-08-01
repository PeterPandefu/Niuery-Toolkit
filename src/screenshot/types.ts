/** 微信风格截图 - 类型定义 */

/** 截图阶段 */
export type ScreenshotPhase = 'idle' | 'selecting' | 'selected';

/** 标注工具类型 */
export type ScreenshotTool =
  | 'arrow'
  | 'rect'
  | 'ellipse'
  | 'line'
  | 'pen'
  | 'text'
  | 'mosaic'
  | 'number';

/** 选区矩形 */
export interface SelectionRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 单个标注对象 */
export interface AnnotationItem {
  id: string;
  tool: ScreenshotTool;
  color: string;
  strokeWidth: number;
  /** arrow / line / pen 使用 */
  points?: number[];
  /** rect / ellipse 使用 */
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  /** text 使用 */
  text?: string;
  fontSize?: number;
  /** number 使用 */
  number?: number;
  /** mosaic 使用：马赛克方块列表 */
  mosaicBlocks?: { x: number; y: number; color: string }[];
  /** mosaic 使用：每个标注的块大小 */
  mosaicBlockSize?: number;
}

/** 工具栏颜色预设（微信风格） */
export const TOOL_COLORS = [
  '#ff4444', // 红
  '#ffcc00', // 黄
  '#44cc44', // 绿
  '#4488ff', // 蓝
  '#ffffff', // 白
  '#000000', // 黑
];

/** 线宽预设 */
export const STROKE_WIDTHS = [2, 4, 7];

/** 文字大小预设 */
export const FONT_SIZES = [14, 20, 28, 40];

/** 马赛克方块大小预设（对应线宽选择器的三档） */
export const MOSAIC_SIZES = [4, 8, 14];

/** 默认马赛克方块大小 */
export const MOSAIC_BLOCK_SIZE = 8;

/** 最小有效选区尺寸 */
export const MIN_SELECTION_SIZE = 8;
