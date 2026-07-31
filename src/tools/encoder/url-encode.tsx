import { useState, useMemo } from 'react';
import { ToolLayout } from '@/components/shared/ToolLayout';
import { Textarea } from '@/components/ui/textarea';
import { Select } from '@/components/ui/select';
import { AlertCircle } from 'lucide-react';

type Mode = 'encode' | 'decode';
type EncodeType = 'component' | 'uri';

export default function UrlEncodeTool() {
  const [input, setInput] = useState('');
  const [mode, setMode] = useState<Mode>('encode');
  const [encodeType, setEncodeType] = useState<EncodeType>('component');

  const { output, error } = useMemo(() => {
    if (!input.trim()) return { output: '', error: null };

    try {
      let result: string;
      if (mode === 'encode') {
        result = encodeType === 'component' ? encodeURIComponent(input) : encodeURI(input);
      } else {
        result = decodeURIComponent(input);
      }
      return { output: result, error: null };
    } catch (e) {
      return { output: '', error: (e as Error).message };
    }
  }, [input, mode, encodeType]);

  // 批量处理（每行一个）
  const batchOutput = useMemo(() => {
    if (!input.includes('\n')) return null;
    const lines = input.split('\n');
    return lines
      .map((line) => {
        try {
          return mode === 'encode'
            ? encodeType === 'component'
              ? encodeURIComponent(line)
              : encodeURI(line)
            : decodeURIComponent(line);
        } catch {
          return `[错误] ${line}`;
        }
      })
      .join('\n');
  }, [input, mode, encodeType]);

  return (
    <ToolLayout
      inputTitle={mode === 'encode' ? '原始文本' : 'URL 编码'}
      outputTitle={mode === 'encode' ? 'URL 编码' : '解码结果'}
      outputValue={batchOutput || output}
      onClear={() => setInput('')}
      onSwap={() => {
        if (output) {
          setInput(output);
          setMode(mode === 'encode' ? 'decode' : 'encode');
        }
      }}
      inputActions={
        <div className="flex items-center gap-2">
          <Select
            value={mode}
            onChange={(e) => setMode(e.target.value as Mode)}
            options={[
              { value: 'encode', label: '编码' },
              { value: 'decode', label: '解码' },
            ]}
            className="h-8 w-20 text-xs"
          />
          {mode === 'encode' && (
            <Select
              value={encodeType}
              onChange={(e) => setEncodeType(e.target.value as EncodeType)}
              options={[
                { value: 'component', label: 'Component' },
                { value: 'uri', label: 'URI' },
              ]}
              className="h-8 w-28 text-xs"
            />
          )}
        </div>
      }
      input={
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={
            mode === 'encode'
              ? '输入要编码的文本...\n支持多行批量处理'
              : '输入 URL 编码字符串...\n例如: %E4%BD%A0%E5%A5%BD'
          }
          className="h-full resize-none font-mono text-sm"
          spellCheck={false}
        />
      }
      output={
        <div className="relative h-full">
          {error ? (
            <div className="flex h-full items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-4">
              <AlertCircle className="h-5 w-5 shrink-0 text-destructive" />
              <div>
                <p className="font-medium text-destructive">解码错误</p>
                <p className="mt-1 text-sm text-muted-foreground">{error}</p>
              </div>
            </div>
          ) : (
            <Textarea
              value={batchOutput || output}
              readOnly
              placeholder="结果..."
              className="h-full resize-none bg-muted/50 font-mono text-sm"
              spellCheck={false}
            />
          )}
        </div>
      }
    />
  );
}
