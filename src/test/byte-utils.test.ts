import { describe, it, expect } from 'vitest';
import {
  encodeText,
  decodeBytes,
  parseHex,
  formatBytes,
  buildHexDump,
  segmentBytes,
  countControlBytes,
  hasUtf8Bom,
  countCodePoints,
  EncodeError,
  MAX_INVALID_RANGES,
  type ByteEncoding,
  type ByteFormat,
} from '@/lib/byte-utils';

const ENCODINGS: ByteEncoding[] = ['utf-8', 'gbk', 'gb18030'];

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(' ');
}

// ============ 编码 ============

describe('encodeText', () => {
  it('UTF-8 编码 ASCII 与中文', () => {
    expect(hex(encodeText('Hi', 'utf-8'))).toBe('48 69');
    expect(hex(encodeText('你好', 'utf-8'))).toBe('e4 bd a0 e5 a5 bd');
  });

  it('GBK 编码中文与欧元符号', () => {
    expect(hex(encodeText('你好', 'gbk'))).toBe('c4 e3 ba c3');
    expect(hex(encodeText('€', 'gbk'))).toBe('a2 e3');
  });

  it('GB18030 双字节区与 GBK 一致', () => {
    expect(hex(encodeText('你好世界', 'gb18030'))).toBe('c4 e3 ba c3 ca c0 bd e7');
    expect(hex(encodeText('€', 'gb18030'))).toBe('a2 e3');
  });

  it('GB18030 四字节区覆盖扩展汉字与补充平面', () => {
    expect(hex(encodeText('㐀', 'gb18030'))).toBe('81 39 ee 39');
    expect(hex(encodeText('𠀀', 'gb18030'))).toBe('95 32 82 36');
    expect(hex(encodeText('😀', 'gb18030'))).toBe('94 39 fc 36');
  });

  it('GB18030 处理 BMP 段内的 PUA 乱序码位', () => {
    expect(hex(encodeText('\uE7C7', 'gb18030'))).toBe('81 35 f4 37');
    expect(hex(encodeText('\u1E40', 'gb18030'))).toBe('81 35 f4 38');
  });

  it('GB18030 边界码位 U+0080 / U+FFFF / U+10FFFF', () => {
    expect(hex(encodeText('\u0080', 'gb18030'))).toBe('81 30 81 30');
    expect(hex(encodeText('\uFFFF', 'gb18030'))).toBe('84 31 a4 39');
    expect(hex(encodeText('\u{10FFFF}', 'gb18030'))).toBe('e3 32 9a 35');
  });

  it('空文本得到空字节', () => {
    for (const encoding of ENCODINGS) {
      expect(encodeText('', encoding)).toHaveLength(0);
    }
  });

  it('GBK 遇到不可编码字符抛错并给出码点序号', () => {
    expect(() => encodeText('你好😀', 'gbk')).toThrow(EncodeError);
    try {
      encodeText('你好😀', 'gbk');
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(EncodeError);
      const failure = error as EncodeError;
      expect(failure.char).toBe('😀');
      expect(failure.index).toBe(2);
      expect(failure.encoding).toBe('gbk');
      expect(failure.message).toContain('U+1F600');
    }
  });

  it('代理对按单个码点计数，不会把高低代理分别报错', () => {
    expect(hex(encodeText('😀', 'utf-8'))).toBe('f0 9f 98 80');
    expect(() => encodeText('😀', 'gbk')).toThrow(/第 1 个字符/);
  });

  it('三编码往返一致（含扩展汉字与边界码位）', () => {
    const samples = ['Hi', '你好世界', '€', '㐀', '𠀀', '😀', '\u0080', '\u00BC', '\u1E40', '\uE7C7', '\uFFFF', '\u{10FFFF}', '报文\r\n测试\t0x41'];
    for (const encoding of ENCODINGS) {
      for (const text of samples) {
        let bytes: Uint8Array;
        try {
          bytes = encodeText(text, encoding);
        } catch (error) {
          expect(error).toBeInstanceOf(EncodeError);
          continue;
        }
        const result = decodeBytes(bytes, encoding);
        expect(result.invalid).toEqual([]);
        expect(result.text).toBe(text);
      }
    }
  });

  it('GBK 双字节全集往返一致', () => {
    const decoder = new TextDecoder('gbk');
    let checked = 0;
    for (let lead = 0x81; lead <= 0xfe; lead++) {
      for (let trail = 0x40; trail <= 0xfe; trail++) {
        if (trail === 0x7f) continue;
        const char = decoder.decode(new Uint8Array([lead, trail]));
        if (char.length !== 1 || char === '\uFFFD') continue;
        expect(decodeBytes(encodeText(char, 'gbk'), 'gbk').text).toBe(char);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(20000);
  });

  it('GB18030 对确实无法表示的 PUA 码位明确报错', () => {
    expect(() => encodeText('\uE854', 'gb18030')).toThrow(EncodeError);
    expect(() => encodeText('\uE5E5', 'gb18030')).toThrow(EncodeError);
  });

  it('GB18030 大范围码位往返抽样零误差', () => {
    const codePoints: number[] = [];
    for (let cp = 0x80; cp < 0x10000; cp += 37) codePoints.push(cp);
    for (let cp = 0x10000; cp <= 0x10ffff; cp += 997) codePoints.push(cp);

    let encoded = 0;
    let unrepresentable = 0;
    for (const cp of codePoints) {
      if (cp >= 0xd800 && cp <= 0xdfff) continue;
      const char = String.fromCodePoint(cp);
      let bytes: Uint8Array;
      try {
        bytes = encodeText(char, 'gb18030');
      } catch (error) {
        expect(error).toBeInstanceOf(EncodeError);
        unrepresentable++;
        continue;
      }
      expect(decodeBytes(bytes, 'gb18030').text).toBe(char);
      encoded++;
    }
    // GB18030 仅缺少少量 PUA 码位，抽样绝大多数必须可编码
    expect(encoded).toBeGreaterThan(codePoints.length * 0.95);
    expect(unrepresentable).toBeLessThan(codePoints.length * 0.05);
  });
});

// ============ 解码 ============

describe('decodeBytes', () => {
  it('按编码解码字节', () => {
    expect(decodeBytes(Uint8Array.from([0xc4, 0xe3, 0xba, 0xc3]), 'gbk').text).toBe('你好');
    expect(decodeBytes(Uint8Array.from([0xe4, 0xbd, 0xa0]), 'utf-8').text).toBe('你');
    expect(decodeBytes(Uint8Array.from([0x95, 0x32, 0x82, 0x36]), 'gb18030').text).toBe('𠀀');
  });

  it('单字节 0x80 解为欧元符号', () => {
    expect(decodeBytes(Uint8Array.from([0x80]), 'gbk').text).toBe('€');
    expect(decodeBytes(Uint8Array.from([0x80]), 'gb18030').text).toBe('€');
  });

  it('合法字节不产生非法区间', () => {
    const result = decodeBytes(encodeText('你好 Hello', 'utf-8'), 'utf-8');
    expect(result.invalid).toEqual([]);
    expect(result.invalidTruncated).toBe(false);
  });

  it('定位 UTF-8 非法字节偏移', () => {
    const result = decodeBytes(Uint8Array.from([0x48, 0xff, 0x69]), 'utf-8');
    expect(result.text).toBe('H\uFFFDi');
    expect(result.invalid).toEqual([{ offset: 1, length: 1 }]);
  });

  it('定位多字节序列截断的偏移与长度', () => {
    const result = decodeBytes(Uint8Array.from([0x41, 0xe4, 0xbd]), 'utf-8');
    expect(result.invalid).toEqual([{ offset: 1, length: 2 }]);
  });

  it('定位 GBK 非法尾字节与末尾孤立首字节', () => {
    // 运行时把 C4 判为单字节非法，28 仍作为 '(' 正常解码
    const trail = decodeBytes(Uint8Array.from([0xc4, 0x28]), 'gbk');
    expect(trail.text).toBe('\uFFFD(');
    expect(trail.invalid).toEqual([{ offset: 0, length: 1 }]);
    expect(decodeBytes(Uint8Array.from([0x41, 0xc4]), 'gbk').invalid).toEqual([{ offset: 1, length: 1 }]);
  });

  it('定位 GB18030 保留区四字节序列', () => {
    const result = decodeBytes(Uint8Array.from([0x84, 0x31, 0xa5, 0x30]), 'gb18030');
    expect(result.text).toBe('\uFFFD');
    expect(result.invalid).toEqual([{ offset: 0, length: 4 }]);
  });

  it('多处非法字节各自定位', () => {
    const result = decodeBytes(Uint8Array.from([0xff, 0x41, 0xff, 0x42, 0xff]), 'utf-8');
    expect(result.invalid).toEqual([
      { offset: 0, length: 1 },
      { offset: 2, length: 1 },
      { offset: 4, length: 1 },
    ]);
  });

  it('非法片段过多时截断报告', () => {
    const bytes = new Uint8Array(MAX_INVALID_RANGES * 4).fill(0xff);
    const result = decodeBytes(bytes, 'utf-8');
    expect(result.invalid).toHaveLength(MAX_INVALID_RANGES);
    expect(result.invalidTruncated).toBe(true);
  });

  it('空字节解码为空文本', () => {
    for (const encoding of ENCODINGS) {
      expect(decodeBytes(new Uint8Array(0), encoding)).toEqual({ text: '', invalid: [], invalidTruncated: false });
    }
  });
});

// ============ HEX 解析 ============

describe('parseHex', () => {
  it('解析空格分隔的十六进制', () => {
    const result = parseHex('48 65 6C');
    expect('bytes' in result && hex(result.bytes)).toBe('48 65 6c');
  });

  it('容忍多种分隔符与大小写混排', () => {
    const expected = '48 65 6c';
    for (const input of ['48656C', '48,65,6c', '48;65:6c', '48_65-6c', '48|65.6c', '48/65/6C', ' 48\t65\n6c\r\n', '48 65 6C']) {
      const result = parseHex(input);
      expect('bytes' in result && hex(result.bytes)).toBe(expected);
    }
  });

  it('剥离 0x 与 \\x 前缀', () => {
    for (const input of ['0x48, 0x65, 0x6C', '0X48 0X65 0X6C', '\\x48\\x65\\x6c', '0x48656C']) {
      const result = parseHex(input);
      expect('bytes' in result && hex(result.bytes)).toBe('48 65 6c');
    }
  });

  it('词中的 0 不被当作前缀吞掉', () => {
    const result = parseHex('A0 B1');
    expect('bytes' in result && hex(result.bytes)).toBe('a0 b1');
    const invalid = parseHex('A0xB1');
    expect('error' in invalid && invalid.position).toBe(2);
  });

  it('空输入得到空字节', () => {
    for (const input of ['', '   ', '\n\t', '0x']) {
      const result = parseHex(input);
      expect('bytes' in result && result.bytes).toHaveLength(0);
    }
  });

  it('非法字符给出原文位置', () => {
    const result = parseHex('48 6G 6C');
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.position).toBe(4);
      expect(result.error).toContain('G');
    }
  });

  it('奇数位数给出末尾位置', () => {
    const result = parseHex('48 6');
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.position).toBe(3);
      expect(result.error).toContain('奇数');
    }
  });

  it('与 formatBytes 各格式往返一致', () => {
    const bytes = encodeText('你好 Hello 123', 'utf-8');
    const formats: ByteFormat[] = ['hex-space', 'hex-plain', 'hex-0x', 'escape'];
    for (const format of formats) {
      for (const upper of [false, true]) {
        const result = parseHex(formatBytes(bytes, format, upper));
        expect('bytes' in result && Array.from(result.bytes)).toEqual(Array.from(bytes));
      }
    }
  });
});

