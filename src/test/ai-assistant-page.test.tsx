import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/i18n';
import type { AiRequest, AiStreamEvent, AiWorkspace } from '@/tools/ai-assistant/types';
import AiAssistantPage from '@/tools/ai-assistant';
import { holdAiUpdate } from '@/tools/ai-assistant/update-lock';
import { saveBytesWithFeedback } from '@/lib/file-save';

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
    fireEvent.click(screen.getByRole('button', { name: 'New assistant' }));
    const dialog = await screen.findByRole('dialog', { name: 'New assistant' });
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Assistant name' }), { target: { value: 'Reviewer' } });
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'System prompt' }), { target: { value: 'Review code' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect((screen.getByRole('combobox', { name: 'Assistant' }) as HTMLSelectElement).selectedOptions[0].textContent).toBe('Reviewer'));
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
    fireEvent.change(screen.getByRole('combobox', { name: 'Current model' }), { target: { value: 'second::model' } });
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
    await waitFor(() => expect(screen.getByRole('option', { name: 'Local test · new-model' })).toBeInTheDocument());
    expect(screen.queryByRole('option', { name: 'Local test · Test model' })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Local test · unused-model' })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save service' })).toBeEnabled());
  });

  it('keeps the conversation usable after generation fails', async () => {
    backend.generate.mockRejectedValue(new Error('Rate limited: try again later'));
    render(<AiAssistantPage />);
    const input = await screen.findByRole('textbox', { name: 'Message' });
    fireEvent.change(input, { target: { value: 'Retain this question' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(screen.getAllByText('Rate limited: try again later').length).toBeGreaterThan(0));
    expect(screen.getByRole('textbox', { name: 'Message' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Regenerate' })).toBeEnabled();
    expect(screen.getByRole('article', { name: 'User message' })).toHaveTextContent('Retain this question');
  });
});
