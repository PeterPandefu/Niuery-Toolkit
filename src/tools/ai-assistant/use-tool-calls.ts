import { useEffect, useState, useSyncExternalStore } from 'react';
import type { AiBackend, AiConversation, AiStreamEvent, AiToolCall, AiToolDecision } from './types';

/** Terminal sweep for calls the backend never settled (discarded wrap-up calls,
 *  cancelled or interrupted streams), so no card hangs in "running" forever. */
export function settlePendingCalls(calls: AiToolCall[] | undefined, note: string): AiToolCall[] | undefined {
  if (!calls?.some(call => call.status === 'pending' || call.status === 'running')) return calls;
  return calls.map(call => call.status === 'pending' || call.status === 'running'
    ? { ...call, status: 'failed' as const, error: call.error ?? note }
    : call);
}

export interface ToolCallDeps {
  changeConversation(id: string, update: (chat: AiConversation) => AiConversation): void;
  saveQuietly(): void;
  backend: Pick<AiBackend, 'decideTool' | 'answerTool'>;
}

function mergeCall(existing: AiToolCall | undefined, event: AiStreamEvent): AiToolCall {
  const base: AiToolCall = existing ?? {
    id: event.callId ?? '',
    name: event.name ?? '',
    arguments: event.arguments ?? '{}',
    status: 'pending',
  };
  if (event.type === 'tool_call') {
    return {
      ...base,
      name: event.name ?? base.name,
      arguments: event.arguments ?? base.arguments,
      status: event.status ?? base.status,
      ...(event.url === undefined ? {} : { url: event.url }),
      ...(event.provenance === undefined ? {} : { provenance: event.provenance }),
    };
  }
  if (event.type === 'approval_required' || event.type === 'question_required') {
    return {
      ...base,
      name: event.name ?? base.name,
      arguments: event.arguments ?? base.arguments,
      status: event.status ?? base.status,
      ...(event.url === undefined ? {} : { url: event.url }),
      ...(event.provenance === undefined ? {} : { provenance: event.provenance }),
    };
  }
  return {
    ...base,
    status: event.status ?? (event.error === undefined ? 'complete' : 'failed'),
    ...(event.result === undefined ? {} : { result: event.result }),
    ...(event.error === undefined ? {} : { error: event.error }),
    ...(event.durationMs === undefined ? {} : { durationMs: event.durationMs }),
  };
}

export interface ToolCallTracker {
  handleEvent(event: AiStreamEvent, conversationId: string, messageId: string): void;
  decide(decision: AiToolDecision): Promise<void>;
  answer(text: string): Promise<void>;
  clear(conversationId?: string): void;
  getPendingApproval(): AiStreamEvent | null;
  subscribe(listener: () => void): () => void;
  dispose(): void;
}

/** React-free core so the workspace controller can own tool approvals across
 *  page unmounts; useToolCalls is a thin subscription wrapper. */
export function createToolCallTracker({ changeConversation, saveQuietly, backend }: ToolCallDeps): ToolCallTracker {
  let pending: AiStreamEvent[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  const listeners = new Set<() => void>();
  const notify = () => { for (const listener of listeners) listener(); };

  const handleEvent = (event: AiStreamEvent, conversationId: string, messageId: string) => {
    if (event.type !== 'tool_call' && event.type !== 'tool_result' && event.type !== 'approval_required' && event.type !== 'question_required') return;
    const callId = event.callId;
    if (!callId) return;
    if (event.type === 'approval_required' || event.type === 'question_required') {
      pending = [...pending.filter(item => item.callId !== callId), event];
      notify();
    }
    changeConversation(conversationId, chat => ({
      ...chat,
      messages: chat.messages.map(message => {
        if (message.id !== messageId) return message;
        const calls = message.toolCalls ?? [];
        const index = calls.findIndex(call => call.id === callId);
        const merged = mergeCall(index < 0 ? undefined : calls[index], event);
        const next = index < 0 ? [...calls, merged] : calls.map((call, at) => (at === index ? merged : call));
        return { ...message, toolCalls: next, status: 'streaming' };
      }),
    }));
    if (timer === null) {
      timer = setTimeout(() => {
        timer = null;
        saveQuietly();
      }, 500);
    }
  };

  /** Only approve or reject. There is deliberately no "always allow" path, so
   *  every call re-checks its target and URL source. */
  const decide = async (decision: AiToolDecision) => {
    const callId = pending[0]?.callId;
    pending = pending.slice(1);
    notify();
    if (!callId) return;
    try {
      await backend.decideTool(callId, decision);
    } catch {
      // A timed-out, cancelled or already-answered call is harmless here.
    }
  };

  const answer = async (text: string) => {
    const callId = pending[0]?.callId;
    pending = pending.slice(1);
    notify();
    if (!callId) return;
    try {
      await backend.answerTool(callId, text);
    } catch {
      // A timed-out, cancelled or already-answered question is harmless here.
    }
  };

  const clear = (conversationId?: string) => {
    pending = conversationId ? pending.filter(item => item.conversationId !== conversationId) : [];
    notify();
  };

  return {
    handleEvent,
    decide,
    answer,
    clear,
    getPendingApproval: () => pending[0] ?? null,
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    dispose: () => { if (timer !== null) clearTimeout(timer); timer = null; },
  };
}

/** Keeps tool records on the assistant message, so round pairing in buildContext
 *  and the excludedMessageIds semantics stay untouched. */
export function useToolCalls(deps: ToolCallDeps) {
  const [tracker] = useState(() => createToolCallTracker(deps));
  const pendingApproval = useSyncExternalStore(tracker.subscribe, tracker.getPendingApproval);
  useEffect(() => () => tracker.dispose(), [tracker]);
  return { handleEvent: tracker.handleEvent, pendingApproval, decide: tracker.decide, answer: tracker.answer, clear: tracker.clear };
}