import { describe, it, expect } from 'vitest';
import {
  analyzeText,
  getCharFrequency,
  getReadingTime,
  optimizeSvg,
  getSvgStats,
  testRegex,
  highlightMatches,
} from '@/lib/text-utils';

// ============ 文本分析 ============

describe('文本分析', () => {
  describe('analyzeText', () => {
    it('空文本', () => {
      const stats = analyzeText('');
      expect(stats.characters).toBe(0);
      expect(stats.charactersNoSpaces).toBe(0);
      expect(stats.words).toBe(0);
      expect(stats.lines).toBe(0);
      expect(stats.sentences).toBe(0);
      expect(stats.paragraphs).toBe(0);
      expect(stats.bytes).toBe(0);
    });

    it('简单英文文本', () => {
      const stats = analyzeText('Hello world. This is a test.');
      expect(stats.characters).toBe(28);
      expect(stats.words).toBe(6);
      expect(stats.lines).toBe(1);
      expect(stats.sentences).toBe(2);
      expect(stats.paragraphs).toBe(1);
    });

    it('多行文本', () => {
      const text = 'Line 1\nLine 2\nLine 3';
      const stats = analyzeText(text);
      expect(stats.lines).toBe(3);
      expect(stats.words).toBe(6);
    });

    it('多段落文本', () => {
      const text = 'First paragraph.\n\nSecond paragraph.\n\nThird paragraph.';
      const stats = analyzeText(text);
      expect(stats.paragraphs).toBe(3);
    });

    it('中文字符字节数', () => {
      const stats = analyzeText('你好');
      expect(stats.characters).toBe(2);
      expect(stats.bytes).toBe(6); // UTF-8 中文 3 字节
    });

    it('不含空格字符数', () => {
      const stats = analyzeText('a b c');
      expect(stats.characters).toBe(5);
      expect(stats.charactersNoSpaces).toBe(3);
    });
  });

  describe('getCharFrequency', () => {
    it('统计字符频率', () => {
      const freq = getCharFrequency('aabbc');
      expect(freq[0]).toEqual(['a', 2]);
      expect(freq[1]).toEqual(['b', 2]);
      expect(freq[2]).toEqual(['c', 1]);
    });

    it('限制 Top N', () => {
      const freq = getCharFrequency('abcdefghij', 3);
      expect(freq).toHaveLength(3);
    });

    it('空文本', () => {
      expect(getCharFrequency('')).toHaveLength(0);
    });
  });

  describe('getReadingTime', () => {
    it('计算阅读时间', () => {
      const time = getReadingTime(500);
      expect(time.chinese).toBe(3); // 500/200 = 2.5 → ceil = 3
      expect(time.english).toBe(2); // 500/250 = 2
    });

    it('零词数', () => {
      const time = getReadingTime(0);
      expect(time.chinese).toBe(0);
      expect(time.english).toBe(0);
    });
  });
});

// ============ SVG 优化器 ============

