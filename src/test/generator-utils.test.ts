import { describe, it, expect } from 'vitest';
import {
  generatePassword,
  calculateEntropy,
  getStrengthLabel,
  generateLoremIpsum,
  generateSentence,
  generateParagraph,
  generateUuid,
  isValidUuid,
  LOREM_WORDS,
  CHINESE_WORDS,
  CHARSETS,
} from '@/lib/generator-utils';

// ============ 密码生成器 ============

describe('密码生成器', () => {
  describe('generatePassword', () => {
    it('生成指定长度的密码', () => {
      const pwd = generatePassword(16, { lowercase: true, uppercase: true, numbers: true, symbols: false }, false);
      expect(pwd).toHaveLength(16);
    });

    it('仅小写字母', () => {
      const pwd = generatePassword(50, { lowercase: true, uppercase: false, numbers: false, symbols: false }, false);
      expect(pwd).toMatch(/^[a-z]+$/);
    });

    it('仅大写字母', () => {
      const pwd = generatePassword(50, { lowercase: false, uppercase: true, numbers: false, symbols: false }, false);
      expect(pwd).toMatch(/^[A-Z]+$/);
    });

    it('仅数字', () => {
      const pwd = generatePassword(50, { lowercase: false, uppercase: false, numbers: true, symbols: false }, false);
      expect(pwd).toMatch(/^[0-9]+$/);
    });

    it('仅符号', () => {
      const pwd = generatePassword(50, { lowercase: false, uppercase: false, numbers: false, symbols: true }, false);
      for (const c of pwd) {
        expect(CHARSETS.symbols).toContain(c);
      }
    });

    it('排除易混淆字符', () => {
      const pwd = generatePassword(200, { lowercase: true, uppercase: true, numbers: true, symbols: false }, true);
      expect(pwd).not.toMatch(/[oO0l1I|]/);
    });

    it('无字符集时返回空字符串', () => {
      const pwd = generatePassword(16, { lowercase: false, uppercase: false, numbers: false, symbols: false }, false);
      expect(pwd).toBe('');
    });

    it('每次生成不同密码（随机性）', () => {
      const opts = { lowercase: true, uppercase: true, numbers: true, symbols: true };
      const pwd1 = generatePassword(32, opts, false);
      const pwd2 = generatePassword(32, opts, false);
      expect(pwd1).not.toBe(pwd2);
    });
  });

  describe('calculateEntropy', () => {
    it('空密码熵值为 0', () => {
      expect(calculateEntropy('')).toBe(0);
    });

    it('纯小写字母', () => {
      // 26 pool, length 8 → 8 * log2(26) ≈ 38
      const entropy = calculateEntropy('abcdefgh');
      expect(entropy).toBe(Math.round(8 * Math.log2(26)));
    });

    it('大小写 + 数字', () => {
      // 62 pool, length 10 → 10 * log2(62) ≈ 60
      const entropy = calculateEntropy('aB3dE5gH7j');
      expect(entropy).toBe(Math.round(10 * Math.log2(62)));
    });

    it('全字符集', () => {
      // 94 pool, length 16 → 16 * log2(94) ≈ 105
      const entropy = calculateEntropy('aB3!dE5@gH7#jK9$');
      expect(entropy).toBe(Math.round(16 * Math.log2(94)));
    });
  });

  describe('getStrengthLabel', () => {
    it('弱 (< 40)', () => {
      expect(getStrengthLabel(0).level).toBe('weak');
      expect(getStrengthLabel(39).level).toBe('weak');
    });

    it('中等 (40-59)', () => {
      expect(getStrengthLabel(40).level).toBe('medium');
      expect(getStrengthLabel(59).level).toBe('medium');
    });

    it('强 (60-79)', () => {
      expect(getStrengthLabel(60).level).toBe('strong');
      expect(getStrengthLabel(79).level).toBe('strong');
    });

    it('非常强 (>= 80)', () => {
      expect(getStrengthLabel(80).level).toBe('very-strong');
      expect(getStrengthLabel(200).level).toBe('very-strong');
    });
  });
});

// ============ Lorem Ipsum ============

describe('Lorem Ipsum', () => {
  describe('generateSentence', () => {
    it('英文句子以句号结尾', () => {
      const sentence = generateSentence(LOREM_WORDS, 'en');
      expect(sentence).toMatch(/\.$/);
    });

    it('中文句子以句号结尾', () => {
      const sentence = generateSentence(CHINESE_WORDS, 'zh');
      expect(sentence).toMatch(/。$/);
    });

    it('英文句子首字母大写', () => {
      const sentence = generateSentence(LOREM_WORDS, 'en');
      expect(sentence[0]).toBe(sentence[0].toUpperCase());
    });
  });

  describe('generateParagraph', () => {
    it('英文段落包含多个句子', () => {
      const para = generateParagraph(LOREM_WORDS, 'en');
      const sentenceCount = (para.match(/\./g) || []).length;
      expect(sentenceCount).toBeGreaterThanOrEqual(3);
    });

    it('中文段落包含多个句号', () => {
      const para = generateParagraph(CHINESE_WORDS, 'zh');
      const sentenceCount = (para.match(/。/g) || []).length;
      expect(sentenceCount).toBeGreaterThanOrEqual(3);
    });
  });

  describe('generateLoremIpsum', () => {
    it('生成指定数量的单词', () => {
      const result = generateLoremIpsum('words', 10, 'en');
      expect(result.split(' ')).toHaveLength(10);
    });

    it('生成指定数量的句子', () => {
      const result = generateLoremIpsum('sentences', 3, 'en');
      const sentences = result.split('. ').filter(Boolean);
      expect(sentences.length).toBeGreaterThanOrEqual(3);
    });

    it('生成指定数量的段落', () => {
      const result = generateLoremIpsum('paragraphs', 2, 'en');
      expect(result.split('\n\n')).toHaveLength(2);
    });

    it('数量限制在 1-100', () => {
      const result = generateLoremIpsum('words', 200, 'en');
      expect(result.split(' ')).toHaveLength(100);
    });

    it('中文单词模式', () => {
      const result = generateLoremIpsum('words', 5, 'zh');
      expect(result).toHaveLength(5);
    });
  });
});

// ============ UUID ============

describe('UUID', () => {
  describe('generateUuid', () => {
    it('生成有效 UUID v4 格式', () => {
      const uuid = generateUuid();
      expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    });

    it('每次生成不同 UUID', () => {
      const uuid1 = generateUuid();
      const uuid2 = generateUuid();
      expect(uuid1).not.toBe(uuid2);
    });
  });

  describe('isValidUuid', () => {
    it('有效 UUID', () => {
      expect(isValidUuid('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
      expect(isValidUuid('6ba7b810-9dad-11d1-80b4-00c04fd430c8')).toBe(true);
    });

    it('无效 UUID', () => {
      expect(isValidUuid('')).toBe(false);
      expect(isValidUuid('not-a-uuid')).toBe(false);
      expect(isValidUuid('550e8400-e29b-41d4-a716')).toBe(false);
      expect(isValidUuid('550e8400e29b41d4a716446655440000')).toBe(false);
    });

    it('大小写不敏感', () => {
      expect(isValidUuid('550E8400-E29B-41D4-A716-446655440000')).toBe(true);
    });
  });
});
