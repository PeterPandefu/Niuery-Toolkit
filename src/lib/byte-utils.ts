/**
 * 字符 ↔ 字节转换与报文字节分析纯函数
 * 从工具组件中提取，便于单元测试
 */

export type ByteEncoding = 'utf-8' | 'gbk' | 'gb18030';

export type ByteFormat = 'hex-space' | 'hex-plain' | 'hex-0x' | 'dec' | 'escape' | 'c-array';

export const BYTE_ENCODING_OPTIONS: { value: ByteEncoding; label: string }[] = [
  { value: 'utf-8', label: 'UTF-8' },
  { value: 'gbk', label: 'GBK' },
  { value: 'gb18030', label: 'GB18030' },
];

export const BYTE_FORMAT_OPTIONS: { value: ByteFormat; label: string; sample: string }[] = [
  { value: 'hex-space', label: 'HEX 空格', sample: '48 65 6C' },
  { value: 'hex-plain', label: 'HEX 连续', sample: '48656C' },
  { value: 'hex-0x', label: '0x 逗号', sample: '0x48, 0x65' },
  { value: 'dec', label: '十进制', sample: '72 101' },
  { value: 'escape', label: '\\x 转义', sample: '\\x48\\x65' },
  { value: 'c-array', label: 'C 数组', sample: '{ 0x48, 0x65 }' },
];

/** 输入与分析上限，避免大报文把 UI 线程和 DOM 拖垮。 */
export const MAX_TEXT_LENGTH = 100_000;
export const MAX_HEX_INPUT_LENGTH = 2_000_000;
export const MAX_ANALYSIS_BYTES = 65_536;
export const MAX_INVALID_RANGES = 200;

const REPLACEMENT = '\uFFFD';

export class EncodeError extends Error {
  readonly char: string;
  /** 码点序号（从 0 开始） */
  readonly index: number;
  readonly encoding: ByteEncoding;

  constructor(char: string, index: number, encoding: ByteEncoding) {
    const codePoint = char.codePointAt(0) ?? 0;
    super(`U+${codePoint.toString(16).toUpperCase().padStart(4, '0')} 无法用 ${encoding.toUpperCase()} 编码（第 ${index + 1} 个字符）`);
    this.name = 'EncodeError';
    this.char = char;
    this.index = index;
    this.encoding = encoding;
  }
}

// ============ 解码器缓存 ============

const decoderCache = new Map<string, TextDecoder>();

function decoderFor(encoding: ByteEncoding, fatal = false): TextDecoder {
  const key = `${encoding}:${fatal}`;
  let decoder = decoderCache.get(key);
  if (!decoder) {
    decoder = new TextDecoder(encoding, { fatal });
    decoderCache.set(key, decoder);
  }
  return decoder;
}

// ============ GBK / GB18030 双字节反查表 ============

// TextEncoder 只输出 UTF-8，GBK 系编码方向必须自建反查表。
const twoByteTables = new Map<ByteEncoding, Map<string, number>>();

function twoByteTable(encoding: ByteEncoding): Map<string, number> {
  const cached = twoByteTables.get(encoding);
  if (cached) return cached;

  const table = new Map<string, number>();
  const decoder = decoderFor(encoding);
  for (let lead = 0x81; lead <= 0xfe; lead++) {
    for (let trail = 0x40; trail <= 0xfe; trail++) {
      if (trail === 0x7f) continue;
      const text = decoder.decode(new Uint8Array([lead, trail]));
      if (text.length !== 1 || text === REPLACEMENT) continue;
      if (!table.has(text)) table.set(text, (lead << 8) | trail);
    }
  }
  twoByteTables.set(encoding, table);
  return table;
}

// ============ GB18030 四字节区索引 ============

const FOUR_BYTE_TOTAL = 126 * 10 * 126 * 10;
const FOUR_BYTE_WINDOW = 1024;

interface FourByteIndex {
  /** BMP 段长度，其后是 0x8431A530-0x8FE39FE39 保留区（解码为 U+FFFD） */
  gapStart: number;
  /** 补充平面段起点，该段与 U+10000-U+10FFFF 严格线性对应 */
  supStart: number;
  anchors: { index: number; codePoint: number }[];
}

let fourByteIndex: FourByteIndex | null = null;

function fourByteSequence(index: number): Uint8Array {
  const fourth = 0x30 + (index % 10);
  let rest = Math.floor(index / 10);
  const third = 0x81 + (rest % 126);
  rest = Math.floor(rest / 126);
  const second = 0x30 + (rest % 10);
  rest = Math.floor(rest / 10);
  return new Uint8Array([0x81 + rest, second, third, fourth]);
}

