import { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useWebSocketClient, WsStatus } from '@/hooks/use-websocket-client';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useToolLogger } from '@/hooks/use-tool-logger';
import { createLogger } from '@/lib/logger';
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
    connecting: { color: 'bg-yellow-400 animate-pulse', label: t('socketTool.connecting') },
    connected: { color: 'bg-green-500', label: t('socketTool.connected') },
    disconnected: { color: 'bg-orange-400', label: t('socketTool.disconnected') },
    error: { color: 'bg-red-500', label: t('socketTool.error') },
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
                  <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-blue-500 mt-0.5" />
                ) : (
                  <ArrowDownLeft className="h-3.5 w-3.5 shrink-0 text-green-500 mt-0.5" />
                )}
                <span
                  className={cn(
                    'break-all whitespace-pre-wrap',
                    msg.direction === 'sent' ? 'text-blue-600 dark:text-blue-400' : 'text-green-600 dark:text-green-400'
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
    await invoke('ws_broadcast', { message: trimmed });
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
                className="inline-flex items-center gap-1 rounded bg-green-100 px-2 py-0.5 text-xs font-mono text-green-700 dark:bg-green-900/30 dark:text-green-400"
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
                  <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-blue-500 mt-0.5" />
                ) : (
                  <ArrowDownLeft className="h-3.5 w-3.5 shrink-0 text-green-500 mt-0.5" />
                )}
                <span className="shrink-0 text-[10px] text-muted-foreground pt-0.5">[{msg.clientId}]</span>
                <span
                  className={cn(
                    'break-all whitespace-pre-wrap',
                    msg.direction === 'sent'
                      ? 'text-blue-600 dark:text-blue-400'
                      : 'text-green-600 dark:text-green-400'
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

// ==================== Main Component ====================
export default function SocketTool() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<'client' | 'server'>('client');
  const log = useToolLogger('socket-tool');

  return (
    <div className="flex h-full flex-col p-4">
      {/* Tab Bar */}
      <div className="mb-4 flex items-center gap-1 rounded-lg bg-muted p-1 w-fit">
        <button
          onClick={() => {
            setTab('client');
            log.info('切换面板', { tab: 'client' });
          }}
          className={cn(
            'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
            tab === 'client'
              ? 'bg-background shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          <PlugZap className="h-3.5 w-3.5" />
          {t('socketTool.client')}
        </button>
        <button
          onClick={() => {
            setTab('server');
            log.info('切换面板', { tab: 'server' });
          }}
          className={cn(
            'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
            tab === 'server'
              ? 'bg-background shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          <Radio className="h-3.5 w-3.5" />
          {t('socketTool.server')}
        </button>
      </div>

      {/* Tab Content */}
      <div className="min-h-0 flex-1">
        {tab === 'client' ? <ClientPanel /> : <ServerPanel />}
      </div>
    </div>
  );
}
