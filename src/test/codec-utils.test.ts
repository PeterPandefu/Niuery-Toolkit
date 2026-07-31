import { describe, it, expect } from 'vitest';
import {
  base64Encode,
  base64Decode,
  splitWords,
  convertCase,
  encodeUnicode,
  decodeUnicode,
  urlEncode,
  urlDecode,
  htmlEncode,
  htmlDecode,
  convertNumberBase,
  sortObjectKeys,
  parseJwt,
  isJwtExpired,
  base64UrlDecode,
  parseTimestamp,
  autoDetectUnit,
  escapeString,
  unescapeString,
} from '@/lib/codec-utils';

// ============ Base64 ============

describe('Base64', () => {
  it('encodes ASCII text', () => {
    expect(base64Encode('Hello, World!')).toBe('SGVsbG8sIFdvcmxkIQ==');
  });

  it('decodes ASCII text', () => {
    expect(base64Decode('SGVsbG8sIFdvcmxkIQ==')).toBe('Hello, World!');
  });

  it('encodes/decodes Unicode (中文)', () => {
    const text = '你好世界';
    const encoded = base64Encode(text);
    expect(encoded).toBeTruthy();
    expect(base64Decode(encoded)).toBe(text);
  });

  it('encodes/decodes emoji', () => {
    const text = '🎉🚀';
    const encoded = base64Encode(text);
    expect(base64Decode(encoded)).toBe(text);
  });

  it('encodes URL-safe variant (no +/=)', () => {
    // 使用会产生 + 和 / 的输入
    const text = '>>>???'; // 编码后含特殊字符
    const urlSafe = base64Encode(text, true);
    expect(urlSafe).not.toContain('+');
    expect(urlSafe).not.toContain('/');
    expect(urlSafe).not.toContain('=');
  });

  it('decodes URL-safe variant', () => {
    const text = '测试 URL Safe 编码';
    const encoded = base64Encode(text, true);
    expect(base64Decode(encoded, true)).toBe(text);
  });

  it('handles empty string', () => {
    expect(base64Encode('')).toBe('');
    expect(base64Decode('')).toBe('');
  });

  it('throws on invalid base64 decode', () => {
    expect(() => base64Decode('not-valid!!!')).toThrow();
  });
});

// ============ Case Converter ============

describe('splitWords', () => {
  it('splits camelCase', () => {
    expect(splitWords('helloWorld')).toEqual(['hello', 'World']);
  });

  it('splits PascalCase', () => {
    expect(splitWords('HelloWorld')).toEqual(['Hello', 'World']);
  });

  it('splits snake_case', () => {
    expect(splitWords('hello_world')).toEqual(['hello', 'world']);
  });

  it('splits kebab-case', () => {
    expect(splitWords('hello-world')).toEqual(['hello', 'world']);
  });

  it('splits space separated', () => {
    expect(splitWords('hello world')).toEqual(['hello', 'world']);
  });

  it('handles consecutive capitals', () => {
    expect(splitWords('HTMLParser')).toEqual(['HTML', 'Parser']);
  });

  it('handles empty string', () => {
    expect(splitWords('')).toEqual([]);
  });
});

describe('convertCase', () => {
  const input = 'hello world';

  it('converts to camelCase', () => {
    expect(convertCase(input, 'camelCase')).toBe('helloWorld');
  });

  it('converts to PascalCase', () => {
    expect(convertCase(input, 'PascalCase')).toBe('HelloWorld');
  });

  it('converts to snake_case', () => {
    expect(convertCase(input, 'snake_case')).toBe('hello_world');
  });

  it('converts to CONSTANT_CASE', () => {
    expect(convertCase(input, 'CONSTANT_CASE')).toBe('HELLO_WORLD');
  });

  it('converts to kebab-case', () => {
    expect(convertCase(input, 'kebab-case')).toBe('hello-world');
  });

  it('converts to Title Case', () => {
    expect(convertCase(input, 'Title Case')).toBe('Hello World');
  });

  it('converts to UPPERCASE', () => {
    expect(convertCase(input, 'UPPERCASE')).toBe('HELLO WORLD');
  });

  it('converts to lowercase', () => {
    expect(convertCase('HELLO WORLD', 'lowercase')).toBe('hello world');
  });

  it('handles camelCase input', () => {
    expect(convertCase('myVariableName', 'snake_case')).toBe('my_variable_name');
  });

  it('handles empty string', () => {
    expect(convertCase('', 'camelCase')).toBe('');
  });
});

