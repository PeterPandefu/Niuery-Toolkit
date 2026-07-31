import { useState, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Copy, Check, Download, Clock, HardDrive } from 'lucide-react';
import { toast } from 'sonner';
import { copyToClipboard } from '@/lib/utils';
import { formatSize, tryFormatJson } from '@/lib/api-client';
import type { ApiResponse, ScriptLog } from '@/store/api-tester-store';

interface ResponsePanelProps {
  response: ApiResponse | null;
  loading: boolean;
  scriptLogs: ScriptLog[];
}

type TabId = 'body' | 'headers' | 'logs';

function statusColor(status: number): string {
  if (status >= 200 && status < 300) return 'text-green-600 dark:text-green-400';
  if (status >= 300 && status < 400) return 'text-blue-600 dark:text-blue-400';
  if (status >= 400 && status < 500) return 'text-orange-600 dark:text-orange-400';
  return 'text-red-600 dark:text-red-400';
}

export function ResponsePanel({ response, loading, scriptLogs }: ResponsePanelProps) {
  const [activeTab, setActiveTab] = useState<TabId>('body');
  const [copied, setCopied] = useState(false);
  const [prettyJson, setPrettyJson] = useState(true);

  const formattedBody = useMemo(() => {
    if (!response) return '';
    const formatted = tryFormatJson(response.body);
    if (formatted && prettyJson) return formatted;
    return response.body;
  }, [response, prettyJson]);

  const isJson = useMemo(() => {
    if (!response) return false;
    return tryFormatJson(response.body) !== null;
  }, [response]);

  const handleCopy = async () => {
    if (response?.body) {
      await copyToClipboard(response.body);
      setCopied(true);
      toast.success('已复制响应体');
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleDownload = () => {
    if (!response) return;
    const blob = new Blob([response.body], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `response-${response.status}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <span className="text-sm text-muted-foreground">请求发送中...</span>
        </div>
      </div>
    );
  }

  if (!response) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <p className="text-sm text-muted-foreground">点击「发送」查看响应结果</p>
          <p className="mt-1 text-xs text-muted-foreground/60">Ctrl+Enter 快捷发送</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Status Bar */}
      <div className="flex items-center gap-4 border-b px-4 py-2">
        <span className={cn('text-sm font-bold', statusColor(response.status))}>
          {response.status} {response.statusText}
        </span>
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <Clock className="h-3 w-3" />
          {response.time} ms
        </span>
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <HardDrive className="h-3 w-3" />
          {formatSize(response.size)}
        </span>
        <div className="ml-auto flex items-center gap-1">
          {isJson && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={() => setPrettyJson(!prettyJson)}
            >
              {prettyJson ? 'Raw' : 'Pretty'}
            </Button>
          )}
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleCopy}>
            {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
          </Button>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleDownload}>
            <Download className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-0.5 border-b px-4">
        {([
          { id: 'body' as TabId, label: 'Body' },
          { id: 'headers' as TabId, label: 'Headers', badge: Object.keys(response.headers).length },
          { id: 'logs' as TabId, label: 'Scripts', badge: scriptLogs.length || undefined },
        ]).map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              'relative px-3 py-2 text-xs font-medium transition-colors',
              activeTab === tab.id
                ? 'text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {tab.label}
            {'badge' in tab && tab.badge ? (
              <span className="ml-1 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
                {tab.badge}
              </span>
            ) : null}
            {activeTab === tab.id && (
              <span className="absolute inset-x-0 bottom-0 h-0.5 bg-primary" />
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="min-h-0 flex-1 overflow-auto p-4">
        {activeTab === 'body' && (
          <pre className="whitespace-pre-wrap break-all font-mono text-sm leading-relaxed">
            {formattedBody || '(空响应体)'}
          </pre>
        )}

        {activeTab === 'headers' && (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="pb-2 pr-4 font-medium text-muted-foreground">Header</th>
                <th className="pb-2 font-medium text-muted-foreground">Value</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(response.headers).map(([key, value]) => (
                <tr key={key} className="border-b/50">
                  <td className="py-1.5 pr-4 font-mono text-xs font-medium text-primary">{key}</td>
                  <td className="py-1.5 font-mono text-xs break-all">{value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {activeTab === 'logs' && (
          <div className="space-y-1">
            {scriptLogs.length === 0 ? (
              <p className="text-sm text-muted-foreground">无脚本执行日志</p>
            ) : (
              scriptLogs.map((log, i) => (
                <div
                  key={i}
                  className={cn(
                    'rounded px-2 py-1 font-mono text-xs',
                    log.type === 'error' && 'bg-destructive/10 text-destructive',
                    log.type === 'assert-pass' && 'bg-green-500/10 text-green-600 dark:text-green-400',
                    log.type === 'assert-fail' && 'bg-red-500/10 text-red-600 dark:text-red-400',
                    log.type === 'info' && 'text-muted-foreground'
                  )}
                >
                  {log.type === 'assert-pass' && '✓ '}
                  {log.type === 'assert-fail' && '✗ '}
                  {log.message}
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
