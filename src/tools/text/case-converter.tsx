import { useState, useMemo } from 'react';
import { ToolLayout } from '@/components/shared/ToolLayout';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { convertCase, type CaseType } from '@/lib/codec-utils';
import { useToolLogger } from '@/hooks/use-tool-logger';

const CASE_TYPES: CaseType[] = [
  'camelCase',
  'PascalCase',
  'snake_case',
  'CONSTANT_CASE',
  'kebab-case',
  'Title Case',
  'UPPERCASE',
  'lowercase',
];

export default function CaseConverter() {
  const [input, setInput] = useState('');
  const [selectedCase, setSelectedCase] = useState<CaseType>('camelCase');
  const log = useToolLogger('case-converter');

  const output = useMemo(() => {
    if (!input.trim()) return '';
    try {
      const result = convertCase(input, selectedCase);
      log.info('转换完成', { targetCase: selectedCase, length: result.length });
      return result;
    } catch (e) {
      log.error('转换失败', e);
      throw e;
    }
  }, [input, selectedCase, log]);

  const allResults = useMemo(() => {
    if (!input.trim()) return [];
    return CASE_TYPES.map((type) => ({
      type,
      value: convertCase(input, type),
    }));
  }, [input]);

  return (
    <ToolLayout
      inputTitle="输入文本"
      outputTitle={`输出 (${selectedCase})`}
      outputValue={output}
      onClear={() => setInput('')}
      inputActions={
        <div className="flex flex-wrap gap-1">
          {CASE_TYPES.map((type) => (
            <Button
              key={type}
              variant={selectedCase === type ? 'default' : 'outline'}
              size="sm"
              className="h-7 text-xs"
              onClick={() => setSelectedCase(type)}
            >
              {type}
            </Button>
          ))}
        </div>
      }
      input={
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="输入文本...\n例如: hello world 或 helloWorld"
          className="h-full resize-none font-mono text-sm"
        />
      }
      output={
        <div className="h-full space-y-4 overflow-y-auto">
          <Textarea
            value={output}
            readOnly
            placeholder="转换结果..."
            className="min-h-[100px] resize-none bg-muted/50 font-mono text-sm"
          />

          {allResults.length > 0 && (
            <div className="space-y-2">
              <span className="text-sm font-medium text-muted-foreground">所有格式</span>
              <div className="grid gap-2">
                {allResults.map(({ type, value }) => (
                  <div
                    key={type}
                    className={cn(
                      'flex items-center justify-between rounded-md border p-2',
                      type === selectedCase && 'border-primary bg-primary/5'
                    )}
                  >
                    <span className="text-xs text-muted-foreground">{type}</span>
                    <code className="font-mono text-sm">{value}</code>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      }
    />
  );
}
