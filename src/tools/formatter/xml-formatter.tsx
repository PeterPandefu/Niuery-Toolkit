import { useState, useMemo } from 'react';
import { XMLParser, XMLBuilder } from 'fast-xml-parser';
import { ToolLayout } from '@/components/shared/ToolLayout';
import { Textarea } from '@/components/ui/textarea';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { AlertCircle } from 'lucide-react';

export default function XmlFormatter() {
  const [input, setInput] = useState('');
  const [indent, setIndent] = useState('2');
  const [mode, setMode] = useState<'format' | 'minify'>('format');

  const { output, error } = useMemo(() => {
    if (!input.trim()) return { output: '', error: null };

    try {
      const parser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: '@_',
        preserveOrder: false,
      });
      const parsed = parser.parse(input);

      const builder = new XMLBuilder({
        ignoreAttributes: false,
        attributeNamePrefix: '@_',
        format: mode === 'format',
        indentBy: ' '.repeat(parseInt(indent)),
        suppressEmptyNode: true,
      });

      const result = builder.build(parsed);
      return { output: result, error: null };
    } catch (e) {
      return { output: '', error: (e as Error).message };
    }
  }, [input, indent, mode]);

  const sampleXml = `<root><item id="1"><name>Test</name><value>123</value></item><item id="2"><name>Test2</name><value>456</value></item></root>`;

  return (
    <ToolLayout
      inputTitle="XML 输入"
      outputTitle={mode === 'format' ? '格式化结果' : '压缩结果'}
      outputValue={output}
      onClear={() => setInput('')}
      inputActions={
        <div className="flex items-center gap-2">
          <Select
            value={mode}
            onChange={(e) => setMode(e.target.value as 'format' | 'minify')}
            options={[
              { value: 'format', label: '格式化' },
              { value: 'minify', label: '压缩' },
            ]}
            className="h-8 w-24 text-xs"
          />
          {mode === 'format' && (
            <Select
              value={indent}
              onChange={(e) => setIndent(e.target.value)}
              options={[
                { value: '2', label: '2 空格' },
                { value: '4', label: '4 空格' },
              ]}
              className="h-8 w-20 text-xs"
            />
          )}
          <Button variant="ghost" size="sm" onClick={() => setInput(sampleXml)}>
            示例
          </Button>
        </div>
      }
      input={
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="输入 XML..."
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
                <p className="font-medium text-destructive">XML 解析错误</p>
                <p className="mt-1 font-mono text-sm text-muted-foreground">{error}</p>
              </div>
            </div>
          ) : (
            <Textarea
              value={output}
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
