/**
 * 核心编码/解码/转换工具函数
 * 从各工具组件中提取的纯函数，便于单元测试
 */

// ============ Base64 ============

export function base64Encode(str: string, urlSafe = false): string {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  let result = btoa(binary);
  if (urlSafe) {
    result = result.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  return result;
}

export function base64Decode(str: string, urlSafe = false): string {
  let input = str;
  if (urlSafe) {
    input = input.replace(/-/g, '+').replace(/_/g, '/');
    while (input.length % 4) input += '=';
  }
  const binary = atob(input);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

// ============ Case Converter ============

export type CaseType =
  | 'camelCase'
  | 'PascalCase'
  | 'snake_case'
  | 'CONSTANT_CASE'
  | 'kebab-case'
  | 'Title Case'
  | 'UPPERCASE'
  | 'lowercase';

export function splitWords(str: string): string[] {
  return str
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/[_\-\s]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

export function convertCase(str: string, type: CaseType): string {
  const words = splitWords(str);
  if (words.length === 0) return '';

  switch (type) {
    case 'camelCase':
      return words
        .map((w, i) =>
          i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
        )
        .join('');
    case 'PascalCase':
      return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join('');
    case 'snake_case':
      return words.map((w) => w.toLowerCase()).join('_');
    case 'CONSTANT_CASE':
      return words.map((w) => w.toUpperCase()).join('_');
    case 'kebab-case':
      return words.map((w) => w.toLowerCase()).join('-');
    case 'Title Case':
      return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
    case 'UPPERCASE':
      return str.toUpperCase();
    case 'lowercase':
      return str.toLowerCase();
    default:
      return str;
  }
}

// ============ Unicode ============

export type UnicodeFormat = 'u4' | 'u8' | 'x';

export function encodeUnicode(str: string, format: UnicodeFormat = 'u4'): string {
  return Array.from(str)
    .map((char) => {
      const code = char.codePointAt(0)!;
      if (code < 128) return char; // ASCII 不转义
      switch (format) {
        case 'u4':
          return code > 0xffff
            ? `\\u{${code.toString(16)}}`
            : `\\u${code.toString(16).padStart(4, '0')}`;
        case 'u8':
          return `\\U${code.toString(16).padStart(8, '0')}`;
        case 'x':
          return `\\x{${code.toString(16)}}`;
        default:
          return char;
      }
    })
    .join('');
}

export function decodeUnicode(str: string): string {
  return str
    .replace(/\\U([0-9a-fA-F]{8})/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/\\u\{([0-9a-fA-F]+)\}/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\x\{([0-9a-fA-F]+)\}/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)));
}

// ============ URL Encode ============

export function urlEncode(str: string, mode: 'component' | 'uri' = 'component'): string {
  return mode === 'component' ? encodeURIComponent(str) : encodeURI(str);
}

export function urlDecode(str: string, mode: 'component' | 'uri' = 'component'): string {
  return mode === 'component' ? decodeURIComponent(str) : decodeURI(str);
}

// ============ HTML Entity ============

const HTML_ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function htmlEncode(str: string, useNamed = true): string {
  return str.replace(/[&<>"']/g, (char) => {
    if (useNamed && HTML_ENTITIES[char]) return HTML_ENTITIES[char];
    return `&#${char.charCodeAt(0)};`;
  });
}

export function htmlDecode(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

// ============ Number Base ============

export interface BaseResult {
  binary: string;
  octal: string;
  decimal: string;
  hex: string;
}

export function convertNumberBase(input: string, base: 2 | 8 | 10 | 16): BaseResult | { error: string } {
  const validChars: Record<number, RegExp> = {
    2: /^[01]+$/,
    8: /^[0-7]+$/,
    10: /^-?\d+$/,
    16: /^[0-9a-fA-F]+$/,
  };

  const cleanInput = input.trim().toLowerCase();
  if (!cleanInput) return { error: '输入为空' };
  if (!validChars[base].test(cleanInput)) {
    return { error: `无效的${base}进制数` };
  }

  try {
    let decimal: bigint;
    if (base === 10) {
      decimal = BigInt(cleanInput);
    } else {
      decimal = BigInt(parseInt(cleanInput, base));
    }

    const isNegative = decimal < 0n;
    const abs = isNegative ? -decimal : decimal;

    return {
      binary: (isNegative ? '-' : '') + abs.toString(2),
      octal: (isNegative ? '-' : '') + abs.toString(8),
      decimal: (isNegative ? '-' : '') + abs.toString(10),
      hex: (isNegative ? '-' : '') + abs.toString(16).toUpperCase(),
    };
  } catch {
    return { error: '解析失败' };
  }
}

// ============ JWT ============

export interface JwtParts {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
  signature: string;
}

export function base64UrlDecode(str: string): string {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) base64 += '=';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

export function parseJwt(token: string): JwtParts | { error: string } {
  const parts = token.trim().split('.');
  if (parts.length !== 3) {
    return { error: '无效的 JWT 格式：应包含 3 个部分（header.payload.signature）' };
  }

  try {
    const header = JSON.parse(base64UrlDecode(parts[0]));
    const payload = JSON.parse(base64UrlDecode(parts[1]));
    return { header, payload, signature: parts[2] };
  } catch {
    return { error: '解码失败：无效的 Base64URL 编码' };
  }
}

export function isJwtExpired(payload: Record<string, unknown>): boolean | null {
  const exp = payload.exp as number | undefined;
  if (exp === undefined) return null;
  return Date.now() > exp * 1000;
}

// ============ Timestamp ============

export interface TimestampResult {
  seconds: number;
  milliseconds: number;
  iso: string;
}

export function parseTimestamp(value: string, unit: 's' | 'ms' = 's'): TimestampResult | { error: string } {
  const num = Number(value);
  if (isNaN(num)) return { error: '无效时间戳' };
  const ms = unit === 's' ? num * 1000 : num;
  const d = new Date(ms);
  if (isNaN(d.getTime())) return { error: '无效时间戳' };
  return {
    seconds: Math.floor(ms / 1000),
    milliseconds: ms,
    iso: d.toISOString(),
  };
}

export function autoDetectUnit(value: string): 's' | 'ms' {
  const num = Number(value);
  // 如果数值大于 1e12，很可能是毫秒
  return Math.abs(num) > 1e12 ? 'ms' : 's';
}

// ============ Escape/Unescape ============

export function escapeString(str: string, mode: 'json' | 'string' | 'regex' = 'json'): string {
  switch (mode) {
    case 'json':
      return JSON.stringify(str).slice(1, -1);
    case 'string':
      return str
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r')
        .replace(/\t/g, '\\t');
    case 'regex':
      return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    default:
      return str;
  }
}

export function unescapeString(str: string, mode: 'json' | 'string' = 'json'): string {
  switch (mode) {
    case 'json':
      try {
        return JSON.parse(`"${str}"`);
      } catch {
        return str;
      }
    case 'string':
      return str
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '\r')
        .replace(/\\t/g, '\t')
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\');
    default:
      return str;
  }
}

// ============ JSON Sort ============

export type SortMode = 'none' | 'alpha' | 'alpha-desc';

export function sortObjectKeys(obj: unknown, mode: SortMode): unknown {
  if (mode === 'none') return obj;
  if (Array.isArray(obj)) return obj.map((item) => sortObjectKeys(item, mode));
  if (obj !== null && typeof obj === 'object') {
    const sorted: Record<string, unknown> = {};
    const keys = Object.keys(obj as Record<string, unknown>);
    if (mode === 'alpha') keys.sort();
    if (mode === 'alpha-desc') keys.sort().reverse();
    for (const key of keys) {
      sorted[key] = sortObjectKeys((obj as Record<string, unknown>)[key], mode);
    }
    return sorted;
  }
  return obj;
}
