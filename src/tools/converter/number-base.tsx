import { useState, useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

interface BaseResult {
  binary: string;
  octal: string;
  decimal: string;
  hex: string;
}

export default function NumberBaseConverter() {
  const [input, setInput] = useState('');
  const [base, setBase] = useState<2 | 8 | 10 | 16>(10);

  const result = useMemo((): BaseResult | { error: string } | null => {
    if (!input.trim()) return null;

    try {
      // 验证输入
      const validChars: Record<number, RegExp> = {
        2: /^[01]+$/,
        8: /^[0-7]+$/,
        10: /^-?\d+$/,
        16: /^[0-9a-fA-F]+$/,
      };

      const cleanInput = input.trim().toLowerCase();
      if (!validChars[base].test(cleanInput)) {
        return { error: `无效的${base}进制数` };
      }

      // 使用 BigInt 避免精度丢失
      let decimal: bigint;
      if (base === 10) {
        decimal = BigInt(cleanInput);
      } else {
        decimal = BigInt(parseInt(cleanInput, base));
      }

      const isNegative = decimal < 0n;
      const abs = isNegative ? -decimal : decimal;

      return {
        binary: (isNegative ? '-' : '') + abs.toString(2),
        octal: (isNegative ? '-' : '') + abs.toString(8),
        decimal: (isNegative ? '-' : '') + abs.toString(10),
        hex: (isNegative ? '-' : '') + abs.toString(16).toUpperCase(),
      };
    } catch {
      return { error: '解析失败' };
    }
  }, [input, base]);

  const bases = [
    { value: 2 as const, label: '二进制', prefix: '0b' },
    { value: 8 as const, label: '八进制', prefix: '0o' },
    { value: 10 as const, label: '十进制', prefix: '' },
    { value: 16 as const, label: '十六进制', prefix: '0x' },
  ];

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto max-w-2xl space-y-8">
        {/* Base Selector */}
        <div className="flex gap-2">
          {bases.map((b) => (
            <button
              key={b.value}
              onClick={() => {
                setBase(b.value);
                setInput('');
              }}
              className={cn(
                'rounded-md px-4 py-2 text-sm font-medium transition-colors',
                base === b.value
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted hover:bg-muted/80'
              )}
            >
              {b.label}
            </button>
          ))}
        </div>

        {/* Input */}
        <div className="space-y-2">
          <Label>输入{bases.find((b) => b.value === base)?.label}数</Label>
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={
              base === 2
                ? '例如: 101010'
                : base === 8
                ? '例如: 755'
                : base === 10
                ? '例如: 42'
                : '例如: FF'
            }
            className="font-mono text-lg"
          />
        </div>

        {/* Results */}
        {result && !('error' in result) && (
          <div className="grid gap-4">
            {bases.map((b) => {
              const key = b.value === 2 ? 'binary' : b.value === 8 ? 'octal' : b.value === 10 ? 'decimal' : 'hex';
              const value = result[key];
              return (
                <div
                  key={b.value}
                  className={cn(
                    'rounded-lg border p-4',
                    base === b.value && 'border-primary bg-primary/5'
                  )}
                >
                  <div className="mb-1 text-sm text-muted-foreground">
                    {b.label} {b.prefix && <code className="text-xs">({b.prefix})</code>}
                  </div>
                  <code className="break-all font-mono text-lg">{value}</code>
                </div>
              );
            })}
          </div>
        )}

        {result && 'error' in result && (
          <p className="text-sm text-destructive">{result.error}</p>
        )}
      </div>
    </div>
  );
}