function codePointAtFourByteIndex(index: number): number {
  if (index < 0 || index >= FOUR_BYTE_TOTAL) return -1;
  const text = decoderFor('gb18030').decode(fourByteSequence(index));
  return text === REPLACEMENT ? -1 : (text.codePointAt(0) ?? -1);
}

/** 指数扩张 + 二分，谓词只需在 [from, 结果] 区间内单调。 */
function firstIndexWhere(predicate: (index: number) => boolean, from: number): number {
  let lo = from;
  let step = 1;
  while (lo < FOUR_BYTE_TOTAL && !predicate(lo)) {
    lo += step;
    step *= 2;
  }
  let hi = Math.min(lo, FOUR_BYTE_TOTAL - 1);
  lo = Math.max(from, lo - step);
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (predicate(mid)) hi = mid;
    else lo = mid + 1;
  }
  return predicate(lo) ? lo : FOUR_BYTE_TOTAL;
}

function gb18030FourByteIndex(): FourByteIndex {
  if (fourByteIndex) return fourByteIndex;
  const gapStart = firstIndexWhere((index) => codePointAtFourByteIndex(index) < 0, 0);
  const supStart = firstIndexWhere((index) => codePointAtFourByteIndex(index) >= 0, gapStart);
  const anchors: FourByteIndex['anchors'] = [];
  for (let index = 0; index < gapStart; index += FOUR_BYTE_WINDOW) {
    anchors.push({ index, codePoint: codePointAtFourByteIndex(index) });
  }
  fourByteIndex = { gapStart, supStart, anchors };
  return fourByteIndex;
}

/** 批量解码一段连续四字节序列；合法序列拼接不会错位，每个码点恰好对应 4 字节。 */
function scanFourByteWindow(start: number, length: number, char: string): Uint8Array | null {
  const count = Math.max(0, Math.min(length, FOUR_BYTE_TOTAL - start));
  if (count <= 0) return null;
  const buffer = new Uint8Array(count * 4);
  for (let offset = 0; offset < count; offset++) {
    buffer.set(fourByteSequence(start + offset), offset * 4);
  }
  const text = decoderFor('gb18030').decode(buffer);
  let offset = 0;
  for (const candidate of text) {
    if (candidate === char) return buffer.slice(offset, offset + 4);
    offset += 4;
  }
  return null;
}

