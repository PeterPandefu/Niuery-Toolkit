import { useState, useMemo } from 'react';
import Editor from '@monaco-editor/react';
import { ToolLayout } from '@/components/shared/ToolLayout';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { useIsDark } from '@/hooks/use-theme';
import { useToolLogger } from '@/hooks/use-tool-logger';
import { AlertCircle, CheckCircle2, Minimize2 } from 'lucide-react';

type SortMode = 'none' | 'alpha' | 'alpha-desc';

function sortObjectKeys(obj: unknown, mode: SortMode): unknown {
  if (mode === 'none') return obj;
  if (Array.isArray(obj)) return obj.map((item) => sortObjectKeys(item, mode));
  if (obj !== null && typeof obj === 'object') {
    const sorted: Record<string, unknown> = {};
    const keys = Object.keys(obj as Record<string, unknown>);
    if (mode === 'alpha') keys.sort();
    if (mode === 'alpha-desc') keys.sort().reverse();
    for (const key of keys) {
      sorted[key] = sortObjectKeys((obj as Record<string, unknown>)[key], mode);
    }
    return sorted;
  }
  return obj;
}

export default function JsonFormatter() {
  const [input, setInput] = useState('');
  const [indent, setIndent] = useState('2');
  const [sortMode, setSortMode] = useState<SortMode>('none');
  const [mode, setMode] = useState<'format' | 'minify'>('format');
  const isDark = useIsDark();
  const log = useToolLogger('json-formatter');

  const { output, error, isValid } = useMemo(() => {
    if (!input.trim()) return { output: '', error: null, isValid: null };

    try {
      const parsed = JSON.parse(input);
      const sorted = sortObjectKeys(parsed, sortMode);
      const result =
        mode === 'format'
          ? JSON.stringify(sorted, null, parseInt(indent))
          : JSON.stringify(sorted);
      log.info('JSON 转换成功', {
        mode,
        inputLength: input.length,
        outputLength: result.length,
      });
      return { output: result, error: null, isValid: true };
    } catch (e) {
      log.warn('JSON 解析错误', { message: (e as Error).message });
      return { output: '', error: (e as Error).message, isValid: false };
    }
  }, [input, indent, sortMode, mode, log]);

  const sampleJson = `{"name":"Niuery Toolkit","version":"1.0.0","features":["offline","secure","fast"],"nested":{"key":"value","array":[1,2,3]}}`;

  return (
    <ToolLayout
      inputTitle="JSON 输入"
      outputTitle={mode === 'format' ? '格式化结果' : '压缩结果'}
      outputValue={output}
      onClear={() => {
        setInput('');
        log.info('清空输入');
      }}
      inputActions={
        <div className="flex items-center gap-2">
          <div className="flex rounded-md border">
            <Button
              variant={mode === 'format' ? 'default' : 'ghost'}
              size="sm"
              className="rounded-r-none"
              onClick={() => {
                setMode('format');
                log.info('切换为格式化模式');
              }}
            >
              格式化
            </Button>
            <Button
              variant={mode === 'minify' ? 'default' : 'ghost'}
              size="sm"
              className="rounded-l-none"
              onClick={() => {
                setMode('minify');
                log.info('切换为压缩模式');
              }}
            >
              <Minimize2 className="mr-1 h-3 w-3" />
              压缩
            </Button>
          </div>
          {mode === 'format' && (
            <>
              <Select
                value={indent}
                onChange={(e) => {
                  setIndent(e.target.value);
                  log.info('切换缩进', { indent: e.target.value });
                }}
                options={[
                  { value: '2', label: '2 空格' },
                  { value: '4', label: '4 空格' },
                  { value: '8', label: 'Tab' },
                ]}
                className="h-8 w-20 text-xs"
              />
              <Select
                value={sortMode}
                onChange={(e) => {
                  const value = e.target.value as SortMode;
                  setSortMode(value);
                  log.info('切换键排序', { sortMode: value });
                }}
                options={[
                  { value: 'none', label: '不排序' },
                  { value: 'alpha', label: 'A→Z' },
                  { value: 'alpha-desc', label: 'Z→A' },
                ]}
                className="h-8 w-20 text-xs"
              />
            </>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setInput(sampleJson);
              log.info('填充示例 JSON');
            }}
          >
            示例
          </Button>
        </div>
      }
      input={
        <div className="relative h-full overflow-hidden rounded-md border">
          <Editor
            height="100%"
            language="json"
            theme={isDark ? 'vs-dark' : 'light'}
            value={input}
            onChange={(v) => setInput(v || '')}
            options={{
              minimap: { enabled: false },
              fontSize: 13,
              lineNumbers: 'on',
              wordWrap: 'on',
              scrollBeyondLastLine: false,
              automaticLayout: true,
              tabSize: parseInt(indent) === 8 ? 4 : parseInt(indent),
              placeholder: '输入 JSON...',
            }}
          />
          {isValid !== null && (
            <div className="absolute bottom-2 right-2 z-10">
              {isValid ? (
                <CheckCircle2 className="h-5 w-5 text-green-500" />
              ) : (
                <AlertCircle className="h-5 w-5 text-destructive" />
              )}
            </div>
          )}
        </div>
      }
      output={
        <div className="relative h-full">
          {error ? (
            <div className="flex h-full items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-4">
              <AlertCircle className="h-5 w-5 shrink-0 text-destructive" />
              <div>
                <p className="font-medium text-destructive">JSON 解析错误</p>
                <p className="mt-1 font-mono text-sm text-muted-foreground">{error}</p>
              </div>
            </div>
          ) : (
            <div className="h-full overflow-hidden rounded-md border">
              <Editor
                height="100%"
                language="json"
                theme={isDark ? 'vs-dark' : 'light'}
                value={output}
                options={{
                  readOnly: true,
                  minimap: { enabled: false },
                  fontSize: 13,
                  lineNumbers: 'on',
                  wordWrap: 'on',
                  scrollBeyondLastLine: false,
                  automaticLayout: true,
                  domReadOnly: true,
                }}
              />
            </div>
          )}
        </div>
      }
    />
  );
}
