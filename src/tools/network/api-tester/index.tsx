import { useState, useCallback, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import {
  Layers,
  Terminal,
  FileText,
  ClipboardPaste,
  Copy,
  Plus,
} from 'lucide-react';
import { toast } from 'sonner';
import { copyToClipboard } from '@/lib/utils';
import { isTauri } from '@/lib/api-client';
import {
  useApiTesterStore,
  type ApiRequest,
  type ScriptLog,
  type HistoryEntry,
} from '@/store/api-tester-store';
import { sendRequest, buildUrl, kvToRecord } from '@/lib/api-client';
import { executeScript } from '@/lib/script-sandbox';
import { findMockRule, generateMockResponse } from '@/lib/mock-engine';
import { parseCurl, toCurl } from '@/lib/curl-parser';
import { RequestPanel } from './RequestPanel';
import { ResponsePanel } from './ResponsePanel';
import { CollectionSidebar } from './CollectionSidebar';
import { EnvironmentDialog } from './EnvironmentDialog';
import { BatchTestDialog } from './BatchTestDialog';
import { MockDialog } from './MockDialog';
import { DocPreviewDialog } from './DocPreviewDialog';

export default function ApiTester() {
  const {
    currentRequest,
    setCurrentRequest,
    response,
    responseLoading,
    scriptLogs,
    setResponse,
    setResponseLoading,
    setScriptLogs,
    addHistory,
    resolveVariables,
    setVariable,
    mockEnabled,
    mockRules,
    environments,
    activeEnvId,
  } = useApiTesterStore();

  const [showSidebar, setShowSidebar] = useState(true);
  const [envDialogOpen, setEnvDialogOpen] = useState(false);
  const [batchDialogOpen, setBatchDialogOpen] = useState(false);
  const [mockDialogOpen, setMockDialogOpen] = useState(false);
  const [docDialogOpen, setDocDialogOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // 发送请求
  const handleSend = useCallback(async () => {
    const req = currentRequest;
    if (!req.url.trim()) return;

    setResponseLoading(true);
    setResponse(null);
    setScriptLogs([]);

    const allLogs: ScriptLog[] = [];
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      // 解析变量
      let url = resolveVariables(buildUrl(req.url, req.params));
      let headers = kvToRecord(
        req.headers.map((h) => ({
          ...h,
          key: resolveVariables(h.key),
          value: resolveVariables(h.value),
        }))
      );
      let body: string | undefined;

      // Auth
      if (req.auth.type === 'bearer' && req.auth.bearerToken) {
        headers['Authorization'] = `Bearer ${resolveVariables(req.auth.bearerToken)}`;
      } else if (req.auth.type === 'basic') {
        headers['Authorization'] = `Basic ${btoa(`${resolveVariables(req.auth.basicUsername)}:${resolveVariables(req.auth.basicPassword)}`)}`;
      } else if (req.auth.type === 'apikey' && req.auth.apiKeyName) {
        if (req.auth.apiKeyIn === 'header') {
          headers[req.auth.apiKeyName] = resolveVariables(req.auth.apiKeyValue);
        } else {
          const sep = url.includes('?') ? '&' : '?';
          url += `${sep}${encodeURIComponent(req.auth.apiKeyName)}=${encodeURIComponent(resolveVariables(req.auth.apiKeyValue))}`;
        }
      }

      // Body
      if (req.body.type !== 'none' && req.method !== 'GET' && req.method !== 'HEAD') {
        if (req.body.type === 'form-data') {
          const enabledFields = req.body.formData.filter((f) => f.enabled && f.key.trim());
          body = enabledFields.map((f) => `${encodeURIComponent(f.key)}=${encodeURIComponent(resolveVariables(f.value))}`).join('&');
          headers['Content-Type'] = 'application/x-www-form-urlencoded';
        } else {
          body = resolveVariables(req.body.content);
          if (req.body.type === 'json') headers['Content-Type'] = 'application/json';
          else if (req.body.type === 'xml') headers['Content-Type'] = 'application/xml';
          else if (req.body.type === 'x-www-form-urlencoded') headers['Content-Type'] = 'application/x-www-form-urlencoded';
        }
      }

      // 前置脚本
      if (req.preScript.trim()) {
        const preResult = await executeScript(req.preScript, {
          request: { url, method: req.method, headers, body: body || '' },
        });
        allLogs.push(...preResult.logs);
        if (preResult.request) {
          url = preResult.request.url;
          headers = preResult.request.headers;
          body = preResult.request.body || undefined;
        }
        for (const [key, value] of Object.entries(preResult.variables)) {
          setVariable(key, value);
        }
      }

      let res;

      // Mock 拦截
      if (mockEnabled) {
        const mockRule = findMockRule(mockRules, req.method, url);
        if (mockRule) {
          allLogs.push({ type: 'info', message: `[Mock] 匹配规则: ${mockRule.name}` });
          res = await generateMockResponse(mockRule);
        }
      }

      // 真实请求
      if (!res) {
        res = await sendRequest({ method: req.method, url, headers, body }, controller.signal);
      }

      // 后置脚本
      if (req.postScript.trim()) {
        const postResult = await executeScript(req.postScript, {
          response: {
            status: res.status,
            statusText: res.statusText,
            headers: res.headers,
            body: res.body,
            time: res.time,
          },
        });
        allLogs.push(...postResult.logs);
        for (const [key, value] of Object.entries(postResult.variables)) {
          setVariable(key, value);
        }
      }

      setResponse(res);
      setScriptLogs(allLogs);

      // 记录历史
      const historyEntry: HistoryEntry = {
        id: crypto.randomUUID().slice(0, 10),
        request: { ...req },
        response: res,
        timestamp: Date.now(),
      };
      addHistory(historyEntry);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        allLogs.push({ type: 'info', message: '请求已取消' });
      } else {
        allLogs.push({
          type: 'error',
          message: err instanceof Error ? err.message : '请求失败',
        });
        toast.error(err instanceof Error ? err.message : '请求失败');
      }
      setScriptLogs(allLogs);
    } finally {
      setResponseLoading(false);
      abortRef.current = null;
    }
  }, [currentRequest, resolveVariables, setVariable, mockEnabled, mockRules, setResponse, setResponseLoading, setScriptLogs, addHistory]);

  // 取消请求
  const handleCancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  // 加载请求
  const handleLoadRequest = useCallback(
    (req: ApiRequest) => {
      setCurrentRequest(req);
      setResponse(null);
      setScriptLogs([]);
    },
    [setCurrentRequest, setResponse, setScriptLogs]
  );

  // 导入 cURL
  const handleImportCurl = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text.trim().startsWith('curl')) {
        const parsed = parseCurl(text);
        setCurrentRequest(parsed);
        toast.success('已从剪贴板导入 cURL');
      } else {
        toast.error('剪贴板内容不是有效的 cURL 命令');
      }
    } catch {
      toast.error('无法读取剪贴板');
    }
  }, [setCurrentRequest]);

  // 导出 cURL
  const handleExportCurl = useCallback(async () => {
    const curl = toCurl(currentRequest);
    await copyToClipboard(curl);
    toast.success('cURL 命令已复制');
  }, [currentRequest]);

  // Ctrl+Enter 快捷键
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        handleSend();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleSend]);

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex items-center gap-1 border-b px-3 py-1.5">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 text-xs"
          onClick={() => setShowSidebar(!showSidebar)}
        >
          <Layers className="h-3.5 w-3.5" />
          {showSidebar ? '隐藏面板' : '集合'}
        </Button>

        <div className="mx-1 h-4 w-px bg-border" />

        {/* Environment Selector */}
        <select
          value={activeEnvId || ''}
          onChange={(e) => useApiTesterStore.getState().setActiveEnv(e.target.value || null)}
          className="h-7 rounded-md border bg-background px-2 text-xs outline-none"
        >
          <option value="">无环境</option>
          {environments.map((env) => (
            <option key={env.id} value={env.id}>{env.name}</option>
          ))}
        </select>

        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setEnvDialogOpen(true)}>
          管理环境
        </Button>

        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={handleImportCurl}>
            <ClipboardPaste className="h-3.5 w-3.5" />
            导入 cURL
          </Button>
          <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={handleExportCurl}>
            <Copy className="h-3.5 w-3.5" />
            复制 cURL
          </Button>

          <div className="mx-1 h-4 w-px bg-border" />

          <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={() => setBatchDialogOpen(true)}>
            <Terminal className="h-3.5 w-3.5" />
            批量测试
          </Button>
          <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={() => setMockDialogOpen(true)}>
            <Plus className="h-3.5 w-3.5" />
            Mock
          </Button>
          <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={() => setDocDialogOpen(true)}>
            <FileText className="h-3.5 w-3.5" />
            文档
          </Button>
        </div>
      </div>

      {/* Non-Tauri Warning */}
      {!isTauri && (
        <div className="border-b bg-yellow-500/10 px-4 py-1.5 text-xs text-yellow-700 dark:text-yellow-400">
          浏览器模式下受 CORS 限制，部分 API 可能无法访问。使用 Tauri 桌面版可绕过此限制。
        </div>
      )}

      {/* Main Content */}
      <div className="flex min-h-0 flex-1">
        {/* Sidebar */}
        {showSidebar && (
          <div className="w-60 shrink-0">
            <CollectionSidebar onLoadRequest={handleLoadRequest} />
          </div>
        )}

        {/* Request + Response */}
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 border-b">
            <RequestPanel
              request={currentRequest}
              onChange={setCurrentRequest}
              onSend={handleSend}
              onCancel={handleCancel}
              loading={responseLoading}
            />
          </div>
          <div className="min-h-0 flex-1">
            <ResponsePanel
              response={response}
              loading={responseLoading}
              scriptLogs={scriptLogs}
            />
          </div>
        </div>
      </div>

      {/* Dialogs */}
      <EnvironmentDialog open={envDialogOpen} onClose={() => setEnvDialogOpen(false)} />
      <BatchTestDialog open={batchDialogOpen} onClose={() => setBatchDialogOpen(false)} />
      <MockDialog open={mockDialogOpen} onClose={() => setMockDialogOpen(false)} />
      <DocPreviewDialog open={docDialogOpen} onClose={() => setDocDialogOpen(false)} />
    </div>
  );
}
