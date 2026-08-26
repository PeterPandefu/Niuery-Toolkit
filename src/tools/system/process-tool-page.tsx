import { useCallback, useMemo, useRef, useState } from 'react';
import { AlertTriangle, FileLock2, FolderOpen, Network, RefreshCw, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useToolLogger } from '@/hooks/use-tool-logger';
import { isTauri } from '@/lib/api-client';
import {
  findFileLockOwners,
  findPortOwners,
  pickExistingFile,
  terminateProcesses,
  validatePortInput,
  type ProcessOwner,
  type ProcessTerminationResult,
} from './process-tools';

type ToolKind = 'port' | 'file';

const STATUS_LABEL: Record<ProcessTerminationResult['status'], string> = {
  terminated: '已结束',
  alreadyExited: '进程已退出',
  accessDenied: '访问被拒绝',
  protected: '受保护进程',
  identityChanged: '进程已变更，未执行结束',
  failed: '结束失败',
};

export function ProcessToolPage({ kind }: { kind: ToolKind }) {
  const [value, setValue] = useState('');
  const [owners, setOwners] = useState<ProcessOwner[]>([]);
  const [results, setResults] = useState<ProcessTerminationResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const lookupVersion = useRef(0);
  const log = useToolLogger(kind === 'port' ? 'port-process-killer' : 'file-unlocker');
  const isPort = kind === 'port';
  const Icon = isPort ? Network : FileLock2;
  const actionLabel = isPort ? '结束占用进程' : '解除文件占用';
  const terminableOwners = useMemo(() => owners.filter((owner) => owner.target.creationTime > 0), [owners]);
  const targetLabel = isPort ? `端口 ${value}` : value;

  const handleValueChange = useCallback((next: string) => {
    lookupVersion.current += 1;
    setValue(next);
    setOwners([]);
    setResults([]);
    setNotice(null);
    setError(null);
    setConfirming(false);
  }, []);

  const lookup = useCallback(async () => {
    const validationError = isPort ? validatePortInput(value) : value.trim() ? null : '请选择要解除占用的文件';
    if (validationError) {
      setError(validationError);
      return;
    }
    const version = lookupVersion.current + 1;
    lookupVersion.current = version;
    setLoading(true);
    setError(null);
    setNotice(null);
    setResults([]);
    try {
      const next = isPort
        ? await findPortOwners(Number(value))
        : await findFileLockOwners(value);
      if (version !== lookupVersion.current) return;
      setOwners(next);
      log.info('完成进程占用查询', { kind, count: next.length });
    } catch (cause) {
      if (version !== lookupVersion.current) return;
      const message = String(cause);
      setOwners([]);
      setError(message);
      log.warn('进程占用查询失败', cause);
    } finally {
      if (version === lookupVersion.current) setLoading(false);
    }
  }, [isPort, kind, log, value]);

  const chooseFile = useCallback(async () => {
    try {
      const path = await pickExistingFile();
      if (!path) return;
      handleValueChange(path);
    } catch (cause) {
      const message = `选择文件失败：${String(cause)}`;
      setError(message);
      log.warn('选择文件失败', cause);
    }
  }, [handleValueChange, log]);

  const confirmTermination = useCallback(async () => {
    setConfirming(false);
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const nextResults = await terminateProcesses(terminableOwners.map((owner) => owner.target));
      setResults(nextResults);
      const ended = nextResults.filter((result) => result.status === 'terminated').length;
      log.info('完成进程结束请求', { kind, count: nextResults.length, ended });

      if (isPort) {
        setNotice(`已结束 ${ended} 个进程`);
        if (ended > 0) toast.success(`已结束 ${ended} 个进程`);
        return;
      }

      const remaining = await findFileLockOwners(value);
      setOwners(remaining);
      if (remaining.length === 0) {
        setNotice('文件已解除占用');
        toast.success('文件已解除占用');
      } else {
        setNotice(`仍有 ${remaining.length} 个进程占用该文件`);
      }
    } catch (cause) {
      const message = `结束进程失败：${String(cause)}`;
      setError(message);
      log.warn('结束进程失败', cause);
    } finally {
      setLoading(false);
    }
  }, [isPort, kind, log, terminableOwners, value]);

  if (!isTauri) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center">
        <div className="space-y-2">
          <Icon className="mx-auto h-12 w-12 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">该功能仅在 Tauri 桌面端可用</p>
        </div>
      </div>
    );
  }

  return (
    <div className="app-ambient h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-4xl px-6 pb-10 pt-6 sm:px-8">
        <header className="flex items-start gap-3 border-b border-border/70 pb-5">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Icon className="h-5 w-5" /></span>
          <div>
            <h2 className="font-heading text-2xl font-semibold tracking-tight">{isPort ? '端口进程终止' : '文件占用解除'}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {isPort ? '查询指定本地端口的 TCP/UDP 占用进程。' : '查询并关闭占用指定文件的进程。'}
            </p>
          </div>
        </header>

        <section className="panel-raised mt-5 p-4">
          <label className="text-sm font-medium" htmlFor={`${kind}-input`}>{isPort ? '端口号' : '文件路径'}</label>
          <div className="mt-2 flex flex-wrap gap-2">
            <input
              id={`${kind}-input`}
              value={value}
              onChange={(event) => handleValueChange(event.target.value)}
              inputMode={isPort ? 'numeric' : undefined}
              placeholder={isPort ? '例如 5173' : '选择或粘贴要解除占用的文件路径'}
              className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring"
            />
            {!isPort && <Button type="button" variant="outline" onClick={() => void chooseFile()}><FolderOpen />选择文件</Button>}
            <Button type="button" onClick={() => void lookup()} disabled={loading}><RefreshCw className={loading ? 'animate-spin' : ''} />查找占用进程</Button>
          </div>
        </section>

        {error && <p className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
        {notice && <p className="mt-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">{notice}</p>}

        {owners.length === 0 && !loading && !error && !notice && <p className="mt-5 text-sm text-muted-foreground">{value ? '未找到占用该目标的本地进程。' : '输入目标后可查询占用进程。'}</p>}

        {owners.length > 0 && (
          <section className="panel-raised mt-5 overflow-hidden" aria-label="占用进程列表">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
              <div><h3 className="text-sm font-semibold">发现 {owners.length} 个关联进程</h3><p className="mt-1 text-xs text-muted-foreground">结束进程可能丢失未保存的数据。</p></div>
              <Button variant="destructive" onClick={() => setConfirming(true)} disabled={loading || terminableOwners.length === 0}><AlertTriangle />{actionLabel}</Button>
            </div>
            <ul className="divide-y divide-border/70">
              {owners.map((owner) => (
                <li key={`${owner.target.pid}-${owner.target.creationTime}`} className="p-4">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1"><strong className="text-sm">{owner.name}</strong><span className="font-mono text-xs text-muted-foreground">PID {owner.target.pid}</span></div>
                  {owner.executablePath && <p className="mt-1 break-all font-mono text-xs text-muted-foreground">{owner.executablePath}</p>}
                  {owner.endpoints.map((endpoint, index) => <p key={`${endpoint.protocol}-${index}`} className="mt-1 font-mono text-xs text-muted-foreground">{endpoint.protocol.toUpperCase()} · {endpoint.localAddress}{endpoint.state ? ` · ${endpoint.state}` : ''}</p>)}
                  {owner.target.creationTime === 0 && <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">无法安全验证该进程，不能执行结束操作。</p>}
                </li>
              ))}
            </ul>
          </section>
        )}

        {results.length > 0 && <section className="panel-raised mt-5 p-4" aria-label="结束结果"><h3 className="text-sm font-semibold">执行结果</h3><ul className="mt-3 space-y-2 text-sm">{results.map((result) => <li key={result.pid}><span className="font-mono">PID {result.pid}</span> · {STATUS_LABEL[result.status]}{result.message ? `：${result.message}` : ''}</li>)}</ul></section>}

        {confirming && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="确认结束进程">
            <button className="absolute inset-0 bg-black/60" aria-label="取消结束进程" onClick={() => setConfirming(false)} />
            <section className="relative w-full max-w-lg rounded-xl border border-border bg-popover p-5 shadow-xl">
              <div className="flex items-start justify-between gap-3"><div><h3 className="text-base font-semibold">确认结束进程</h3><p className="mt-1 text-sm text-muted-foreground">以下进程将被强制关闭，未保存的数据可能丢失。</p><p className="mt-2 break-all text-sm font-medium">查询目标：{targetLabel}</p></div><Button variant="ghost" size="icon" aria-label="关闭确认" onClick={() => setConfirming(false)}><X /></Button></div>
              <ul className="mt-4 max-h-48 space-y-2 overflow-y-auto text-sm">{terminableOwners.map((owner) => <li key={owner.target.pid}>{owner.name} · PID {owner.target.pid}</li>)}</ul>
              <div className="mt-5 flex justify-end gap-2"><Button variant="outline" onClick={() => setConfirming(false)}>取消</Button><Button variant="destructive" onClick={() => void confirmTermination()}><AlertTriangle />确认结束</Button></div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
