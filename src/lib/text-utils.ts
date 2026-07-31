/**
 * 文本工具函数
 * 文本分析、SVG 优化、正则匹配等纯函数
 */

// ============ 文本分析 ============

export interface TextStats {
  characters: number;
  charactersNoSpaces: number;
  words: number;
  lines: number;
  sentences: number;
  paragraphs: number;
  bytes: number;
}

/** 分析文本统计信息 */
export function analyzeText(text: string): TextStats {
  const characters = text.length;
  const charactersNoSpaces = text.replace(/\s/g, '').length;
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const lines = text ? text.split('\n').length : 0;
  const sentences = text.trim() ? (text.match(/[.!?]+/g) || []).length || 1 : 0;
  const paragraphs = text.trim() ? text.split(/\n\s*\n/).filter(Boolean).length : 0;
  const bytes = new TextEncoder().encode(text).length;

  return { characters, charactersNoSpaces, words, lines, sentences, paragraphs, bytes };
}

/** 获取字符频率 (Top N) */
export function getCharFrequency(text: string, topN = 20): [string, number][] {
  const freq = new Map<string, number>();
  for (const char of text) {
    freq.set(char, (freq.get(char) || 0) + 1);
  }
  return Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN);
}

/** 计算预计阅读时间（分钟） */
export function getReadingTime(wordCount: number): { chinese: number; english: number } {
  return {
    chinese: Math.ceil(wordCount / 200),
    english: Math.ceil(wordCount / 250),
  };
}

// ============ SVG 优化器 ============

export interface SvgOptimizeOptions {
  removeComments: boolean;
  removeMetadata: boolean;
  cleanupIds: boolean;
  minifyWhitespace: boolean;
}

/** 优化 SVG 字符串 */
export function optimizeSvg(svg: string, options: SvgOptimizeOptions): string {
  let result = svg;

  if (options.removeComments) {
    result = result.replace(/<!--[\s\S]*?-->/g, '');
  }

  if (options.removeMetadata) {
    result = result.replace(/<metadata[\s\S]*?<\/metadata>/gi, '');
    result = result.replace(/<title[\s\S]*?<\/title>/gi, '');
    result = result.replace(/<desc[\s\S]*?<\/desc>/gi, '');
    result = result.replace(/\s+(?:inkscape|sodipodi|serif|illustrator|sketch):[\w-]+="[^"]*"/gi, '');
    result = result.replace(/\s+xmlns:(?:inkscape|sodipodi|serif|illustrator|sketch)="[^"]*"/gi, '');
  }

  if (options.cleanupIds) {
    let counter = 0;
    const idMap = new Map<string, string>();
    result = result.replace(/id="([^"]+)"/g, (_, id) => {
      if (!idMap.has(id)) {
        idMap.set(id, `id${counter++}`);
      }
      return `id="${idMap.get(id)}"`;
    });
    result = result.replace(/url\(#([^)]+)\)/g, (_, id) => {
      return `url(#${idMap.get(id) || id})`;
    });
    result = result.replace(/xlink:href="#([^"]+)"/g, (_, id) => {
      return `xlink:href="#${idMap.get(id) || id}"`;
    });
  }

  if (options.minifyWhitespace) {
    result = result
      .replace(/\s+/g, ' ')
      .replace(/>\s+</g, '><')
      .trim();
  }

  return result;
}

/** 计算 SVG 优化统计 */
export function getSvgStats(original: string, optimized: string): {
  originalSize: number;
  optimizedSize: number;
  savings: number;
} {
  const originalSize = new TextEncoder().encode(original).length;
  const optimizedSize = new TextEncoder().encode(optimized).length;
  const savings = Math.round((1 - optimizedSize / originalSize) * 100);
  return { originalSize, optimizedSize, savings };
}

// ============ 正则表达式测试 ============

export interface RegexMatchResult {
  match: string;
  index: number;
  groups: (string | undefined)[];
}

export interface RegexTestResult {
  matches: RegexMatchResult[];
  error: string | null;
}

/** 执行正则匹配 */
export function testRegex(pattern: string, flags: string, testString: string): RegexTestResult {
  if (!pattern || !testString) return { matches: [], error: null };

  try {
    const regex = new RegExp(pattern, flags);
    const results: RegexMatchResult[] = [];
    let match: RegExpExecArray | null;

    if (flags.includes('g')) {
      while ((match = regex.exec(testString)) !== null) {
        results.push({
          match: match[0],
          index: match.index,
          groups: match.slice(1),
        });
        if (match[0] === '') regex.lastIndex++;
      }
    } else {
      match = regex.exec(testString);
      if (match) {
        results.push({
          match: match[0],
          index: match.index,
          groups: match.slice(1),
        });
      }
    }

    return { matches: results, error: null };
  } catch (e) {
    return { matches: [], error: (e as Error).message };
  }
}

/** 高亮匹配文本分段 */
export function highlightMatches(
  testString: string,
  matches: RegexMatchResult[]
): { text: string; isMatch: boolean }[] {
  if (matches.length === 0) return [{ text: testString, isMatch: false }];

  const parts: { text: string; isMatch: boolean }[] = [];
  let lastIndex = 0;

  matches.forEach((m) => {
    if (m.index > lastIndex) {
      parts.push({ text: testString.slice(lastIndex, m.index), isMatch: false });
    }
    parts.push({ text: m.match, isMatch: true });
    lastIndex = m.index + m.match.length;
  });

  if (lastIndex < testString.length) {
    parts.push({ text: testString.slice(lastIndex), isMatch: false });
  }

  return parts;
}
