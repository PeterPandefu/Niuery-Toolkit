import { useState, useMemo } from 'react';
import { ToolLayout } from '@/components/shared/ToolLayout';
import { Textarea } from '@/components/ui/textarea';
import { Select } from '@/components/ui/select';

type Mode = 'encode' | 'decode';
type EntityType = 'named' | 'decimal' | 'hex';

const NAMED_ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
  '©': '&copy;',
  '®': '&reg;',
  '™': '&trade;',
  ' ': '&nbsp;',
  '–': '&ndash;',
  '—': '&mdash;',
  '…': '&hellip;',
};

function encodeHtml(str: string, type: EntityType): string {
  return str
    .split('')
    .map((char) => {
      const code = char.charCodeAt(0);
      if (code < 128 && !NAMED_ENTITIES[char]) return char;
      if (type === 'named' && NAMED_ENTITIES[char]) return NAMED_ENTITIES[char];
      if (type === 'decimal') return `&#${code};`;
      if (type === 'hex') return `&#x${code.toString(16).toUpperCase()};`;
      return NAMED_ENTITIES[char] || `&#${code};`;
    })
    .join('');
}

function decodeHtml(str: string): string {
  const textarea = document.createElement('textarea');
  textarea.innerHTML = str;
  return textarea.value;
}

export default function HtmlEntityTool() {
  const [input, setInput] = useState('');
  const [mode, setMode] = useState<Mode>('encode');
  const [entityType, setEntityType] = useState<EntityType>('named');

  const output = useMemo(() => {
    if (!input.trim()) return '';
    return mode === 'encode' ? encodeHtml(input, entityType) : decodeHtml(input);
  }, [input, mode, entityType]);

  return (
    <ToolLayout
      inputTitle={mode === 'encode' ? '原始文本' : 'HTML 实体'}
      outputTitle={mode === 'encode' ? 'HTML 实体' : '解码结果'}
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
              { value: 'encode', label: '编码' },
              { value: 'decode', label: '解码' },
            ]}
            className="h-8 w-20 text-xs"
          />
          {mode === 'encode' && (
            <Select
              value={entityType}
              onChange={(e) => setEntityType(e.target.value as EntityType)}
              options={[
                { value: 'named', label: '命名实体' },
                { value: 'decimal', label: '十进制' },
                { value: 'hex', label: '十六进制' },
              ]}
              className="h-8 w-24 text-xs"
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
              ? '输入 HTML 文本...\n例如: <div class="test">Hello & World</div>'
              : '输入 HTML 实体...\n例如: &lt;div&gt;'
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
