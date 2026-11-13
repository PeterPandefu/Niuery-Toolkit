import { useCallback, useEffect, useRef, useState } from 'react';
import type { AiBackend, AiConversation, AiStreamEvent, AiToolCall, AiToolDecision } from './types';

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
    };
  }
  if (event.type === 'approval_required' || event.type === 'question_required') {
    return {
      ...base,
      name: event.name ?? base.name,
      arguments: event.arguments ?? base.arguments,
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

/** Keeps tool records on the assistant message, so round pairing in buildContext
 *  and the excludedMessageIds semantics stay untouched. */
export function useToolCalls({ changeConversation, saveQuietly, backend }: ToolCallDeps) {
  const [pendingApproval, setPendingApproval] = useState<AiStreamEvent | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current !== null) clearTimeout(timer.current);
  }, []);

  const handleEvent = useCallback((event: AiStreamEvent, conversationId: string, messageId: string) => {
    if (event.type !== 'tool_call' && event.type !== 'tool_result' && event.type !== 'approval_required' && event.type !== 'question_required') return;
    const callId = event.callId;
    if (!callId) return;
    if (event.type === 'approval_required' || event.type === 'question_required') setPendingApproval(event);
    changeConversation(conversationId, chat => ({
      ...chat,
      updatedAt: Date.now(),
      messages: chat.messages.map(message => {
        if (message.id !== messageId) return message;
        const calls = message.toolCalls ?? [];
        const index = calls.findIndex(call => call.id === callId);
        const merged = mergeCall(index < 0 ? undefined : calls[index], event);
        const next = index < 0 ? [...calls, merged] : calls.map((call, at) => (at === index ? merged : call));
        return { ...message, toolCalls: next, status: 'streaming' };
      }),
    }));
    if (timer.current === null) {
      timer.current = setTimeout(() => {
        timer.current = null;
        saveQuietly();
      }, 500);
    }
  }, [changeConversation, saveQuietly]);

  /** Only approve or reject. There is deliberately no "always allow" path, so
   *  every call re-checks its target and URL source. */
  const decide = useCallback(async (decision: AiToolDecision) => {
    const callId = pendingApproval?.callId;
    setPendingApproval(null);
    if (!callId) return;
    try {
      await backend.decideTool(callId, decision);
    } catch {
      // A timed-out, cancelled or already-answered call is harmless here.
    }
  }, [pendingApproval, backend]);

  const answer = useCallback(async (text: string) => {
    const callId = pendingApproval?.callId;
    setPendingApproval(null);
    if (!callId) return;
    try {
      await backend.answerTool(callId, text);
    } catch {
      // A timed-out, cancelled or already-answered question is harmless here.
    }
  }, [pendingApproval, backend]);

  const clear = useCallback(() => setPendingApproval(null), []);

  return { handleEvent, pendingApproval, decide, answer, clear };
}