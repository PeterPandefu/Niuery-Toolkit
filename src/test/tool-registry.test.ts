import { describe, expect, it, vi } from 'vitest';
import { getAllTools, getAvailableCategories, getToolById, getToolsByCategory, preloadTool } from '@/registry/tool-registry';
import { TOOL_CATEGORY_ORDER } from '@/types/tool';
import zh from '@/i18n/locales/zh.json';
import en from '@/i18n/locales/en.json';

describe('工具注册表', () => {
  it('完整注册 50 个工具', () => {
    expect(getAllTools()).toHaveLength(50);
  });

  it('按任务导向的稳定顺序返回 10 个分类', () => {
    expect(getAvailableCategories()).toEqual(TOOL_CATEGORY_ORDER);
  });

  it.each([
    ['data', 12],
    ['security', 9],
    ['text', 10],
    ['generator', 4],
    ['image', 3],
    ['canvas', 3],
    ['capture', 2],
    ['network', 2],
    ['system', 4],
    ['language', 1],
  ] as const)('分类 %s 包含 %i 个工具', (category, count) => {
    expect(getToolsByCategory(category)).toHaveLength(count);
  });

  it('将代表性工具归入符合任务的分类', () => {
    expect(getToolById('json-formatter')?.category).toBe('data');
    expect(getToolById('checksum')?.category).toBe('security');
    expect(getToolById('markdown-editor')?.category).toBe('text');
    expect(getToolById('mermaid-editor')?.category).toBe('text');
    expect(getToolById('plantuml-editor')?.category).toBe('text');
    expect(getToolById('sticky-note')?.category).toBe('text');
    expect(getToolById('pdf-toolkit')?.category).toBe('image');
    expect(getToolById('mind-map')?.category).toBe('canvas');
    expect(getToolById('screenshot-editor')?.category).toBe('capture');
    expect(getToolById('clipboard-history')?.category).toBe('system');
    expect(getToolById('port-process-killer')?.category).toBe('system');
    expect(getToolById('file-unlocker')?.category).toBe('system');
  });

  it('保留稳定的工具标识符与必填字段', () => {
    const tools = getAllTools();
    expect(new Set(tools.map((tool) => tool.id)).size).toBe(tools.length);
    tools.forEach((tool) => {
      expect(tool.id).toBeTruthy();
      expect(tool.name).toBeTruthy();
      expect(tool.icon).toBeDefined();
      expect(tool.component).toBeDefined();
      expect(tool.keywords.length).toBeGreaterThan(0);
      expect(tool.description).toBeTruthy();
      expect(tool.capabilities.network).toMatch(/^(offline|network|hybrid)$/);
      expect(Array.isArray(tool.capabilities.permissions)).toBe(true);
    });
  });

  it('为联网、桌面和高权限工具声明边界', () => {
    expect(getToolById('api-tester')?.capabilities.network).toBe('network');
    expect(getToolById('translator')?.capabilities.network).toBe('network');
    expect(getToolById('screen-recorder')?.capabilities).toMatchObject({
      desktopOnly: true,
      permissions: expect.arrayContaining(['screen', 'microphone', 'systemAudio']),
    });
    expect(getToolById('sticky-note')?.capabilities).toMatchObject({ desktopOnly: true, permissions: ['file', 'nativeWindow'] });
  });

  it('支持重型工具的指向预加载，并忽略预加载失败', async () => {
    const tool = getToolById('tldraw-board');
    expect(tool).toBeDefined();
    const original = tool?.preload;
    const preload = vi.fn().mockResolvedValue(undefined);
    if (tool) tool.preload = preload;

    preloadTool('tldraw-board');
    preloadTool('tldraw-board');
    await Promise.resolve();
    expect(preload).toHaveBeenCalledTimes(1);

    if (tool) tool.preload = () => Promise.reject(new Error('预加载失败'));
    expect(() => preloadTool('tldraw-board')).not.toThrow();
    if (tool) tool.preload = original;
  });

  it.each([
    ['中文', zh.tools],
    ['英文', en.tools],
  ] as const)('所有工具都有%s本地化名称', (_language, translations) => {
    const missing = getAllTools()
      .map((tool) => tool.id)
      .filter((toolId) => !(toolId in translations));

    expect(missing).toEqual([]);
  });
});
