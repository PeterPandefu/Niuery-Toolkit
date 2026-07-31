import { useState, useMemo } from 'react';
import { ToolLayout } from '@/components/shared/ToolLayout';
import { Textarea } from '@/components/ui/textarea';
import { Select } from '@/components/ui/select';

type Mode = 'escape' | 'unescape';
type Language = 'json' | 'javascript' | 'regex';

function escapeString(str: string, lang: Language): string {
  switch (lang) {
    case 'json':
      return JSON.stringify(str).slice(1, -1);
    case 'javascript':
      return str
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
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

function unescapeString(str: string, lang: Language): string {
  switch (lang) {
    case 'json':
      try {
        return JSON.parse(`"${str}"`);
      } catch {
        return str;
      }
    case 'javascript':
      return str
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '\r')
        .replace(/\\t/g, '\t')
        .replace(/\\'/g, "'")
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\');
    case 'regex':
      return str.replace(/\\([.*+?^${}()|[\]\\])/g, '$1');
    default:
      return str;
  }
}

export default function EscapeUnescape() {
  const [input, setInput] = useState('');
  const [mode, setMode] = useState<Mode>('escape');
  const [language, setLanguage] = useState<Language>('json');

  const output = useMemo(() => {
    if (!input) return '';
    return mode === 'escape' ? escapeString(input, language) : unescapeString(input, language);
  }, [input, mode, language]);

  return (
    <ToolLayout
      inputTitle={mode === 'escape' ? '原始文本' : '转义文本'}
      outputTitle={mode === 'escape' ? '转义结果' : '反转义结果'}
      outputValue={output}
      onClear={() => setInput('')}
      onSwap={() => {
        if (output) {
          setInput(output);
          setMode(mode === 'escape' ? 'unescape' : 'escape');
        }
      }}
      inputActions={
        <div className="flex items-center gap-2">
          <Select
            value={mode}
            onChange={(e) => setMode(e.target.value as Mode)}
            options={[
              { value: 'escape', label: '转义' },
              { value: 'unescape', label: '反转义' },
            ]}
            className="h-8 w-24 text-xs"
          />
          <Select
            value={language}
            onChange={(e) => setLanguage(e.target.value as Language)}
            options={[
              { value: 'json', label: 'JSON' },
              { value: 'javascript', label: 'JavaScript' },
              { value: 'regex', label: 'RegExp' },
            ]}
            className="h-8 w-28 text-xs"
          />
        </div>
      }
      input={
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={
            mode === 'escape'
              ? '输入要转义的文本...\n例如: Hello "World"\nNew line here'
              : '输入转义后的文本...\n例如: Hello \\"World\\"\\nNew line here'
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