// ============ 字节格式化 ============

describe('formatBytes', () => {
  const bytes = Uint8Array.from([0x48, 0x65, 0x6c]);

  it('六种格式输出', () => {
    expect(formatBytes(bytes, 'hex-space')).toBe('48 65 6c');
    expect(formatBytes(bytes, 'hex-plain')).toBe('48656c');
    expect(formatBytes(bytes, 'hex-0x')).toBe('0x48, 0x65, 0x6c');
    expect(formatBytes(bytes, 'dec')).toBe('72 101 108');
    expect(formatBytes(bytes, 'escape')).toBe('\\x48\\x65\\x6c');
    expect(formatBytes(bytes, 'c-array')).toBe('{ 0x48, 0x65, 0x6c }');
  });

  it('大写只影响十六进制数字', () => {
    expect(formatBytes(bytes, 'hex-space', true)).toBe('48 65 6C');
    expect(formatBytes(Uint8Array.from([0xab]), 'hex-0x', true)).toBe('0xAB');
    expect(formatBytes(Uint8Array.from([0xab]), 'escape', true)).toBe('\\xAB');
    expect(formatBytes(bytes, 'dec', true)).toBe('72 101 108');
  });

  it('空字节各格式输出', () => {
    expect(formatBytes(new Uint8Array(0), 'hex-space')).toBe('');
    expect(formatBytes(new Uint8Array(0), 'c-array')).toBe('{ }');
  });

  it('单字节补零', () => {
    expect(formatBytes(Uint8Array.from([0x00, 0x0f]), 'hex-space')).toBe('00 0f');
  });
});

