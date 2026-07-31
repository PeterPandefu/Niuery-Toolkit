import { useState, useMemo, useCallback } from 'react';
import { ToolLayout } from '@/components/shared/ToolLayout';
import { Textarea } from '@/components/ui/textarea';
import { Select } from '@/components/ui/select';
import { AlertCircle } from 'lucide-react';

type Mode = 'compress' | 'decompress';
type Encoding = 'gzip' | 'deflate';

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

export default function GzipTool() {
  const [input, setInput] = useState('');
  const [mode, setMode] = useState<Mode>('compress');
  const [encoding, setEncoding] = useState<Encoding>('gzip');
  const [output, setOutput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<{ original: number; compressed: number } | null>(null);

  const process = useCallback(async () => {
    if (!input.trim()) {
      setOutput('');
      setError(null);
      setStats(null);
      return;
    }

    try {
      if (mode === 'compress') {
        const encoder = new TextEncoder();
        const data = encoder.encode(input);
        const stream = new Blob([data])
          .stream()
          .pipeThrough(new CompressionStream(encoding === 'gzip' ? 'gzip' : 'deflate'));
        const compressedBuffer = await new Response(stream).arrayBuffer();
        const base64 = arrayBufferToBase64(compressedBuffer);
        setOutput(base64);
        setStats({ original: data.length, compressed: compressedBuffer.byteLength });
        setError(null);
      } else {
        const buffer = base64ToArrayBuffer(input.trim());
        const stream = new Blob([buffer])
          .stream()
          .pipeThrough(new DecompressionStream(encoding === 'gzip' ? 'gzip' : 'deflate'));
        const decompressedBuffer = await new Response(stream).arrayBuffer();
        const decoder = new TextDecoder();
        const text = decoder.decode(decompressedBuffer);
        setOutput(text);
        setStats({ original: buffer.byteLength, compressed: decompressedBuffer.byteLength });
        setError(null);
      }
    } catch (e) {
      setError(mode === 'decompress' ? '解压失败：无效的压缩数据' : '压缩失败');
      setOutput('');
      setStats(null);
    }
  }, [input, mode, encoding]);

  // Auto-process on input change
  useMemo(() => {
    process();
  }, [process]);

  const ratio = stats
    ? mode === 'compress'
      ? Math.round((1 - stats.compressed / stats.original) * 100)
      : Math.round((stats.compressed / stats.original - 1) * 100)
    : 0;

  return (
    <ToolLayout
      inputTitle={mode === 'compress' ? '原始文本' : 'Base64 压缩数据'}
      outputTitle={mode === 'compress' ? 'Base64 压缩结果' : '解压结果'}
      outputValue={output}
      onClear={() => { setInput(''); setOutput(''); setStats(null); }}
      onSwap={() => {
        if (output) {
          setInput(output);
          setMode(mode === 'compress' ? 'decompress' : 'compress');
          setOutput('');
        }
      }}
      inputActions={
        <div className="flex items-center gap-2">
          <Select
            value={mode}
            onChange={(e) => { setMode(e.target.value as Mode); setOutput(''); }}
            options={[
              { value: 'compress', label: '压缩' },
              { value: 'decompress', label: '解压' },
            ]}
            className="h-8 w-20 text-xs"
          />
          <Select
            value={encoding}
            onChange={(e) => { setEncoding(e.target.value as Encoding); setOutput(''); }}
            options={[
              { value: 'gzip', label: 'GZip' },
              { value: 'deflate', label: 'Deflate' },
            ]}
            className="h-8 w-24 text-xs"
          />
        </div>
      }
      input={
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={mode === 'compress' ? '输入要压缩的文本...' : '输入 Base64 编码的压缩数据...'}
          className="h-full resize-none font-mono text-sm"
          spellCheck={false}
        />
      }
      output={
        <div className="flex h-full flex-col gap-2">
          {error ? (
            <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-4">
              <AlertCircle className="h-5 w-5 shrink-0 text-destructive" />
              <p className="text-sm text-destructive">{error}</p>
            </div>
          ) : (
            <Textarea
              value={output}
              readOnly
              placeholder="结果..."
              className="flex-1 resize-none bg-muted/50 font-mono text-sm"
              spellCheck={false}
            />
          )}
          {stats && !error && (
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <span>原始: {stats.original} bytes</span>
              <span>结果: {mode === 'compress' ? stats.compressed : stats.compressed} bytes</span>
              {mode === 'compress' && (
                <span className={ratio > 0 ? 'text-green-500' : 'text-red-500'}>
                  压缩率: {ratio > 0 ? `-${ratio}%` : `+${Math.abs(ratio)}%`}
                </span>
              )}
            </div>
          )}
        </div>
      }
    />
  );
}
