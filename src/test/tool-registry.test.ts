import { describe, expect, it } from 'vitest';
import { getAllTools, getAvailableCategories, getToolById, getToolsByCategory } from '@/registry/tool-registry';
import { TOOL_CATEGORY_ORDER } from '@/types/tool';

describe('工具注册表', () => {
  it('完整注册 46 个工具', () => {
    expect(getAllTools()).toHaveLength(46);
  });

  it('按任务导向的稳定顺序返回 10 个分类', () => {
    expect(getAvailableCategories()).toEqual(TOOL_CATEGORY_ORDER);
  });

  it.each([
    ['data', 11],
    ['security', 9],
    ['text', 9],
    ['generator', 4],
    ['image', 3],
    ['canvas', 3],
    ['capture', 2],
    ['network', 2],
    ['system', 2],
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
    });
  });
});
