import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { useToolLogger } from '@/hooks/use-tool-logger';
import { Upload, FileIcon, CheckCircle2, XCircle, Loader2 } from 'lucide-react';

type HashAlgorithm = 'SHA-1' | 'SHA-256' | 'SHA-384' | 'SHA-512';

interface FileResult {
  fileName: string;
  fileSize: number;
  algorithm: HashAlgorithm;
  hash: string;
  timeMs: number;
}

export default function ChecksumTool() {
  const [files, setFiles] = useState<File[]>([]);
  const [algorithm, setAlgorithm] = useState<HashAlgorithm>('SHA-256');
  const [results, setResults] = useState<FileResult[]>([]);
  const [expectedHash, setExpectedHash] = useState('');
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const log = useToolLogger('checksum');

  const computeHash = useCallback(async (file: File, algo: HashAlgorithm): Promise<FileResult> => {
    const start = performance.now();
    const buffer = await file.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest(algo, buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hash = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
    const timeMs = performance.now() - start;
    return { fileName: file.name, fileSize: file.size, algorithm: algo, hash, timeMs };
  }, []);

  const processFiles = useCallback(async (fileList: File[]) => {
    if (fileList.length === 0) return;
    setProcessing(true);
    setProgress(0);
    setResults([]);

    try {
      const newResults: FileResult[] = [];
      for (let i = 0; i < fileList.length; i++) {
        const result = await computeHash(fileList[i], algorithm);
        newResults.push(result);
        setProgress(Math.round(((i + 1) / fileList.length) * 100));
        setResults([...newResults]);
        log.info('文件哈希计算完成', {
          fileName: result.fileName,
          fileSize: result.fileSize,
          algorithm,
          timeMs: Math.round(result.timeMs * 10) / 10,
        });
      }
    } catch (e) {
      log.error('文件哈希计算失败', e);
    } finally {
      setProcessing(false);
    }
  }, [algorithm, computeHash, log]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const droppedFiles = Array.from(e.dataTransfer.files);
    if (droppedFiles.length > 0) {
      log.info('选择文件', {
        count: droppedFiles.length,
        files: droppedFiles.map((f) => ({ name: f.name, size: f.size })),
      });
      setFiles(droppedFiles);
      processFiles(droppedFiles);
    }
  }, [processFiles, log]);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(e.target.files || []);
    if (selectedFiles.length > 0) {
      log.info('选择文件', {
        count: selectedFiles.length,
        files: selectedFiles.map((f) => ({ name: f.name, size: f.size })),
      });
      setFiles(selectedFiles);
      processFiles(selectedFiles);
    }
  }, [processFiles, log]);

  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  const verifyHash = (hash: string): boolean | null => {
    if (!expectedHash.trim()) return null;
    return hash.toLowerCase() === expectedHash.trim().toLowerCase();
  };

  return (
    <div className="flex h-full flex-col gap-4 p-4 overflow-y-auto">
      {/* 配置区 */}
      <div className="flex items-end gap-4">
        <div className="space-y-2">
          <Label>哈希算法</Label>
          <Select
            value={algorithm}
            onChange={(e) => {
              const value = e.target.value as HashAlgorithm;
              setAlgorithm(value);
              log.info('切换哈希算法', { algorithm: value });
              if (files.length > 0) processFiles(files);
            }}
            options={[
              { value: 'SHA-1', label: 'SHA-1' },
              { value: 'SHA-256', label: 'SHA-256' },
              { value: 'SHA-384', label: 'SHA-384' },
              { value: 'SHA-512', label: 'SHA-512' },
            ]}
            className="w-32"
          />
        </div>
        <div className="flex-1 space-y-2">
          <Label>期望哈希值（可选，用于校验）</Label>
          <Input
            value={expectedHash}
            onChange={(e) => setExpectedHash(e.target.value)}
            placeholder="粘贴期望的哈希值进行比对..."
            className="font-mono text-sm"
          />
        </div>
      </div>

      {/* 拖放区域 */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={`flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-8 transition-colors ${
          dragOver ? 'border-primary bg-primary/5' : 'border-muted-foreground/25 hover:border-primary/50'
        }`}
      >
        <Upload className="h-10 w-10 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          拖拽文件到此处，或
        </p>
        <label>
          <input
            type="file"
            multiple
            onChange={handleFileInput}
            className="hidden"
          />
          <Button variant="outline" size="sm" onClick={() => (document.querySelector('input[type="file"]') as HTMLElement)?.click()}>
            选择文件
          </Button>
        </label>
      </div>

      {/* 进度条 */}
      {processing && (
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            计算中... {progress}%
          </div>
          <div className="h-2 w-full rounded-full bg-muted">
            <div
              className="h-2 rounded-full bg-primary transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {/* 结果列表 */}
      {results.length > 0 && (
        <div className="space-y-3">
          <p className="text-sm font-medium">计算结果 ({results.length} 个文件)</p>
          {results.map((result, idx) => {
            const verified = verifyHash(result.hash);
            return (
              <div key={idx} className="rounded-lg border p-4 space-y-2">
                <div className="flex items-center gap-2">
                  <FileIcon className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium truncate">{result.fileName}</span>
                  <span className="text-xs text-muted-foreground">({formatSize(result.fileSize)})</span>
                  {verified !== null && (
                    verified ? (
                      <span className="flex items-center gap-1 text-xs text-green-500 ml-auto">
                        <CheckCircle2 className="h-3.5 w-3.5" /> 匹配
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-xs text-red-500 ml-auto">
                        <XCircle className="h-3.5 w-3.5" /> 不匹配
                      </span>
                    )
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 rounded bg-muted px-2 py-1.5 text-xs font-mono break-all">
                    {result.hash}
                  </code>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => navigator.clipboard.writeText(result.hash)}
                  >
                    复制
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {result.algorithm} · 耗时 {result.timeMs.toFixed(1)}ms
                </p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