// ============ 报文视图 ============

describe('buildHexDump', () => {
  it('按行给出偏移、十六进制与 ASCII 侧栏', () => {
    const lines = buildHexDump(encodeText('Hello', 'utf-8'), 16);
    expect(lines).toHaveLength(1);
    expect(lines[0].offset).toBe(0);
    expect(lines[0].hex).toEqual(['48', '65', '6c', '6c', '6f']);
    expect(lines[0].ascii).toBe('Hello');
  });

  it('末行不足宽度时不补齐', () => {
    const lines = buildHexDump(new Uint8Array(20), 16);
    expect(lines).toHaveLength(2);
    expect(lines[1].offset).toBe(16);
    expect(lines[1].hex).toHaveLength(4);
  });

  it('不可打印字节在 ASCII 侧栏显示为点', () => {
    const lines = buildHexDump(Uint8Array.from([0x41, 0x00, 0x7f, 0x0a, 0x42]), 16);
    expect(lines[0].ascii).toBe('A...B');
  });

  it('每行字节数被钳制在 1..64', () => {
    expect(buildHexDump(new Uint8Array(8), 0)).toHaveLength(1);
    expect(buildHexDump(new Uint8Array(8), 1)).toHaveLength(8);
    expect(buildHexDump(new Uint8Array(128), 999)).toHaveLength(2);
  });

  it('大写选项作用于十六进制列', () => {
    expect(buildHexDump(Uint8Array.from([0xab]), 16, true)[0].hex).toEqual(['AB']);
  });

  it('空字节不产生行', () => {
    expect(buildHexDump(new Uint8Array(0))).toEqual([]);
  });
});

