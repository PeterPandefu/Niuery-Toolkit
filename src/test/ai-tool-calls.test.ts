import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { mapAiMessage } from '@/tools/ai-assistant/runtime/message-mapper';
import { useToolCalls } from '@/tools/ai-assistant/use-tool-calls';
import type { AiConversation, AiMessage, AiStreamEvent, AiToolCall } from '@/tools/ai-assistant/types';

function message(overrides: Partial<AiMessage> = {}): AiMessage {
  return {
    id: 'reply-1', role: 'assistant', content: 'answer', attachments: [],
    createdAt: 1_700_000_000_000, status: 'complete', ...overrides,
  };
}

function call(overrides: Partial<AiToolCall> = {}): AiToolCall {
  return { id: 'call-1', name: 'calculate', arguments: '{"expression":"6*7"}', status: 'complete', result: '42', ...overrides };
}

function event(overrides: Partial<AiStreamEvent> = {}): AiStreamEvent {
  return {
    requestId: 'r1', conversationId: 'c1', messageId: 'reply-1',
    type: 'tool_call', callId: 'call-1', name: 'calculate', arguments: '{"expression":"6*7"}', status: 'pending',
    ...overrides,
  };
}

type LoosePart = { type: string; toolName?: string; argsText?: string; args?: Record<string, unknown>; result?: unknown; isError?: boolean };

function partsOf(mapped: ReturnType<typeof mapAiMessage>): readonly LoosePart[] {
  return mapped.content as unknown as readonly LoosePart[];
}

describe('tool call message mapping', () => {
  it('emits a tool-call part carrying the raw arguments and result', () => {
    const tool = partsOf(mapAiMessage(message({ toolCalls: [call()] }))).find(part => part.type === 'tool-call');
    expect(tool).toBeDefined();
    expect(tool?.toolName).toBe('calculate');
    expect(tool?.argsText).toBe('{"expression":"6*7"}');
    expect(tool?.args).toEqual({ expression: '6*7' });
    expect(tool?.result).toBe('42');
    expect(tool?.isError).toBeUndefined();
  });

  it('orders reasoning, then tool calls, then the answer text', () => {
    const mapped = mapAiMessage(message({ thinking: 'thought', toolCalls: [call()] }));
    expect(partsOf(mapped).map(part => part.type)).toEqual(['reasoning', 'tool-call', 'text']);
  });

  it('marks failed and rejected calls as errors', () => {
    for (const status of ['failed', 'rejected'] as const) {
      const mapped = mapAiMessage(message({ toolCalls: [call({ status, result: undefined, error: 'denied' })] }));
      const tool = partsOf(mapped).find(part => part.type === 'tool-call');
      expect(tool?.isError).toBe(true);
    }
  });

  it('still renders a call whose argument record is malformed', () => {
    const mapped = mapAiMessage(message({ toolCalls: [call({ arguments: '{"expression":' })] }));
    const tool = partsOf(mapped).find(part => part.type === 'tool-call');
    expect(tool?.args).toEqual({});
    expect(tool?.argsText).toBe('{"expression":');
  });

  it('adds no tool part when the message has none', () => {
    expect(partsOf(mapAiMessage(message())).some(part => part.type === 'tool-call')).toBe(false);
  });

  it('never emits tool parts for a user message', () => {
    const mapped = mapAiMessage(message({ role: 'user', toolCalls: [call()] }));
    expect(partsOf(mapped).some(part => part.type === 'tool-call')).toBe(false);
  });
});