// ============ Unicode ============

describe('Unicode', () => {
  it('encodes Chinese to \\uXXXX', () => {
    expect(encodeUnicode('你好', 'u4')).toBe('\\u4f60\\u597d');
  });

  it('encodes Chinese to \\UXXXXXXXX', () => {
    expect(encodeUnicode('你', 'u8')).toBe('\\U00004f60');
  });

  it('encodes Chinese to \\x{XXXX}', () => {
    expect(encodeUnicode('你', 'x')).toBe('\\x{4f60}');
  });

  it('preserves ASCII characters', () => {
    expect(encodeUnicode('Hello', 'u4')).toBe('Hello');
  });

  it('decodes \\uXXXX', () => {
    expect(decodeUnicode('\\u4f60\\u597d')).toBe('你好');
  });

  it('decodes \\UXXXXXXXX', () => {
    expect(decodeUnicode('\\U00004f60')).toBe('你');
  });

  it('decodes \\x{XXXX}', () => {
    expect(decodeUnicode('\\x{4f60}')).toBe('你');
  });

  it('round-trips mixed content', () => {
    const text = 'Hello 世界!';
    const encoded = encodeUnicode(text, 'u4');
    expect(decodeUnicode(encoded)).toBe(text);
  });
});

// ============ URL Encode ============

describe('URL Encode/Decode', () => {
  it('encodes component (encodes / and ?)', () => {
    expect(urlEncode('a/b?c=d', 'component')).toBe('a%2Fb%3Fc%3Dd');
  });

  it('encodes URI (preserves / and ?)', () => {
    expect(urlEncode('http://a.com/b?c=d', 'uri')).toBe('http://a.com/b?c=d');
  });

  it('decodes component', () => {
    expect(urlDecode('%E4%BD%A0%E5%A5%BD', 'component')).toBe('你好');
  });

  it('round-trips Chinese text', () => {
    const text = '你好 世界';
    expect(urlDecode(urlEncode(text, 'component'), 'component')).toBe(text);
  });

  it('encodes spaces as %20 in component mode', () => {
    expect(urlEncode('a b', 'component')).toBe('a%20b');
  });
});

// ============ HTML Entity ============

describe('HTML Entity', () => {
  it('encodes special characters with named entities', () => {
    expect(htmlEncode('<div class="test">&</div>', true)).toBe(
      '&lt;div class=&quot;test&quot;&gt;&amp;&lt;/div&gt;'
    );
  });

  it('encodes with numeric entities', () => {
    expect(htmlEncode('&', false)).toBe('&#38;');
    expect(htmlEncode('<', false)).toBe('&#60;');
  });

  it('decodes named entities', () => {
    expect(htmlDecode('&lt;div&gt;&amp;&lt;/div&gt;')).toBe('<div>&</div>');
  });

  it('decodes numeric entities', () => {
    expect(htmlDecode('&#60;&#62;')).toBe('<>');
  });

  it('decodes hex entities', () => {
    expect(htmlDecode('&#x3C;&#x3E;')).toBe('<>');
  });

  it('round-trips', () => {
    const text = '<script>alert("xss")</script>';
    expect(htmlDecode(htmlEncode(text, true))).toBe(text);
  });
});

// ============ Number Base ============

