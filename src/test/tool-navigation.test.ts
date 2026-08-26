import { beforeEach, describe, expect, it } from 'vitest';
import { openTool } from '@/lib/tool-navigation';
import { useAppStore } from '@/store/app-store';
import { useToolLifecycleStore } from '@/store/tool-lifecycle-store';

describe('openTool', () => {
  beforeEach(() => {
    useAppStore.setState({
      activeToolId: null,
      activeCategory: null,
      recentToolUsage: {},
      usageSequence: 0,
    });
    useToolLifecycleStore.setState({ activeTools: [] });
  });

  it('starts, activates, categorizes, and records a selected tool', () => {
    openTool('base64');

    expect(useToolLifecycleStore.getState().activeTools).toContain('base64');
    expect(useAppStore.getState().activeToolId).toBe('base64');
    expect(useAppStore.getState().activeCategory).toBe('security');
    expect(useAppStore.getState().recentToolUsage.base64).toEqual({ count: 1, lastUsedOrder: 1 });

    openTool('base64');
    expect(useAppStore.getState().recentToolUsage.base64).toEqual({ count: 2, lastUsedOrder: 2 });
  });

  it('does not record an unknown tool', () => {
    openTool('not-a-tool');

    expect(useToolLifecycleStore.getState().activeTools).toEqual([]);
    expect(useAppStore.getState().getRecentToolIds()).toEqual([]);
  });
});
