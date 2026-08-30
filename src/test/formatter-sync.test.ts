import { describe, expect, it } from 'vitest';
import { syncFormatterValuePreservingFormat } from '@/lib/formatter-sync';

describe('格式化结果反向同步', () => {
  it('JSON 只替换值并保留左侧原始排版', () => {
    const original = '{"name":"旧值", "count": 1}';
    const previous = '{\n  "name": "旧值",\n  "count": 1\n}';
    const edited = '{\n  "name": "新值",\n  "count": 1\n}';

    expect(syncFormatterValuePreservingFormat(original, previous, edited)).toBe('{"name":"新值", "count": 1}');
  });

  it('只调整右侧空白时不改写左侧', () => {
    const original = '<root><item>值</item></root>';
    const previous = '<root>\n  <item>值</item>\n</root>';
    const edited = '<root>\n    <item>值</item>\n</root>';

    expect(syncFormatterValuePreservingFormat(original, previous, edited)).toBe(original);
  });

  it('结构 token 数量变化时保留原文，避免错误格式化', () => {
    const original = 'SELECT id FROM users';
    const previous = 'SELECT\n  id\nFROM users';
    const edited = 'SELECT\n  id, name\nFROM users';

    expect(syncFormatterValuePreservingFormat(original, previous, edited)).toBe(original);
  });
});
