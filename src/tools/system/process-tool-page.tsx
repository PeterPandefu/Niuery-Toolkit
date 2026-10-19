import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, FileLock2, FolderOpen, Network, RefreshCw, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useToolLogger } from '@/hooks/use-tool-logger';
import { isTauri } from '@/lib/api-client';
import {
  findFileLockOwners,
  findFolderLockOwners,
  findPortOwners,
  pickExistingFile,
  pickExistingFolder,
  terminateProcesses,
  validatePortInput,
  type ProcessOwner,
  type ProcessTerminationResult,
} from './process-tools';

export type ToolKind = 'port' | 'file' | 'folder';

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
  const [queried, setQueried] = useState(false);
  const [terminating, setTerminating] = useState(false);
  const lookupVersion = useRef(0);
  const dialogRef = useRef<HTMLElement>(null);
  const log = useToolLogger('resource-unlocker');
  const isPort = kind === 'port';
  const targetType = isPort ? '端口' : kind === 'folder' ? '文件夹' : '文件';
  const Icon = isPort ? Network : kind === 'folder' ? FolderOpen : FileLock2;
  const actionLabel = isPort ? '结束占用进程' : `解除${targetType}占用`;
  const queryOwners = useCallback((target: string) => isPort ? findPortOwners(Number(target))
    : kind === 'folder' ? findFolderLockOwners(target) : findFileLockOwners(target), [isPort, kind]);
  const terminableOwners = useMemo(() => owners.filter((owner) => /^[1-9]\d*$/.test(owner.target.creationTime)), [owners]);
  const targetLabel = isPort ? `端口 ${value}` : value;

  useEffect(() => () => { lookupVersion.current += 1; }, []);

  useEffect(() => {
    if (!confirming) return;
    const previous = document.activeElement;
    const dialog = dialogRef.current;
    const buttons = dialog?.querySelectorAll<HTMLButtonElement>('button');
    buttons?.[0]?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setConfirming(false);
      if (event.key !== 'Tab' || !buttons?.length) return;
      const first = buttons[0];
      const last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, [confirming]);

  const handleValueChange = useCallback((next: string) => {
    lookupVersion.current += 1;
    setValue(next);
    setOwners([]);
    setResults([]);
    setNotice(null);
    setError(null);
    setConfirming(false);
    setLoading(false);
    setQueried(false);
  }, []);

  const lookup = useCallback(async () => {
    const validationError = isPort ? validatePortInput(value) : value.trim() ? null : `请选择要解除占用的${targetType}`;
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
      const next = await queryOwners(value);
      if (version !== lookupVersion.current) return;
      setOwners(next);
      setQueried(true);
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
  }, [isPort, kind, log, queryOwners, targetType, value]);

  const chooseFile = useCallback(async () => {
    const version = lookupVersion.current;
    try {
      const path = await (kind === 'folder' ? pickExistingFolder() : pickExistingFile());
      if (!path || version !== lookupVersion.current) return;
      handleValueChange(path);
    } catch (cause) {
      if (version !== lookupVersion.current) return;
      const message = `选择${targetType}失败：${String(cause)}`;
      setError(message);
      log.warn(`选择${targetType}失败`, cause);
    }
  }, [handleValueChange, kind, log, targetType]);

  const confirmTermination = useCallback(async () => {
    const version = ++lookupVersion.current;
    setConfirming(false);
    setLoading(true);
    setTerminating(true);
    setError(null);
    setNotice(null);
    try {
      const nextResults = await terminateProcesses(terminableOwners.map((owner) => owner.target));
      if (version !== lookupVersion.current) return;
      setResults(nextResults);
      const ended = nextResults.filter((result) => result.status === 'terminated').length;
      log.info('完成进程结束请求', { kind, count: nextResults.length, ended });

      const remaining = await queryOwners(value);
      if (version !== lookupVersion.current) return;
      setOwners(remaining);
      if (remaining.length === 0) {
        setNotice(`${targetType}已解除占用`);
        toast.success(`${targetType}已解除占用`);
      } else {
        setNotice(`仍有 ${remaining.length} 个进程占用该${targetType}`);
      }
    } catch (cause) {
      if (version !== lookupVersion.current) return;
      const message = `操作或占用复查失败：${String(cause)}`;
      setError(message);
      log.warn('结束进程失败', cause);
    } finally {
      if (version === lookupVersion.current) { setLoading(false); setTerminating(false); }
    }
  }, [kind, log, queryOwners, targetType, terminableOwners, value]);

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
            <h2 className="font-heading text-2xl font-semibold tracking-tight">占用解除</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {isPort ? '查询指定本地端口的 TCP/UDP 占用进程。' : kind === 'folder' ? '查询并关闭占用文件夹及其子文件、子目录的进程。目录链接与重解析点不参与扫描。' : '查询并关闭占用指定文件的进程。'}
            </p>
          </div>
        </header>

        <section className="panel-raised mt-5 p-4">
          <label className="text-sm font-medium" htmlFor={`${kind}-input`}>{isPort ? '端口号' : `${targetType}路径`}</label>
          <div className="mt-2 flex flex-wrap gap-2">
            <input
              id={`${kind}-input`}
              value={value}
              disabled={terminating}
              onChange={(event) => handleValueChange(event.target.value)}
              inputMode={isPort ? 'numeric' : undefined}
              placeholder={isPort ? '例如 5173' : `选择或粘贴要解除占用的${targetType}路径`}
              className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring"
            />
            {!isPort && <Button type="button" variant="outline" disabled={loading} onClick={() => void chooseFile()}><FolderOpen />选择{targetType}</Button>}
            <Button type="button" onClick={() => void lookup()} disabled={loading}><RefreshCw className={loading ? 'animate-spin' : ''} />查找占用进程</Button>
          </div>
        </section>

        {error && <p role="alert" className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
        {notice && <p role="status" className="mt-4 rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm">{notice}</p>}

        {owners.length === 0 && !loading && !error && !notice && <p className="mt-5 text-sm text-muted-foreground">{queried ? '未找到占用该目标的本地进程。' : '输入目标后可查询占用进程。'}</p>}

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
                  {!/^[1-9]\d*$/.test(owner.target.creationTime) && <p className="mt-2 text-xs text-warning">无法安全验证该进程，不能执行结束操作。</p>}
                </li>
              ))}
            </ul>
          </section>
        )}

        {results.length > 0 && <section className="panel-raised mt-5 p-4" aria-label="结束结果"><h3 className="text-sm font-semibold">执行结果</h3><ul className="mt-3 space-y-2 text-sm">{results.map((result) => <li key={result.pid}><span className="font-mono">PID {result.pid}</span> · {STATUS_LABEL[result.status]}{result.message ? `：${result.message}` : ''}</li>)}</ul></section>}

        {confirming && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="确认结束进程">
            <button className="absolute inset-0 bg-black/60" aria-label="取消结束进程" onClick={() => setConfirming(false)} />
            <section ref={dialogRef} className="relative w-full max-w-lg rounded-xl border border-border bg-popover p-5 shadow-xl">
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
