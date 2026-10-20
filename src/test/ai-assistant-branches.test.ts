import { describe, expect, it } from 'vitest';
import { forkConversation, retainAnswerVersion, selectAnswerVersion, continueFromSummary, summarySource } from '@/tools/ai-assistant/branches';
import { createWorkspace, newConversation } from '@/tools/ai-assistant/model';
import type { AiMessage } from '@/tools/ai-assistant/types';

const msg = (id: string, role: AiMessage['role'], content: string): AiMessage => ({ id, role, content, attachments: [], status: 'complete', createdAt: 1 });
const chat = () => ({ ...newConversation(createWorkspace().assistants[0]), messages: [msg('u1', 'user', 'Question'), msg('a1', 'assistant', 'Answer'), msg('u2', 'user', 'Followup'), msg('a2', 'assistant', 'Followup answer')] });

describe('AI branches and continuation', () => {
  it('keeps thinking with each answer version and clears it when the chosen version has none', () => {
    const first = { ...msg('a', 'assistant', 'First'), thinking: 'First thought' };
    const next = retainAnswerVersion(first, msg('a', 'assistant', 'Second'));
    expect(selectAnswerVersion(next, 0).thinking).toBe('First thought');
    expect(selectAnswerVersion(selectAnswerVersion(next, 0), 1).thinking).toBeUndefined();
  });
  it('forks at a user question with independent attachments and clears target approvals', () => {
    const original = chat(); original.approvedTargets = ['approved'];
    original.messages[0].attachments = [{ id: 'f', name: 'a.txt', kind: 'text', mimeType: 'text/plain', data: 'a', size: 1 }];
    const fork = forkConversation(original, 'u1');
    expect(fork.id).not.toBe(original.id);
    expect(fork.parentConversationId).toBe(original.id);
    expect(fork.messages).toEqual([]);
    expect(fork.draft).toBe('Question');
    expect(fork.approvedTargets).toEqual([]);
    fork.draftAttachments[0].data = 'changed';
    expect(original.messages[0].attachments[0].data).toBe('a');
    expect(original.messages).toHaveLength(4);
  });
  it('forks after an answer without retaining later messages and rejects unknown IDs', () => {
    const original = chat();
    expect(forkConversation(original, 'a1').messages.map(message => message.id)).toEqual(['u1', 'a1']);
    expect(() => forkConversation(original, 'missing')).toThrow(/消息/);
  });
  it('retains every successful answer and switches versions without losing alternatives', () => {
    const first = msg('a', 'assistant', 'First');
    const second = retainAnswerVersion(first, { ...first, content: 'Second' });
    const third = retainAnswerVersion(second, { ...second, content: 'Third' });
    expect(third.versions?.map(version => version.content)).toEqual(['First', 'Second', 'Third']);
    const selected = selectAnswerVersion(third, 0);
    expect(selected.content).toBe('First');
    expect(selected.versions).toHaveLength(3);
    expect(() => selectAnswerVersion(third, 8)).toThrow(/版本/);
  });
  it('clears metadata absent from a restored older answer version', () => {
    const answer = JSON.parse(JSON.stringify(retainAnswerVersion(msg('a', 'assistant', 'First'), { ...msg('a', 'assistant', 'Second'), finishReason: 'length', usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 }, durationMs: 500 })));
    const selected = selectAnswerVersion(answer, 0);
    expect(selected.finishReason).toBeUndefined(); expect(selected.usage).toBeUndefined(); expect(selected.durationMs).toBeUndefined();
  });
  it('creates an empty conversation with an editable summary while preserving the source', () => {
    const original = chat(); const next = continueFromSummary(original, 'Decided to use SQLite');
    expect(next.summary).toBe('Decided to use SQLite');
    expect(next.messages).toEqual([]);
    expect(next.parentConversationId).toBe(original.id);
    expect(original.messages).toHaveLength(4);
    expect(() => continueFromSummary(original, '   ')).toThrow(/摘要/);
  });
  it('does not copy old task results into a fork or summary continuation', () => {
    const original = { ...chat(), tasks: [{ id: 'task', kind: 'summary' as const, prompt: 'Old input', createdAt: 1, results: [] }] };
    expect(forkConversation(original, 'u1').tasks ?? []).toEqual([]);
    expect(continueFromSummary(original, 'Keep decision').tasks ?? []).toEqual([]);
  });
  it('summarizes only complete rounds from a visible selected range', () => {
    const original = chat(); original.messages[3].status = 'failed';
    expect(summarySource(original, 20)).toContain('Question');
    expect(summarySource(original, 20)).not.toContain('Followup');
    expect(summarySource(chat(), 1)).toContain('Followup answer');
    expect(summarySource(chat(), 1)).not.toContain('Question');
  });
});
