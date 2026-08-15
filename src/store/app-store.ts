import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { SkinId, ThemeMode, ToolCategory } from '@/types/tool';
import { DEFAULT_SKIN } from '@/lib/theme';

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
    (set) => ({
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
