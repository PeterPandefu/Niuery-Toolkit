import { ComponentType, LazyExoticComponent } from 'react';

/** 工具分类 */
export type ToolCategory =
  | 'converter'
  | 'encoder'
  | 'formatter'
  | 'generator'
  | 'text'
  | 'graphic';

/** 分类显示名称映射 */
export const CATEGORY_NAMES: Record<ToolCategory, string> = {
  converter: '转换器',
  encoder: '编码器',
  formatter: '格式化器',
  generator: '生成器',
  text: '文本工具',
  graphic: '图形工具',
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

/** 全局应用状态 */
export interface AppState {
  theme: ThemeMode;
  sidebarCollapsed: boolean;
  recentTools: string[];
  activeToolId: string | null;
}
