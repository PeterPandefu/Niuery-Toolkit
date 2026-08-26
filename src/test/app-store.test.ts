import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '@/store/app-store';

describe('useAppStore', () => {
  beforeEach(() => {
    useAppStore.setState({
      theme: 'system',
      skin: 'forge',
      activeCategory: null,
      activeToolId: null,
      searchOpen: false,
      recentToolUsage: {},
      usageSequence: 0,
    });
  });

  describe('theme', () => {
    it('defaults to system', () => {
      expect(useAppStore.getState().theme).toBe('system');
    });

    it('sets theme to dark', () => {
      useAppStore.getState().setTheme('dark');
      expect(useAppStore.getState().theme).toBe('dark');
    });

    it('sets theme to light', () => {
      useAppStore.getState().setTheme('light');
      expect(useAppStore.getState().theme).toBe('light');
    });

    it('sets skin and restores the default appearance', () => {
      useAppStore.getState().setSkin('ocean');
      useAppStore.getState().setTheme('dark');
      expect(useAppStore.getState().skin).toBe('ocean');

      useAppStore.getState().resetAppearance();
      expect(useAppStore.getState().skin).toBe('forge');
      expect(useAppStore.getState().theme).toBe('system');
    });
  });

  describe('setActiveTool', () => {
    it('defaults to null', () => {
      expect(useAppStore.getState().activeToolId).toBeNull();
    });

    it('sets active tool', () => {
      useAppStore.getState().setActiveTool('json-formatter');
      expect(useAppStore.getState().activeToolId).toBe('json-formatter');
    });

    it('clears active tool with null', () => {
      useAppStore.getState().setActiveTool('json-formatter');
      useAppStore.getState().setActiveTool(null);
      expect(useAppStore.getState().activeToolId).toBeNull();
    });
  });

  describe('setSearchOpen', () => {
    it('defaults to closed', () => {
      expect(useAppStore.getState().searchOpen).toBe(false);
    });

    it('opens search panel', () => {
      useAppStore.getState().setSearchOpen(true);
      expect(useAppStore.getState().searchOpen).toBe(true);
    });

    it('closes search panel', () => {
      useAppStore.getState().setSearchOpen(true);
      useAppStore.getState().setSearchOpen(false);
      expect(useAppStore.getState().searchOpen).toBe(false);
    });
  });

  describe('setActiveCategory', () => {
    it('defaults to null', () => {
      expect(useAppStore.getState().activeCategory).toBeNull();
    });

    it('sets active category', () => {
      useAppStore.getState().setActiveCategory('security');
      expect(useAppStore.getState().activeCategory).toBe('security');
    });

    it('clears active category with null', () => {
      useAppStore.getState().setActiveCategory('data');
      useAppStore.getState().setActiveCategory(null);
      expect(useAppStore.getState().activeCategory).toBeNull();
    });
  });

  describe('recent tool usage', () => {
    it('starts empty and records each selection for the current session', () => {
      expect(useAppStore.getState().getRecentToolIds()).toEqual([]);

      useAppStore.getState().recordToolUsage('json-formatter');
      useAppStore.getState().recordToolUsage('base64');
      useAppStore.getState().recordToolUsage('json-formatter');

      expect(useAppStore.getState().recentToolUsage).toEqual({
        'json-formatter': { count: 2, lastUsedOrder: 3 },
        base64: { count: 1, lastUsedOrder: 2 },
      });
      expect(useAppStore.getState().getRecentToolIds()).toEqual(['json-formatter', 'base64']);
    });

    it('sorts equal usage counts by the most recent selection', () => {
      useAppStore.getState().recordToolUsage('timestamp');
      useAppStore.getState().recordToolUsage('uuid-generator');
      useAppStore.getState().recordToolUsage('base64');
      useAppStore.getState().recordToolUsage('uuid-generator');
      useAppStore.getState().recordToolUsage('base64');

      expect(useAppStore.getState().getRecentToolIds()).toEqual([
        'base64',
        'uuid-generator',
        'timestamp',
      ]);
    });

    it('does not persist usage between application launches', () => {
      useAppStore.getState().recordToolUsage('qrcode');

      const persisted = useAppStore.persist.getOptions().partialize?.(useAppStore.getState());
      expect(persisted).not.toHaveProperty('recentToolUsage');
      expect(persisted).not.toHaveProperty('usageSequence');
    });
  });
});
