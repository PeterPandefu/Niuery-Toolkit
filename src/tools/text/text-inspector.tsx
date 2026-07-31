import { useState, useMemo } from 'react';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { analyzeText, getCharFrequency, getReadingTime } from '@/lib/text-utils';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export default function TextInspector() {
  const [input, setInput] = useState('');

  const stats = useMemo(() => analyzeText(input), [input]);

  // 字符频率分析
  const charFrequency = useMemo(() => getCharFrequency(input, 20), [input]);

  const statItems = [
    { label: '字符数', value: stats.characters.toLocaleString() },
    { label: '字符数 (不含空格)', value: stats.charactersNoSpaces.toLocaleString() },
    { label: '单词数', value: stats.words.toLocaleString() },
    { label: '行数', value: stats.lines.toLocaleString() },
    { label: '句子数', value: stats.sentences.toLocaleString() },
    { label: '段落数', value: stats.paragraphs.toLocaleString() },
    { label: '字节数 (UTF-8)', value: formatBytes(stats.bytes) },
  ];

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto max-w-3xl space-y-6">
        {/* Input */}
        <div className="space-y-2">
          <Label>输入文本</Label>
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="输入或粘贴文本进行分析..."
            className="min-h-[200px] resize-none"
          />
        </div>

        {/* Stats Grid */}
        {input && (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {statItems.map(({ label, value }) => (
              <div key={label} className="rounded-lg border p-4 text-center">
                <div className="text-2xl font-bold">{value}</div>
                <div className="text-xs text-muted-foreground">{label}</div>
              </div>
            ))}
          </div>
        )}

        {/* Character Frequency */}
        {charFrequency.length > 0 && (
          <div className="space-y-2">
            <Label>字符频率 (Top 20)</Label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {charFrequency.map(([char, count]) => (
                <div
                  key={char}
                  className="flex items-center justify-between rounded-md border px-3 py-2"
                >
                  <code className="font-mono">
                    {char === ' ' ? '␣' : char === '\n' ? '↵' : char === '\t' ? '⇥' : char}
                  </code>
                  <span className="text-sm text-muted-foreground">{count}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Reading Time */}
        {stats.words > 0 && (
          <div className="rounded-lg border p-4">
            <div className="text-sm text-muted-foreground">预计阅读时间</div>
            <div className="text-lg font-medium">
              {getReadingTime(stats.words).chinese} 分钟 (中文) / {getReadingTime(stats.words).english} 分钟 (英文)
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
