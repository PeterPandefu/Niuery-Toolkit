import { describe, it, expect } from 'vitest';
import {
  getAllTools,
  getToolsByCategory,
  getToolById,
  getAvailableCategories,
} from '@/registry/tool-registry';

describe('Tool Registry', () => {
  it('registers all 43 tools', () => {
    const tools = getAllTools();
    expect(tools.length).toBe(43);
  });

  it('has 10 categories', () => {
    const categories = getAvailableCategories();
    expect(categories.length).toBe(10);
    expect(categories).toContain('converter');
    expect(categories).toContain('encoder');
    expect(categories).toContain('formatter');
    expect(categories).toContain('generator');
    expect(categories).toContain('text');
    expect(categories).toContain('graphic');
    expect(categories).toContain('network');
    expect(categories).toContain('system');
    expect(categories).toContain('translate');
    expect(categories).toContain('pdf');
  });

  it('has 8 converters', () => {
    expect(getToolsByCategory('converter').length).toBe(8);
  });

  it('has 7 encoders', () => {
    expect(getToolsByCategory('encoder').length).toBe(7);
  });

  it('has 4 formatters', () => {
    expect(getToolsByCategory('formatter').length).toBe(4);
  });

  it('has 5 generators', () => {
    expect(getToolsByCategory('generator').length).toBe(5);
  });

  it('has 6 text tools', () => {
    expect(getToolsByCategory('text').length).toBe(6);
  });

  it('has 8 graphic tools', () => {
    const tools = getToolsByCategory('graphic');
    expect(tools).toHaveLength(8);
    expect(tools.map((tool) => tool.id)).toEqual(expect.arrayContaining([
      'image-studio',
      'mind-map',
      'excalidraw-board',
      'tldraw-board',
    ]));
  });

  it('has a translator', () => {
    expect(getToolsByCategory('translate').map((tool) => tool.id)).toEqual(['translator']);
  });

  it('has a pdf toolkit', () => {
    expect(getToolsByCategory('pdf').map((tool) => tool.id)).toEqual(['pdf-toolkit']);
  });

  it('has 2 network tools', () => {
    expect(getToolsByCategory('network').length).toBe(2);
  });

  it('has a system monitor', () => {
    expect(getToolsByCategory('system').map((tool) => tool.id)).toEqual(['system-monitor']);
  });

  it('retrieves tool by id', () => {
    const tool = getToolById('json-yaml');
    expect(tool).toBeDefined();
    expect(tool!.name).toBe('JSON ↔ YAML');
    expect(tool!.category).toBe('converter');
  });

  it('returns undefined for unknown tool', () => {
    expect(getToolById('nonexistent')).toBeUndefined();
  });

  it('every tool has required fields', () => {
    const tools = getAllTools();
    for (const tool of tools) {
      expect(tool.id).toBeTruthy();
      expect(tool.name).toBeTruthy();
      expect(tool.icon).toBeDefined();
      expect(tool.category).toBeTruthy();
      expect(tool.component).toBeDefined();
      expect(tool.keywords.length).toBeGreaterThan(0);
      expect(tool.description).toBeTruthy();
    }
  });

  it('all tool ids are unique', () => {
    const tools = getAllTools();
    const ids = tools.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