describe('SVG 优化器', () => {
  const sampleSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <!-- comment -->
  <metadata>Editor info</metadata>
  <title>Test</title>
  <desc>Description</desc>
  <circle id="myCircle" cx="50" cy="50" r="40"/>
  <use xlink:href="#myCircle"/>
</svg>`;

  describe('optimizeSvg', () => {
    it('移除注释', () => {
      const result = optimizeSvg(sampleSvg, {
        removeComments: true,
        removeMetadata: false,
        cleanupIds: false,
        minifyWhitespace: false,
      });
      expect(result).not.toContain('<!--');
      expect(result).toContain('<metadata>');
    });

    it('移除元数据', () => {
      const result = optimizeSvg(sampleSvg, {
        removeComments: false,
        removeMetadata: true,
        cleanupIds: false,
        minifyWhitespace: false,
      });
      expect(result).not.toContain('<metadata>');
      expect(result).not.toContain('<title>');
      expect(result).not.toContain('<desc>');
      expect(result).toContain('<!-- comment -->');
    });

    it('简化 ID', () => {
      const result = optimizeSvg(sampleSvg, {
        removeComments: false,
        removeMetadata: false,
        cleanupIds: true,
        minifyWhitespace: false,
      });
      expect(result).toContain('id="id0"');
      expect(result).toContain('xlink:href="#id0"');
      expect(result).not.toContain('myCircle');
    });

    it('压缩空白', () => {
      const result = optimizeSvg('<svg>\n  <rect/>\n  <circle/>\n</svg>', {
        removeComments: false,
        removeMetadata: false,
        cleanupIds: false,
        minifyWhitespace: true,
      });
      expect(result).toBe('<svg><rect/><circle/></svg>');
    });

    it('全部选项启用', () => {
      const result = optimizeSvg(sampleSvg, {
        removeComments: true,
        removeMetadata: true,
        cleanupIds: true,
        minifyWhitespace: true,
      });
      expect(result).not.toContain('<!--');
      expect(result).not.toContain('<metadata>');
      expect(result).toContain('id="id0"');
      expect(result).not.toContain('\n');
    });

    it('空输入', () => {
      const result = optimizeSvg('', {
        removeComments: true,
        removeMetadata: true,
        cleanupIds: true,
        minifyWhitespace: true,
      });
      expect(result).toBe('');
    });
  });

  describe('getSvgStats', () => {
    it('计算优化统计', () => {
      const original = '<svg>  <!-- comment -->  <rect/>  </svg>';
      const optimized = '<svg><rect/></svg>';
      const stats = getSvgStats(original, optimized);
      expect(stats.originalSize).toBeGreaterThan(stats.optimizedSize);
      expect(stats.savings).toBeGreaterThan(0);
    });

    it('相同大小', () => {
      const stats = getSvgStats('<svg/>', '<svg/>');
      expect(stats.savings).toBe(0);
    });
  });
});

// ============ 正则表达式测试 ============

describe('正则表达式测试', () => {
  describe('testRegex', () => {
    it('全局匹配', () => {
      const result = testRegex('\\d+', 'g', 'abc 123 def 456');
      expect(result.error).toBeNull();
      expect(result.matches).toHaveLength(2);
      expect(result.matches[0]).toEqual({ match: '123', index: 4, groups: [] });
      expect(result.matches[1]).toEqual({ match: '456', index: 12, groups: [] });
    });

    it('非全局匹配（仅第一个）', () => {
      const result = testRegex('\\d+', '', 'abc 123 def 456');
      expect(result.matches).toHaveLength(1);
      expect(result.matches[0].match).toBe('123');
    });

    it('捕获组', () => {
      const result = testRegex('(\\w+)@(\\w+)', 'g', 'user@host admin@server');
      expect(result.matches).toHaveLength(2);
      expect(result.matches[0].groups).toEqual(['user', 'host']);
      expect(result.matches[1].groups).toEqual(['admin', 'server']);
    });

    it('忽略大小写', () => {
      const result = testRegex('hello', 'gi', 'Hello HELLO hello');
      expect(result.matches).toHaveLength(3);
    });

    it('无效正则返回错误', () => {
      const result = testRegex('[invalid', 'g', 'test');
      expect(result.error).not.toBeNull();
      expect(result.matches).toHaveLength(0);
    });

    it('空模式或空文本', () => {
      expect(testRegex('', 'g', 'test').matches).toHaveLength(0);
      expect(testRegex('\\d+', 'g', '').matches).toHaveLength(0);
    });

    it('空匹配不陷入死循环', () => {
      // 空模式被 !pattern 拦截，返回空结果
      const result = testRegex('', 'g', 'abc');
      expect(result.matches).toHaveLength(0);
      expect(result.error).toBeNull();
    });
  });

  describe('highlightMatches', () => {
    it('无匹配时返回整段文本', () => {
      const parts = highlightMatches('hello world', []);
      expect(parts).toEqual([{ text: 'hello world', isMatch: false }]);
    });

    it('正确分段高亮', () => {
      const matches = [
        { match: 'world', index: 6, groups: [] },
      ];
      const parts = highlightMatches('hello world!', matches);
      expect(parts).toEqual([
        { text: 'hello ', isMatch: false },
        { text: 'world', isMatch: true },
        { text: '!', isMatch: false },
      ]);
    });

    it('多个匹配', () => {
      const matches = [
        { match: 'a', index: 0, groups: [] },
        { match: 'b', index: 2, groups: [] },
      ];
      const parts = highlightMatches('a-b-c', matches);
      expect(parts).toEqual([
        { text: 'a', isMatch: true },
        { text: '-', isMatch: false },
        { text: 'b', isMatch: true },
        { text: '-c', isMatch: false },
      ]);
    });

    it('匹配在文本开头', () => {
      const matches = [{ match: 'hello', index: 0, groups: [] }];
      const parts = highlightMatches('hello world', matches);
      expect(parts[0]).toEqual({ text: 'hello', isMatch: true });
    });

    it('匹配在文本结尾', () => {
      const matches = [{ match: 'world', index: 6, groups: [] }];
      const parts = highlightMatches('hello world', matches);
      expect(parts[parts.length - 1]).toEqual({ text: 'world', isMatch: true });
    });
  });
});
