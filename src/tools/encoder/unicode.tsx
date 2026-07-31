import { useState, useMemo } from 'react';
import { ToolLayout } from '@/components/shared/ToolLayout';
import { Textarea } from '@/components/ui/textarea';
import { Select } from '@/components/ui/select';
import { encodeUnicode, decodeUnicode, type UnicodeFormat } from '@/lib/codec-utils';

type Mode = 'encode' | 'decode';
type Format = UnicodeFormat;

export default function UnicodeTool() {
  const [input, setInput] = useState('');
  const [mode, setMode] = useState<Mode>('encode');
  const [format, setFormat] = useState<Format>('u4');

  const output = useMemo(() => {
    if (!input.trim()) return '';
    try {
      return mode === 'encode' ? encodeUnicode(input, format) : decodeUnicode(input);
    } catch {
      return '[解码错误]';
    }
  }, [input, mode, format]);

  return (
    <ToolLayout
      inputTitle={mode === 'encode' ? '原始文本' : 'Unicode 转义'}
      outputTitle={mode === 'encode' ? 'Unicode 转义' : '解码结果'}
      outputValue={output}
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
              { value: 'encode', label: '转义' },
              { value: 'decode', label: '反转义' },
            ]}
            className="h-8 w-20 text-xs"
          />
          {mode === 'encode' && (
            <Select
              value={format}
              onChange={(e) => setFormat(e.target.value as Format)}
              options={[
                { value: 'u4', label: '\\uXXXX' },
                { value: 'u8', label: '\\UXXXXXXXX' },
                { value: 'x', label: '\\x{XXXX}' },
              ]}
              className="h-8 w-32 text-xs"
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
              ? '输入文本...\n例如: 你好世界 Hello'
              : '输入 Unicode 转义序列...\n例如: \\u4f60\\u597d'
          }
          className="h-full resize-none font-mono text-sm"
          spellCheck={false}
        />
      }
      output={
        <Textarea
          value={output}
          readOnly
          placeholder="结果..."
          className="h-full resize-none bg-muted/50 font-mono text-sm"
          spellCheck={false}
        />
      }
    />
  );
}
