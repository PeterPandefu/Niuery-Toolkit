import { useState, useMemo, useEffect, useRef } from 'react';
import { XMLParser, XMLBuilder } from 'fast-xml-parser';
import { ToolLayout } from '@/components/shared/ToolLayout';
import {
  FoldableCodeEditor,
  type FoldableCodeEditorHandle,
} from '@/components/shared/FoldableCodeEditor';
import { hasFoldableStructure } from '@/lib/structured-editor-folding';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { useToolLogger } from '@/hooks/use-tool-logger';
import { AlertCircle, FoldVertical, UnfoldVertical } from 'lucide-react';

export default function XmlFormatter() {
  const [input, setInput] = useState('');
  const [indent, setIndent] = useState('2');
  const [mode, setMode] = useState<'format' | 'minify'>('format');
  const log = useToolLogger('xml-formatter');
  const inputEditorRef = useRef<FoldableCodeEditorHandle>(null);
  const outputEditorRef = useRef<FoldableCodeEditorHandle>(null);

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
      log.info('XML 转换成功', {
        mode,
        inputLength: input.length,
        outputLength: result.length,
      });
      return { output: result, error: null };
    } catch (e) {
      log.warn('XML 解析错误', { message: (e as Error).message });
      return { output: '', error: (e as Error).message };
    }
  }, [input, indent, mode, log]);

  const sampleXml = `<root><item id="1"><name>Test</name><value>123</value></item><item id="2"><name>Test2</name><value>456</value></item></root>`;
  const hasFoldableContent = hasFoldableStructure(input, 'xml') || hasFoldableStructure(output, 'xml');

  const unfoldAll = () => {
    void inputEditorRef.current?.unfoldAll();
    void outputEditorRef.current?.unfoldAll();
  };

  useEffect(() => {
    unfoldAll();
  }, [input, output, indent, mode]);

  return (
    <ToolLayout
      inputTitle="XML 输入"
      outputTitle={mode === 'format' ? '格式化结果' : '压缩结果'}
      outputValue={output}
      onClear={() => {
        setInput('');
        log.info('清空输入');
      }}
      inputActions={
        <div className="flex items-center gap-2">
          <Select
            value={mode}
            onChange={(e) => {
              const value = e.target.value as 'format' | 'minify';
              setMode(value);
              log.info('切换模式', { mode: value });
            }}
            options={[
              { value: 'format', label: '格式化' },
              { value: 'minify', label: '压缩' },
            ]}
            className="h-8 w-24 text-xs"
          />
          {mode === 'format' && (
            <Select
              value={indent}
              onChange={(e) => {
                setIndent(e.target.value);
                log.info('切换缩进', { indent: e.target.value });
              }}
              options={[
                { value: '2', label: '2 空格' },
                { value: '4', label: '4 空格' },
              ]}
              className="h-8 w-20 text-xs"
            />
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setInput(sampleXml);
              log.info('填充示例 XML');
            }}
          >
            示例
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => {
              void inputEditorRef.current?.foldAll();
              void outputEditorRef.current?.foldAll();
            }}
            disabled={!hasFoldableContent}
            title="全部折叠"
            aria-label="全部折叠"
          >
            <FoldVertical className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={unfoldAll}
            disabled={!hasFoldableContent}
            title="全部展开"
            aria-label="全部展开"
          >
            <UnfoldVertical className="h-3.5 w-3.5" />
          </Button>
        </div>
      }
      input={
        <FoldableCodeEditor
          ref={inputEditorRef}
          value={input}
          onChange={setInput}
          language="xml"
          placeholder="输入 XML..."
          tabSize={parseInt(indent)}
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
            <FoldableCodeEditor
              ref={outputEditorRef}
              value={output}
              readOnly
              language="xml"
              placeholder="结果..."
              tabSize={parseInt(indent)}
            />
          )}
        </div>
      }
    />
  );
}
