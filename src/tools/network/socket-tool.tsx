import { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useWebSocketClient, WsStatus } from '@/hooks/use-websocket-client';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useToolLogger } from '@/hooks/use-tool-logger';
import { createLogger } from '@/lib/logger';
import { ensureNetworkAccessAllowed } from '@/lib/api-client';
import {
  ArrowUpRight,
  ArrowDownLeft,
  Trash2,
  Send,
  Plug,
  PlugZap,
  Monitor,
  Radio,
  Circle,
  Binary,
  Server,
  Wifi,
  RefreshCw,
} from 'lucide-react';

// Detect Tauri environment (Tauri v2 uses __TAURI_INTERNALS__)
function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

// 子面板日志（顶层入口 SocketTool 使用 useToolLogger）
const clientLog = createLogger('socket-tool:client');
const serverLog = createLogger('socket-tool:server');

// ==================== Status Badge ====================
function StatusBadge({ status, t }: { status: WsStatus; t: (key: string) => string }) {
  const config: Record<WsStatus, { color: string; label: string }> = {
    idle: { color: 'bg-gray-400', label: t('socketTool.idle') },
    connecting: { color: 'bg-warning animate-pulse', label: t('socketTool.connecting') },
    connected: { color: 'bg-success', label: t('socketTool.connected') },
    disconnected: { color: 'bg-warning', label: t('socketTool.disconnected') },
    error: { color: 'bg-destructive', label: t('socketTool.error') },
  };
  const { color, label } = config[status];
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium bg-muted">
      <Circle className={cn('h-2 w-2 fill-current', color)} />
      {label}
    </span>
  );
}