function encodeGb18030FourByte(char: string, codePoint: number): Uint8Array | null {
  const index = gb18030FourByteIndex();

  if (codePoint >= 0x10000) {
    const position = index.supStart + (codePoint - 0x10000);
    if (codePointAtFourByteIndex(position) === codePoint) return fourByteSequence(position);
    return scanFourByteWindow(Math.max(index.gapStart, position - FOUR_BYTE_WINDOW), FOUR_BYTE_WINDOW * 2, char);
  }

  let lo = 0;
  let hi = index.anchors.length - 1;
  let window = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (index.anchors[mid].codePoint <= codePoint) {
      window = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  for (const delta of [0, -1, 1, -2, 2]) {
    const position = window + delta;
    if (position < 0 || position >= index.anchors.length) continue;
    const found = scanFourByteWindow(index.anchors[position].index, FOUR_BYTE_WINDOW, char);
    if (found) return found;
  }
  // BMP 段存在一处 PUA 乱序（U+E7C7 排在 U+1E40 之前），锚点定位不到时整段兜底。
  return scanFourByteWindow(0, index.gapStart, char);
}

function encodeCodePoint(char: string, encoding: ByteEncoding): Uint8Array | null {
  const codePoint = char.codePointAt(0) ?? 0;
  if (codePoint < 0x80) return new Uint8Array([codePoint]);

  const packed = twoByteTable(encoding).get(char);
  if (packed !== undefined) return new Uint8Array([packed >> 8, packed & 0xff]);

  if (encoding === 'gb18030') return encodeGb18030FourByte(char, codePoint);
  return null;
}

// ============ 编码 / 解码 ============

export function encodeText(text: string, encoding: ByteEncoding): Uint8Array {
  if (encoding === 'utf-8') return new TextEncoder().encode(text);

  const output: number[] = [];
  let index = 0;
  for (const char of text) {
    const bytes = encodeCodePoint(char, encoding);
    if (!bytes) throw new EncodeError(char, index, encoding);
    for (const byte of bytes) output.push(byte);
    index++;
  }
  return Uint8Array.from(output);
}

export interface InvalidByteRange {
  offset: number;
  length: number;
}

export interface DecodeResult {
  text: string;
  invalid: InvalidByteRange[];
  /** 非法片段过多，只报告了前 MAX_INVALID_RANGES 处 */
  invalidTruncated: boolean;
}

function canDecodeFatally(bytes: Uint8Array, encoding: ByteEncoding): boolean {
  try {
    decoderFor(encoding, true).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

export function decodeBytes(bytes: Uint8Array, encoding: ByteEncoding): DecodeResult {
  const text = decoderFor(encoding).decode(bytes);
  if (!text.includes(REPLACEMENT)) return { text, invalid: [], invalidTruncated: false };

  const segments = walkSegments(bytes, encoding);
  const invalid: InvalidByteRange[] = [];
  let invalidTruncated = false;

  // 整段 fatal 解码成功即说明区间内全部合法，只在失败时二分，避免逐字节解码。
  const verify = (lo: number, hi: number): void => {
    if (lo >= hi || invalidTruncated) return;
    const start = segments[lo].offset;
    const end = segments[hi - 1].offset + segments[hi - 1].length;
    if (canDecodeFatally(bytes.subarray(start, end), encoding)) return;
    if (hi - lo === 1) {
      invalid.push({ offset: start, length: end - start });
      if (invalid.length >= MAX_INVALID_RANGES) invalidTruncated = true;
      return;
    }
    const mid = (lo + hi) >> 1;
    verify(lo, mid);
    verify(mid, hi);
  };
  verify(0, segments.length);

  return { text, invalid, invalidTruncated };
}

// ============ 字节分段 ============

interface RawSegment {
  offset: number;
  length: number;
}

/** UTF-8 最大子部分长度，与解码器吐出 U+FFFD 的边界保持一致。 */
function utf8SegmentLength(bytes: Uint8Array, offset: number): number {
  const lead = bytes[offset];
  if (lead < 0x80) return 1;

  let needed = 0;
  let min = 0x80;
  let max = 0xbf;
  if (lead >= 0xc2 && lead <= 0xdf) {
    needed = 1;
  } else if (lead >= 0xe0 && lead <= 0xef) {
    needed = 2;
    if (lead === 0xe0) min = 0xa0;
    else if (lead === 0xed) max = 0x9f;
  } else if (lead >= 0xf0 && lead <= 0xf4) {
    needed = 3;
    if (lead === 0xf0) min = 0x90;
    else if (lead === 0xf4) max = 0x8f;
  } else {
    return 1;
  }

  let length = 1;
  for (let step = 0; step < needed; step++) {
    const next = bytes[offset + 1 + step];
    if (next === undefined) break;
    const low = step === 0 ? min : 0x80;
    const high = step === 0 ? max : 0xbf;
    if (next < low || next > high) break;
    length++;
  }
  return length;
}

function multiByteSegmentLength(bytes: Uint8Array, offset: number, encoding: ByteEncoding): number {
  const lead = bytes[offset];
  if (lead <= 0x80 || lead === 0xff) return 1;
  const second = bytes[offset + 1];
  if (second === undefined) return 1;

  if (encoding === 'gb18030' && second >= 0x30 && second <= 0x39) {
    const third = bytes[offset + 2];
    if (third === undefined || third < 0x81 || third > 0xfe) return 2;
    const fourth = bytes[offset + 3];
    if (fourth === undefined || fourth < 0x30 || fourth > 0x39) return 3;
    return 4;
  }
  if (second >= 0x40 && second <= 0xfe && second !== 0x7f) return 2;
  return 1;
}

function segmentLength(bytes: Uint8Array, offset: number, encoding: ByteEncoding): number {
  return encoding === 'utf-8'
    ? utf8SegmentLength(bytes, offset)
    : multiByteSegmentLength(bytes, offset, encoding);
}

function walkSegments(bytes: Uint8Array, encoding: ByteEncoding, limit = Infinity): RawSegment[] {
  const segments: RawSegment[] = [];
  let offset = 0;
  while (offset < bytes.length && segments.length < limit) {
    const length = segmentLength(bytes, offset, encoding);
    segments.push({ offset, length });
    offset += length;
  }
  return segments;
}

export interface ByteSegment {
  offset: number;
  length: number;
  text: string;
  /** 非法片段为 -1 */
  codePoint: number;
  valid: boolean;
}

/** 按编码结构切分字节，给出每个字符占用的字节与偏移；limit 用于分页。 */
export function segmentBytes(bytes: Uint8Array, encoding: ByteEncoding, limit = Infinity): ByteSegment[] {
  const raw = walkSegments(bytes, encoding, limit);
  const fatal = decoderFor(encoding, true);
  const loose = decoderFor(encoding);
  const segments: ByteSegment[] = [];

  for (const { offset, length } of raw) {
    const slice = bytes.subarray(offset, offset + length);
    let text: string;
    let valid = true;
    try {
      text = fatal.decode(slice);
    } catch {
      valid = false;
      text = loose.decode(slice);
    }
    segments.push({ offset, length, text, codePoint: valid ? (text.codePointAt(0) ?? -1) : -1, valid });
  }
  return segments;
}

// ============ HEX 解析与格式化 ============

export type HexParseResult = { bytes: Uint8Array } | { error: string; position: number };

const HEX_SEPARATORS = new Set([' ', '\t', '\n', '\r', '\v', '\f', ',', ';', ':', '_', '-', '|', '.', '/']);

function hexDigitValue(char: string): number {
  if (char >= '0' && char <= '9') return char.charCodeAt(0) - 48;
  if (char >= 'a' && char <= 'f') return char.charCodeAt(0) - 87;
  if (char >= 'A' && char <= 'F') return char.charCodeAt(0) - 55;
  return -1;
}

/** 宽松解析：容忍空格/逗号/换行/分号等分隔符，以及 0x 与 \x 前缀。 */
export function parseHex(input: string): HexParseResult {
  const digits: number[] = [];
  const positions: number[] = [];
  let tokenStart = true;

  for (let index = 0; index < input.length; index++) {
    const char = input[index];
    const next = input[index + 1];

    if (char === '\\' && (next === 'x' || next === 'X')) {
      index++;
      tokenStart = true;
      continue;
    }
    // 只在词首把 0x 当前缀，否则 "A0xB1" 里的 0 会被误吞。
    if (tokenStart && char === '0' && (next === 'x' || next === 'X')) {
      index++;
      continue;
    }

    const value = hexDigitValue(char);
    if (value >= 0) {
      digits.push(value);
      positions.push(index);
      tokenStart = false;
      continue;
    }
    if (HEX_SEPARATORS.has(char)) {
      tokenStart = true;
      continue;
    }
    return { error: `第 ${index + 1} 个字符「${char}」不是十六进制数字或分隔符`, position: index };
  }

  if (digits.length % 2 !== 0) {
    return {
      error: `十六进制位数为 ${digits.length}（奇数），末尾缺少半个字节`,
      position: positions[positions.length - 1] ?? 0,
    };
  }

  const bytes = new Uint8Array(digits.length / 2);
  for (let index = 0; index < bytes.length; index++) {
    bytes[index] = (digits[index * 2] << 4) | digits[index * 2 + 1];
  }
  return { bytes };
}

export function formatBytes(bytes: Uint8Array, format: ByteFormat, upper = false): string {
  const hex = (byte: number) => {
    const text = byte.toString(16).padStart(2, '0');
    return upper ? text.toUpperCase() : text;
  };
  const values = Array.from(bytes);

  switch (format) {
    case 'hex-space':
      return values.map(hex).join(' ');
    case 'hex-plain':
      return values.map(hex).join('');
    case 'hex-0x':
      return values.map((byte) => `0x${hex(byte)}`).join(', ');
    case 'dec':
      return values.map((byte) => String(byte)).join(' ');
    case 'escape':
      return values.map((byte) => `\\x${hex(byte)}`).join('');
    case 'c-array':
      return values.length ? `{ ${values.map((byte) => `0x${hex(byte)}`).join(', ')} }` : '{ }';
  }
}

// ============ 报文视图 ============

export interface HexDumpLine {
  offset: number;
  hex: string[];
  ascii: string;
}

export function buildHexDump(bytes: Uint8Array, perLine = 16, upper = false): HexDumpLine[] {
  const width = Math.max(1, Math.min(64, Math.floor(perLine) || 16));
  const lines: HexDumpLine[] = [];
  for (let offset = 0; offset < bytes.length; offset += width) {
    const slice = Array.from(bytes.subarray(offset, offset + width));
    lines.push({
      offset,
      hex: slice.map((byte) => {
        const text = byte.toString(16).padStart(2, '0');
        return upper ? text.toUpperCase() : text;
      }),
      ascii: slice.map((byte) => (byte >= 0x20 && byte <= 0x7e ? String.fromCharCode(byte) : '.')).join(''),
    });
  }
  return lines;
}

/** C0 控制字节（保留 \t \n \r）与 DEL，报文中通常意味着字段边界或填充。 */
export function countControlBytes(bytes: Uint8Array): number {
  let count = 0;
  for (const byte of bytes) {
    if (byte === 0x7f || (byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d)) count++;
  }
  return count;
}

export function hasUtf8Bom(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
}

export function countCodePoints(text: string): number {
  let count = 0;
  for (let index = 0; index < text.length; index++) {
    const lead = text.charCodeAt(index);
    if (lead >= 0xd800 && lead <= 0xdbff && index + 1 < text.length) {
      const trail = text.charCodeAt(index + 1);
      if (trail >= 0xdc00 && trail <= 0xdfff) index++;
    }
    count++;
  }
  return count;
}