import { useState, useCallback } from 'react';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { copyToClipboard } from '@/lib/utils';
import { Copy, Upload } from 'lucide-react';

type HashAlgorithm = 'SHA-1' | 'SHA-256' | 'SHA-384' | 'SHA-512';

const ALGORITHMS: HashAlgorithm[] = ['SHA-1', 'SHA-256', 'SHA-384', 'SHA-512'];

async function computeHash(
  data: string | ArrayBuffer,
  algorithm: HashAlgorithm
): Promise<string> {
  const encoder = new TextEncoder();
  const buffer = typeof data === 'string' ? encoder.encode(data) : data;
  const hashBuffer = await crypto.subtle.digest(algorithm, buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function computeHmac(
  data: string,
  key: string,
  algorithm: HashAlgorithm
): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(key);
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: algorithm },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(data));
  const hashArray = Array.from(new Uint8Array(signature));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

export default function HashGenerator() {
  const [input, setInput] = useState('');
  const [hmacKey, setHmacKey] = useState('');
  const [hashes, setHashes] = useState<Record<string, string>>({});
  const [computing, setComputing] = useState(false);

  const compute = useCallback(async () => {
    if (!input) return;
    setComputing(true);

    try {
      const results: Record<string, string> = {};

      for (const algo of ALGORITHMS) {
        if (hmacKey) {
          results[algo] = await computeHmac(input, hmacKey, algo);
        } else {
          results[algo] = await computeHash(input, algo);
        }
      }

      setHashes(results);
    } catch (e) {
      toast.error('计算失败: ' + (e as Error).message);
    } finally {
      setComputing(false);
    }
  }, [input, hmacKey]);

  const handleFileDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (!file) return;

    if (file.size > 50 * 1024 * 1024) {
      toast.error('文件大小不能超过 50MB');
      return;
    }

    setComputing(true);
    try {
      const buffer = await file.arrayBuffer();
      const results: Record<string, string> = {};

      for (const algo of ALGORITHMS) {
        results[algo] = await computeHash(buffer, algo);
      }

      setHashes(results);
      toast.success(`已计算文件: ${file.name}`);
    } catch (e) {
      toast.error('计算失败: ' + (e as Error).message);
    } finally {
      setComputing(false);
    }
  }, []);

  const handleCopy = useCallback(async (algo: string, value: string) => {
    await copyToClipboard(value);
    toast.success(`已复制 ${algo}`);
  }, []);

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto max-w-2xl space-y-6">
        {/* Input */}
        <div
          className="space-y-2"
          onDrop={handleFileDrop}
          onDragOver={(e) => e.preventDefault()}
        >
          <div className="flex items-center justify-between">
            <Label>输入文本（或拖拽文件）</Label>
            <label className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
              <input
                type="file"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const buffer = await file.arrayBuffer();
                  setComputing(true);
                  const results: Record<string, string> = {};
                  for (const algo of ALGORITHMS) {
                    results[algo] = await computeHash(buffer, algo);
                  }
                  setHashes(results);
                  setComputing(false);
                  toast.success(`已计算文件: ${file.name}`);
                }}
              />
              <Upload className="mr-1 inline h-3 w-3" />
              选择文件
            </label>
          </div>
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="输入要计算哈希的文本..."
            className="min-h-[120px] resize-none font-mono text-sm"
          />
        </div>

        {/* HMAC Key */}
        <div className="space-y-2">
          <Label>HMAC 密钥（可选）</Label>
          <Input
            value={hmacKey}
            onChange={(e) => setHmacKey(e.target.value)}
            placeholder="留空则计算普通哈希，填写则计算 HMAC"
            className="font-mono"
          />
        </div>

        {/* Compute Button */}
        <Button onClick={compute} disabled={!input || computing} className="w-full">
          {computing ? '计算中...' : hmacKey ? '计算 HMAC' : '计算哈希'}
        </Button>

        {/* Results */}
        {Object.keys(hashes).length > 0 && (
          <div className="space-y-3">
            {ALGORITHMS.map((algo) => (
              <div key={algo} className="rounded-lg border p-4">
                <div className="mb-2 flex items-center justify-between">
                  <span className="font-medium">{algo}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleCopy(algo, hashes[algo])}
                  >
                    <Copy className="mr-1 h-3 w-3" />
                    复制
                  </Button>
                </div>
                <code className="block break-all font-mono text-sm text-muted-foreground">
                  {hashes[algo]}
                </code>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
