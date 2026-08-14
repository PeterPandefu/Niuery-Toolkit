import { ComponentType, LazyExoticComponent } from 'react';
import {
  Camera,
  Database,
  FileText,
  Globe2,
  Languages,
  MonitorCog,
  PenTool,
  ShieldCheck,
  Sparkles,
  Image,
} from 'lucide-react';

/** 工具分类 */
export type ToolCategory =
  | 'data'
  | 'security'
  | 'text'
  | 'generator'
  | 'image'
  | 'canvas'
  | 'capture'
  | 'network'
  | 'system'
  | 'language';

/** 分类显示名称映射 */
export const CATEGORY_NAMES: Record<ToolCategory, string> = {
  data: '数据与转换',
  security: '编码与安全',
  text: '文本与代码',
  generator: '生成工具',
  image: '图像与文档',
  canvas: '图表与画布',
  capture: '截图与录制',
  network: '接口与网络',
  system: '系统与剪贴板',
  language: '语言翻译',
};

/** 导航与设置使用的稳定分类顺序。 */
export const TOOL_CATEGORY_ORDER: ToolCategory[] = [
  'data',
  'security',
  'text',
  'generator',
  'image',
  'canvas',
  'capture',
  'network',
  'system',
  'language',
];

/** 分类图标映射 */
export const CATEGORY_ICONS: Record<ToolCategory, ComponentType<{ className?: string }>> = {
  data: Database,
  security: ShieldCheck,
  text: FileText,
  generator: Sparkles,
  image: Image,
  canvas: PenTool,
  capture: Camera,
  network: Globe2,
  system: MonitorCog,
  language: Languages,
};

/** 工具定义接口 */
export interface ToolDefinition {
  /** 唯一标识 */
  id: string;
  /** 显示名称 */
  name: string;
  /** 图标组件 */
  icon: ComponentType<{ className?: string }>;
  /** 分类 */
  category: ToolCategory;
  /** 懒加载组件 */
  component: LazyExoticComponent<ComponentType>;
  /** 搜索关键词 */
  keywords: string[];
  /** 简短描述 */
  description: string;
}

/** 工具状态 */
export interface ToolState {
  input: string;
  output: string;
  options: Record<string, unknown>;
}

/** 主题模式 */
export type ThemeMode = 'light' | 'dark' | 'system';

/** 内置视觉皮肤 */
export type SkinId = 'forge' | 'ocean' | 'forest' | 'mono';

/** 全局应用状态 */
export interface AppState {
  theme: ThemeMode;
  skin: SkinId;
  activeCategory: ToolCategory | null;
  recentTools: string[];
  activeToolId: string | null;
}
