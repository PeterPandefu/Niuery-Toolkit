import { useState, useRef, useCallback } from 'react';

export type WsStatus = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error';

export interface WsMessage {
  id: string;
  direction: 'sent' | 'received';
  content: string;
  timestamp: number;
}

let msgIdCounter = 0;
function nextMsgId() {
  return `ws-msg-${Date.now()}-${++msgIdCounter}`;
}

export function useWebSocketClient() {
  const [status, setStatus] = useState<WsStatus>('idle');
  const [messages, setMessages] = useState<WsMessage[]>([]);
  const [connectionTime, setConnectionTime] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const wsRef = useRef<WebSocket | null>(null);
  const connectStartRef = useRef<number>(0);

  const connect = useCallback((url: string) => {
    // Close existing connection
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    setStatus('connecting');
    setErrorMessage('');
    setConnectionTime(null);
    connectStartRef.current = performance.now();

    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        const elapsed = Math.round(performance.now() - connectStartRef.current);
        setConnectionTime(elapsed);
        setStatus('connected');
      };

      ws.onmessage = (event) => {
        const content = typeof event.data === 'string' ? event.data : '[Binary Data]';
        setMessages((prev) => [
          ...prev,
          { id: nextMsgId(), direction: 'received', content, timestamp: Date.now() },
        ]);
      };

      ws.onclose = () => {
        setStatus((prev) => (prev === 'error' ? 'error' : 'disconnected'));
        wsRef.current = null;
      };

      ws.onerror = () => {
        setErrorMessage('WebSocket connection failed');
        setStatus('error');
      };
    } catch (e) {
      setErrorMessage((e as Error).message);
      setStatus('error');
    }
  }, []);

  const disconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setStatus('disconnected');
  }, []);

  const send = useCallback((content: string) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(content);
      setMessages((prev) => [
        ...prev,
        { id: nextMsgId(), direction: 'sent', content, timestamp: Date.now() },
      ]);
      return true;
    }
    return false;
  }, []);

  const clearMessages = useCallback(() => {
    setMessages([]);
  }, []);

  return {
    status,
    messages,
    connectionTime,
    errorMessage,
    connect,
    disconnect,
    send,
    clearMessages,
  };
}
