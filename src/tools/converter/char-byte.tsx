import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { ToolLayout } from '@/components/shared/ToolLayout';
import { Textarea } from '@/components/ui/textarea';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useToolLogger } from '@/hooks/use-tool-logger';
import {
  BYTE_ENCODING_OPTIONS,
  BYTE_FORMAT_OPTIONS,
  MAX_ANALYSIS_BYTES,
  MAX_HEX_INPUT_LENGTH,
  MAX_TEXT_LENGTH,
  EncodeError,
  buildHexDump,
  countCodePoints,
  countControlBytes,
  decodeBytes,
  encodeText,
  formatBytes,
  hasUtf8Bom,
  parseHex,
  segmentBytes,
  type ByteEncoding,
  type ByteFormat,
  type InvalidByteRange,
} from '@/lib/byte-utils';

type Direction = 'to-bytes' | 'to-text';
type View = 'text' | 'packet';

type Conversion =
  | { status: 'empty' }
  | { status: 'error'; message: string }
  | {
      status: 'ok';
      bytes: Uint8Array;
      text: string;
      invalid: InvalidByteRange[];
      invalidTruncated: boolean;
    };

const DUMP_PAGE_LINES = 128;
const SEGMENT_PAGE_ROWS = 200;
const HEX_FORMATS: ByteFormat[] = ['hex-space', 'hex-plain', 'hex-0x', 'escape'];

function displayChar(text: string): string {
  if (text === ' ') return '␣';
  if (text === '\n') return '⏎';
  if (text === '\r') return '␍';
  if (text === '\t') return '⇥';
  const codePoint = text.codePointAt(0) ?? 0;
  if (codePoint < 0x20 || codePoint === 0x7f) return '·';
  return text;
}

function codePointLabel(codePoint: number): string {
  return `U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}`;
}

interface PacketViewProps {
  bytes: Uint8Array;
  text: string;
  encoding: ByteEncoding;
  upper: boolean;
  perLine: number;
  invalid: InvalidByteRange[];
  invalidTruncated: boolean;
}

