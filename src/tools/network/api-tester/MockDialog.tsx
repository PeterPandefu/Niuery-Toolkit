import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Plus, Trash2, X, Power } from 'lucide-react';
import { KeyValueEditor } from './KeyValueEditor';
import {
  useApiTesterStore,
  HTTP_METHODS,
  type HttpMethod,
} from '@/store/api-tester-store';

interface MockDialogProps {
  open: boolean;
  onClose: () => void;
}

export function MockDialog({ open, onClose }: MockDialogProps) {
  const {
    mockRules,
    mockEnabled,
    setMockEnabled,
    addMockRule,
    removeMockRule,
    updateMockRule,
  } = useApiTesterStore();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedRule = mockRules.find((r) => r.id === selectedId);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="flex h-[550px] w-[750px] flex-col rounded-lg border bg-background shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-3">
            <h3 className="text-sm font-semibold">Mock 服务</h3>
            <button
              onClick={() => setMockEnabled(!mockEnabled)}
              className={cn(
                'flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors',
                mockEnabled
                  ? 'bg-green-500/10 text-green-600 dark:text-green-400'
                  : 'bg-muted text-muted-foreground'
              )}
            >
              <Power className="h-3 w-3" />
              {mockEnabled ? '已启用' : '已禁用'}
            </button>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={() => addMockRule()}>
              <Plus className="h-3.5 w-3.5" />
              新建规则
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1">
          {/* Left: Rule List */}
          <div className="w-56 shrink-0 overflow-y-auto border-r p-2">
            {mockRules.length === 0 && (
              <p className="py-4 text-center text-xs text-muted-foreground">暂无 Mock 规则</p>
            )}
            {mockRules.map((rule) => (
              <div
                key={rule.id}
                className={cn(
                  'group mb-1 flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors',
                  selectedId === rule.id ? 'bg-primary/10 text-primary' : 'hover:bg-muted'
                )}
                onClick={() => setSelectedId(rule.id)}
              >
                <span
                  className={cn(
                    'h-1.5 w-1.5 shrink-0 rounded-full',
                    rule.enabled ? 'bg-green-500' : 'bg-gray-300'
                  )}
                />
                <span className="flex-1 truncate">{rule.name}</span>
                <button
                  className="hidden p-0.5 group-hover:block"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeMockRule(rule.id);
                    if (selectedId === rule.id) setSelectedId(null);
                  }}
                >
                  <Trash2 className="h-3 w-3 text-muted-foreground hover:text-destructive" />
                </button>
              </div>
            ))}
          </div>

          {/* Right: Rule Editor */}
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {selectedRule ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">规则名称</label>
                    <input
                      value={selectedRule.name}
                      onChange={(e) => updateMockRule(selectedRule.id, { name: e.target.value })}
                      className="h-8 w-full rounded-md border bg-background px-2.5 text-sm outline-none focus:ring-1 focus:ring-ring"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">HTTP 方法</label>
                    <select
                      value={selectedRule.method}
                      onChange={(e) => updateMockRule(selectedRule.id, { method: e.target.value as HttpMethod | '*' })}
                      className="h-8 w-full rounded-md border bg-background px-2 text-sm outline-none focus:ring-1 focus:ring-ring"
                    >
                      <option value="*">ALL</option>
                      {HTTP_METHODS.map((m) => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">
                    URL 模式 (支持 * 通配符和 :param)
                  </label>
                  <input
                    value={selectedRule.urlPattern}
                    onChange={(e) => updateMockRule(selectedRule.id, { urlPattern: e.target.value })}
                    placeholder="/api/users/:id"
                    className="h-8 w-full rounded-md border bg-background px-2.5 text-sm font-mono outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">状态码</label>
                    <input
                      type="number"
                      value={selectedRule.statusCode}
                      onChange={(e) => updateMockRule(selectedRule.id, { statusCode: parseInt(e.target.value) || 200 })}
                      className="h-8 w-full rounded-md border bg-background px-2.5 text-sm outline-none focus:ring-1 focus:ring-ring"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">延迟 (ms)</label>
                    <input
                      type="number"
                      value={selectedRule.delay}
                      onChange={(e) => updateMockRule(selectedRule.id, { delay: parseInt(e.target.value) || 0 })}
                      className="h-8 w-full rounded-md border bg-background px-2.5 text-sm outline-none focus:ring-1 focus:ring-ring"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">响应体</label>
                  <Textarea
                    value={selectedRule.body}
                    onChange={(e) => updateMockRule(selectedRule.id, { body: e.target.value })}
                    className="min-h-[120px] resize-y font-mono text-xs"
                    spellCheck={false}
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">响应头</label>
                  <KeyValueEditor
                    items={selectedRule.headers}
                    onChange={(headers) => updateMockRule(selectedRule.id, { headers })}
                  />
                </div>

                <div className="flex items-center gap-2">
                  <label className="text-xs font-medium text-muted-foreground">启用规则</label>
                  <input
                    type="checkbox"
                    checked={selectedRule.enabled}
                    onChange={(e) => updateMockRule(selectedRule.id, { enabled: e.target.checked })}
                    className="h-4 w-4 accent-primary"
                  />
                </div>
              </div>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                选择或创建一个 Mock 规则
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
