import { describe, expect, it } from 'vitest';
import { buildToolSearchText, matchesSearchText, toPinyinBlob } from '@/lib/pinyin-search';

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
});