// ==================== Client Panel ====================
function ClientPanel() {
  const { t } = useTranslation();
  const { status, messages, connectionTime, errorMessage, connect, disconnect, send, clearMessages } =
    useWebSocketClient();
  const [url, setUrl] = useState('ws://localhost:8080');
  const [inputMsg, setInputMsg] = useState('');
  const logEndRef = useRef<HTMLDivElement>(null);
  const receivedCountRef = useRef(0);

  // Auto-scroll to bottom
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // 记录收到的消息（只记长度，不记全量内容）
  useEffect(() => {
    const received = messages.filter((m) => m.direction === 'received');
    if (received.length > receivedCountRef.current) {
      const latest = received[received.length - 1];
      clientLog.info('收到消息', { length: latest.content.length });
    }
    receivedCountRef.current = received.length;
  }, [messages]);

  // 连接错误
  useEffect(() => {
    if (status === 'error' && errorMessage) {
      clientLog.error('连接错误', { url, errorMessage });
    }
  }, [status, errorMessage, url]);

  const handleConnect = useCallback(() => {
    if (status === 'connected' || status === 'connecting') {
      clientLog.info('断开连接', { url });
      disconnect();
    } else {
      clientLog.info('发起连接', { url });
      connect(url);
    }
  }, [status, url, connect, disconnect]);

  const handleSend = useCallback(() => {
    const trimmed = inputMsg.trim();
    if (!trimmed) return;
    if (send(trimmed)) {
      clientLog.info('发送消息', { length: trimmed.length });
      setInputMsg('');
    } else {
      clientLog.warn('发送消息失败', { length: trimmed.length });
    }
  }, [inputMsg, send]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  const isConnected = status === 'connected';

  return (
    <div className="flex h-full flex-col gap-3">
      {/* Connection Bar */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Plug className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={t('socketTool.urlPlaceholder')}
            className="h-9 w-full rounded-md border bg-background pl-9 pr-3 text-sm font-mono outline-none focus:ring-2 focus:ring-ring"
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleConnect();
            }}
          />
        </div>
        <Button
          onClick={handleConnect}
          variant={isConnected ? 'destructive' : 'default'}
          size="sm"
          className="h-9 gap-1.5"
        >
          <PlugZap className="h-3.5 w-3.5" />
          {isConnected || status === 'connecting'
            ? t('socketTool.disconnect')
            : t('socketTool.connect')}
        </Button>
      </div>

      {/* Status Row */}
      <div className="flex items-center gap-3">
        <StatusBadge status={status} t={t} />
        {connectionTime !== null && (
          <span className="text-xs text-muted-foreground">
            {t('socketTool.connectionTime', { ms: connectionTime })}
          </span>
        )}
        {errorMessage && <span className="text-xs text-destructive">{errorMessage}</span>}
      </div>

      {/* Message Log */}
      <div className="flex-1 overflow-y-auto rounded-md border bg-muted/30 p-3 font-mono text-sm">
        {messages.length === 0 ? (
          <div className="flex h-full items-center justify-center text-muted-foreground text-xs">
            {t('socketTool.idle')}
          </div>
        ) : (
          <div className="space-y-1.5">
            {messages.map((msg) => (
              <div key={msg.id} className="flex items-start gap-2">
                <span className="shrink-0 text-[10px] text-muted-foreground pt-0.5 tabular-nums">
                  {new Date(msg.timestamp).toLocaleTimeString()}
                </span>
                {msg.direction === 'sent' ? (
                  <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-info mt-0.5" />
                ) : (
                  <ArrowDownLeft className="h-3.5 w-3.5 shrink-0 text-success mt-0.5" />
                )}
                <span
                  className={cn(
                    'break-all whitespace-pre-wrap',
                    msg.direction === 'sent' ? 'text-info' : 'text-success'
                  )}
                >
                  {msg.content}
                </span>
              </div>
            ))}
            <div ref={logEndRef} />
          </div>
        )}
      </div>

      {/* Send Area */}
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={inputMsg}
          onChange={(e) => setInputMsg(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t('socketTool.messagePlaceholder')}
          disabled={!isConnected}
          className="h-9 flex-1 rounded-md border bg-background px-3 text-sm font-mono outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
        />
        <Button onClick={handleSend} disabled={!isConnected || !inputMsg.trim()} size="sm" className="h-9 gap-1.5">
          <Send className="h-3.5 w-3.5" />
          {t('socketTool.send')}
        </Button>
        <Button onClick={clearMessages} variant="ghost" size="icon" className="h-9 w-9" title={t('socketTool.clearLog')}>
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

// ==================== Server Panel ====================
interface ServerClient {
  id: string;
  connectedAt: number;
}

interface ServerMessage {
  id: string;
  clientId: string;
  content: string;
  timestamp: number;
  direction: 'received' | 'sent';
}

function ServerPanel() {
  const { t } = useTranslation();
  const [port, setPort] = useState('8080');
  const [running, setRunning] = useState(false);
  const [clients, setClients] = useState<ServerClient[]>([]);
  const [messages, setMessages] = useState<ServerMessage[]>([]);
  const [broadcastMsg, setBroadcastMsg] = useState('');
  const logEndRef = useRef<HTMLDivElement>(null);
  const unlistenRef = useRef<(() => void) | null>(null);

  const tauriAvailable = isTauri();

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Listen to Tauri events
  useEffect(() => {
    if (!tauriAvailable) return;

    let cancelled = false;

    async function setupListeners() {
      const { listen } = await import('@tauri-apps/api/event');

      const unlistenConnected = await listen<{ clientId: string }>('ws-client-connected', (event) => {
        if (cancelled) return;
        serverLog.info('客户端连接', { clientId: event.payload.clientId });
        setClients((prev) => [...prev, { id: event.payload.clientId, connectedAt: Date.now() }]);
        setMessages((prev) => [
          ...prev,
          {
            id: `srv-${Date.now()}-conn`,
            clientId: event.payload.clientId,
            content: t('socketTool.clientConnected', { id: event.payload.clientId }),
            timestamp: Date.now(),
            direction: 'received',
          },
        ]);
      });

      const unlistenDisconnected = await listen<{ clientId: string }>('ws-client-disconnected', (event) => {
        if (cancelled) return;
        serverLog.info('客户端断开', { clientId: event.payload.clientId });
        setClients((prev) => prev.filter((c) => c.id !== event.payload.clientId));
        setMessages((prev) => [
          ...prev,
          {
            id: `srv-${Date.now()}-disc`,
            clientId: event.payload.clientId,
            content: t('socketTool.clientDisconnected', { id: event.payload.clientId }),
            timestamp: Date.now(),
            direction: 'received',
          },
        ]);
      });

      const unlistenMessage = await listen<{ clientId: string; message: string }>('ws-message-received', (event) => {
        if (cancelled) return;
        setMessages((prev) => [
          ...prev,
          {
            id: `srv-${Date.now()}-msg-${Math.random().toString(36).slice(2)}`,
            clientId: event.payload.clientId,
            content: event.payload.message,
            timestamp: Date.now(),
            direction: 'received',
          },
        ]);
      });

      unlistenRef.current = () => {
        unlistenConnected();
        unlistenDisconnected();
        unlistenMessage();
      };
    }

    setupListeners();

    return () => {
      cancelled = true;
      unlistenRef.current?.();
    };
  }, [tauriAvailable, t]);

  const handleStartStop = useCallback(async () => {
    if (!tauriAvailable) return;

    if (running) {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('stop_ws_server');
      setRunning(false);
      setClients([]);
      serverLog.info('服务器已停止', { port: parseInt(port, 10) });
    } else {
      const { invoke } = await import('@tauri-apps/api/core');
      try {
        ensureNetworkAccessAllowed();
        await invoke('start_ws_server', { port: parseInt(port, 10) });
        setRunning(true);
        setMessages([]);
        setClients([]);
        serverLog.info('服务器已启动', { port: parseInt(port, 10) });
      } catch (e) {
        serverLog.error('服务器启动失败', e);
        setMessages((prev) => [
          ...prev,
          {
            id: `srv-${Date.now()}-err`,
            clientId: 'system',
            content: `Error: ${(e as Error).message || e}`,
            timestamp: Date.now(),
            direction: 'received',
          },
        ]);
      }
    }
  }, [tauriAvailable, running, port]);

  const handleBroadcast = useCallback(async () => {
    const trimmed = broadcastMsg.trim();
    if (!trimmed || !tauriAvailable) return;

    const { invoke } = await import('@tauri-apps/api/core');
    try {
      ensureNetworkAccessAllowed();
      await invoke('ws_broadcast', { message: trimmed });
    } catch (error) {
      serverLog.error('广播失败', error);
      return;
    }
    serverLog.info('广播消息', { length: trimmed.length, clients: clients.length });
    setMessages((prev) => [
      ...prev,
      {
        id: `srv-${Date.now()}-bc`,
        clientId: 'server',
        content: trimmed,
        timestamp: Date.now(),
        direction: 'sent',
      },
    ]);
    setBroadcastMsg('');
  }, [broadcastMsg, tauriAvailable, clients.length]);

  // Non-Tauri fallback
  if (!tauriAvailable) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
        <Monitor className="h-12 w-12 text-muted-foreground/50" />
        <div>
          <p className="font-medium text-muted-foreground">{t('socketTool.serverRequiresDesktop')}</p>
          <p className="mt-1 text-sm text-muted-foreground/70">{t('socketTool.serverRequiresDesktopDesc')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-3">
      {/* Server Controls */}
      <div className="flex items-center gap-2">
        <label className="text-sm text-muted-foreground">{t('socketTool.port')}</label>
        <input
          type="number"
          value={port}
          onChange={(e) => setPort(e.target.value)}
          disabled={running}
          className="h-9 w-24 rounded-md border bg-background px-3 text-sm font-mono outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
          min="1"
          max="65535"
        />
        <Button
          onClick={handleStartStop}
          variant={running ? 'destructive' : 'default'}
          size="sm"
          className="h-9 gap-1.5"
        >
          <Radio className="h-3.5 w-3.5" />
          {running ? t('socketTool.stopServer') : t('socketTool.startServer')}
        </Button>
        <StatusBadge
          status={running ? 'connected' : 'idle'}
          t={running ? () => t('socketTool.serverRunning') : () => t('socketTool.serverStopped')}
        />
      </div>

      {/* Clients List */}
      <div className="rounded-md border p-2">
        <p className="mb-1 text-xs font-medium text-muted-foreground">
          {t('socketTool.clients')} ({clients.length})
        </p>
        {clients.length === 0 ? (
          <p className="text-xs text-muted-foreground/60">{t('socketTool.noClients')}</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {clients.map((c) => (
              <span
                key={c.id}
                className="inline-flex items-center gap-1 rounded bg-success/10 px-2 py-0.5 text-xs font-mono text-success"
              >
                <Circle className="h-1.5 w-1.5 fill-current" />
                {c.id}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Message Log */}
      <div className="flex-1 overflow-y-auto rounded-md border bg-muted/30 p-3 font-mono text-sm">
        {messages.length === 0 ? (
          <div className="flex h-full items-center justify-center text-muted-foreground text-xs">
            {running ? t('socketTool.noClients') : t('socketTool.serverStopped')}
          </div>
        ) : (
          <div className="space-y-1.5">
            {messages.map((msg) => (
              <div key={msg.id} className="flex items-start gap-2">
                <span className="shrink-0 text-[10px] text-muted-foreground pt-0.5 tabular-nums">
                  {new Date(msg.timestamp).toLocaleTimeString()}
                </span>
                {msg.direction === 'sent' ? (
                  <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-info mt-0.5" />
                ) : (
                  <ArrowDownLeft className="h-3.5 w-3.5 shrink-0 text-success mt-0.5" />
                )}
                <span className="shrink-0 text-[10px] text-muted-foreground pt-0.5">[{msg.clientId}]</span>
                <span
                  className={cn(
                    'break-all whitespace-pre-wrap',
                    msg.direction === 'sent'
                      ? 'text-info'
                      : 'text-success'
                  )}
                >
                  {msg.content}
                </span>
              </div>
            ))}
            <div ref={logEndRef} />
          </div>
        )}
      </div>

      {/* Broadcast Area */}
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={broadcastMsg}
          onChange={(e) => setBroadcastMsg(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleBroadcast();
          }}
          placeholder={t('socketTool.broadcastPlaceholder')}
          disabled={!running}
          className="h-9 flex-1 rounded-md border bg-background px-3 text-sm font-mono outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
        />
        <Button onClick={handleBroadcast} disabled={!running || !broadcastMsg.trim()} size="sm" className="h-9 gap-1.5">
          <Send className="h-3.5 w-3.5" />
          {t('socketTool.broadcast')}
        </Button>
      </div>
    </div>
  );
}

type NativeProtocol = 'tcp' | 'udp';
type NativeMode = 'client' | 'server';
type NativeStatus = 'idle' | 'connecting' | 'connected' | 'listening' | 'disconnected' | 'error';
type SendMode = 'text' | 'hex';

interface NativeLog {
  id: string;
  direction: 'sent' | 'received' | 'system';
  data: number[];
  timestamp: number;
  peer?: string;
}

interface NativeStatusEvent {
  sessionId: string;
  state: NativeStatus;
  protocol: NativeProtocol;
  mode: NativeMode;
  localAddress?: string;
  remoteAddress?: string;
  peer?: string;
  error?: string;
}

interface NativeDataEvent {
  sessionId: string;
  direction: 'received';
  data: number[];
  peer?: string;
}

interface NativeSessionSummary {
  id: string;
  protocol: NativeProtocol;
  mode: NativeMode;
  status: NativeStatus;
  host: string;
  port: string;
  localPort: string;
  localAddress: string;
  remoteAddress: string;
  error: string;
  peers: string[];
}

function bytesToHex(bytes: number[]) {
  return bytes.map((value) => value.toString(16).padStart(2, '0')).join(' ');
}

function bytesToText(bytes: number[]) {
  return new TextDecoder().decode(new Uint8Array(bytes));
}

function parseHex(value: string) {
  const normalized = value.trim().replace(/0x/gi, '').replace(/[\s,;:_-]+/g, '');
  if (!normalized) return [];
  if (!/^[0-9a-f]+$/i.test(normalized) || normalized.length % 2 !== 0) {
    throw new Error('十六进制数据必须由偶数个 0-9、A-F 字符组成');
  }
  return normalized.match(/.{2}/g)?.map((part) => Number.parseInt(part, 16)) ?? [];
}

function NativeSocketPanel({
  protocol,
  mode,
  onModeChange,
  onProtocolChange,
  onBusyChange,
}: {
  protocol: NativeProtocol;
  mode: NativeMode;
  onModeChange: (mode: NativeMode) => void;
  onProtocolChange: (protocol: NativeProtocol) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const tauriAvailable = isTauri();
  const [host, setHost] = useState('127.0.0.1');
  const [port, setPort] = useState('8080');
  const [localPort, setLocalPort] = useState('');
  const [status, setStatus] = useState<NativeStatus>('idle');
  const [statusError, setStatusError] = useState('');
  const [localAddress, setLocalAddress] = useState('');
  const [remoteAddress, setRemoteAddress] = useState('');
  const [showHex, setShowHex] = useState(false);
  const [sendMode, setSendMode] = useState<SendMode>('text');
  const [draft, setDraft] = useState('');
  const [repeatCount, setRepeatCount] = useState('1');
  const [target, setTarget] = useState('');
  const [peers, setPeers] = useState<string[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const [sessions, setSessions] = useState<NativeSessionSummary[]>([]);
  const [logsBySession, setLogsBySession] = useState<Record<string, NativeLog[]>>({});
  const [draftLogs, setDraftLogs] = useState<NativeLog[]>([]);
  const logEndRef = useRef<HTMLDivElement>(null);

  const logs = sessionId ? logsBySession[sessionId] ?? [] : draftLogs;
  const setLogs = useCallback((next: NativeLog[] | ((current: NativeLog[]) => NativeLog[])) => {
    if (sessionIdRef.current) {
      setLogsBySession((current) => {
        const previous = current[sessionIdRef.current as string] ?? [];
        const value = typeof next === 'function' ? next(previous) : next;
        return { ...current, [sessionIdRef.current as string]: value };
      });
    } else {
      setDraftLogs(next);
    }
  }, []);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  useEffect(() => {
    if (!tauriAvailable) return;
    let cancelled = false;
    let cleanups: Array<() => void> = [];
    async function listenEvents() {
      const { listen } = await import('@tauri-apps/api/event');
      const unlistenStatus = await listen<NativeStatusEvent>('socket-debug-status', (event) => {
        if (cancelled) return;
        const payload = event.payload;
        const selected = sessionIdRef.current === payload.sessionId;
        setSessions((current) => {
          const existing = current.find((item) => item.id === payload.sessionId);
          const next: NativeSessionSummary = {
            id: payload.sessionId,
            protocol: payload.protocol,
            mode: payload.mode,
            status: payload.state,
            host: existing?.host ?? '',
            port: existing?.port ?? '',
            localPort: existing?.localPort ?? '',
            localAddress: payload.localAddress ?? existing?.localAddress ?? '',
            remoteAddress: payload.remoteAddress ?? existing?.remoteAddress ?? '',
            error: payload.error ?? '',
            peers: payload.state === 'disconnected' && payload.peer
              ? (existing?.peers ?? []).filter((peer) => peer !== payload.peer)
              : payload.peer && !(existing?.peers ?? []).includes(payload.peer)
                ? [...(existing?.peers ?? []), payload.peer]
                : existing?.peers ?? [],
          };
          return existing ? current.map((item) => item.id === payload.sessionId ? next : item) : [...current, next];
        });
        if (selected) {
          setStatus(payload.state);
          setStatusError(payload.error ?? '');
          if (payload.localAddress) setLocalAddress(payload.localAddress);
          if (payload.remoteAddress) setRemoteAddress(payload.remoteAddress);
        }
        if (payload.peer) {
          if (selected) {
            setTarget((current) => current || payload.peer || '');
            setPeers((current) => (current.includes(payload.peer as string) ? current : [...current, payload.peer as string]));
          }
        }
        if (selected && payload.state === 'disconnected' && payload.peer) {
          setPeers((current) => current.filter((peer) => peer !== payload.peer));
        }
        if (payload.error) {
          const entry = { id: `${Date.now()}-error`, direction: 'system' as const, data: [], timestamp: Date.now(), peer: payload.error };
          setLogsBySession((current) => ({ ...current, [payload.sessionId]: [...(current[payload.sessionId] ?? []), entry] }));
        }
      });
      const unlistenData = await listen<NativeDataEvent>('socket-debug-data', (event) => {
        if (cancelled) return;
        const selected = sessionIdRef.current === event.payload.sessionId;
        if (selected && event.payload.peer) {
          setTarget((current) => current || event.payload.peer || '');
          setPeers((current) => (current.includes(event.payload.peer as string) ? current : [...current, event.payload.peer as string]));
        }
        const entry: NativeLog = {
          id: `${Date.now()}-${Math.random()}`,
          direction: 'received',
          data: event.payload.data,
          timestamp: Date.now(),
          peer: event.payload.peer,
        };
        setLogsBySession((current) => ({ ...current, [event.payload.sessionId]: [...(current[event.payload.sessionId] ?? []), entry] }));
        if (event.payload.peer) {
          setSessions((current) => current.map((item) => item.id === event.payload.sessionId && !item.peers.includes(event.payload.peer as string)
            ? { ...item, peers: [...item.peers, event.payload.peer as string] }
            : item));
        }
      });
      if (cancelled) {
        unlistenStatus();
        unlistenData();
      } else {
        cleanups = [unlistenStatus, unlistenData];
      }
    }
    void listenEvents();
    return () => {
      cancelled = true;
      cleanups.forEach((cleanup) => cleanup());
    };
  }, [tauriAvailable]);

  useEffect(() => () => {
    if (tauriAvailable) {
      void import('@tauri-apps/api/core').then(({ invoke }) => invoke('socket_debug_stop')).catch(() => undefined);
    }
  }, [tauriAvailable]);

  const isActive = status === 'connected' || status === 'connecting' || status === 'listening';

  useEffect(() => {
    onBusyChange(isActive);
  }, [isActive, onBusyChange]);

  const selectSession = useCallback((id: string) => {
    const selected = sessions.find((item) => item.id === id);
    if (!selected) return;
    sessionIdRef.current = id;
    setSessionId(id);
    onProtocolChange(selected.protocol);
    onModeChange(selected.mode);
    setHost(selected.host);
    setPort(selected.port);
    setLocalPort(selected.localPort);
    setStatus(selected.status);
    setStatusError(selected.error);
    setLocalAddress(selected.localAddress);
    setRemoteAddress(selected.remoteAddress);
    setPeers(selected.peers);
    setTarget(selected.peers[0] ?? '');
  }, [onProtocolChange, sessions]);

  const startNewSession = useCallback(() => {
    sessionIdRef.current = null;
    setSessionId(null);
    setStatus('idle');
    setStatusError('');
    setLocalAddress('');
    setRemoteAddress('');
    setPeers([]);
    setTarget('');
    setDraftLogs([]);
  }, []);

  const handleStartStop = useCallback(async () => {
    if (!tauriAvailable) return;
    const { invoke } = await import('@tauri-apps/api/core');
    if (status === 'connected' || status === 'connecting' || status === 'listening') {
      if (!sessionId) return;
      await invoke('socket_debug_stop', { sessionId });
      setStatus('disconnected');
      setSessions((current) => current.map((item) => item.id === sessionId ? { ...item, status: 'disconnected' } : item));
      return;
    }
    try {
      ensureNetworkAccessAllowed();
    } catch (error) {
      setStatusError(String(error));
      setStatus('error');
      return;
    }
    const numericPort = Number(port);
    const numericLocalPort = localPort.trim() ? Number(localPort) : undefined;
    if (!Number.isInteger(numericPort) || numericPort < 1 || numericPort > 65535) {
      setStatusError('请输入 1 到 65535 之间的端口');
      setStatus('error');
      return;
    }
    if (numericLocalPort !== undefined && (!Number.isInteger(numericLocalPort) || numericLocalPort < 1 || numericLocalPort > 65535)) {
      setStatusError('本地端口必须在 1 到 65535 之间');
      setStatus('error');
      return;
    }
    try {
      setStatus('connecting');
      setStatusError('');
      setDraftLogs([]);
      setPeers([]);
      const info = await invoke<{ sessionId: string; protocol: NativeProtocol; mode: NativeMode; localAddress?: string; remoteAddress?: string }>('socket_debug_start', {
        request: {
          protocol,
          mode,
          host: host.trim() || (mode === 'server' ? '0.0.0.0' : '127.0.0.1'),
          port: numericPort,
          localPort: numericLocalPort,
        },
      });
      sessionIdRef.current = info.sessionId;
      setSessionId(info.sessionId);
      setSessions((current) => [...current.filter((item) => item.id !== info.sessionId), {
        id: info.sessionId,
        protocol: info.protocol,
        mode: info.mode,
        status: mode === 'server' ? 'listening' : 'connected',
        host: host.trim() || (mode === 'server' ? '0.0.0.0' : '127.0.0.1'),
        port,
        localPort,
        localAddress: info.localAddress ?? '',
        remoteAddress: info.remoteAddress ?? '',
        error: '',
        peers: [],
      }]);
      setLogsBySession((current) => ({ ...current, [info.sessionId]: [] }));
      setLocalAddress(info.localAddress ?? '');
      setRemoteAddress(info.remoteAddress ?? '');
      setStatus(mode === 'server' ? 'listening' : 'connected');
    } catch (error) {
      const message = String(error);
      setStatus('error');
      setStatusError(message);
      setDraftLogs([{ id: `${Date.now()}-error`, direction: 'system', data: [], timestamp: Date.now(), peer: message }]);
    }
  }, [host, localPort, mode, port, protocol, sessionId, status, tauriAvailable]);

  const handleSend = useCallback(async () => {
    if (!tauriAvailable || !sessionId || (status !== 'connected' && status !== 'listening')) return;
    try {
      ensureNetworkAccessAllowed();
    } catch (error) {
      setStatusError(String(error));
      return;
    }
    let data: number[];
    try {
      data = sendMode === 'hex' ? parseHex(draft) : Array.from(new TextEncoder().encode(draft));
    } catch (error) {
      setStatusError(String(error));
      return;
    }
    if (!data.length) return;
    const count = Math.max(1, Math.min(999, Number.parseInt(repeatCount, 10) || 1));
    const { invoke } = await import('@tauri-apps/api/core');
    try {
      for (let index = 0; index < count; index += 1) {
        await invoke('socket_debug_send', { request: { sessionId, data, target: target.trim() || undefined } });
        setLogs((current) => [...current, { id: `${Date.now()}-${index}-${Math.random()}`, direction: 'sent', data, timestamp: Date.now(), peer: target.trim() || undefined }]);
      }
      setStatusError('');
    } catch (error) {
      setStatusError(String(error));
    }
  }, [draft, repeatCount, sendMode, sessionId, status, target, tauriAvailable]);

  if (!tauriAvailable) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
        <Wifi className="h-12 w-12 text-muted-foreground/50" />
        <div>
          <p className="font-medium text-muted-foreground">TCP/UDP Socket 需要桌面端运行</p>
          <p className="mt-1 text-sm text-muted-foreground/70">请在 Tauri 桌面应用中打开此工具，以访问本机网络连接。</p>
        </div>
      </div>
    );
  }

  const statusLabel: Record<NativeStatus, string> = {
    idle: '未连接', connecting: '连接中', connected: '已连接', listening: '监听中', disconnected: '已断开', error: '连接错误',
  };
  const sendTarget = mode === 'server' ? target : protocol === 'udp' ? `${host}:${port}` : undefined;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {sessions.length > 0 && <div className="flex min-w-0 items-center gap-2 overflow-x-auto border-b pb-2">
        <span className="shrink-0 text-xs font-medium text-muted-foreground">会话</span>
        {sessions.map((item) => <button key={item.id} type="button" onClick={() => selectSession(item.id)} className={cn('flex shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs', item.id === sessionId ? 'border-primary/40 bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted')}>
          <Circle className={cn('h-2 w-2 fill-current', item.status === 'connected' || item.status === 'listening' ? 'text-success' : item.status === 'error' ? 'text-destructive' : 'text-muted-foreground')} />
          {item.protocol.toUpperCase()} {item.mode === 'server' ? '服务端' : '客户端'} · {item.port || item.localAddress || item.id}
        </button>)}
        <button type="button" onClick={startNewSession} className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-dashed px-2.5 text-xs text-muted-foreground hover:bg-muted"><Plug className="h-3.5 w-3.5" />新建会话</button>
      </div>}
      <div className="rounded-xl border bg-card p-4 shadow-sm">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">连接参数</h2>
            <p className="mt-1 text-xs text-muted-foreground">填写网络地址和端口，然后建立连接。</p>
          </div>
          <span className={cn('inline-flex shrink-0 items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs font-medium', status === 'connected' || status === 'listening' ? 'text-success' : status === 'error' ? 'text-destructive' : 'text-muted-foreground')}>
            <Circle className={cn('h-2 w-2 fill-current', status === 'connected' || status === 'listening' ? 'text-success' : status === 'error' ? 'text-destructive' : 'text-muted-foreground')} />{statusLabel[status]}
          </span>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_140px_140px_auto]">
        <label className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">
          {mode === 'server' ? '绑定地址' : '目标地址'}
          <input value={host} onChange={(event) => setHost(event.target.value)} disabled={isActive} className="h-9 rounded-md border bg-background px-3 font-mono text-sm text-foreground outline-none focus:ring-2 focus:ring-ring disabled:opacity-60" placeholder={mode === 'server' ? '0.0.0.0' : '127.0.0.1'} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {mode === 'server' ? '监听端口' : '目标端口'}
          <input type="number" min="1" max="65535" value={port} onChange={(event) => setPort(event.target.value)} disabled={isActive} className="h-9 rounded-md border bg-background px-3 font-mono text-sm text-foreground outline-none focus:ring-2 focus:ring-ring disabled:opacity-60" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {protocol === 'udp' ? '本地端口（可选）' : '本地端口'}
          <input type="number" min="1" max="65535" value={localPort} onChange={(event) => setLocalPort(event.target.value)} disabled={isActive || protocol === 'tcp'} className="h-9 rounded-md border bg-background px-3 font-mono text-sm text-foreground outline-none focus:ring-2 focus:ring-ring disabled:opacity-60" placeholder={protocol === 'udp' && mode === 'client' ? '自动分配' : protocol === 'udp' ? '默认使用监听端口' : 'TCP 自动分配'} />
        </label>
        <Button onClick={() => void handleStartStop()} variant={isActive ? 'destructive' : 'default'} className="mt-auto h-9 gap-1.5">
          {isActive ? <PlugZap className="h-4 w-4" /> : <Plug className="h-4 w-4" />}{isActive ? '断开' : mode === 'server' ? '开始监听' : '连接'}
        </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>本地：<b className="font-mono font-normal text-foreground">{localAddress || '—'}</b></span>
        <span>对端：<b className="font-mono font-normal text-foreground">{remoteAddress || '—'}</b></span>
        {statusError && <span className="text-destructive">{statusError}</span>}
      </div>

      {mode === 'server' && <div className="flex items-center gap-2 rounded-md border bg-muted/20 px-3 py-2 text-xs">
        <Server className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-muted-foreground">连接目标</span>
        <select value={target} onChange={(event) => setTarget(event.target.value)} className="h-7 min-w-0 flex-1 rounded border bg-background px-2 font-mono text-xs outline-none" disabled={!peers.length}>
          <option value="">{peers.length ? '全部客户端' : '暂无客户端'}</option>
          {peers.map((peer) => <option key={peer} value={peer}>{peer}</option>)}
        </select>
      </div>}

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border bg-slate-950/[0.03]">
        <div className="flex h-9 shrink-0 items-center justify-between border-b px-2">
          <span className="text-xs font-medium text-muted-foreground">数据收发记录</span>
          <div className="flex items-center gap-1">
            <button type="button" title="切换十六进制显示" onClick={() => setShowHex((value) => !value)} className={cn('inline-flex h-7 items-center gap-1 rounded px-2 text-xs', showHex ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted')}><Binary className="h-3.5 w-3.5" />{showHex ? '文本' : '十六进制'}</button>
            <button type="button" title="清空记录" onClick={() => setLogs([])} className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"><RefreshCw className="h-3.5 w-3.5" /></button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3 font-mono text-xs">
          {logs.length === 0 ? <div className="flex h-full items-center justify-center text-muted-foreground">连接后，收到的数据会显示在这里</div> : logs.map((log) => (
            <div key={log.id} className="mb-2 flex items-start gap-2 leading-relaxed">
              <span className="shrink-0 text-[10px] text-muted-foreground">{new Date(log.timestamp).toLocaleTimeString()}</span>
              {log.direction === 'system' ? <span className="break-all text-destructive">{log.peer}</span> : <>
                <span className={cn('shrink-0 font-semibold', log.direction === 'sent' ? 'text-info' : 'text-success')}>{log.direction === 'sent' ? '↑ 发' : '↓ 收'}</span>
                {log.peer && <span className="shrink-0 text-muted-foreground">[{log.peer}]</span>}
                <span className="break-all whitespace-pre-wrap text-foreground">{showHex ? bytesToHex(log.data) : bytesToText(log.data)}</span>
              </>}
            </div>
          ))}
          <div ref={logEndRef} />
        </div>
      </div>

      <div className="shrink-0 rounded-md border bg-background p-2">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">发送数据</span>
          <div className="ml-auto flex rounded border bg-muted/40 p-0.5">
            {(['text', 'hex'] as SendMode[]).map((item) => <button key={item} type="button" onClick={() => setSendMode(item)} className={cn('h-6 rounded px-2 text-xs', sendMode === item ? 'bg-background shadow-sm' : 'text-muted-foreground')}>{item === 'text' ? '文本' : '十六进制'}</button>)}
          </div>
          <label className="flex items-center gap-1 text-xs text-muted-foreground">重复 <input type="number" min="1" max="999" value={repeatCount} onChange={(event) => setRepeatCount(event.target.value)} className="h-7 w-16 rounded border bg-background px-2 text-center font-mono text-xs" /></label>
          <Button onClick={() => void handleSend()} disabled={!isActive || !draft.trim()} size="sm" className="h-8 gap-1.5"><Send className="h-3.5 w-3.5" />发送数据</Button>
        </div>
        <textarea value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') void handleSend(); }} rows={3} disabled={!isActive} className="w-full resize-y rounded border bg-background px-3 py-2 font-mono text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-60" placeholder={sendMode === 'hex' ? '例如：48 65 6C 6C 6F' : '输入要发送的内容，Ctrl + Enter 发送'} />
        {mode === 'server' && <p className="mt-1 text-[11px] text-muted-foreground">当前发送目标：{sendTarget || '全部客户端'}</p>}
      </div>
    </div>
  );
}

// ==================== Main Component ====================
export default function SocketTool() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<'tcp' | 'udp' | 'websocket'>('tcp');
  const [mode, setMode] = useState<NativeMode>('client');
  const [nativeBusy, setNativeBusy] = useState(false);
  const log = useToolLogger('socket-tool');

  const isWebSocket = tab === 'websocket';
  const handleProtocolChange = (next: 'tcp' | 'udp' | 'websocket') => {
    setTab(next);
    log.info('切换协议', { tab: next });
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 p-5">
      <header className="flex shrink-0 flex-col gap-4 rounded-xl border bg-card px-4 py-4 shadow-sm lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Wifi className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <h1 className="text-base font-semibold tracking-tight">网络连接调试</h1>
              <p className="mt-0.5 text-xs text-muted-foreground">选择协议和角色，建立连接后即可收发数据。</p>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-2 lg:items-end">
          <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">协议</span>
          <div className="flex flex-wrap gap-1 rounded-lg bg-muted p-1" role="tablist" aria-label="选择网络协议">
            {(['tcp', 'udp', 'websocket'] as const).map((item) => {
              const selected = tab === item;
              return (
                <button
                  key={item}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  aria-disabled={!isWebSocket && nativeBusy}
                  disabled={!isWebSocket && nativeBusy}
                  onClick={() => handleProtocolChange(item)}
                  className={cn('inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-sm font-medium transition-colors', selected ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}
                >
                  {item === 'websocket' ? <Radio className="h-3.5 w-3.5" aria-hidden="true" /> : <Binary className="h-3.5 w-3.5" aria-hidden="true" />}
                  {item === 'websocket' ? 'WebSocket' : item.toUpperCase()}
                </button>
              );
            })}
          </div>
        </div>
      </header>

      <section className="flex shrink-0 flex-col gap-3 rounded-xl border bg-card p-4 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold">连接角色</h2>
            <p className="mt-1 text-xs text-muted-foreground">客户端主动连接目标；服务端等待其他设备连接。</p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:min-w-[260px]" role="group" aria-label="选择连接角色">
            {(['client', 'server'] as NativeMode[]).map((item) => {
              const selected = mode === item;
              return (
                <button
                  key={item}
                  type="button"
                  onClick={() => setMode(item)}
                  aria-pressed={selected}
                  disabled={!isWebSocket && nativeBusy}
                  className={cn('flex min-h-12 items-center justify-center gap-2 rounded-lg border px-3 text-sm font-medium transition-colors', selected ? 'border-primary bg-primary/10 text-primary' : 'text-muted-foreground hover:border-primary/40 hover:text-foreground')}
                >
                  {item === 'client' ? <Plug className="h-4 w-4" aria-hidden="true" /> : <Server className="h-4 w-4" aria-hidden="true" />}
                  <span>{item === 'client' ? t('socketTool.client') : t('socketTool.server')}</span>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      <div className="min-h-0 flex-1">
        {isWebSocket ? (
          <div className="flex h-full min-h-0 flex-col gap-3">
            {mode === 'client' ? <ClientPanel /> : <ServerPanel />}
          </div>
        ) : (
          <NativeSocketPanel
            protocol={tab}
            mode={mode}
            onModeChange={setMode}
            onProtocolChange={(next) => handleProtocolChange(next)}
            onBusyChange={setNativeBusy}
          />
        )}
      </div>
    </div>
  );
}
