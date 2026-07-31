import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Plus, Trash2, X } from 'lucide-react';
import { KeyValueEditor } from './KeyValueEditor';
import {
  useApiTesterStore,
} from '@/store/api-tester-store';

interface EnvironmentDialogProps {
  open: boolean;
  onClose: () => void;
}

export function EnvironmentDialog({ open, onClose }: EnvironmentDialogProps) {
  const {
    environments,
    activeEnvId,
    globalVariables,
    addEnvironment,
    removeEnvironment,
    updateEnvironment,
    setActiveEnv,
    setGlobalVariables,
  } = useApiTesterStore();

  const [selectedId, setSelectedId] = useState<string | 'global'>(activeEnvId || 'global');

  if (!open) return null;

  const selectedEnv = environments.find((e) => e.id === selectedId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="flex h-[500px] w-[700px] flex-col rounded-lg border bg-background shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h3 className="text-sm font-semibold">环境管理</h3>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex min-h-0 flex-1">
          {/* Left: Environment List */}
          <div className="w-48 shrink-0 border-r p-2">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">环境列表</span>
              <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => addEnvironment()}>
                <Plus className="h-3 w-3" />
              </Button>
            </div>

            {/* Global Variables */}
            <button
              onClick={() => setSelectedId('global')}
              className={cn(
                'mb-1 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors',
                selectedId === 'global' ? 'bg-primary/10 font-medium text-primary' : 'hover:bg-muted'
              )}
            >
              全局变量
            </button>

            {environments.map((env) => (
              <div key={env.id} className="group mb-1 flex items-center">
                <button
                  onClick={() => setSelectedId(env.id)}
                  className={cn(
                    'flex flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors',
                    selectedId === env.id ? 'bg-primary/10 font-medium text-primary' : 'hover:bg-muted'
                  )}
                >
                  {env.name}
                  {activeEnvId === env.id && (
                    <span className="ml-auto h-1.5 w-1.5 rounded-full bg-green-500" />
                  )}
                </button>
                <button
                  className="hidden p-0.5 group-hover:block"
                  onClick={() => removeEnvironment(env.id)}
                >
                  <Trash2 className="h-3 w-3 text-muted-foreground hover:text-destructive" />
                </button>
              </div>
            ))}
          </div>

          {/* Right: Variables Editor */}
          <div className="flex min-h-0 flex-1 flex-col p-4">
            {selectedId === 'global' ? (
              <>
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-sm font-medium">全局变量</span>
                  <span className="text-xs text-muted-foreground">所有环境共享</span>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto">
                  <KeyValueEditor
                    items={globalVariables}
                    onChange={setGlobalVariables}
                    keyPlaceholder="变量名"
                    valuePlaceholder="变量值"
                  />
                </div>
              </>
            ) : selectedEnv ? (
              <>
                <div className="mb-3 flex items-center gap-2">
                  <input
                    value={selectedEnv.name}
                    onChange={(e) => updateEnvironment(selectedEnv.id, { name: e.target.value })}
                    className="h-7 rounded border bg-background px-2 text-sm font-medium outline-none focus:ring-1 focus:ring-ring"
                  />
                  <Button
                    variant={activeEnvId === selectedEnv.id ? 'secondary' : 'default'}
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => setActiveEnv(activeEnvId === selectedEnv.id ? null : selectedEnv.id)}
                  >
                    {activeEnvId === selectedEnv.id ? '取消激活' : '设为当前环境'}
                  </Button>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto">
                  <KeyValueEditor
                    items={selectedEnv.variables}
                    onChange={(variables) => updateEnvironment(selectedEnv.id, { variables })}
                    keyPlaceholder="变量名"
                    valuePlaceholder="变量值"
                  />
                </div>
              </>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                选择或创建一个环境
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
