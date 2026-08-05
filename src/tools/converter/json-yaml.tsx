import { useState, useMemo, useCallback } from 'react';
import yaml from 'js-yaml';
import { ToolLayout } from '@/components/shared/ToolLayout';
import { Textarea } from '@/components/ui/textarea';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { AlertCircle } from 'lucide-react';
import { useToolLogger } from '@/hooks/use-tool-logger';

type Direction = 'json-to-yaml' | 'yaml-to-json';

export default function JsonYamlConverter() {
  const log = useToolLogger('json-yaml');
  const [input, setInput] = useState('');
  const [direction, setDirection] = useState<Direction>('json-to-yaml');
  const [indent, setIndent] = useState('2');

  const { output, error } = useMemo(() => {
    if (!input.trim()) return { output: '', error: null };

    try {
      if (direction === 'json-to-yaml') {
        const parsed = JSON.parse(input);
        const result = yaml.dump(parsed, {
          indent: parseInt(indent),
          lineWidth: -1,
          noRefs: true,
        });
        log.info('JSON → YAML 转换成功', { inputLength: input.length, outputLength: result.length });
        return { output: result, error: null };
      } else {
        const parsed = yaml.load(input);
        const result = JSON.stringify(parsed, null, parseInt(indent));
        log.info('YAML → JSON 转换成功', { inputLength: input.length, outputLength: result.length });
        return { output: result, error: null };
      }
    } catch (e) {
      log.warn('转换失败', { direction, error: (e as Error).message });
      return { output: '', error: (e as Error).message };
    }
  }, [input, direction, indent, log]);

  const handleSwap = useCallback(() => {
    if (output) {
      setInput(output);
      setDirection(direction === 'json-to-yaml' ? 'yaml-to-json' : 'json-to-yaml');
      log.info('交换输入输出', { newDirection: direction === 'json-to-yaml' ? 'yaml-to-json' : 'json-to-yaml' });
    }
  }, [output, direction, log]);

  const sampleJson = `{
  "name": "Niuery Toolkit",
  "version": "1.0.0",
  "features": ["offline", "secure", "fast"],
  "author": {
    "name": "Developer",
    "email": "dev@example.com"
  }
}`;

  const sampleYaml = `name: Niuery Toolkit
version: 1.0.0
features:
  - offline
  - secure
  - fast
author:
  name: Developer
  email: dev@example.com`;

  return (
    <ToolLayout
      inputTitle={direction === 'json-to-yaml' ? 'JSON' : 'YAML'}
      outputTitle={direction === 'json-to-yaml' ? 'YAML' : 'JSON'}
      outputValue={output}
      onClear={() => {
        setInput('');
        log.info('清空输入');
      }}
      onSwap={handleSwap}
      inputActions={
        <div className="flex items-center gap-2">
          <Select
            value={direction}
            onChange={(e) => {
              setDirection(e.target.value as Direction);
              log.info(`切换转换方向: ${e.target.value}`);
            }}
            options={[
              { value: 'json-to-yaml', label: 'JSON → YAML' },
              { value: 'yaml-to-json', label: 'YAML → JSON' },
            ]}
            className="h-8 w-32 text-xs"
          />
          <Select
            value={indent}
            onChange={(e) => setIndent(e.target.value)}
            options={[
              { value: '2', label: '2 空格' },
              { value: '4', label: '4 空格' },
            ]}
            className="h-8 w-20 text-xs"
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setInput(direction === 'json-to-yaml' ? sampleJson : sampleYaml)}
          >
            示例
          </Button>
        </div>
      }
      input={
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={direction === 'json-to-yaml' ? '输入 JSON...' : '输入 YAML...'}
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
