import { getToolById } from '@/registry/tool-registry';
import { useAppStore } from '@/store/app-store';
import { useToolLifecycleStore } from '@/store/tool-lifecycle-store';

/** 打开一个工具，并记录当前应用进程内的实际使用。 */
export function openTool(toolId: string) {
  const tool = getToolById(toolId);
  if (!tool) return;

  useToolLifecycleStore.getState().startTool(toolId);
  const appStore = useAppStore.getState();
  appStore.recordToolUsage(toolId);
  appStore.setActiveTool(toolId);
  appStore.setActiveCategory(tool.category);
}
