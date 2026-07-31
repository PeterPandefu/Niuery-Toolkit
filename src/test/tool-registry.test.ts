import { describe, it, expect } from 'vitest';
import {
  getAllTools,
  getToolsByCategory,
  getToolById,
  getAvailableCategories,
} from '@/registry/tool-registry';

describe('Tool Registry', () => {
  it('registers all 32 tools', () => {
    const tools = getAllTools();
    expect(tools.length).toBe(32);
  });

  it('has 6 categories', () => {
    const categories = getAvailableCategories();
    expect(categories.length).toBe(6);
    expect(categories).toContain('converter');
    expect(categories).toContain('encoder');
    expect(categories).toContain('formatter');
    expect(categories).toContain('generator');
    expect(categories).toContain('text');
    expect(categories).toContain('graphic');
  });

  it('has 7 converters', () => {
    expect(getToolsByCategory('converter').length).toBe(7);
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

  it('has 5 text tools', () => {
    expect(getToolsByCategory('text').length).toBe(5);
  });

  it('has 4 graphic tools', () => {
    expect(getToolsByCategory('graphic').length).toBe(4);
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
