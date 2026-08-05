import { useState, useCallback, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { copyToClipboard } from '@/lib/utils';
import { RefreshCw, Copy, Eye, EyeOff } from 'lucide-react';
import { generatePassword, calculateEntropy, getStrengthLabel } from '@/lib/generator-utils';
import { useToolLogger } from '@/hooks/use-tool-logger';

export default function PasswordGenerator() {
  const [length, setLength] = useState(16);
  const [options, setOptions] = useState({
    lowercase: true,
    uppercase: true,
    numbers: true,
    symbols: false,
  });
  const [excludeAmbiguous, setExcludeAmbiguous] = useState(true);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(true);
  const log = useToolLogger('password-generator');

  const generate = useCallback(() => {
    setPassword(generatePassword(length, options, excludeAmbiguous));
    log.info('生成密码', { length, options, excludeAmbiguous });
  }, [length, options, excludeAmbiguous, log]);

  const entropy = useMemo(() => calculateEntropy(password), [password]);
  const strength = useMemo(() => {
    const { label, level } = getStrengthLabel(entropy);
    const colorMap = { weak: 'text-red-500', medium: 'text-yellow-500', strong: 'text-green-500', 'very-strong': 'text-emerald-500' };
    return { label, color: colorMap[level] };
  }, [entropy]);

  const handleCopy = useCallback(async () => {
    if (password) {
      await copyToClipboard(password);
      log.info('复制密码', { length: password.length });
      toast.success('密码已复制');
    }
  }, [password, log]);

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto max-w-md space-y-8">
        {/* Password Display */}
        <div className="relative">
          <div className="flex items-center gap-2 rounded-lg border bg-muted/50 p-4">
            <code
              className={cn(
                'flex-1 break-all font-mono text-lg',
                !showPassword && 'blur-sm select-none'
              )}
            >
              {password || '点击生成按钮'}
            </code>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShowPassword(!showPassword)}
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </Button>
            <Button variant="ghost" size="icon" onClick={handleCopy} disabled={!password}>
              <Copy className="h-4 w-4" />
            </Button>
          </div>
          {password && (
            <div className="mt-2 flex items-center justify-between text-sm">
              <span className="text-muted-foreground">熵值: {entropy} bits</span>
              <span className={cn('font-medium', strength.color)}>强度: {strength.label}</span>
            </div>
          )}
        </div>

        {/* Length Slider */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>长度</Label>
            <span className="font-mono text-sm">{length}</span>
          </div>
          <input
            type="range"
            min="4"
            max="128"
            value={length}
            onChange={(e) => setLength(parseInt(e.target.value))}
            className="w-full"
          />
        </div>

        {/* Character Options */}
        <div className="space-y-3">
          <Label>字符集</Label>
          {(
            [
              ['lowercase', '小写字母 (a-z)'],
              ['uppercase', '大写字母 (A-Z)'],
              ['numbers', '数字 (0-9)'],
              ['symbols', '符号 (!@#$...)'],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={options[key]}
                onChange={(e) => setOptions({ ...options, [key]: e.target.checked })}
                className="h-4 w-4 rounded border"
              />
              <span className="text-sm">{label}</span>
            </label>
          ))}
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={excludeAmbiguous}
              onChange={(e) => setExcludeAmbiguous(e.target.checked)}
              className="h-4 w-4 rounded border"
            />
            <span className="text-sm">排除易混淆字符 (o, O, 0, l, 1, I)</span>
          </label>
        </div>

        {/* Generate Button */}
        <Button onClick={generate} className="w-full">
          <RefreshCw className="mr-2 h-4 w-4" />
          生成密码
        </Button>
      </div>
    </div>
  );
}