describe('segmentBytes', () => {
  it('UTF-8 逐字符给出偏移与占用字节', () => {
    const segments = segmentBytes(encodeText('A你😀', 'utf-8'), 'utf-8');
    expect(segments.map((s) => [s.text, s.offset, s.length])).toEqual([
      ['A', 0, 1],
      ['你', 1, 3],
      ['😀', 4, 4],
    ]);
    expect(segments.every((s) => s.valid)).toBe(true);
    expect(segments[2].codePoint).toBe(0x1f600);
  });

  it('GBK 双字节字符分段', () => {
    const segments = segmentBytes(encodeText('A你', 'gbk'), 'gbk');
    expect(segments.map((s) => [s.text, s.offset, s.length])).toEqual([
      ['A', 0, 1],
      ['你', 1, 2],
    ]);
  });

  it('GB18030 混合双字节与四字节分段', () => {
    const segments = segmentBytes(encodeText('你㐀😀', 'gb18030'), 'gb18030');
    expect(segments.map((s) => [s.text, s.offset, s.length])).toEqual([
      ['你', 0, 2],
      ['㐀', 2, 4],
      ['😀', 6, 4],
    ]);
  });

  it('非法片段标记为 invalid 且码点为 -1', () => {
    const segments = segmentBytes(Uint8Array.from([0x41, 0xff, 0x42]), 'utf-8');
    expect(segments[1]).toMatchObject({ offset: 1, length: 1, valid: false, codePoint: -1 });
    expect(segments[2]).toMatchObject({ offset: 2, text: 'B', valid: true });
  });

  it('limit 只返回前 N 段', () => {
    const bytes = encodeText('abcdefghij', 'utf-8');
    expect(segmentBytes(bytes, 'utf-8', 3)).toHaveLength(3);
    expect(segmentBytes(bytes, 'utf-8')).toHaveLength(10);
  });

  it('与 decodeBytes 的非法区间一致', () => {
    const bytes = Uint8Array.from([0x41, 0xe4, 0xbd, 0x42, 0xff]);
    const segments = segmentBytes(bytes, 'utf-8');
    const invalid = segments.filter((s) => !s.valid).map((s) => ({ offset: s.offset, length: s.length }));
    expect(invalid).toEqual(decodeBytes(bytes, 'utf-8').invalid);
  });
});

describe('统计辅助', () => {
  it('countControlBytes 保留制表与换行', () => {
    expect(countControlBytes(Uint8Array.from([0x41, 0x09, 0x0a, 0x0d]))).toBe(0);
    expect(countControlBytes(Uint8Array.from([0x00, 0x1f, 0x7f, 0x41]))).toBe(3);
    expect(countControlBytes(encodeText('你好', 'utf-8'))).toBe(0);
  });

  it('hasUtf8Bom 只识别 EF BB BF', () => {
    expect(hasUtf8Bom(Uint8Array.from([0xef, 0xbb, 0xbf, 0x41]))).toBe(true);
    expect(hasUtf8Bom(Uint8Array.from([0xef, 0xbb]))).toBe(false);
    expect(hasUtf8Bom(encodeText('你好', 'utf-8'))).toBe(false);
  });

  it('countCodePoints 按码点而非 UTF-16 单元计数', () => {
    expect(countCodePoints('')).toBe(0);
    expect(countCodePoints('abc')).toBe(3);
    expect(countCodePoints('你好')).toBe(2);
    expect(countCodePoints('😀')).toBe(1);
    expect(countCodePoints('a😀b')).toBe(3);
  });
});