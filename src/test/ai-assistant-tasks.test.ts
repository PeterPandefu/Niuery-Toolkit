import { describe, expect, it } from 'vitest';
import { createComparisonTask, createSummaryTask } from '@/tools/ai-assistant/tasks';
import { createWorkspace, newConversation } from '@/tools/ai-assistant/model';
import type { AiProvider } from '@/tools/ai-assistant/types';

const providers: AiProvider[] = [{ id: 'p', name: 'API', kind: 'openai', baseUrl: 'http://localhost/v1', hasApiKey: false, enabled: true, models: [{ id: 'a', name: 'A', supportsImages: false }, { id: 'b', name: 'B', supportsImages: false }] }];
function chat() { const value = newConversation(createWorkspace().assistants[0]); value.systemPrompt = ''; value.draft = 'Compare this question'; return value; }

describe('AI isolated task requests', () => {
  it('uses identical context for every comparison and keeps a durable snapshot of all destinations', () => {
    const value = chat();
    const task = createComparisonTask(value, providers, [{ providerId: 'p', modelId: 'a' }, { providerId: 'p', modelId: 'b' }]);
    expect(task.requests).toHaveLength(2);
    expect(task.requests[0].messages).toEqual(task.requests[1].messages);
    expect(task.requests[0].messages[0].content).toBe('Compare this question');
    expect(task.results.map(result => result.message.modelId)).toEqual(['a', 'b']);
    expect(task.targets).toEqual(['p:http://localhost/v1']);
    task.requests[0].messages[0].content = 'changed';
    expect(value.draft).toBe('Compare this question');
  });
  it('rejects missing, duplicate or too few model selections before any request', () => {
    expect(() => createComparisonTask(chat(), providers, [{ providerId: 'p', modelId: 'a' }])).toThrow(/2/);
    expect(() => createComparisonTask(chat(), providers, [{ providerId: 'p', modelId: 'a' }, { providerId: 'p', modelId: 'a' }])).toThrow(/重复/);
    expect(() => createComparisonTask(chat(), providers, [{ providerId: 'p', modelId: 'a' }, { providerId: 'p', modelId: 'missing' }])).toThrow(/模型/);
  });
  it('applies the strictest capacity once so comparison models receive equal history', () => {
    const value = chat();
    value.messages = [{ id: 'q', role: 'user', content: 'x'.repeat(200), status: 'complete', attachments: [], createdAt: 1 }, { id: 'a', role: 'assistant', content: 'x'.repeat(200), status: 'complete', attachments: [], createdAt: 2 }];
    const services = structuredClone(providers); services[0].models[1].contextWindow = 100; services[0].models[1].maxOutputTokens = 20;
    const task = createComparisonTask(value, services, [{ providerId: 'p', modelId: 'a' }, { providerId: 'p', modelId: 'b' }]);
    expect(task.requests[0].messages.map(message => message.content)).toEqual(['Compare this question']);
    expect(task.requests[1].messages).toEqual(task.requests[0].messages);
  });
  it('summarizes only the selected complete rounds and refuses an empty source', () => {
    const value = chat(); value.providerId = 'p'; value.modelId = 'a';
    expect(() => createSummaryTask(value, providers, 20)).toThrow(/完整/);
    value.messages = [{ id: 'q', role: 'user', content: 'Decision?', status: 'complete', attachments: [], createdAt: 1 }, { id: 'a', role: 'assistant', content: 'Use SQLite.', status: 'complete', attachments: [], createdAt: 2 }];
    const task = createSummaryTask(value, providers, 1);
    expect(task.requests[0].messages[0].content).toContain('Use SQLite.');
    expect(task.requests[0].messages).toHaveLength(1);
    expect(task.kind).toBe('summary');
  });
  it('preserves the previous continuation summary when generating another summary', () => {
    const value = chat(); value.providerId = 'p'; value.modelId = 'a'; value.summary = 'Earlier decision: use SQLite';
    value.messages = [{ id: 'q', role: 'user', content: 'Next?', status: 'complete', attachments: [], createdAt: 1 }, { id: 'a', role: 'assistant', content: 'Add backups', status: 'complete', attachments: [], createdAt: 2 }];
    expect(createSummaryTask(value, providers, 1).requests[0].messages[0].content).toContain('Earlier decision: use SQLite');
  });
});