describe('Number Base Converter', () => {
  it('converts decimal 255 to all bases', () => {
    const result = convertNumberBase('255', 10);
    expect(result).toEqual({
      binary: '11111111',
      octal: '377',
      decimal: '255',
      hex: 'FF',
    });
  });

  it('converts binary 1010 to all bases', () => {
    const result = convertNumberBase('1010', 2);
    expect(result).toEqual({
      binary: '1010',
      octal: '12',
      decimal: '10',
      hex: 'A',
    });
  });

  it('converts hex FF to all bases', () => {
    const result = convertNumberBase('FF', 16);
    expect(result).toEqual({
      binary: '11111111',
      octal: '377',
      decimal: '255',
      hex: 'FF',
    });
  });

  it('converts octal 77 to all bases', () => {
    const result = convertNumberBase('77', 8);
    expect(result).toEqual({
      binary: '111111',
      octal: '77',
      decimal: '63',
      hex: '3F',
    });
  });

  it('handles negative decimal', () => {
    const result = convertNumberBase('-10', 10);
    expect(result).toEqual({
      binary: '-1010',
      octal: '-12',
      decimal: '-10',
      hex: '-A',
    });
  });

  it('rejects invalid binary', () => {
    const result = convertNumberBase('123', 2);
    expect(result).toEqual({ error: '无效的2进制数' });
  });

  it('rejects invalid hex', () => {
    const result = convertNumberBase('GG', 16);
    expect(result).toEqual({ error: '无效的16进制数' });
  });

  it('handles empty input', () => {
    const result = convertNumberBase('', 10);
    expect(result).toEqual({ error: '输入为空' });
  });
});

// ============ JSON Sort ============

describe('sortObjectKeys', () => {
  it('returns object unchanged with mode none', () => {
    const obj = { b: 1, a: 2 };
    expect(sortObjectKeys(obj, 'none')).toEqual({ b: 1, a: 2 });
  });

  it('sorts keys alphabetically', () => {
    const obj = { c: 3, a: 1, b: 2 };
    const result = sortObjectKeys(obj, 'alpha') as Record<string, number>;
    expect(Object.keys(result)).toEqual(['a', 'b', 'c']);
  });

  it('sorts keys reverse alphabetically', () => {
    const obj = { a: 1, c: 3, b: 2 };
    const result = sortObjectKeys(obj, 'alpha-desc') as Record<string, number>;
    expect(Object.keys(result)).toEqual(['c', 'b', 'a']);
  });

  it('sorts nested objects', () => {
    const obj = { z: { b: 2, a: 1 }, a: 0 };
    const result = sortObjectKeys(obj, 'alpha') as Record<string, unknown>;
    expect(Object.keys(result)).toEqual(['a', 'z']);
    expect(Object.keys(result.z as Record<string, number>)).toEqual(['a', 'b']);
  });

  it('handles arrays (preserves order, sorts inner objects)', () => {
    const obj = { items: [{ b: 2, a: 1 }] };
    const result = sortObjectKeys(obj, 'alpha') as { items: Record<string, number>[] };
    expect(Object.keys(result.items[0])).toEqual(['a', 'b']);
  });

  it('handles primitives', () => {
    expect(sortObjectKeys(42, 'alpha')).toBe(42);
    expect(sortObjectKeys('str', 'alpha')).toBe('str');
    expect(sortObjectKeys(null, 'alpha')).toBe(null);
  });
});

// ============ JWT ============

