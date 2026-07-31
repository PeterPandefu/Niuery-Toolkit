import { useState, useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { AlertCircle } from 'lucide-react';
import { testRegex, highlightMatches } from '@/lib/text-utils';

const COMMON_PATTERNS = [
  { name: '邮箱', pattern: '[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}' },
  { name: 'URL', pattern: 'https?://[\\w\\-._~:/?#\\[\\]@!$&\'()*+,;=%]+' },
  { name: 'IP地址', pattern: '\\b(?:\\d{1,3}\\.){3}\\d{1,3}\\b' },
  { name: '手机号', pattern: '1[3-9]\\d{9}' },
  { name: '日期', pattern: '\\d{4}[-/]\\d{2}[-/]\\d{2}' },
  { name: '十六进制颜色', pattern: '#[0-9a-fA-F]{6}\\b' },
];

export default function RegexTester() {
  const [pattern, setPattern] = useState('');
  const [flags, setFlags] = useState('g');
  const [testString, setTestString] = useState('');

  const { matches, error } = useMemo(() => {
    return testRegex(pattern, flags, testString);
  }, [pattern, flags, testString]);

  // 高亮匹配文本
  const highlightedText = useMemo(() => {
    if (!pattern || !testString || error || matches.length === 0) return null;
    return highlightMatches(testString, matches);
  }, [pattern, testString, matches, error]);

  const flagOptions = [
    { flag: 'g', label: 'global' },
    { flag: 'i', label: 'ignoreCase' },
    { flag: 'm', label: 'multiline' },
    { flag: 's', label: 'dotAll' },
    { flag: 'u', label: 'unicode' },
  ];

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto max-w-3xl space-y-6">
        {/* Pattern Input */}
        <div className="space-y-2">
          <Label>正则表达式</Label>
          <div className="flex items-center gap-2 rounded-md border px-3">
            <span className="text-muted-foreground">/</span>
            <Input
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
              placeholder="输入正则表达式..."
              className="border-0 px-0 font-mono shadow-none focus-visible:ring-0"
              spellCheck={false}
            />
            <span className="text-muted-foreground">/</span>
            <Input
              value={flags}
              onChange={(e) => setFlags(e.target.value)}
              className="w-16 border-0 px-0 text-center font-mono shadow-none focus-visible:ring-0"
              spellCheck={false}
            />
          </div>
          {error && (
            <p className="flex items-center gap-1 text-sm text-destructive">
              <AlertCircle className="h-4 w-4" />
              {error}
            </p>
          )}
        </div>

        {/* Flags */}
        <div className="flex flex-wrap gap-2">
          {flagOptions.map(({ flag, label }) => (
            <button
              key={flag}
              onClick={() =>
                setFlags((f) => (f.includes(flag) ? f.replace(flag, '') : f + flag))
              }
              className={cn(
                'rounded-md px-2 py-1 text-xs font-medium transition-colors',
                flags.includes(flag)
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted hover:bg-muted/80'
              )}
              title={label}
            >
              {flag}
            </button>
          ))}
        </div>

        {/* Common Patterns */}
        <div className="flex flex-wrap gap-2">
          <span className="text-sm text-muted-foreground">常用:</span>
          {COMMON_PATTERNS.map(({ name, pattern: p }) => (
            <Button
              key={name}
              variant="outline"
              size="sm"
              onClick={() => setPattern(p)}
            >
              {name}
            </Button>
          ))}
        </div>

        {/* Test String */}
        <div className="space-y-2">
          <Label>测试文本</Label>
          <Textarea
            value={testString}
            onChange={(e) => setTestString(e.target.value)}
            placeholder="输入要测试的文本..."
            className="min-h-[150px] resize-none font-mono text-sm"
          />
        </div>

        {/* Highlighted Result */}
        {highlightedText && (
          <div className="space-y-2">
            <Label>匹配高亮</Label>
            <div className="rounded-md border bg-muted/30 p-4 font-mono text-sm whitespace-pre-wrap">
              {highlightedText.map((part, i) =>
                part.isMatch ? (
                  <mark key={i} className="bg-yellow-300 dark:bg-yellow-600/50">
                    {part.text}
                  </mark>
                ) : (
                  <span key={i}>{part.text}</span>
                )
              )}
            </div>
          </div>
        )}

        {/* Match Results */}
        {matches.length > 0 && (
          <div className="space-y-2">
            <Label>匹配结果 ({matches.length} 个)</Label>
            <div className="max-h-[200px] space-y-2 overflow-y-auto">
              {matches.map((m, i) => (
                <div key={i} className="rounded-md border p-3">
                  <div className="flex items-center justify-between">
                    <code className="font-mono text-sm">{m.match}</code>
                    <span className="text-xs text-muted-foreground">
                      位置: {m.index}
                    </span>
                  </div>
                  {m.groups.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {m.groups.map((g, j) => (
                        <span
                          key={j}
                          className="rounded bg-muted px-1.5 py-0.5 text-xs"
                        >
                          ${j + 1}: {g ?? 'undefined'}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
