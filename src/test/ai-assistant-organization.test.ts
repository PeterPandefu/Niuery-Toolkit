import { describe, expect, it } from 'vitest';
import { searchConversations, quoteDraft, applyTemplate, templateVariables } from '@/tools/ai-assistant/organization';
import { createWorkspace, newConversation } from '@/tools/ai-assistant/model';

describe('AI conversation organization', () => {
  it('searches across assistants and returns a message location and matching excerpt', () => {
    const workspace = createWorkspace();
    const chat = { ...newConversation(workspace.assistants[1]), title: 'Database', messages: [{ id: 'm1', role: 'assistant' as const, content: 'The UNIQUE constraint is violated', attachments: [], createdAt: 1, status: 'complete' as const }] };
    const matches = searchConversations([chat], 'unique', workspace.assistants[0].id, false);
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ conversation: { id: chat.id }, messageId: 'm1', excerpt: 'The UNIQUE constraint is violated' });
  });
  it('finds persisted model task answers and continuation summaries', () => {
    const assistant = createWorkspace().assistants[0];
    const chat = { ...newConversation(assistant), summary: 'Decision: PostgreSQL', tasks: [{ id: 'task', kind: 'comparison' as const, prompt: 'Compare databases', createdAt: 1, results: [{ label: 'A', target: 'p:http://localhost', message: { id: 'result', role: 'assistant' as const, content: 'SQLite uses a local file', attachments: [], status: 'complete' as const, createdAt: 1 } }] }] };
    expect(searchConversations([chat], 'SQLite', assistant.id, false)[0]).toMatchObject({ messageId: 'result', excerpt: 'SQLite uses a local file' });
    expect(searchConversations([chat], 'PostgreSQL', assistant.id, false)).toHaveLength(1);
  });
  it('keeps pinned chats first and separates archive browsing while searching both', () => {
    const assistant = createWorkspace().assistants[0];
    const old = { ...newConversation(assistant), id: 'old', title: 'Old', updatedAt: 1, pinned: true };
    const recent = { ...newConversation(assistant), id: 'new', title: 'New', updatedAt: 100 };
    const archived = { ...newConversation(assistant), id: 'archive', title: 'Archived', archived: true };
    expect(searchConversations([recent, archived, old], '', assistant.id, false).map(hit => hit.conversation.id)).toEqual(['old', 'new']);
    expect(searchConversations([recent, archived, old], '', assistant.id, true).map(hit => hit.conversation.id)).toEqual(['archive']);
    expect(searchConversations([archived], 'Archived', assistant.id, false)).toHaveLength(1);
  });
  it('inserts an editable Markdown quote without losing existing drafts', () => {
    expect(quoteDraft('My followup', 'First\nSecond')).toBe('My followup\n\n> First\n> Second\n\n');
    expect(quoteDraft('', 'quoted')).toBe('> quoted\n\n');
  });
  it('requires every unique template variable and never recursively substitutes supplied content', () => {
    expect(templateVariables('Translate {{text}} into {{language}}. {{text}}')).toEqual(['text', 'language']);
    expect(() => applyTemplate('Translate {{text}}', {})).toThrow(/text/);
    expect(applyTemplate('Translate {{text}} into {{language}}', { text: '{{language}}', language: 'English' })).toBe('Translate {{language}} into English');
  });
});
