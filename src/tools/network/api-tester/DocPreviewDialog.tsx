import { useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { X, Download, Copy, Check } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { copyToClipboard } from '@/lib/utils';
import { useApiTesterStore } from '@/store/api-tester-store';
import { generateFullDoc } from '@/lib/doc-generator';

interface DocPreviewDialogProps {
  open: boolean;
  onClose: () => void;
}

export function DocPreviewDialog({ open, onClose }: DocPreviewDialogProps) {
  const { collections } = useApiTesterStore();
  const [copied, setCopied] = useState(false);

  const doc = useMemo(() => generateFullDoc(collections), [collections]);

  if (!open) return null;

  const handleCopy = async () => {
    await copyToClipboard(doc);
    setCopied(true);
    toast.success('已复制文档');
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const blob = new Blob([doc], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'api-documentation.md';
    a.click();
    URL.revokeObjectURL(url);
    toast.success('文档已导出');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="flex h-[600px] w-[800px] flex-col rounded-lg border bg-background shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h3 className="text-sm font-semibold">接口文档预览</h3>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={handleCopy}>
              {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
              复制
            </Button>
            <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={handleDownload}>
              <Download className="h-3.5 w-3.5" />
              导出 .md
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Content */}
        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-foreground">
            {doc}
          </pre>
        </div>
      </div>
    </div>
  );
}
