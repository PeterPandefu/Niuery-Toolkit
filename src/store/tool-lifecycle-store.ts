import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { createLogger } from '@/lib/logger';

const log = createLogger('lifecycle');

/**
 * 工具生命周期管理 Store
 * 类似 uTools 的工具进程管理：工具按需启动/关闭，支持常驻配置
 */
interface ToolLifecycleStore {
  /** 当前运行中（已挂载）的工具 ID 列表 */
  activeTools: string[];
  /** 常驻工具 ID 列表（持久化，应用启动时自动加载） */
  alwaysOnTools: string[];

  /** 启动工具（加入运行列表） */
  startTool: (toolId: string) => void;
  /** 停止工具（从运行列表移除，常驻工具不可停止） */
  stopTool: (toolId: string) => void;
  /** 切换工具运行状态 */
  toggleTool: (toolId: string) => void;
  /** 判断工具是否运行中 */
  isToolActive: (toolId: string) => boolean;
  /** 设置工具是否常驻 */
  setAlwaysOn: (toolId: string, alwaysOn: boolean) => void;
  /** 判断工具是否常驻 */
  isAlwaysOn: (toolId: string) => boolean;
  /** 初始化：将常驻工具全部启动 */
  initAlwaysOnTools: () => void;
}

export const useToolLifecycleStore = create<ToolLifecycleStore>()(
  persist(
    (set, get) => ({
      activeTools: [],
      alwaysOnTools: [],

      startTool: (toolId) =>
        set((state) => {
          if (state.activeTools.includes(toolId)) return state;
          log.info(`启动工具: ${toolId}`);
          return { activeTools: [...state.activeTools, toolId] };
        }),

      stopTool: (toolId) =>
        set((state) => {
          // 常驻工具不可通过开关停止
          if (state.alwaysOnTools.includes(toolId)) return state;
          log.info(`停止工具: ${toolId}`);
          return { activeTools: state.activeTools.filter((id) => id !== toolId) };
        }),

      toggleTool: (toolId) => {
        const { activeTools, alwaysOnTools, startTool, stopTool } = get();
        // 常驻工具不可切换关闭
        if (alwaysOnTools.includes(toolId)) return;
        if (activeTools.includes(toolId)) {
          stopTool(toolId);
        } else {
          startTool(toolId);
        }
      },

      isToolActive: (toolId) => get().activeTools.includes(toolId),

      setAlwaysOn: (toolId, alwaysOn) =>
        set((state) => {
          log.info(`常驻设置: ${toolId} → ${alwaysOn ? '常驻' : '取消常驻'}`);
          if (alwaysOn) {
            const alwaysOnTools = state.alwaysOnTools.includes(toolId)
              ? state.alwaysOnTools
              : [...state.alwaysOnTools, toolId];
            // 设为常驻时同时启动
            const activeTools = state.activeTools.includes(toolId)
              ? state.activeTools
              : [...state.activeTools, toolId];
            return { alwaysOnTools, activeTools };
          }
          return {
            alwaysOnTools: state.alwaysOnTools.filter((id) => id !== toolId),
          };
        }),

      isAlwaysOn: (toolId) => get().alwaysOnTools.includes(toolId),

      initAlwaysOnTools: () =>
        set((state) => {
          const merged = new Set([...state.activeTools, ...state.alwaysOnTools]);
          if (state.alwaysOnTools.length > 0) {
            log.info(`初始化常驻工具: ${state.alwaysOnTools.join(', ')}`);
          }
          return { activeTools: Array.from(merged) };
        }),
    }),
    {
      name: 'niuery-toolkit-lifecycle',
      partialize: (state) => ({
        alwaysOnTools: state.alwaysOnTools,
      }),
      onRehydrateStorage: () => (state) => {
        // 持久化恢复后，自动启动常驻工具
        if (state) {
          state.initAlwaysOnTools();
        }
      },
    }
  )
);
