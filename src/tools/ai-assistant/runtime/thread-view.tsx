import { AssistantRuntimeProvider, ThreadPrimitive, useAuiState, type AssistantRuntime } from '@assistant-ui/react';
import { useCallback, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import { useNiueryRuntime, type AiRuntimeActions } from './use-niuery-runtime';
import { AiRuntimeScope } from './runtime-context';
import type { AiMessage, AiProvider } from '../types';
import { useAiText } from '../ui-text';

export function AiThread({ messages, providers, actions, running, disabled, sendDisabled, activeRunId, children, runtimeRef, targetMessageId }: {
  messages: AiMessage[]; providers: AiProvider[]; actions: AiRuntimeActions; running: boolean; disabled: boolean; sendDisabled: boolean; activeRunId?: string; children: ReactNode; runtimeRef?: { current: AssistantRuntime | null }; targetMessageId?: string;
}) {
  const [startIndex, setStartIndex] = useState(() => Math.max(0, messages.length - 100));
  const targetIndex = targetMessageId ? messages.findIndex(message => message.id === targetMessageId) : -1;
  const start = Math.min(startIndex < messages.length ? startIndex : 0, targetIndex < 0 ? messages.length : targetIndex);
  useLayoutEffect(() => { if (start !== startIndex) setStartIndex(start); }, [start, startIndex]);
  const visibleMessages = useMemo(() => messages.slice(start), [messages, start]);
  const loadEarlier = useCallback(async () => { setStartIndex(index => Math.max(0, index - 100)); }, []);
  const runtime = useNiueryRuntime({ messages: visibleMessages, providers, actions, running, disabled, sendDisabled, activeRunId, hasEarlier: start > 0, onLoadEarlier: loadEarlier });
  useLayoutEffect(() => { if (runtimeRef) runtimeRef.current = runtime; return () => { if (runtimeRef?.current === runtime) runtimeRef.current = null; }; }, [runtime, runtimeRef]);
  return <AssistantRuntimeProvider runtime={runtime}><AiRuntimeScope><ThreadPrimitive.Root asChild>{children}</ThreadPrimitive.Root></AiRuntimeScope></AssistantRuntimeProvider>;
}

export function AiReadonlyMessage({ message, providers, children, showThinking }: { message: AiMessage; providers: AiProvider[]; children: ReactNode; showThinking?: boolean }) {
  const renderedMessage = showThinking === false ? { ...message, thinking: undefined } : message;
  const runtime = useNiueryRuntime({ messages: [renderedMessage], providers, running: message.status === 'streaming', disabled: true });
  return <AssistantRuntimeProvider runtime={runtime}><AiRuntimeScope><ThreadPrimitive.Root><ThreadPrimitive.Messages>{() => children}</ThreadPrimitive.Messages></ThreadPrimitive.Root></AiRuntimeScope></AssistantRuntimeProvider>;
}

export function LoadEarlierMessages() {
  const t = useAiText();
  const hasEarlier = useAuiState(state => state.thread.hasEarlier);
  return hasEarlier ? <ThreadPrimitive.LoadEarlier type="button" className="ai-load-earlier">{t('显示较早的消息', 'Load earlier messages')}</ThreadPrimitive.LoadEarlier> : null;
}
