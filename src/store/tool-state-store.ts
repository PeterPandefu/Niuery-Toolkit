import { create } from 'zustand';

/** 每个工具的独立状态 */
interface ToolStateEntry {
  input: string;
  output: string;
  options: Record<string, string>;
}

interface ToolStateStore {
  states: Map<string, ToolStateEntry>;
  getToolState: (toolId: string) => ToolStateEntry | undefined;
  setToolState: (toolId: string, state: Partial<ToolStateEntry>) => void;
  clearToolState: (toolId: string) => void;
}

export const useToolStateStore = create<ToolStateStore>((set, get) => ({
  states: new Map(),

  getToolState: (toolId) => get().states.get(toolId),

  setToolState: (toolId, partial) =>
    set((state) => {
      const newStates = new Map(state.states);
      const existing = newStates.get(toolId) || { input: '', output: '', options: {} };
      newStates.set(toolId, { ...existing, ...partial });
      return { states: newStates };
    }),

  clearToolState: (toolId) =>
    set((state) => {
      const newStates = new Map(state.states);
      newStates.delete(toolId);
      return { states: newStates };
    }),
}));

/** Hook: 获取特定工具的状态 */
export function useToolState(toolId: string) {
  const getToolState = useToolStateStore((s) => s.getToolState);
  const setToolState = useToolStateStore((s) => s.setToolState);
  const state = useToolStateStore((s) => s.states.get(toolId));

  return {
    state: state || { input: '', output: '', options: {} },
    setState: (partial: Partial<ToolStateEntry>) => setToolState(toolId, partial),
    getInput: () => getToolState(toolId)?.input || '',
    setInput: (input: string) => setToolState(toolId, { input }),
  };
}
