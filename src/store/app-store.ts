import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { ThemeMode, ToolCategory } from '@/types/tool';

interface AppStore {
  // 主题
  theme: ThemeMode;
  setTheme: (theme: ThemeMode) => void;

  // 当前展开的分类面板
  activeCategory: ToolCategory | null;
  setActiveCategory: (category: ToolCategory | null) => void;

  // 最近使用的工具
  recentTools: string[];
  addRecentTool: (toolId: string) => void;

  // 当前活动工具
  activeToolId: string | null;
  setActiveTool: (toolId: string | null) => void;

  // 搜索面板
  searchOpen: boolean;
  setSearchOpen: (open: boolean) => void;
}

export const useAppStore = create<AppStore>()(
  persist(
    (set) => ({
      // 主题
      theme: 'system',
      setTheme: (theme) => set({ theme }),

      // 分类面板
      activeCategory: null,
      setActiveCategory: (category) => set({ activeCategory: category }),

      // 最近使用
      recentTools: [],
      addRecentTool: (toolId) =>
        set((state) => {
          const filtered = state.recentTools.filter((id) => id !== toolId);
          return { recentTools: [toolId, ...filtered].slice(0, 10) };
        }),

      // 活动工具
      activeToolId: null,
      setActiveTool: (toolId) => set({ activeToolId: toolId }),

      // 搜索
      searchOpen: false,
      setSearchOpen: (open) => set({ searchOpen: open }),
    }),
    {
      name: 'niuery-toolkit-store',
      partialize: (state) => ({
        theme: state.theme,
        recentTools: state.recentTools,
      }),
    }
  )
);
