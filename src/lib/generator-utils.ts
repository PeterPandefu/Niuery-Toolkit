/**
 * 生成器工具函数
 * 密码生成、熵值计算、Lorem Ipsum 等纯函数
 */

// ============ 密码生成器 ============

export const CHARSETS = {
  lowercase: 'abcdefghijklmnopqrstuvwxyz',
  uppercase: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  numbers: '0123456789',
  symbols: '!@#$%^&*()_+-=[]{}|;:,.<>?',
};

const AMBIGUOUS = 'oO0l1I|';

export interface PasswordOptions {
  lowercase: boolean;
  uppercase: boolean;
  numbers: boolean;
  symbols: boolean;
}

/** 生成密码 */
export function generatePassword(
  length: number,
  options: PasswordOptions,
  excludeAmbiguous: boolean
): string {
  let chars = '';
  if (options.lowercase) chars += CHARSETS.lowercase;
  if (options.uppercase) chars += CHARSETS.uppercase;
  if (options.numbers) chars += CHARSETS.numbers;
  if (options.symbols) chars += CHARSETS.symbols;

  if (excludeAmbiguous) {
    chars = chars.split('').filter((c) => !AMBIGUOUS.includes(c)).join('');
  }

  if (!chars) return '';

  const array = new Uint32Array(length);
  crypto.getRandomValues(array);
  return Array.from(array, (n) => chars[n % chars.length]).join('');
}

/** 计算密码熵值 (bits) */
export function calculateEntropy(password: string): number {
  if (!password) return 0;
  let poolSize = 0;
  if (/[a-z]/.test(password)) poolSize += 26;
  if (/[A-Z]/.test(password)) poolSize += 26;
  if (/[0-9]/.test(password)) poolSize += 10;
  if (/[^a-zA-Z0-9]/.test(password)) poolSize += 32;
  return Math.round(password.length * Math.log2(poolSize || 1));
}

/** 获取强度标签 */
export function getStrengthLabel(entropy: number): { label: string; level: 'weak' | 'medium' | 'strong' | 'very-strong' } {
  if (entropy < 40) return { label: '弱', level: 'weak' };
  if (entropy < 60) return { label: '中等', level: 'medium' };
  if (entropy < 80) return { label: '强', level: 'strong' };
  return { label: '非常强', level: 'very-strong' };
}

// ============ Lorem Ipsum ============

export const LOREM_WORDS =
  'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua enim ad minim veniam quis nostrud exercitation ullamco laboris nisi aliquip ex ea commodo consequat duis aute irure in reprehenderit voluptate velit esse cillum fugiat nulla pariatur excepteur sint occaecat cupidatat non proident sunt culpa qui officia deserunt mollit anim id est laborum'.split(' ');

export const CHINESE_WORDS =
  '天地玄黄宇宙洪荒日月盈昃辰宿列张寒来暑往秋收冬藏闰余成岁律吕调阳云腾致雨露结为霜金生丽水玉出昆冈剑号巨阙珠称夜光果珍李柰菜重芥姜海咸河淡鳞潜羽翔龙师火帝鸟官人皇始制文字乃服衣裳推位让国有虞陶唐吊民伐罪周发殷汤坐朝问道垂拱平章爱育黎首臣伏戎羌遐迩一体率宾归王'.split('');

export type LoremType = 'paragraphs' | 'sentences' | 'words';
export type LoremLang = 'en' | 'zh';

/** 生成句子 */
export function generateSentence(words: string[], lang: LoremLang): string {
  const length = 8 + Math.floor(Math.random() * 12);
  const sentence: string[] = [];
  for (let i = 0; i < length; i++) {
    sentence.push(words[Math.floor(Math.random() * words.length)]);
  }
  const result = lang === 'en' ? sentence.join(' ') : sentence.join('');
  return result.charAt(0).toUpperCase() + result.slice(1) + (lang === 'en' ? '.' : '。');
}

/** 生成段落 */
export function generateParagraph(words: string[], lang: LoremLang): string {
  const sentences = 3 + Math.floor(Math.random() * 4);
  const paragraph: string[] = [];
  for (let i = 0; i < sentences; i++) {
    paragraph.push(generateSentence(words, lang));
  }
  return paragraph.join(lang === 'en' ? ' ' : '');
}

/** 生成 Lorem Ipsum 文本 */
export function generateLoremIpsum(type: LoremType, count: number, lang: LoremLang): string {
  const num = Math.min(Math.max(count, 1), 100);
  const words = lang === 'en' ? LOREM_WORDS : CHINESE_WORDS;

  switch (type) {
    case 'paragraphs':
      return Array.from({ length: num }, () => generateParagraph(words, lang)).join('\n\n');
    case 'sentences':
      return Array.from({ length: num }, () => generateSentence(words, lang)).join(lang === 'en' ? ' ' : '');
    case 'words':
      return Array.from({ length: num }, () => words[Math.floor(Math.random() * words.length)]).join(lang === 'en' ? ' ' : '');
  }
}

// ============ UUID ============

/** 生成 UUID v4 */
export function generateUuid(): string {
  return crypto.randomUUID();
}

/** 验证 UUID 格式 */
export function isValidUuid(str: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(str.trim());
}
