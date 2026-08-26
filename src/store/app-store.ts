import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { SkinId, ThemeMode, ToolCategory } from '@/types/tool';
import { DEFAULT_SKIN } from '@/lib/theme';

export interface RecentToolUsage {
  count: number;
  lastUsedOrder: number;
}

export type RecentToolUsageMap = Record<string, RecentToolUsage>;

export function getRecentToolIds(usage: RecentToolUsageMap, limit?: number): string[] {
  const ids = Object.entries(usage)
    .sort(([, left], [, right]) => right.count - left.count || right.lastUsedOrder - left.lastUsedOrder)
    .map(([toolId]) => toolId);
  return limit === undefined ? ids : ids.slice(0, limit);
}

interface AppStore {
  // 主题
  theme: ThemeMode;
  setTheme: (theme: ThemeMode) => void;
  skin: SkinId;
  setSkin: (skin: SkinId) => void;
  resetAppearance: () => void;

  // 当前展开的分类面板
  activeCategory: ToolCategory | null;
  setActiveCategory: (category: ToolCategory | null) => void;

  // 当前活动工具
  activeToolId: string | null;
  setActiveTool: (toolId: string | null) => void;

  // 当前应用进程内的工具使用记录（不持久化）
  recentToolUsage: RecentToolUsageMap;
  usageSequence: number;
  recordToolUsage: (toolId: string) => void;
  getRecentToolIds: (limit?: number) => string[];

  // 搜索面板
  searchOpen: boolean;
  setSearchOpen: (open: boolean) => void;

  // 快捷栏固定工具
  pinnedTools: string[];
  setPinnedTools: (tools: string[]) => void;
  togglePinnedTool: (toolId: string) => void;
}

export const useAppStore = create<AppStore>()(
  persist(
    (set, get) => ({
      // 主题
      theme: 'system',
      setTheme: (theme) => set({ theme }),
      skin: DEFAULT_SKIN,
      setSkin: (skin) => set({ skin }),
      resetAppearance: () => set({ theme: 'system', skin: DEFAULT_SKIN }),

      // 分类面板
      activeCategory: null,
      setActiveCategory: (category) => set({ activeCategory: category }),

      // 活动工具
      activeToolId: null,
      setActiveTool: (toolId) => set({ activeToolId: toolId }),

      // 最近使用：按次数排序，次数相同时按最后一次使用排序。
      recentToolUsage: {},
      usageSequence: 0,
      recordToolUsage: (toolId) =>
        set((state) => {
          const lastUsedOrder = state.usageSequence + 1;
          const previous = state.recentToolUsage[toolId];
          return {
            usageSequence: lastUsedOrder,
            recentToolUsage: {
              ...state.recentToolUsage,
              [toolId]: {
                count: (previous?.count ?? 0) + 1,
                lastUsedOrder,
              },
            },
          };
        }),
      getRecentToolIds: (limit) => getRecentToolIds(get().recentToolUsage, limit),

      // 搜索
      searchOpen: false,
      setSearchOpen: (open) => set({ searchOpen: open }),

      // 快捷栏固定工具
      pinnedTools: ['json-formatter', 'base64', 'timestamp', 'uuid-generator', 'qrcode', 'text-diff'],
      setPinnedTools: (tools) => set({ pinnedTools: tools }),
      togglePinnedTool: (toolId) =>
        set((state) => {
          const exists = state.pinnedTools.includes(toolId);
          return {
            pinnedTools: exists
              ? state.pinnedTools.filter((id) => id !== toolId)
              : [...state.pinnedTools, toolId],
          };
        }),
    }),
    {
      name: 'niuery-toolkit-store',
      partialize: (state) => ({
        theme: state.theme,
        skin: state.skin,
        pinnedTools: state.pinnedTools,
      }),
      version: 2,
      migrate: (persistedState) => {
        const persisted = persistedState as Partial<Pick<AppStore, 'theme' | 'skin' | 'pinnedTools'>>;
        return {
          theme: persisted.theme ?? 'system',
          skin: persisted.skin ?? DEFAULT_SKIN,
          pinnedTools: persisted.pinnedTools ?? ['json-formatter', 'base64', 'timestamp', 'uuid-generator', 'qrcode', 'text-diff'],
        };
      },
    }
  )
);