describe('tool call event state machine', () => {
  function setup() {
    const changeConversation = vi.fn();
    const saveQuietly = vi.fn();
    const decideTool = vi.fn(async () => {});
    const { result } = renderHook(() => useToolCalls({ changeConversation, saveQuietly, backend: { decideTool } }));
    return { changeConversation, saveQuietly, decideTool, apply: result.current.handleEvent, result };
  }

  it('upserts by call id instead of appending duplicates', () => {
    const { changeConversation, apply } = setup();
    const chat: AiConversation = {
      id: 'c1', assistantId: 'a1', title: 't', systemPrompt: '', parameters: { historyRounds: 20 },
      messages: [message({ status: 'streaming' })], draft: '', draftAttachments: [], approvedTargets: [], updatedAt: 0,
    };
    changeConversation.mockImplementation((_id: string, updater: (value: AiConversation) => AiConversation) => {
      Object.assign(chat, updater(chat));
    });
    apply(event(), 'c1', 'reply-1');
    apply(event({ type: 'tool_result', status: 'complete', result: '42', durationMs: 12 }), 'c1', 'reply-1');
    const calls = chat.messages[0].toolCalls ?? [];
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ id: 'call-1', name: 'calculate', status: 'complete', result: '42', durationMs: 12 });
    expect(calls[0].arguments).toBe('{"expression":"6*7"}');
  });

  it('keeps separate calls distinct and records failures', () => {
    const { changeConversation, apply } = setup();
    const chat: AiConversation = {
      id: 'c1', assistantId: 'a1', title: 't', systemPrompt: '', parameters: { historyRounds: 20 },
      messages: [message({ status: 'streaming' })], draft: '', draftAttachments: [], approvedTargets: [], updatedAt: 0,
    };
    changeConversation.mockImplementation((_id: string, updater: (value: AiConversation) => AiConversation) => {
      Object.assign(chat, updater(chat));
    });
    apply(event(), 'c1', 'reply-1');
    apply(event({ callId: 'call-2', name: 'get_current_time', arguments: '{}' }), 'c1', 'reply-1');
    apply(event({ type: 'tool_result', callId: 'call-2', status: 'failed', error: '未知工具' }), 'c1', 'reply-1');
    const calls = chat.messages[0].toolCalls ?? [];
    expect(calls.map(item => item.id)).toEqual(['call-1', 'call-2']);
    expect(calls[1]).toMatchObject({ status: 'failed', error: '未知工具' });
    expect(calls[0].status).toBe('pending');
  });

  it('ignores events without a call id and unrelated event types', () => {
    const { changeConversation, apply } = setup();
    apply(event({ callId: undefined }), 'c1', 'reply-1');
    apply(event({ type: 'delta', text: 'hi' }), 'c1', 'reply-1');
    apply(event({ type: 'metadata' }), 'c1', 'reply-1');
    expect(changeConversation).not.toHaveBeenCalled();
  });

  it('leaves other messages untouched', () => {
    const { changeConversation, apply } = setup();
    const chat: AiConversation = {
      id: 'c1', assistantId: 'a1', title: 't', systemPrompt: '', parameters: { historyRounds: 20 },
      messages: [message({ id: 'other', content: 'keep' }), message({ status: 'streaming' })],
      draft: '', draftAttachments: [], approvedTargets: [], updatedAt: 0,
    };
    changeConversation.mockImplementation((_id: string, updater: (value: AiConversation) => AiConversation) => {
      Object.assign(chat, updater(chat));
    });
    apply(event(), 'c1', 'reply-1');
    expect(chat.messages[0].toolCalls).toBeUndefined();
    expect(chat.messages[0].content).toBe('keep');
    expect(chat.messages[1].toolCalls).toHaveLength(1);
  });
});

describe('tool approval gate', () => {
  function setup() {
    const changeConversation = vi.fn();
    const saveQuietly = vi.fn();
    const decideTool = vi.fn(async () => {});
    const { result } = renderHook(() => useToolCalls({ changeConversation, saveQuietly, backend: { decideTool } }));
    return { changeConversation, decideTool, result };
  }

  const approval = event({
    type: 'approval_required', callId: 'call-7', name: 'fetch_url',
    arguments: '{"url":"https://example.com/a"}', url: 'https://example.com/a', provenance: 'modelProposed',
  });

  it('surfaces the verbatim URL and its provenance for verification', () => {
    const { changeConversation, result } = setup();
    act(() => result.current.handleEvent(approval, 'c1', 'reply-1'));
    expect(result.current.pendingApproval?.callId).toBe('call-7');
    expect(result.current.pendingApproval?.url).toBe('https://example.com/a');
    expect(result.current.pendingApproval?.provenance).toBe('modelProposed');
    const updater = changeConversation.mock.calls[0][1] as (chat: AiConversation) => AiConversation;
    const chat: AiConversation = {
      id: 'c1', assistantId: 'a1', title: 't', systemPrompt: '', parameters: { historyRounds: 20 },
      messages: [message({ status: 'streaming' })], draft: '', draftAttachments: [], approvedTargets: [], updatedAt: 0,
    };
    const recorded = updater(chat).messages[0].toolCalls?.[0];
    expect(recorded?.url).toBe('https://example.com/a');
    expect(recorded?.provenance).toBe('modelProposed');
  });

  it('sends approve and reject decisions and closes the dialog', async () => {
    for (const decision of ['approved', 'rejected'] as const) {
      const { decideTool, result } = setup();
      act(() => result.current.handleEvent(approval, 'c1', 'reply-1'));
      await act(async () => { await result.current.decide(decision); });
      expect(decideTool).toHaveBeenCalledWith('call-7', decision);
      expect(result.current.pendingApproval).toBeNull();
    }
  });

  it('offers no always-allow path: a second decide without a pending call is a no-op', async () => {
    const { decideTool, result } = setup();
    act(() => result.current.handleEvent(approval, 'c1', 'reply-1'));
    await act(async () => { await result.current.decide('approved'); });
    decideTool.mockClear();
    await act(async () => { await result.current.decide('approved'); });
    expect(decideTool).not.toHaveBeenCalled();
  });

  it('closing without deciding never approves the call', () => {
    const { decideTool, result } = setup();
    act(() => result.current.handleEvent(approval, 'c1', 'reply-1'));
    act(() => result.current.clear());
    expect(result.current.pendingApproval).toBeNull();
    expect(decideTool).not.toHaveBeenCalled();
  });

  it('a stale answer failing in Rust does not throw into the UI', async () => {
    const changeConversation = vi.fn();
    const decideTool = vi.fn(async () => { throw new Error('该调用已失效'); });
    const { result } = renderHook(() => useToolCalls({ changeConversation, saveQuietly: vi.fn(), backend: { decideTool } }));
    act(() => result.current.handleEvent(approval, 'c1', 'reply-1'));
    await act(async () => { await result.current.decide('approved'); });
    expect(result.current.pendingApproval).toBeNull();
  });
});