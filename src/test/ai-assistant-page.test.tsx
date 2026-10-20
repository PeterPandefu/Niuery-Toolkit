import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/i18n';
import type { AiRequest, AiStreamEvent, AiWorkspace } from '@/tools/ai-assistant/types';
import AiAssistantPage from '@/tools/ai-assistant';
import { holdAiUpdate } from '@/tools/ai-assistant/update-lock';
import { saveBytesWithFeedback } from '@/lib/file-save';
import { newConversation } from '@/tools/ai-assistant/model';

const backend = vi.hoisted(() => ({
  load: vi.fn(), save: vi.fn(), saveProvider: vi.fn(), removeProvider: vi.fn(), listModels: vi.fn(),
  testConnection: vi.fn(), generate: vi.fn(), cancel: vi.fn(), openDataDirectory: vi.fn(), reset: vi.fn(),
}));
vi.mock('@/tools/ai-assistant/backend', () => ({ desktopAiBackend: backend }));
vi.mock('@/lib/file-save', () => ({ saveBytesWithFeedback: vi.fn() }));

function workspace(configured = true): AiWorkspace {
  return {
    version: 1, providers: configured ? [{ id: 'provider', name: 'Local test', kind: 'ollama', baseUrl: 'http://127.0.0.1:11434', hasApiKey: false, enabled: true, models: [{ id: 'model', name: 'Test model', supportsImages: true }] }] : [],
    assistants: [{ id: 'assistant', name: 'General assistant', description: 'Ask a question', systemPrompt: 'Be helpful', providerId: 'provider', modelId: 'model', parameters: { historyRounds: 20 } }],
    conversations: [], activeAssistantId: 'assistant',
  };
}

beforeEach(async () => {
  vi.resetAllMocks();
  await i18n.changeLanguage('en');
  backend.load.mockResolvedValue(workspace()); backend.save.mockResolvedValue(undefined);
  backend.cancel.mockResolvedValue(undefined);
  backend.generate.mockImplementation(async (request: AiRequest, event: (event: AiStreamEvent) => void) => {
    const ids = { requestId: request.requestId, conversationId: request.conversationId, messageId: request.messageId };
    event({ ...ids, type: 'delta', text: 'Hello from test model' }); event({ ...ids, type: 'done' });
  });
});
afterEach(cleanup);

