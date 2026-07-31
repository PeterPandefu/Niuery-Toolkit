import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Send, Loader2 } from 'lucide-react';
import { KeyValueEditor } from './KeyValueEditor';
import { BodyEditor } from './BodyEditor';
import { AuthPanel } from './AuthPanel';
import { ScriptPanel } from './ScriptPanel';
import {
  HTTP_METHODS,
  type ApiRequest,
  type HttpMethod,
} from '@/store/api-tester-store';

interface RequestPanelProps {
  request: ApiRequest;
  onChange: (partial: Partial<ApiRequest>) => void;
  onSend: () => void;
  onCancel: () => void;
  loading: boolean;
}

type TabId = 'params' | 'headers' | 'body' | 'auth' | 'scripts';

const METHOD_COLORS: Record<HttpMethod, string> = {
  GET: 'text-green-600 dark:text-green-400',
  POST: 'text-yellow-600 dark:text-yellow-400',
  PUT: 'text-blue-600 dark:text-blue-400',
  PATCH: 'text-purple-600 dark:text-purple-400',
  DELETE: 'text-red-600 dark:text-red-400',
  HEAD: 'text-cyan-600 dark:text-cyan-400',
  OPTIONS: 'text-gray-600 dark:text-gray-400',
};

export function RequestPanel({ request, onChange, onSend, onCancel, loading }: RequestPanelProps) {
  const [activeTab, setActiveTab] = useState<TabId>('params');

  const tabs: { id: TabId; label: string; badge?: number }[] = [
    { id: 'params', label: 'Params', badge: request.params.filter((p) => p.enabled && p.key).length || undefined },
    { id: 'headers', label: 'Headers', badge: request.headers.filter((h) => h.enabled && h.key).length || undefined },
    { id: 'body', label: 'Body', badge: request.body.type !== 'none' ? 1 : undefined },
    { id: 'auth', label: 'Auth', badge: request.auth.type !== 'none' ? 1 : undefined },
    { id: 'scripts', label: 'Scripts', badge: (request.preScript || request.postScript) ? 1 : undefined },
  ];

  return (
    <div className="flex h-full flex-col">
      {/* URL Bar */}
      <div className="flex items-center gap-2 border-b px-4 py-2.5">
        <select
          value={request.method}
          onChange={(e) => onChange({ method: e.target.value as HttpMethod })}
          className={cn(
            'h-9 w-24 rounded-md border bg-background px-2 text-sm font-bold outline-none focus:ring-1 focus:ring-ring',
            METHOD_COLORS[request.method]
          )}
        >
          {HTTP_METHODS.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>

        <input
          value={request.url}
          onChange={(e) => onChange({ url: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) onSend();
          }}
          placeholder="输入请求 URL，支持 {{variable}}"
          className="h-9 flex-1 rounded-md border bg-background px-3 text-sm font-mono outline-none focus:ring-1 focus:ring-ring"
          spellCheck={false}
        />

        {loading ? (
          <Button variant="destructive" size="sm" className="h-9 gap-1.5" onClick={onCancel}>
            <Loader2 className="h-4 w-4 animate-spin" />
            取消
          </Button>
        ) : (
          <Button size="sm" className="h-9 gap-1.5" onClick={onSend} disabled={!request.url.trim()}>
            <Send className="h-4 w-4" />
            发送
          </Button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-0.5 border-b px-4">
        {tabs.map((tab) => (
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
            {tab.badge && (
              <span className="ml-1 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
                {tab.badge}
              </span>
            )}
            {activeTab === tab.id && (
              <span className="absolute inset-x-0 bottom-0 h-0.5 bg-primary" />
            )}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {activeTab === 'params' && (
          <KeyValueEditor
            items={request.params}
            onChange={(params) => onChange({ params })}
            keyPlaceholder="参数名"
            valuePlaceholder="参数值"
          />
        )}
        {activeTab === 'headers' && (
          <KeyValueEditor
            items={request.headers}
            onChange={(headers) => onChange({ headers })}
            keyPlaceholder="Header 名称"
            valuePlaceholder="Header 值"
          />
        )}
        {activeTab === 'body' && (
          <BodyEditor body={request.body} onChange={(body) => onChange({ body })} />
        )}
        {activeTab === 'auth' && (
          <AuthPanel auth={request.auth} onChange={(auth) => onChange({ auth })} />
        )}
        {activeTab === 'scripts' && (
          <ScriptPanel
            preScript={request.preScript}
            postScript={request.postScript}
            onPreScriptChange={(preScript) => onChange({ preScript })}
            onPostScriptChange={(postScript) => onChange({ postScript })}
          />
        )}
      </div>
    </div>
  );
}
