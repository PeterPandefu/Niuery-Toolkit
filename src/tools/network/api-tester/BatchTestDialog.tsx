import { useState, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { X, Play, CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import {
  useApiTesterStore,
  type ApiRequest,
  type ApiResponse,
  type ScriptLog,
} from '@/store/api-tester-store';
import { sendRequest, buildUrl, kvToRecord } from '@/lib/api-client';
import { executeScript } from '@/lib/script-sandbox';
import { flattenRequests } from '@/lib/doc-generator';

interface BatchTestDialogProps {
  open: boolean;
  onClose: () => void;
}

interface TestResult {
  request: ApiRequest;
  response: ApiResponse | null;
  logs: ScriptLog[];
  passed: boolean;
  error?: string;
}

export function BatchTestDialog({ open, onClose }: BatchTestDialogProps) {
  const { collections, resolveVariables, setVariable } = useApiTesterStore();
  const [results, setResults] = useState<TestResult[]>([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);

  const allRequests = collections.flatMap((c) => flattenRequests(c.items));

  const runTests = useCallback(async () => {
    if (allRequests.length === 0) return;
    setRunning(true);
    setResults([]);
    setProgress(0);

    const testResults: TestResult[] = [];

    for (let i = 0; i < allRequests.length; i++) {
      const req = allRequests[i];
      setProgress(i + 1);

      try {
        // 解析变量
        const url = resolveVariables(buildUrl(req.url, req.params));
        const headers = kvToRecord(
          req.headers.map((h) => ({ ...h, key: resolveVariables(h.key), value: resolveVariables(h.value) }))
        );

        // Auth
        if (req.auth.type === 'bearer' && req.auth.bearerToken) {
          headers['Authorization'] = `Bearer ${resolveVariables(req.auth.bearerToken)}`;
        } else if (req.auth.type === 'basic') {
          headers['Authorization'] = `Basic ${btoa(`${resolveVariables(req.auth.basicUsername)}:${resolveVariables(req.auth.basicPassword)}`)}`;
        } else if (req.auth.type === 'apikey' && req.auth.apiKeyIn === 'header') {
          headers[req.auth.apiKeyName] = resolveVariables(req.auth.apiKeyValue);
        }

        // Body
        let body: string | undefined;
        if (req.body.type !== 'none' && req.method !== 'GET' && req.method !== 'HEAD') {
          body = resolveVariables(req.body.content);
        }

        const response = await sendRequest({ method: req.method, url, headers, body });

        // 执行后置脚本
        let logs: ScriptLog[] = [];
        let passed = response.status < 400;

        if (req.postScript.trim()) {
          const scriptResult = await executeScript(req.postScript, {
            response: {
              status: response.status,
              statusText: response.statusText,
              headers: response.headers,
              body: response.body,
              time: response.time,
            },
          });
          logs = scriptResult.logs;
          // 如果有断言失败，标记为不通过
          if (scriptResult.logs.some((l) => l.type === 'assert-fail')) {
            passed = false;
          }
          // 设置变量
          for (const [key, value] of Object.entries(scriptResult.variables)) {
            setVariable(key, value);
          }
        }

        testResults.push({ request: req, response, logs, passed });
      } catch (err) {
        testResults.push({
          request: req,
          response: null,
          logs: [],
          passed: false,
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      }

      setResults([...testResults]);
    }

    setRunning(false);
  }, [allRequests, resolveVariables, setVariable]);

  if (!open) return null;

  const passedCount = results.filter((r) => r.passed).length;
  const failedCount = results.filter((r) => !r.passed).length;
  const totalTime = results.reduce((sum, r) => sum + (r.response?.time || 0), 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="flex h-[550px] w-[750px] flex-col rounded-lg border bg-background shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h3 className="text-sm font-semibold">批量测试</h3>
          <div className="flex items-center gap-2">
            <Button size="sm" className="h-7 gap-1 text-xs" onClick={runTests} disabled={running || allRequests.length === 0}>
              {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
              {running ? `运行中 ${progress}/${allRequests.length}` : '运行全部'}
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Summary */}
        {results.length > 0 && (
          <div className="flex items-center gap-4 border-b px-4 py-2 text-xs">
            <span>总计: {results.length}</span>
            <span className="text-green-600 dark:text-green-400">通过: {passedCount}</span>
            <span className="text-red-600 dark:text-red-400">失败: {failedCount}</span>
            <span className="text-muted-foreground">耗时: {totalTime}ms</span>
          </div>
        )}

        {/* Results */}
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {allRequests.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              集合中没有请求，请先添加请求到集合
            </p>
          ) : results.length === 0 && !running ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              点击「运行全部」开始批量测试 ({allRequests.length} 个请求)
            </p>
          ) : (
            <div className="space-y-2">
              {results.map((result, i) => (
                <div
                  key={i}
                  className={cn(
                    'rounded-lg border p-3',
                    result.passed ? 'border-green-500/30 bg-green-500/5' : 'border-red-500/30 bg-red-500/5'
                  )}
                >
                  <div className="flex items-center gap-2">
                    {result.passed ? (
                      <CheckCircle2 className="h-4 w-4 text-green-500" />
                    ) : (
                      <XCircle className="h-4 w-4 text-red-500" />
                    )}
                    <span className="text-xs font-bold text-muted-foreground">{result.request.method}</span>
                    <span className="flex-1 truncate text-xs font-medium">{result.request.name}</span>
                    {result.response && (
                      <span className="text-xs text-muted-foreground">{result.response.time}ms</span>
                    )}
                  </div>
                  {result.error && (
                    <p className="mt-1 text-xs text-destructive">{result.error}</p>
                  )}
                  {result.logs.filter((l) => l.type === 'assert-fail').length > 0 && (
                    <div className="mt-1 space-y-0.5">
                      {result.logs.filter((l) => l.type === 'assert-fail').map((l, j) => (
                        <p key={j} className="text-xs text-destructive">✗ {l.message}</p>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
