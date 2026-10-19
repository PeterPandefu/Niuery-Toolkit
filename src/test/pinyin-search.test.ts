import { describe, expect, it } from 'vitest';
import { buildToolSearchText, getNameMatchRank, matchesSearchText, toPinyinBlob } from '@/lib/pinyin-search';

describe('拼音检索', () => {
  it('生成全拼和首字母', () => {
    const blob = toPinyinBlob('JSON 格式化');
    expect(blob).toContain('geshihua');
    expect(blob).toContain('gsh');
  });

  it('可用全拼或首字母匹配工具名', () => {
    const searchText = buildToolSearchText(['json-formatter', 'JSON 格式化', 'json', '格式化']);
    expect(matchesSearchText(searchText, 'geshi')).toBe(true);
    expect(matchesSearchText(searchText, 'gsh')).toBe(true);
    expect(matchesSearchText(searchText, 'json')).toBe(true);
    expect(matchesSearchText(searchText, 'xyznotool')).toBe(false);
  });

  it('按名称精确、前缀、包含、多词匹配排序，描述命中排在名称命中之后', () => {
    const names = ['Mermaid 实时编辑器', '图片 SVG 转换', 'SVG 优化', 'SVG'];
    expect(names.sort((a, b) => getNameMatchRank([a], 'svg') - getNameMatchRank([b], 'svg')))
      .toEqual(['SVG', 'SVG 优化', '图片 SVG 转换', 'Mermaid 实时编辑器']);

    expect(getNameMatchRank(['JSON 格式化'], '格式 JSON')).toBeLessThan(getNameMatchRank(['文本编辑器'], '格式 JSON'));
  });

  it('名称排序兼容大小写、空白和多个语言的名称', () => {
    expect(getNameMatchRank(['SVG Optimizer', 'SVG 优化'], '  sVg优化  ')).toBe(0);
    expect(getNameMatchRank(['SVG Optimizer', 'SVG 优化'], 'svg opt')).toBe(1);
    expect(getNameMatchRank(['SVG Optimizer', 'SVG 优化'], '优化')).toBe(2);
  });
});
