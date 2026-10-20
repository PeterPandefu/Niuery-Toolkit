import { describe, expect, it } from 'vitest';
import { buildBudgetedContext, effectiveParameters } from '@/tools/ai-assistant/context';
import { createWorkspace, newConversation } from '@/tools/ai-assistant/model';
import type { AiMessage, AiModel } from '@/tools/ai-assistant/types';

const msg = (id: string, role: AiMessage['role'], content: string): AiMessage => ({ id, role, content, attachments: [], status: 'complete', createdAt: 1 });
const model: AiModel = { id: 'm', name: 'Model', supportsImages: false, contextWindow: 100, maxOutputTokens: 20 };
const chat = () => ({ ...newConversation(createWorkspace().assistants[0]), systemPrompt: '', messages: [msg('u1', 'user', 'x'.repeat(200)), msg('a1', 'assistant', 'x'.repeat(200)), msg('u2', 'user', 'Hello')] });

describe('AI context budget', () => {
  it('includes continuation summary in the request and budget', () => {
    const result = buildBudgetedContext({ ...chat(), summary: 'Decided on SQLite' });
    expect(result.systemPrompt).toContain('Decided on SQLite');
    expect(result.inputTokens).toBeGreaterThan(buildBudgetedContext(chat()).inputTokens);
    expect(() => buildBudgetedContext({ ...chat(), summary: 'x'.repeat(1000) }, model)).toThrow(/上下文/);
  });
  it('removes oldest complete rounds while preserving the current question and local history', () => {
    const value = chat();
    const result = buildBudgetedContext(value, model);
    expect(result.messages.map(message => message.id)).toEqual(['u2']);
    expect(result.droppedRounds).toBe(1);
    expect(result.inputTokens + result.reservedOutputTokens).toBeLessThanOrEqual(100);
    expect(value.messages).toHaveLength(3);
  });
  it('rejects an oversized current question without dropping or truncating it', () => {
    const value = { ...chat(), messages: [msg('u', 'user', 'x'.repeat(1000))] };
    expect(() => buildBudgetedContext(value, model)).toThrow(/上下文|context/);
    expect(value.messages[0].content).toHaveLength(1000);
  });
  it('excludes complete rounds explicitly and counts text attachments', () => {
    const value = { ...chat(), excludedMessageIds: ['a1'] };
    expect(buildBudgetedContext(value).messages.map(message => message.id)).toEqual(['u2']);
    value.messages[2].attachments = [{ id: 'f', name: 'large.txt', kind: 'text', mimeType: 'text/plain', data: 'x'.repeat(1000), size: 1000 }];
    expect(() => buildBudgetedContext(value, model)).toThrow(/上下文|context/);
  });
  it('keeps unknown context capacity explicit and honors output and temperature capabilities', () => {
    expect(buildBudgetedContext(chat()).contextWindow).toBeUndefined();
    expect(effectiveParameters({ historyRounds: 20, temperature: 0.5, maxOutputTokens: 500 }, { ...model, supportsTemperature: false })).toEqual({ historyRounds: 20, maxOutputTokens: 20 });
  });
  it('sends the output reservation as an enforced limit when model capacity is known', () => {
    const budget = buildBudgetedContext({ ...chat(), messages: [msg('u', 'user', 'Hello')] }, { ...model, maxOutputTokens: undefined });
    expect(budget.reservedOutputTokens).toBe(25);
    expect(budget.parameters.maxOutputTokens).toBe(25);
  });
  it('rejects invalid configured model capacities before starting a request', () => {
    expect(() => buildBudgetedContext(chat(), { ...model, contextWindow: -1 })).toThrow(/容量/);
    expect(() => buildBudgetedContext(chat(), { ...model, maxOutputTokens: 0 })).toThrow(/容量/);
  });
  it('includes system prompt and output reservation when checking capacity', () => {
    expect(() => buildBudgetedContext({ ...chat(), systemPrompt: 'x'.repeat(1000) }, model)).toThrow(/上下文|context/);
  });
});