describe('JWT Parser', () => {
  // 标准测试 JWT: {"alg":"HS256","typ":"JWT"}.{"sub":"1234567890","name":"John Doe","iat":1516239022}.signature
  const validJwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';

  it('parses a valid JWT', () => {
    const result = parseJwt(validJwt);
    expect(result).not.toHaveProperty('error');
    if (!('error' in result)) {
      expect(result.header).toEqual({ alg: 'HS256', typ: 'JWT' });
      expect(result.payload.sub).toBe('1234567890');
      expect(result.payload.name).toBe('John Doe');
      expect(result.payload.iat).toBe(1516239022);
      expect(result.signature).toBe('SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c');
    }
  });

  it('rejects JWT with wrong number of parts', () => {
    const result = parseJwt('only.two');
    expect(result).toHaveProperty('error');
  });

  it('rejects JWT with invalid base64', () => {
    const result = parseJwt('invalid!!!.also-invalid!!!.sig');
    expect(result).toHaveProperty('error');
  });

  it('handles empty token', () => {
    const result = parseJwt('');
    expect(result).toHaveProperty('error');
  });

  it('base64UrlDecode handles URL-safe characters', () => {
    // eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9 decodes to {"alg":"HS256","typ":"JWT"}
    const decoded = base64UrlDecode('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
    expect(JSON.parse(decoded)).toEqual({ alg: 'HS256', typ: 'JWT' });
  });
});

describe('JWT Expiration', () => {
  it('returns null when no exp claim', () => {
    expect(isJwtExpired({ sub: '123' })).toBe(null);
  });

  it('detects expired token', () => {
    // exp in the past (year 2000)
    expect(isJwtExpired({ exp: 946684800 })).toBe(true);
  });

  it('detects valid (non-expired) token', () => {
    // exp far in the future (year 2100)
    expect(isJwtExpired({ exp: 4102444800 })).toBe(false);
  });
});

// ============ Timestamp ============

describe('Timestamp Parser', () => {
  it('parses seconds timestamp', () => {
    const result = parseTimestamp('1516239022', 's');
    expect(result).not.toHaveProperty('error');
    if (!('error' in result)) {
      expect(result.seconds).toBe(1516239022);
      expect(result.milliseconds).toBe(1516239022000);
      expect(result.iso).toBe('2018-01-18T01:30:22.000Z');
    }
  });

  it('parses milliseconds timestamp', () => {
    const result = parseTimestamp('1516239022000', 'ms');
    expect(result).not.toHaveProperty('error');
    if (!('error' in result)) {
      expect(result.seconds).toBe(1516239022);
      expect(result.milliseconds).toBe(1516239022000);
    }
  });

  it('rejects invalid timestamp', () => {
    const result = parseTimestamp('not-a-number', 's');
    expect(result).toEqual({ error: '无效时间戳' });
  });

  it('handles epoch zero', () => {
    const result = parseTimestamp('0', 's');
    if (!('error' in result)) {
      expect(result.iso).toBe('1970-01-01T00:00:00.000Z');
    }
  });
});

describe('autoDetectUnit', () => {
  it('detects seconds for small values', () => {
    expect(autoDetectUnit('1516239022')).toBe('s');
  });

  it('detects milliseconds for large values', () => {
    expect(autoDetectUnit('1516239022000')).toBe('ms');
  });

  it('detects seconds for zero', () => {
    expect(autoDetectUnit('0')).toBe('s');
  });
});

// ============ Escape/Unescape ============

describe('Escape/Unescape', () => {
  it('escapes JSON string', () => {
    expect(escapeString('hello\n"world"', 'json')).toBe('hello\\n\\"world\\"');
  });

  it('unescapes JSON string', () => {
    expect(unescapeString('hello\\nworld', 'json')).toBe('hello\nworld');
  });

  it('escapes regex special chars', () => {
    expect(escapeString('a.b*c', 'regex')).toBe('a\\.b\\*c');
  });

  it('escapes string mode', () => {
    const result = escapeString('line1\nline2\ttab', 'string');
    expect(result).toContain('\\n');
    expect(result).toContain('\\t');
  });

  it('unescapes string mode', () => {
    expect(unescapeString('line1\\nline2', 'string')).toBe('line1\nline2');
  });

  it('handles empty string', () => {
    expect(escapeString('', 'json')).toBe('');
    expect(unescapeString('', 'json')).toBe('');
  });
});
