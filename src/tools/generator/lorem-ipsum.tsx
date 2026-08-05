import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { copyToClipboard } from '@/lib/utils';
import { RefreshCw, Copy } from 'lucide-react';
import { generateLoremIpsum, type LoremType, type LoremLang } from '@/lib/generator-utils';
import { useToolLogger } from '@/hooks/use-tool-logger';

export default function LoremIpsum() {
  const [type, setType] = useState<LoremType>('paragraphs');
  const [count, setCount] = useState('3');
  const [lang, setLang] = useState<LoremLang>('en');
  const [output, setOutput] = useState('');
  const log = useToolLogger('lorem-ipsum');

  const generate = useCallback(() => {
    const num = parseInt(count) || 1;
    setOutput(generateLoremIpsum(type, num, lang));
    log.info('生成占位文本', { type, count: num, lang });
  }, [type, count, lang, log]);

  const handleCopy = useCallback(async () => {
    if (output) {
      await copyToClipboard(output);
      log.info('复制生成内容', { length: output.length });
      toast.success('已复制');
    }
  }, [output, log]);

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto max-w-2xl space-y-6">
        {/* Configuration */}
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label>类型</Label>
            <Select
              value={type}
              onChange={(e) => setType(e.target.value as LoremType)}
              options={[
                { value: 'paragraphs', label: '段落' },
                { value: 'sentences', label: '句子' },
                { value: 'words', label: '单词' },
              ]}
            />
          </div>
          <div className="space-y-2">
            <Label>数量</Label>
            <Input
              type="number"
              value={count}
              onChange={(e) => setCount(e.target.value)}
              min="1"
              max="100"
            />
          </div>
          <div className="space-y-2">
            <Label>语言</Label>
            <Select
              value={lang}
              onChange={(e) => setLang(e.target.value as LoremLang)}
              options={[
                { value: 'en', label: 'Lorem Ipsum' },
                { value: 'zh', label: '千字文' },
              ]}
            />
          </div>
        </div>

        {/* Generate Button */}
        <Button onClick={generate} className="w-full">
          <RefreshCw className="mr-2 h-4 w-4" />
          生成
        </Button>

        {/* Output */}
        {output && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                {output.length} 字符
              </span>
              <Button variant="ghost" size="sm" onClick={handleCopy}>
                <Copy className="mr-1 h-3 w-3" />
                复制
              </Button>
            </div>
            <Textarea
              value={output}
              readOnly
              className="min-h-[300px] resize-none leading-relaxed"
            />
          </div>
        )}
      </div>
    </div>
  );
}
