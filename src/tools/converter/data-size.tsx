import { useState, useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { convertDataSize, formatDataSize, DATA_SIZE_UNITS, type DataSizeUnit } from '@/lib/converter-utils';
import { useToolLogger } from '@/hooks/use-tool-logger';

export default function DataSizeConverter() {
  const log = useToolLogger('data-size');
  const [value, setValue] = useState('1');
  const [fromUnit, setFromUnit] = useState<DataSizeUnit>('GB');
  const [standard, setStandard] = useState<'1024' | '1000'>('1024');

  const results = useMemo(() => {
    const num = parseFloat(value);
    if (isNaN(num)) {
      if (value.trim()) log.warn('无效数值输入', { value });
      return null;
    }
    log.info('数据大小转换成功', { value: num, unit: fromUnit, standard });
    return convertDataSize(num, fromUnit, parseInt(standard) as 1024 | 1000);
  }, [value, fromUnit, standard, log]);

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto max-w-2xl space-y-8">
        {/* Input */}
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>数值</Label>
            <Input
              type="number"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="font-mono text-lg"
            />
          </div>
          <div className="flex gap-4">
            <div className="flex-1 space-y-2">
              <Label>单位</Label>
              <Select
                value={fromUnit}
                onChange={(e) => {
                  setFromUnit(e.target.value as DataSizeUnit);
                  log.info(`切换单位: ${e.target.value}`);
                }}
                options={DATA_SIZE_UNITS.map((u) => ({ value: u, label: u }))}
              />
            </div>
            <div className="flex-1 space-y-2">
              <Label>标准</Label>
              <Select
                value={standard}
                onChange={(e) => {
                  setStandard(e.target.value as '1024' | '1000');
                  log.info(`切换标准: ${e.target.value === '1024' ? 'IEC (1024)' : 'SI (1000)'}`);
                }}
                options={[
                  { value: '1024', label: 'IEC (1024)' },
                  { value: '1000', label: 'SI (1000)' },
                ]}
              />
            </div>
          </div>
        </div>

        {/* Results */}
        {results && (
          <div className="grid gap-3">
            {results.map((result) => (
              <div
                key={result.unit}
                className={`flex items-center justify-between rounded-lg border p-4 ${
                  result.unit === fromUnit ? 'border-primary bg-primary/5' : ''
                }`}
              >
                <span className="font-medium">{result.unit}</span>
                <code className="font-mono">
                  {formatDataSize(result.value)}
                </code>
              </div>
            ))}
          </div>
        )}

        <p className="text-sm text-muted-foreground">
          {standard === '1024'
            ? 'IEC 标准: 1 KB = 1024 B (二进制，常用于计算机存储)'
            : 'SI 标准: 1 KB = 1000 B (十进制，常用于硬盘厂商标称)'}
        </p>
      </div>
    </div>
  );
}
