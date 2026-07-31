import { useState, useMemo } from 'react';
import { XMLParser, XMLBuilder } from 'fast-xml-parser';
import { ToolLayout } from '@/components/shared/ToolLayout';
import { Textarea } from '@/components/ui/textarea';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { AlertCircle } from 'lucide-react';

type Direction = 'xml-to-json' | 'json-to-xml';

export default function XmlJsonConverter() {
  const [input, setInput] = useState('');
  const [direction, setDirection] = useState<Direction>('xml-to-json');
  const [ignoreAttrs, setIgnoreAttrs] = useState('false');

  const { output, error } = useMemo(() => {
    if (!input.trim()) return { output: '', error: null };

    try {
      if (direction === 'xml-to-json') {
        const parser = new XMLParser({
          ignoreAttributes: ignoreAttrs === 'true',
          attributeNamePrefix: '@_',
          textNodeName: '#text',
        });
        const result = parser.parse(input);
        return { output: JSON.stringify(result, null, 2), error: null };
      } else {
        const parsed = JSON.parse(input);
        const builder = new XMLBuilder({
          ignoreAttributes: ignoreAttrs === 'true',
          attributeNamePrefix: '@_',
          textNodeName: '#text',
          format: true,
        });
        const result = builder.build(parsed);
        return { output: result, error: null };
      }
    } catch (e) {
      return { output: '', error: (e as Error).message };
    }
  }, [input, direction, ignoreAttrs]);

  const sampleXml = `<?xml version="1.0" encoding="UTF-8"?>
<bookstore>
  <book category="fiction">
    <title>Harry Potter</title>
    <author>J.K. Rowling</author>
    <price>29.99</price>
  </book>
</bookstore>`;

  const sampleJson = `{
  "bookstore": {
    "book": {
      "@_category": "fiction",
      "title": "Harry Potter",
      "author": "J.K. Rowling",
      "price": 29.99
    }
  }
}`;

  return (
    <ToolLayout
      inputTitle={direction === 'xml-to-json' ? 'XML' : 'JSON'}
      outputTitle={direction === 'xml-to-json' ? 'JSON' : 'XML'}
      outputValue={output}
      onClear={() => setInput('')}
      inputActions={
        <div className="flex items-center gap-2">
          <Select
            value={direction}
            onChange={(e) => setDirection(e.target.value as Direction)}
            options={[
              { value: 'xml-to-json', label: 'XML → JSON' },
              { value: 'json-to-xml', label: 'JSON → XML' },
            ]}
            className="h-8 w-32 text-xs"
          />
          <Select
            value={ignoreAttrs}
            onChange={(e) => setIgnoreAttrs(e.target.value)}
            options={[
              { value: 'false', label: '保留属性' },
              { value: 'true', label: '忽略属性' },
            ]}
            className="h-8 w-24 text-xs"
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setInput(direction === 'xml-to-json' ? sampleXml : sampleJson)}
          >
            示例
          </Button>
        </div>
      }
      input={
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={direction === 'xml-to-json' ? '输入 XML...' : '输入 JSON...'}
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
                <p className="font-medium text-destructive">解析错误</p>
                <p className="mt-1 text-sm text-muted-foreground">{error}</p>
              </div>
            </div>
          ) : (
            <Textarea
              value={output}
              readOnly
              placeholder="转换结果..."
              className="h-full resize-none bg-muted/50 font-mono text-sm"
              spellCheck={false}
            />
          )}
        </div>
      }
    />
  );
}
