import { useState, useMemo } from 'react';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/zh-cn';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { RefreshCw } from 'lucide-react';

dayjs.extend(utc);
dayjs.extend(relativeTime);
dayjs.locale('zh-cn');

type Mode = 'to-date' | 'to-timestamp';

export default function TimestampConverter() {
  const [mode, setMode] = useState<Mode>('to-date');
  const [timestamp, setTimestamp] = useState('');
  const [dateStr, setDateStr] = useState('');
  const [unit, setUnit] = useState<'s' | 'ms'>('s');
  const [timezone, setTimezone] = useState('local');

  const now = useMemo(() => Math.floor(Date.now() / 1000), []);

  const timestampResult = useMemo(() => {
    if (!dateStr) return null;
    try {
      const d = dayjs(dateStr);
      if (!d.isValid()) return { error: '无效日期' };
      return {
        seconds: d.unix(),
        milliseconds: d.valueOf(),
        iso: d.toISOString(),
        relative: d.fromNow(),
      };
    } catch {
      return { error: '解析失败' };
    }
  }, [dateStr]);

  const dateResult = useMemo(() => {
    if (!timestamp) return null;
    try {
      const num = Number(timestamp);
      if (isNaN(num)) return { error: '无效时间戳' };
      const ms = unit === 's' ? num * 1000 : num;
      const d = timezone === 'utc' ? dayjs.utc(ms) : dayjs(ms);
      if (!d.isValid()) return { error: '无效时间戳' };
      return {
        local: d.format('YYYY-MM-DD HH:mm:ss'),
        utc: d.utc().format('YYYY-MM-DD HH:mm:ss'),
        iso: d.toISOString(),
        relative: d.fromNow(),
      };
    } catch {
      return { error: '解析失败' };
    }
  }, [timestamp, unit, timezone]);

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto max-w-2xl space-y-8">
        {/* Mode Selector */}
        <div className="flex items-center gap-4">
          <Select
            value={mode}
            onChange={(e) => setMode(e.target.value as Mode)}
            options={[
              { value: 'to-date', label: '时间戳 → 日期' },
              { value: 'to-timestamp', label: '日期 → 时间戳' },
            ]}
            className="w-48"
          />
          <Button variant="outline" size="sm" onClick={() => {
            setTimestamp(String(now));
            setDateStr(dayjs().format('YYYY-MM-DDTHH:mm'));
          }}>
            <RefreshCw className="mr-2 h-4 w-4" />
            当前时间
          </Button>
        </div>

        {mode === 'to-date' ? (
          <div className="space-y-6">
            {/* Input */}
            <div className="space-y-2">
              <Label>Unix 时间戳</Label>
              <div className="flex gap-2">
                <Input
                  type="number"
                  value={timestamp}
                  onChange={(e) => setTimestamp(e.target.value)}
                  placeholder="例如: 1704067200"
                  className="font-mono"
                />
                <Select
                  value={unit}
                  onChange={(e) => setUnit(e.target.value as 's' | 'ms')}
                  options={[
                    { value: 's', label: '秒' },
                    { value: 'ms', label: '毫秒' },
                  ]}
                  className="w-24"
                />
                <Select
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                  options={[
                    { value: 'local', label: '本地时区' },
                    { value: 'utc', label: 'UTC' },
                  ]}
                  className="w-28"
                />
              </div>
            </div>

            {/* Results */}
            {dateResult && !('error' in dateResult) && (
              <div className="grid gap-4 rounded-lg border p-4">
                <ResultRow label="本地时间" value={dateResult.local} />
                <ResultRow label="UTC 时间" value={dateResult.utc} />
                <ResultRow label="ISO 8601" value={dateResult.iso} />
                <ResultRow label="相对时间" value={dateResult.relative} />
              </div>
            )}
            {dateResult && 'error' in dateResult && (
              <p className="text-sm text-destructive">{dateResult.error}</p>
            )}
          </div>
        ) : (
          <div className="space-y-6">
            {/* Input */}
            <div className="space-y-2">
              <Label>日期时间</Label>
              <Input
                type="datetime-local"
                value={dateStr}
                onChange={(e) => setDateStr(e.target.value)}
                className="font-mono"
              />
            </div>

            {/* Results */}
            {timestampResult && !('error' in timestampResult) && (
              <div className="grid gap-4 rounded-lg border p-4">
                <ResultRow label="秒级时间戳" value={String(timestampResult.seconds)} />
                <ResultRow label="毫秒级时间戳" value={String(timestampResult.milliseconds)} />
                <ResultRow label="ISO 8601" value={timestampResult.iso} />
                <ResultRow label="相对时间" value={timestampResult.relative} />
              </div>
            )}
            {timestampResult && 'error' in timestampResult && (
              <p className="text-sm text-destructive">{timestampResult.error}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ResultRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-muted-foreground">{label}</span>
      <code className="rounded bg-muted px-2 py-1 font-mono text-sm">{value}</code>
    </div>
  );
}
