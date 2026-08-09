import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '@/store/app-store';

describe('useAppStore', () => {
  beforeEach(() => {
    useAppStore.setState({
      theme: 'system',
      skin: 'forge',
      activeCategory: null,
      recentTools: [],
      activeToolId: null,
      searchOpen: false,
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

  describe('addRecentTool', () => {
    it('adds a tool to empty list', () => {
      useAppStore.getState().addRecentTool('base64');
      expect(useAppStore.getState().recentTools).toEqual(['base64']);
    });

    it('prepends new tool to front', () => {
      useAppStore.getState().addRecentTool('base64');
      useAppStore.getState().addRecentTool('uuid');
      expect(useAppStore.getState().recentTools).toEqual(['uuid', 'base64']);
    });

    it('deduplicates existing tool and moves to front', () => {
      useAppStore.getState().addRecentTool('base64');
      useAppStore.getState().addRecentTool('uuid');
      useAppStore.getState().addRecentTool('base64');
      expect(useAppStore.getState().recentTools).toEqual(['base64', 'uuid']);
    });

    it('caps at 10 entries', () => {
      for (let i = 0; i < 15; i++) {
        useAppStore.getState().addRecentTool(`tool-${i}`);
      }
      const recent = useAppStore.getState().recentTools;
      expect(recent).toHaveLength(10);
      expect(recent[0]).toBe('tool-14');
      expect(recent[9]).toBe('tool-5');
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
      useAppStore.getState().setActiveCategory('encoder');
      expect(useAppStore.getState().activeCategory).toBe('encoder');
    });

    it('clears active category with null', () => {
      useAppStore.getState().setActiveCategory('converter');
      useAppStore.getState().setActiveCategory(null);
      expect(useAppStore.getState().activeCategory).toBeNull();
    });
  });
});
