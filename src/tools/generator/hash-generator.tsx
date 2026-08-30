import { useState, useCallback } from 'react';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { copyToClipboard } from '@/lib/utils';
import { useToolLogger } from '@/hooks/use-tool-logger';
import { Copy, FileIcon, Upload } from 'lucide-react';
import { md5 } from 'js-md5';

type HashAlgorithm = 'MD5' | 'SHA-1' | 'SHA-256' | 'SHA-384' | 'SHA-512';

const ALGORITHMS: HashAlgorithm[] = ['MD5', 'SHA-1', 'SHA-256', 'SHA-384', 'SHA-512'];

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

async function computeHash(
  data: string | ArrayBuffer,
  algorithm: HashAlgorithm
): Promise<string> {
  const encoder = new TextEncoder();
  const buffer = typeof data === 'string' ? encoder.encode(data) : data;
  if (algorithm === 'MD5') {
    return md5(buffer);
  }
  const hashBuffer = await crypto.subtle.digest(algorithm, buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function computeHmac(
  data: string,
  key: string,
  algorithm: HashAlgorithm
): Promise<string> {
  if (algorithm === 'MD5') {
    return md5.hmac(key, data);
  }
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
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [hashes, setHashes] = useState<Record<string, string>>({});
  const [computing, setComputing] = useState(false);
  const log = useToolLogger('hash-generator');

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
      log.info('哈希计算完成', {
        inputLength: input.length,
        hmac: hmacKey.length > 0,
        algorithms: ALGORITHMS.length,
      });
    } catch (e) {
      log.error('哈希计算失败', e);
      toast.error('计算失败: ' + (e as Error).message);
    } finally {
      setComputing(false);
    }
  }, [input, hmacKey, log]);

  const handleFileDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (!file) return;

    if (file.size > 50 * 1024 * 1024) {
      log.warn('文件超过大小限制', { name: file.name, size: file.size });
      toast.error('文件大小不能超过 50MB');
      return;
    }

    log.info('选择文件', { name: file.name, size: file.size });
    setInput('');
    setSelectedFile(file);
    setComputing(true);
    try {
      const buffer = await file.arrayBuffer();
      const results: Record<string, string> = {};

      for (const algo of ALGORITHMS) {
        results[algo] = await computeHash(buffer, algo);
      }

      setHashes(results);
      log.info('文件哈希计算完成', { name: file.name, size: file.size });
      toast.success(`已计算文件: ${file.name}`);
    } catch (e) {
      log.error('文件哈希计算失败', e);
      toast.error('计算失败: ' + (e as Error).message);
    } finally {
      setComputing(false);
    }
  }, [log]);

  const handleCopy = useCallback(async (algo: string, value: string) => {
    await copyToClipboard(value);
    log.info('复制哈希值', { algorithm: algo });
    toast.success(`已复制 ${algo}`);
  }, [log]);

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
                  log.info('选择文件', { name: file.name, size: file.size });
                  setInput('');
                  setSelectedFile(file);
                  const buffer = await file.arrayBuffer();
                  setComputing(true);
                  const results: Record<string, string> = {};
                  for (const algo of ALGORITHMS) {
                    results[algo] = await computeHash(buffer, algo);
                  }
                  setHashes(results);
                  setComputing(false);
                  log.info('文件哈希计算完成', { name: file.name, size: file.size });
                  toast.success(`已计算文件: ${file.name}`);
                }}
              />
              <Upload className="mr-1 inline h-3 w-3" />
              选择文件
            </label>
          </div>
          <Textarea
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              if (e.target.value) setSelectedFile(null);
            }}
            placeholder="输入要计算哈希的文本..."
            className="min-h-[120px] resize-none font-mono text-sm"
          />
          {selectedFile && (
            <div className="flex min-w-0 items-center gap-2 rounded-lg border bg-muted/20 px-3 py-2" aria-live="polite">
              <FileIcon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate text-sm" title={selectedFile.name}>
                {selectedFile.name}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {formatFileSize(selectedFile.size)}
              </span>
            </div>
          )}
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
