import { useState, useCallback } from 'react';
import { v1 as uuidv1, v4 as uuidv4, v5 as uuidv5 } from 'uuid';
import { ulid } from 'ulid';
import { nanoid } from 'nanoid';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { copyToClipboard } from '@/lib/utils';
import { useToolLogger } from '@/hooks/use-tool-logger';
import { RefreshCw, Copy, Trash2 } from 'lucide-react';

type UuidType = 'v1' | 'v4' | 'v5' | 'ulid' | 'nanoid';

const UUID_TYPES: { value: UuidType; label: string; description: string }[] = [
  { value: 'v4', label: 'UUID v4', description: '随机生成（最常用）' },
  { value: 'v1', label: 'UUID v1', description: '基于时间戳' },
  { value: 'v5', label: 'UUID v5', description: '基于命名空间 (SHA-1)' },
  { value: 'ulid', label: 'ULID', description: '可排序的唯一标识符' },
  { value: 'nanoid', label: 'NanoID', description: '轻量级唯一 ID' },
];

export default function UuidGenerator() {
  const [type, setType] = useState<UuidType>('v4');
  const [count, setCount] = useState('5');
  const [uppercase, setUppercase] = useState('false');
  const [hyphens, setHyphens] = useState('true');
  const [namespace, setNamespace] = useState('');
  const [name, setName] = useState('');
  const [results, setResults] = useState<string[]>([]);
  const log = useToolLogger('uuid-generator');

  const generate = useCallback(() => {
    const num = Math.min(Math.max(parseInt(count) || 1, 1), 1000);
    const ids: string[] = [];

    for (let i = 0; i < num; i++) {
      let id: string;
      switch (type) {
        case 'v1':
          id = uuidv1();
          break;
        case 'v4':
          id = uuidv4();
          break;
        case 'v5':
          id = namespace && name ? uuidv5(name, namespace) : uuidv4();
          break;
        case 'ulid':
          id = ulid();
          break;
        case 'nanoid':
          id = nanoid();
          break;
        default:
          id = uuidv4();
      }

      if (uppercase === 'true') id = id.toUpperCase();
      if (hyphens === 'false' && type !== 'nanoid') id = id.replace(/-/g, '');

      ids.push(id);
    }

    setResults(ids);
    log.info('生成唯一标识符', {
      type,
      count: num,
      uppercase: uppercase === 'true',
      hyphens: hyphens === 'true',
    });
  }, [type, count, uppercase, hyphens, namespace, name, log]);

  const handleCopyAll = useCallback(async () => {
    await copyToClipboard(results.join('\n'));
    log.info('复制全部 ID', { count: results.length });
    toast.success(`已复制 ${results.length} 个 ID`);
  }, [results, log]);

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto max-w-2xl space-y-6">
        {/* Configuration */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>类型</Label>
            <Select
              value={type}
              onChange={(e) => setType(e.target.value as UuidType)}
              options={UUID_TYPES.map((t) => ({ value: t.value, label: t.label }))}
            />
            <p className="text-xs text-muted-foreground">
              {UUID_TYPES.find((t) => t.value === type)?.description}
            </p>
          </div>
          <div className="space-y-2">
            <Label>数量 (1-1000)</Label>
            <Input
              type="number"
              value={count}
              onChange={(e) => setCount(e.target.value)}
              min="1"
              max="1000"
            />
          </div>
        </div>

        {/* Options */}
        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={uppercase === 'true'}
              onChange={(e) => setUppercase(e.target.checked ? 'true' : 'false')}
              className="h-4 w-4 rounded border"
            />
            <span className="text-sm">大写</span>
          </label>
          {type !== 'nanoid' && type !== 'ulid' && (
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={hyphens === 'true'}
                onChange={(e) => setHyphens(e.target.checked ? 'true' : 'false')}
                className="h-4 w-4 rounded border"
              />
              <span className="text-sm">包含连字符</span>
            </label>
          )}
        </div>

        {/* UUID v5 specific inputs */}
        {type === 'v5' && (
          <div className="grid gap-4 rounded-lg border p-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>命名空间 (UUID)</Label>
              <Input
                value={namespace}
                onChange={(e) => setNamespace(e.target.value)}
                placeholder="例如: 6ba7b810-9dad-11d1-80b4-00c04fd430c8"
              />
            </div>
            <div className="space-y-2">
              <Label>名称</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="输入名称..."
              />
            </div>
          </div>
        )}

        {/* Generate Button */}
        <Button onClick={generate} className="w-full">
          <RefreshCw className="mr-2 h-4 w-4" />
          生成
        </Button>

        {/* Results */}
        {results.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                已生成 {results.length} 个 ID
              </span>
              <div className="flex gap-1">
                <Button variant="ghost" size="sm" onClick={handleCopyAll}>
                  <Copy className="mr-1 h-3 w-3" />
                  复制全部
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setResults([])}>
                  <Trash2 className="mr-1 h-3 w-3" />
                  清空
                </Button>
              </div>
            </div>
            <Textarea
              value={results.join('\n')}
              readOnly
              className="min-h-[200px] resize-none font-mono text-sm"
            />
          </div>
        )}
      </div>
    </div>
  );
}