describe('AI assistant page', () => {
  it('sends a captured draft once after consent and keeps changes made while consent is open', async () => {
    const state = workspace(); const chat = newConversation(state.assistants[0]);
    chat.title = 'History'; chat.messages = [{ id: 'q', role: 'user', content: 'Old', attachments: [], status: 'complete', createdAt: 1 }, { id: 'a', role: 'assistant', content: 'Answer', attachments: [], status: 'complete', createdAt: 2 }];
    chat.approvedTargets = ['old-target']; state.conversations = [chat]; state.activeConversationId = chat.id; backend.load.mockResolvedValue(state);
    render(<AiAssistantPage />); const input = await screen.findByRole('textbox', { name: 'Message' });
    fireEvent.change(input, { target: { value: 'Captured' } }); fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    const dialog = await screen.findByRole('dialog', { name: 'Send history to this service?' });
    fireEvent.change(input, { target: { value: 'Next draft' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(backend.generate).toHaveBeenCalledTimes(1));
    const request = backend.generate.mock.calls[0][0] as AiRequest;
    expect(request.messages[request.messages.length - 1].content).toBe('Captured');
    expect(input).toHaveValue('Next draft');
  });
  it('keeps history and draft untouched when cross-service consent is cancelled', async () => {
    const state = workspace(); const chat = newConversation(state.assistants[0]);
    chat.messages = [{ id: 'q', role: 'user', content: 'Old question', attachments: [], status: 'complete', createdAt: 1 }];
    chat.approvedTargets = ['old']; chat.draft = 'Keep draft'; state.conversations = [chat]; state.activeConversationId = chat.id;
    backend.load.mockResolvedValue(state);
    render(<AiAssistantPage />); await screen.findByRole('textbox', { name: 'Message' });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    const dialog = await screen.findByRole('dialog', { name: 'Send history to this service?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('Keep draft');
    expect(screen.getAllByRole('article', { name: 'User message' })).toHaveLength(1);
    expect(backend.generate).not.toHaveBeenCalled();
  });
  it('reveals and scrolls to a search result outside the current history page', async () => {
    const state = workspace(); const chat = newConversation(state.assistants[0]); chat.title = 'Long history';
    chat.messages = Array.from({ length: 201 }, (_, index) => ({ id: `history-${index}`, role: 'assistant' as const, content: index === 0 ? 'Unique hidden target' : `History ${index}`, attachments: [], status: 'complete' as const, createdAt: index + 1 }));
    state.conversations = [chat]; state.activeConversationId = chat.id; backend.load.mockResolvedValue(state);
    const original = HTMLElement.prototype.scrollIntoView; const scroll = vi.fn(); HTMLElement.prototype.scrollIntoView = scroll;
    try {
      render(<AiAssistantPage />); await screen.findByRole('textbox', { name: 'Message' });
      expect(screen.queryByText('Unique hidden target')).not.toBeInTheDocument();
      fireEvent.change(screen.getByRole('textbox', { name: 'Search conversations' }), { target: { value: 'Unique hidden target' } });
      fireEvent.click(screen.getByRole('button', { name: 'Open conversation: Long history' }));
      await waitFor(() => expect(document.querySelector('[data-ai-message="history-0"]')).toHaveClass('ai-search-hit'));
      expect(scroll).toHaveBeenCalledWith({ block: 'center' });
    } finally { HTMLElement.prototype.scrollIntoView = original; }
  });
  it('uses each recorded model thinking preference for old replies and task results', async () => {
    const state = workspace();
    state.providers[0].models[0].showThinking = false;
    state.providers[0].models.push({ id: 'shown', name: 'Shown', supportsImages: false, showThinking: true });
    const chat = newConversation(state.assistants[0]);
    chat.modelId = 'shown'; chat.messages = [{ id: 'hidden', role: 'assistant', providerId: 'provider', modelId: 'model', content: 'Old answer', thinking: 'Hidden thought', attachments: [], status: 'complete', createdAt: 1 }];
    chat.tasks = [{ id: 't', kind: 'comparison', prompt: 'Test', createdAt: 1, results: [{ label: 'Hidden model', target: 'provider:http://localhost', message: { ...chat.messages[0], id: 'hidden-task' } }, { label: 'Shown model', target: 'provider:http://localhost', message: { ...chat.messages[0], id: 'shown-task', modelId: 'shown', thinking: 'Visible thought' } }] }];
    state.conversations = [chat]; state.activeConversationId = chat.id; backend.load.mockResolvedValue(state);
    render(<AiAssistantPage />);
    await screen.findByText('Shown model');
    expect(screen.getAllByRole('region', { name: 'Thinking' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Show thinking' }));
    expect(screen.getByText('Visible thought')).toBeVisible();
    expect(screen.queryByText('Hidden thought')).not.toBeInTheDocument();
  });
  it('forks an old question and keeps the entire original conversation', async () => {
    const state = workspace(); const chat = newConversation(state.assistants[0]); chat.title = 'Original';
    chat.messages = [{ id: 'q', role: 'user', content: 'Question', attachments: [], status: 'complete', createdAt: 1 }, { id: 'a', role: 'assistant', content: 'Answer', attachments: [], status: 'complete', createdAt: 2 }];
    state.conversations = [chat]; state.activeConversationId = chat.id; backend.load.mockResolvedValue(state);
    render(<AiAssistantPage />); await screen.findByText('Answer', { selector: '.ai-markdown p' });
    fireEvent.click(screen.getAllByRole('button', { name: 'Fork from here' })[0]);
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('Question');
    expect(screen.getByRole('button', { name: 'Open conversation: Original' })).toBeInTheDocument();
    expect(backend.generate).not.toHaveBeenCalled();
  });
  it('pins, archives and restores a conversation without deleting its contents', async () => {
    const state = workspace(); const chat = newConversation(state.assistants[0]); chat.title = 'Keep me';
    state.conversations = [chat]; state.activeConversationId = chat.id; backend.load.mockResolvedValue(state);
    render(<AiAssistantPage />);
    await screen.findByRole('textbox', { name: 'Message' });
    fireEvent.click(screen.getByRole('button', { name: 'Pin: Keep me' }));
    expect(screen.getByRole('button', { name: 'Unpin: Keep me' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Archive: Keep me' }));
    expect(screen.queryByRole('button', { name: 'Open conversation: Keep me' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show archived conversations' }));
    fireEvent.click(screen.getByRole('button', { name: 'Unarchive: Keep me' }));
    fireEvent.click(screen.getByRole('button', { name: 'Show active conversations' }));
    expect(screen.getByRole('button', { name: 'Open conversation: Keep me' })).toBeInTheDocument();
    await waitFor(() => expect(backend.save.mock.calls[backend.save.mock.calls.length - 1]?.[0].conversations[0]).toMatchObject({ pinned: true, archived: false, title: 'Keep me' }));
  });
  it('searches another assistant message and opens its conversation at the match', async () => {
    const state = workspace();
    state.assistants.push({ ...state.assistants[0], id: 'other', name: 'Other assistant' });
    const chat = newConversation(state.assistants[1]);
    chat.title = 'Database'; chat.messages = [{ id: 'match', role: 'assistant', content: 'UNIQUE constraint violation', status: 'complete', attachments: [], createdAt: 1 }];
    state.conversations = [chat]; backend.load.mockResolvedValue(state);
    render(<AiAssistantPage />);
    await screen.findByRole('textbox', { name: 'Message' });
    fireEvent.change(screen.getByRole('textbox', { name: 'Search conversations' }), { target: { value: 'unique' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Open conversation: Database' }));
    expect(screen.getByRole('combobox', { name: 'Assistant' })).toHaveValue('other');
    expect(screen.getByText('UNIQUE constraint violation', { selector: '.ai-markdown p' })).toBeInTheDocument();
  });
  it('quotes a reply into the draft without sending another request', async () => {
    render(<AiAssistantPage />);
    const input = await screen.findByRole('textbox', { name: 'Message' });
    fireEvent.change(input, { target: { value: 'Hello' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Quote message' }));
    expect(input).toHaveValue('> Hello from test model\n\n');
    expect(backend.generate).toHaveBeenCalledTimes(1);
  });
  it('groups assistant management under one settings button and supports dismissing it', async () => {
    render(<AiAssistantPage />);
    await screen.findByRole('textbox', { name: 'Message' });
    const trigger = screen.getByRole('button', { name: 'Assistant settings' });
    expect(screen.queryByRole('button', { name: 'New assistant' })).not.toBeInTheDocument();
    fireEvent.click(trigger);
    const actions = screen.getByRole('group', { name: 'Assistant actions' });
    expect(within(actions).getByRole('button', { name: 'New assistant' })).toHaveFocus();
    expect(within(actions).getByRole('button', { name: 'Edit assistant' })).toBeEnabled();
    expect(within(actions).getByRole('button', { name: 'Duplicate assistant' })).toBeEnabled();
    expect(within(actions).getByRole('button', { name: 'Delete assistant' })).toBeDisabled();
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(trigger);
    fireEvent.pointerDown(screen.getByRole('textbox', { name: 'Message' }));
    expect(screen.queryByRole('group', { name: 'Assistant actions' })).not.toBeInTheDocument();
  });

  it('keeps edit, duplicate and delete actions usable from assistant settings', async () => {
    render(<AiAssistantPage />);
    await screen.findByRole('textbox', { name: 'Message' });
    const trigger = screen.getByRole('button', { name: 'Assistant settings' });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('button', { name: 'Edit assistant' }));
    const editor = await screen.findByRole('dialog', { name: 'Edit assistant' });
    expect(within(editor).getByRole('textbox', { name: 'Assistant name' })).toHaveValue('General assistant');
    fireEvent.click(within(editor).getByRole('button', { name: 'Cancel' }));
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate assistant' }));
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Assistant' })).toHaveTextContent('General assistant copy'));
    expect(screen.queryByRole('group', { name: 'Assistant actions' })).not.toBeInTheDocument();
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('button', { name: 'Delete assistant' }));
    const confirmation = await screen.findByRole('dialog', { name: 'Delete assistant' });
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Transfer and delete assistant' }));
    await waitFor(() => expect(screen.queryByRole('option', { name: 'General assistant copy' })).not.toBeInTheDocument());
    expect(screen.getByRole('combobox', { name: 'Assistant' })).toHaveValue('assistant');
  });

  it('expands conversation search and restores the toolbar and visible history when creating a conversation', async () => {
    render(<AiAssistantPage />);
    await screen.findByRole('textbox', { name: 'Message' });
    const search = screen.getByRole('textbox', { name: 'Search conversations' });
    const create = screen.getByRole('button', { name: 'New conversation' });
    const tools = search.closest('.ai-conversation-tools');
    expect(tools).toContainElement(create);
    expect(tools).not.toHaveClass('is-searching');
    fireEvent.focus(search);
    fireEvent.change(search, { target: { value: 'no matching history' } });
    expect(tools).toHaveClass('is-searching');
    expect(screen.queryByRole('button', { name: /^Open conversation:/ })).not.toBeInTheDocument();
    fireEvent.click(create);
    expect(search).toHaveValue('');
    expect(tools).not.toHaveClass('is-searching');
    expect(screen.getAllByRole('button', { name: /^Open conversation:/ })).toHaveLength(1);
    fireEvent.click(search);
    expect(tools).toHaveClass('is-searching');
    fireEvent.click(create);
    expect(tools).not.toHaveClass('is-searching');
    expect(screen.getAllByRole('button', { name: /^Open conversation:/ })).toHaveLength(1);
  });

  it('opens an existing empty new conversation and preserves its draft and attachments', async () => {
    const value = workspace();
    const empty = { ...newConversation(value.assistants[0]), id: 'empty', draft: 'Unsent question', draftAttachments: [{ id: 'file', name: 'notes.txt', kind: 'text' as const, mimeType: 'text/plain', size: 5, data: 'notes' }] };
    const history = { ...newConversation(value.assistants[0]), id: 'history', title: 'Previous conversation', messages: [{ id: 'question', role: 'user' as const, content: 'Previous question', attachments: [], status: 'complete' as const, createdAt: 1 }] };
    value.conversations = [history, empty];
    value.activeConversationId = history.id;
    backend.load.mockResolvedValue(value);
    render(<AiAssistantPage />);
    const input = await screen.findByRole('textbox', { name: 'Message' });
    fireEvent.change(input, { target: { value: 'History draft' } });
    const search = screen.getByRole('textbox', { name: 'Search conversations' });
    fireEvent.change(search, { target: { value: 'Previous' } });
    fireEvent.click(screen.getByRole('button', { name: 'New conversation' }));
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('Unsent question');
    expect(screen.getByRole('button', { name: 'Remove attachment: notes.txt' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open conversation: 新会话' }).closest('.ai-conversation-row')).toHaveClass('is-active');
    expect(screen.getAllByRole('button', { name: /^Open conversation:/ })).toHaveLength(2);
    expect(search).toHaveValue('');
    fireEvent.click(screen.getByRole('button', { name: 'New conversation' }));
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('Unsent question');
    expect(screen.getAllByRole('button', { name: /^Open conversation:/ })).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Open conversation: Previous conversation' }));
    expect(input).toHaveValue('History draft');
  });

  it.each(['renamed', 'has messages', 'another assistant'] as const)('creates a new conversation when the empty candidate is %s', async kind => {
    const value = workspace();
    const current = { ...newConversation(value.assistants[0]), id: 'current', title: 'Current conversation' };
    const candidate = { ...newConversation(value.assistants[0]), id: 'candidate' };
    if (kind === 'renamed') candidate.title = 'Saved blank conversation';
    if (kind === 'has messages') candidate.messages = [{ id: 'question', role: 'user', content: '', attachments: [], status: 'failed', createdAt: 1 }];
    if (kind === 'another assistant') {
      value.assistants.push({ ...value.assistants[0], id: 'other', name: 'Other assistant' });
      candidate.assistantId = 'other';
    }
    value.conversations = [current, candidate];
    value.activeConversationId = current.id;
    backend.load.mockResolvedValue(value);
    render(<AiAssistantPage />);
    await screen.findByRole('textbox', { name: 'Message' });
    fireEvent.click(screen.getByRole('button', { name: 'New conversation' }));
    const rows = screen.getAllByRole('button', { name: /^Open conversation:/ });
    expect(rows).toHaveLength(kind === 'another assistant' ? 2 : 3);
    const active = rows.find(row => row.closest('.ai-conversation-row')?.classList.contains('is-active'));
    expect(active).toHaveAccessibleName('Open conversation: 新会话');
    expect(screen.getByRole('combobox', { name: 'Assistant' })).toHaveValue('assistant');
  });

  it('labels the icon-only model service settings control', async () => {
    render(<AiAssistantPage />);
    await screen.findByRole('textbox', { name: 'Message' });
    const settings = screen.getByRole('button', { name: 'Model service settings' });
    expect(settings).toHaveAttribute('title', 'Model service settings');
    expect(settings).toHaveTextContent('');
    fireEvent.click(settings);
    expect(await screen.findByRole('dialog', { name: 'Model service settings' })).toBeInTheDocument();
  });

  it('keeps model selection, parameters and working export controls in the message composer', async () => {
    render(<AiAssistantPage />);
    await screen.findByRole('textbox', { name: 'Message' });
    const composer = screen.getByRole('region', { name: 'Message composer' });
    expect(within(composer).getByRole('combobox', { name: 'Current model' })).toHaveValue('provider::model');
    fireEvent.click(within(composer).getByRole('button', { name: 'Conversation settings' }));
    const settings = await screen.findByRole('dialog', { name: 'Conversation settings' });
    fireEvent.change(within(settings).getByRole('spinbutton', { name: 'History rounds' }), { target: { value: '3' } });
    fireEvent.click(within(settings).getByRole('button', { name: 'Save' }));
    fireEvent.change(within(composer).getByRole('textbox', { name: 'Message' }), { target: { value: 'Export this conversation' } });
    fireEvent.click(within(composer).getByRole('button', { name: 'Send' }));
    await screen.findByText('Hello from test model');
    expect(backend.generate.mock.calls[0][0].parameters.historyRounds).toBe(3);
    fireEvent.click(within(composer).getByRole('button', { name: 'Export conversation' }));
    fireEvent.click(within(composer).getByRole('button', { name: 'JSON' }));
    await waitFor(() => expect(saveBytesWithFeedback).toHaveBeenCalledWith('Export this conversation.json', expect.any(Blob), 'JSON', ['json']));
    expect(screen.queryByRole('group', { name: 'Export format' })).not.toBeInTheDocument();
  });

  it('dismisses export options with Escape and outside clicks and restores keyboard focus', async () => {
    render(<AiAssistantPage />);
    await screen.findByRole('textbox', { name: 'Message' });
    const trigger = screen.getByRole('button', { name: 'Export conversation' });
    fireEvent.click(trigger);
    expect(screen.getByRole('button', { name: 'Markdown' })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(screen.queryByRole('group', { name: 'Export format' })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    fireEvent.click(trigger);
    fireEvent.pointerDown(screen.getByRole('textbox', { name: 'Message' }));
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });
  it('blocks an AI page opened during an update and resumes when the download fails', async () => {
    backend.load.mockResolvedValue(workspace(false));
    const release = holdAiUpdate();
    render(<AiAssistantPage />);
    try {
      await act(async () => {});
      expect(screen.queryByRole('textbox', { name: 'Message' })).not.toBeInTheDocument();
      expect(backend.generate).not.toHaveBeenCalled();
    } finally { act(release); }
    expect(await screen.findByRole('button', { name: 'Configure model service' })).toBeEnabled();
    expect(screen.getByRole('textbox', { name: 'Message' })).toBeEnabled();
  });
  it('opens a usable default conversation after reset waits for its durable save', async () => {
    render(<AiAssistantPage />);
    await screen.findByRole('textbox', { name: 'Message' });
    fireEvent.click(screen.getByRole('button', { name: 'Model service settings' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reset AI assistant data' }));
    const confirmation = await screen.findByRole('dialog', { name: 'Reset AI assistant?' });
    let finishSave: (() => void) | undefined;
    backend.save.mockImplementation(() => new Promise<void>(resolve => { finishSave = resolve; }));
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Confirm deletion' }));
    await waitFor(() => expect(finishSave).toBeDefined());
    backend.save.mockResolvedValue(undefined);
    await act(async () => { finishSave!(); });
    expect(await screen.findByRole('button', { name: 'Configure model service' })).toBeEnabled();
    expect(screen.getByRole('textbox', { name: 'Message' })).toBeEnabled();
    expect(backend.generate).not.toHaveBeenCalled();
  });
  it('offers local setup without contacting a model when no provider is configured', async () => {
    backend.load.mockResolvedValue(workspace(false));
    render(<AiAssistantPage />);
    await screen.findByRole('button', { name: 'Configure model service' });
    expect(backend.generate).not.toHaveBeenCalled();
    expect(backend.listModels).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Configure model service' }));
    expect(await screen.findByRole('dialog', { name: 'Model service settings' })).toBeInTheDocument();
  });

  it('creates conversations, sends a message and retains a draft when switching', async () => {
    render(<AiAssistantPage />);
    const input = await screen.findByRole('textbox', { name: 'Message' });
    await waitFor(() => expect(input).toBeEnabled());
    fireEvent.change(input, { target: { value: 'First question' } });
    expect(input).toHaveValue('First question');
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(backend.generate).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Hello from test model')).toBeInTheDocument();
    fireEvent.change(input, { target: { value: 'unsent draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'New conversation' }));
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('');
    fireEvent.click(screen.getByRole('button', { name: 'Open conversation: First question' }));
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('unsent draft');
    expect(backend.generate).toHaveBeenCalledTimes(1);
  });

  it('does not submit an IME composition, and stops an active response', async () => {
    backend.generate.mockImplementation(() => new Promise(() => {}));
    render(<AiAssistantPage />);
    const input = await screen.findByRole('textbox', { name: 'Message' });
    fireEvent.change(input, { target: { value: '你好' } });
    fireEvent.compositionStart(input);
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', keyCode: 229, isComposing: true });
    expect(backend.generate).not.toHaveBeenCalled();
    fireEvent.compositionEnd(input);
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
    await waitFor(() => expect(backend.generate).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Stop generating' }));
    await waitFor(() => expect(backend.cancel).toHaveBeenCalledTimes(1));
  });

  it('confirms editing a sent message before replacing the following reply', async () => {
    render(<AiAssistantPage />);
    const input = await screen.findByRole('textbox', { name: 'Message' });
    fireEvent.change(input, { target: { value: 'Old question' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByText('Hello from test model');
    fireEvent.click(screen.getByRole('button', { name: 'Edit message' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Edit message content' }), { target: { value: 'Revised question' } });
    fireEvent.click(screen.getByRole('button', { name: 'Resend edited message' }));
    const dialog = await screen.findByRole('dialog', { name: 'Replace following messages?' });
    expect(backend.generate).toHaveBeenCalledTimes(1);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(backend.generate).toHaveBeenCalledTimes(2));
    expect(screen.getByText('Revised question')).toBeInTheDocument();
    expect(within(screen.getByRole('article', { name: 'User message' })).queryByText('Old question')).not.toBeInTheDocument();
  });

  it('creates and selects a custom assistant without changing existing conversations', async () => {
    render(<AiAssistantPage />);
    await screen.findByRole('textbox', { name: 'Message' });
    fireEvent.click(screen.getByRole('button', { name: 'Assistant settings' }));
    fireEvent.click(screen.getByRole('button', { name: 'New assistant' }));
    const dialog = await screen.findByRole('dialog', { name: 'New assistant' });
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Assistant name' }), { target: { value: 'Reviewer' } });
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'System prompt' }), { target: { value: 'Review code' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Assistant' })).toHaveTextContent('Reviewer'));
    fireEvent.click(screen.getByRole('combobox', { name: 'Assistant' }));
    expect(screen.getByRole('option', { name: 'Reviewer' })).toBeInTheDocument();
  });

  it('renders model Markdown without requesting remote images or executing HTML', async () => {
    const value = workspace();
    value.conversations = [{ id: 'chat', assistantId: 'assistant', title: 'Safety', systemPrompt: '', parameters: { historyRounds: 20 }, messages: [{ id: 'reply', role: 'assistant', content: '<script>alert(1)</script>\n![track](https://example.com/track.png)\n```js\nconsole.log(1)\n```', attachments: [], status: 'complete', createdAt: Date.now() }], draft: '', draftAttachments: [], approvedTargets: [], updatedAt: Date.now() }];
    value.activeConversationId = 'chat'; backend.load.mockResolvedValue(value);
    const { container } = render(<AiAssistantPage />);
    await waitFor(() => expect(container.querySelector('code')?.textContent).toContain('console.log(1)'));
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img[src^="https:"]')).toBeNull();
    expect(screen.getByRole('button', { name: 'Copy code' })).toBeInTheDocument();
    await act(async () => {});
  });

  it('saves API keys through the credential boundary and adds a model without probing the network', async () => {
    backend.load.mockResolvedValue(workspace(false));
    backend.saveProvider.mockImplementation(async provider => ({ ...provider, hasApiKey: true }));
    render(<AiAssistantPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Configure model service' }));
    const dialog = screen.getByRole('dialog', { name: 'Model service settings' });
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Service name' }), { target: { value: 'My API' } });
    fireEvent.change(within(dialog).getByLabelText('API Key'), { target: { value: 'test-secret-only' } });
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Manual model ID' }), { target: { value: 'custom-model' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save service' }));
    await waitFor(() => expect(backend.saveProvider).toHaveBeenCalledWith(expect.objectContaining({ name: 'My API', models: [expect.objectContaining({ id: 'custom-model', supportsImages: false })] }), 'test-secret-only'));
    expect(backend.listModels).not.toHaveBeenCalled();
    expect(backend.testConnection).not.toHaveBeenCalled();
    expect(JSON.stringify(backend.save.mock.calls)).not.toContain('test-secret-only');
    await waitFor(() => expect(within(dialog).getByLabelText('API Key')).toHaveValue(''));
  });

  it('requests consent before a different service receives existing messages', async () => {
    const value = workspace();
    value.providers.push({ ...value.providers[0], id: 'second', name: 'Second service', baseUrl: 'https://new-service.test/v1' });
    backend.load.mockResolvedValue(value);
    render(<AiAssistantPage />);
    const input = await screen.findByRole('textbox', { name: 'Message' });
    fireEvent.change(input, { target: { value: 'Existing history' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByText('Hello from test model');
    fireEvent.click(screen.getByRole('combobox', { name: 'Current model' }));
    fireEvent.click(within(screen.getByRole('listbox', { name: 'Current model' })).getAllByRole('option', { name: 'Test model' })[1]);
    fireEvent.change(input, { target: { value: 'Next question' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    const dialog = await screen.findByRole('dialog', { name: 'Send history to this service?' });
    expect(backend.generate).toHaveBeenCalledTimes(1);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(backend.generate).toHaveBeenCalledTimes(2));
    expect(backend.generate.mock.calls[1][0].providerId).toBe('second');
  });

  it('offers only explicitly enabled models in the chat selector after fetching and saving', async () => {
    backend.saveProvider.mockImplementation(async provider => provider);
    backend.listModels.mockResolvedValue([
      { id: 'new-model', name: 'new-model', supportsImages: false },
      { id: 'unused-model', name: 'unused-model', supportsImages: false },
    ]);
    render(<AiAssistantPage />);
    await screen.findByRole('textbox', { name: 'Message' });
    fireEvent.click(screen.getByRole('button', { name: 'Model service settings' }));
    fireEvent.click(screen.getByRole('button', { name: 'Fetch models' }));
    const picker = await screen.findByRole('dialog', { name: 'Choose enabled models' });
    fireEvent.click(within(picker).getByRole('button', { name: 'Clear selection' }));
    fireEvent.click(within(picker).getByRole('checkbox', { name: 'Enable model: new-model' }));
    fireEvent.click(within(picker).getByRole('button', { name: 'Apply selection' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save service' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save service' })).toBeEnabled());
  });

  it('keeps the conversation usable after generation fails', async () => {
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Model service settings' })).getByRole('button', { name: 'Close' }));
    fireEvent.click(screen.getByRole('combobox', { name: 'Current model' }));
    expect(screen.getByRole('option', { name: 'new-model' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Test model' })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'unused-model' })).not.toBeInTheDocument();
    backend.generate.mockRejectedValue(new Error('Rate limited: try again later'));
    render(<AiAssistantPage />);
    const input = await screen.findByRole('textbox', { name: 'Message' });
    fireEvent.change(input, { target: { value: 'Retain this question' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(screen.getAllByText('Rate limited: try again later').length).toBeGreaterThan(0));
    expect(screen.getByRole('textbox', { name: 'Message' })).toBeEnabled();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Regenerate' })).toBeEnabled());
    expect(screen.getByRole('article', { name: 'User message' })).toHaveTextContent('Retain this question');
  });
});