function PacketView({ bytes, text, encoding, upper, perLine, invalid, invalidTruncated }: PacketViewProps) {
  const [dumpLines, setDumpLines] = useState(DUMP_PAGE_LINES);
  const [segmentRows, setSegmentRows] = useState(SEGMENT_PAGE_ROWS);
  const [selectedOffset, setSelectedOffset] = useState<number | null>(null);

  useEffect(() => {
    setSelectedOffset(null);
  }, [bytes]);

  const windowBytes = useMemo(() => bytes.subarray(0, MAX_ANALYSIS_BYTES), [bytes]);
  const lines = useMemo(
    () => buildHexDump(windowBytes.subarray(0, dumpLines * perLine), perLine, upper),
    [windowBytes, dumpLines, perLine, upper]
  );
  const segments = useMemo(() => segmentBytes(windowBytes, encoding, segmentRows), [windowBytes, encoding, segmentRows]);

  const invalidOffsets = useMemo(() => {
    const offsets = new Set<number>();
    for (const range of invalid) {
      for (let index = 0; index < range.length; index++) offsets.add(range.offset + index);
    }
    return offsets;
  }, [invalid]);

  const selectedSegment = useMemo(
    () =>
      selectedOffset === null
        ? null
        : (segments.find((segment) => selectedOffset >= segment.offset && selectedOffset < segment.offset + segment.length) ?? null),
    [segments, selectedOffset]
  );

  const highlightStart = selectedSegment ? selectedSegment.offset : selectedOffset;
  const highlightEnd = selectedSegment ? selectedSegment.offset + selectedSegment.length : selectedOffset === null ? null : selectedOffset + 1;

  const stats = useMemo(
    () => ({
      codePoints: countCodePoints(text),
      byteLength: bytes.length,
      controls: countControlBytes(bytes),
      bom: hasUtf8Bom(bytes),
    }),
    [text, bytes]
  );

  const maxDumpLines = Math.ceil(MAX_ANALYSIS_BYTES / perLine);
  const hasMoreLines = dumpLines < maxDumpLines && windowBytes.length > dumpLines * perLine;
  const hasMoreSegments = segments.length >= segmentRows && windowBytes.length > (segments[segments.length - 1]?.offset ?? 0) + (segments[segments.length - 1]?.length ?? 0);

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="shrink-0 space-y-1 rounded-md border border-border bg-muted/40 px-3 py-1.5 text-xs">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="text-muted-foreground">字符 <span className="font-mono text-foreground">{stats.codePoints}</span></span>
          <span className="text-muted-foreground">字节 <span className="font-mono text-foreground">{stats.byteLength}</span></span>
          <span className="text-muted-foreground">控制字节 <span className="font-mono text-foreground">{stats.controls}</span></span>
          {stats.bom && <span className="text-warning">含 UTF-8 BOM</span>}
          {invalid.length > 0 && (
            <span className="text-destructive">
              非法字节 {invalid.length}{invalidTruncated ? '+' : ''} 处
            </span>
          )}
          {bytes.length > MAX_ANALYSIS_BYTES && (
            <span className="text-muted-foreground">报文视图仅分析前 {MAX_ANALYSIS_BYTES / 1024} KB</span>
          )}
        </div>
        {invalid.length > 0 && (
          <div className="font-mono text-[11px] text-destructive/90">
            偏移 {invalid.slice(0, 12).map((range) => range.offset).join(', ')}
            {invalid.length > 12 ? ' …' : ''}
          </div>
        )}
      </div>

      <div
        className="min-h-0 flex-1 overflow-auto rounded-md border border-border bg-muted/20 p-2 font-mono text-xs"
        onClick={(event) => {
          const target = (event.target as HTMLElement).closest<HTMLElement>('[data-offset]');
          if (target) setSelectedOffset(Number(target.dataset.offset));
        }}
      >
        {lines.length === 0 ? (
          <p className="px-1 py-2 font-sans text-muted-foreground">暂无字节数据</p>
        ) : (
          lines.map((line) => (
            <div key={line.offset} className="flex items-center gap-3 leading-5">
              <span className="shrink-0 text-muted-foreground/70">{line.offset.toString(16).padStart(8, '0')}</span>
              <span className="flex shrink-0 gap-1">
                {Array.from({ length: perLine }, (_, index) => {
                  const value = line.hex[index];
                  const offset = line.offset + index;
                  if (value === undefined) return <span key={index} className="w-5 shrink-0" />;
                  const highlighted = highlightStart !== null && highlightEnd !== null && offset >= highlightStart && offset < highlightEnd;
                  return (
                    <button
                      key={index}
                      type="button"
                      data-offset={offset}
                      title={`偏移 ${offset} · 十进制 ${parseInt(value, 16)}`}
                      className={cn(
                        'w-5 shrink-0 cursor-pointer rounded text-center transition-colors hover:bg-accent',
                        invalidOffsets.has(offset) && 'text-destructive',
                        highlighted && 'bg-primary text-primary-foreground hover:bg-primary'
                      )}
                    >
                      {value}
                    </button>
                  );
                })}
              </span>
              <span className="shrink-0 whitespace-pre text-muted-foreground">|{line.ascii}|</span>
            </div>
          ))
        )}
        {hasMoreLines && (
          <Button variant="ghost" size="sm" className="mt-1 h-7 font-sans text-xs" onClick={() => setDumpLines((prev) => prev + DUMP_PAGE_LINES)}>
            加载更多字节行
          </Button>
        )}
      </div>

      <div className="h-2/5 shrink-0 overflow-auto rounded-md border border-border">
        <table className="w-full border-collapse text-xs">
          <thead className="sticky top-0 z-[1] bg-card text-left text-muted-foreground">
            <tr>
              <th className="px-2 py-1 font-medium">字符</th>
              <th className="px-2 py-1 font-medium">码点</th>
              <th className="px-2 py-1 font-medium">字节</th>
              <th className="px-2 py-1 font-medium">偏移</th>
              <th className="px-2 py-1 font-medium">长度</th>
            </tr>
          </thead>
          <tbody>
            {segments.map((segment) => {
              const selected = selectedSegment?.offset === segment.offset;
              return (
                <tr
                  key={segment.offset}
                  onClick={() => setSelectedOffset(segment.offset)}
                  className={cn(
                    'cursor-pointer border-t border-border/60 transition-colors hover:bg-accent/50',
                    selected && 'bg-primary/10',
                    !segment.valid && 'text-destructive'
                  )}
                >
                  <td className="px-2 py-0.5 font-mono">{segment.valid ? displayChar(segment.text) : '非法'}</td>
                  <td className="px-2 py-0.5 font-mono">{segment.valid ? codePointLabel(segment.codePoint) : '—'}</td>
                  <td className="px-2 py-0.5 font-mono">{formatBytes(bytes.subarray(segment.offset, segment.offset + segment.length), 'hex-space', upper)}</td>
                  <td className="px-2 py-0.5 font-mono">{segment.offset}</td>
                  <td className="px-2 py-0.5 font-mono">{segment.length}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {hasMoreSegments && (
          <Button variant="ghost" size="sm" className="m-1 h-7 text-xs" onClick={() => setSegmentRows((prev) => prev + SEGMENT_PAGE_ROWS)}>
            加载更多字符
          </Button>
        )}
      </div>
    </div>
  );
}

export default function CharByteTool() {
  const log = useToolLogger('char-byte');
  const [input, setInput] = useState('');
  const [direction, setDirection] = useState<Direction>('to-bytes');
  const [encoding, setEncoding] = useState<ByteEncoding>('utf-8');
  const [format, setFormat] = useState<ByteFormat>('hex-space');
  const [upper, setUpper] = useState(false);
  const [view, setView] = useState<View>('text');
  const [perLine, setPerLine] = useState(16);

  const deferredInput = useDeferredValue(input);

  const conversion = useMemo<Conversion>(() => {
    if (!deferredInput) return { status: 'empty' };

    if (direction === 'to-bytes') {
      if (deferredInput.length > MAX_TEXT_LENGTH) {
        return { status: 'error', message: `文本长度 ${deferredInput.length} 超过上限 ${MAX_TEXT_LENGTH} 字符` };
      }
      try {
        return { status: 'ok', bytes: encodeText(deferredInput, encoding), text: deferredInput, invalid: [], invalidTruncated: false };
      } catch (error) {
        return { status: 'error', message: error instanceof EncodeError ? error.message : `编码失败：${(error as Error).message}` };
      }
    }

    if (deferredInput.length > MAX_HEX_INPUT_LENGTH) {
      return { status: 'error', message: `Hex 输入长度 ${deferredInput.length} 超过上限 ${MAX_HEX_INPUT_LENGTH} 字符` };
    }
    const parsed = parseHex(deferredInput);
    if ('error' in parsed) return { status: 'error', message: parsed.error };
    const decoded = decodeBytes(parsed.bytes, encoding);
    return { status: 'ok', bytes: parsed.bytes, text: decoded.text, invalid: decoded.invalid, invalidTruncated: decoded.invalidTruncated };
  }, [deferredInput, direction, encoding]);

  // 与转换分离：切换字节格式或大小写只重排输出，不重新编码，也不打断报文视图的选中态。
  const output = useMemo(() => {
    if (conversion.status !== 'ok') return '';
    return direction === 'to-bytes' ? formatBytes(conversion.bytes, format, upper) : conversion.text;
  }, [conversion, direction, format, upper]);

  const handleSwap = () => {
    if (conversion.status !== 'ok') return;
    if (direction === 'to-bytes') {
      // 十进制与 C 数组无法被 parseHex 还原，交换时统一落到 HEX 空格格式。
      const parseable = HEX_FORMATS.includes(format);
      setInput(parseable ? output : formatBytes(conversion.bytes, 'hex-space', upper));
      if (!parseable) setFormat('hex-space');
      setDirection('to-text');
    } else {
      setInput(conversion.text);
      setDirection('to-bytes');
    }
    log.info('交换输入输出', { direction: direction === 'to-bytes' ? 'to-text' : 'to-bytes' });
  };

  const outputPane = () => {
    if (conversion.status === 'error') {
      return (
        <div className="flex h-full items-start overflow-auto p-3">
          <p className="text-sm text-destructive">{conversion.message}</p>
        </div>
      );
    }
    if (conversion.status === 'empty') {
      return <Textarea value="" readOnly placeholder="结果..." className="h-full resize-none bg-muted/50 font-mono text-sm" spellCheck={false} />;
    }
    if (view === 'packet') {
      return (
        <PacketView
          bytes={conversion.bytes}
          text={conversion.text}
          encoding={encoding}
          upper={upper}
          perLine={perLine}
          invalid={conversion.invalid}
          invalidTruncated={conversion.invalidTruncated}
        />
      );
    }
    return <Textarea value={output} readOnly placeholder="结果..." className="h-full resize-none bg-muted/50 font-mono text-sm" spellCheck={false} />;
  };

  return (
    <ToolLayout
      inputTitle={direction === 'to-bytes' ? '字符' : '字节 (Hex)'}
      outputTitle={view === 'packet' ? '报文分析' : direction === 'to-bytes' ? '字节' : '字符'}
      outputValue={conversion.status === 'ok' ? output : ''}
      onClear={() => {
        setInput('');
        log.info('清空输入');
      }}
      onSwap={handleSwap}
      onDrop={(content) => {
        if (!content) return;
        setInput(content);
        log.info('拖放文本输入', { length: content.length });
      }}
      inputActions={
        <>
          <Select
            aria-label="转换方向"
            value={direction}
            onValueChange={(value) => {
              setDirection(value as Direction);
              log.info('切换方向', { direction: value });
            }}
            options={[
              { value: 'to-bytes', label: '字符 → 字节' },
              { value: 'to-text', label: '字节 → 字符' },
            ]}
            variant="compact"
            className="h-8 w-32 text-xs"
          />
          <Select
            aria-label="字符编码"
            value={encoding}
            onValueChange={(value) => {
              setEncoding(value as ByteEncoding);
              log.info('切换编码', { encoding: value });
            }}
            options={BYTE_ENCODING_OPTIONS}
            variant="compact"
            className="h-8 w-28 text-xs"
          />
          {direction === 'to-bytes' && (
            <Select
              aria-label="字节格式"
              value={format}
              onValueChange={(value) => {
                setFormat(value as ByteFormat);
                log.info('切换字节格式', { format: value });
              }}
              options={BYTE_FORMAT_OPTIONS.map((option) => ({ value: option.value, label: option.label, description: option.sample }))}
              variant="compact"
              className="h-8 w-32 text-xs"
            />
          )}
          {direction === 'to-bytes' && format !== 'dec' && (
            <Button
              variant="ghost"
              size="sm"
              aria-pressed={upper}
              title="切换十六进制大小写"
              className="h-8 px-2 font-mono text-xs"
              onClick={() => {
                setUpper(!upper);
                log.info('切换大小写', { upper: !upper });
              }}
            >
              {upper ? 'ABC' : 'abc'}
            </Button>
          )}
          <div className="ml-1 flex shrink-0 items-center gap-0.5 rounded-md border border-border p-0.5">
            {(['text', 'packet'] as const).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={view === option}
                onClick={() => {
                  setView(option);
                  log.info('切换视图', { view: option });
                }}
                className={cn(
                  'cursor-pointer rounded px-2 py-1 text-xs font-medium transition-colors',
                  view === option ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                )}
              >
                {option === 'text' ? '文本' : '报文'}
              </button>
            ))}
          </div>
          {view === 'packet' && (
            <Select
              aria-label="每行字节数"
              value={String(perLine)}
              onValueChange={(value) => setPerLine(Number(value))}
              options={[
                { value: '8', label: '每行 8' },
                { value: '16', label: '每行 16' },
                { value: '32', label: '每行 32' },
              ]}
              variant="compact"
              className="h-8 w-24 text-xs"
            />
          )}
        </>
      }
      input={
        <Textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder={
            direction === 'to-bytes'
              ? '输入文本...\n例如: 你好世界 Hello'
              : '输入十六进制字节...\n例如: 48 65 6C 6C 6F 或 0x48,0x65,0x6C 或 48656C'
          }
          className="h-full resize-none font-mono text-sm"
          spellCheck={false}
        />
      }
      output={outputPane()}
    />
  );
}