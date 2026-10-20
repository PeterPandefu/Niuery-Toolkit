import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import i18n from '@/i18n';
import AiAssistantPage from '@/tools/ai-assistant';
import type { AiWorkspace } from '@/tools/ai-assistant/types';
const backend = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn(), generate: vi.fn(), cancel: vi.fn(async () => {}) }));
vi.mock('@/tools/ai-assistant/backend', () => ({ desktopAiBackend: backend }));
beforeEach(async () => { await i18n.changeLanguage('en'); vi.clearAllMocks(); backend.save.mockResolvedValue(undefined); }); afterEach(cleanup);

it('continues with the user edited generated summary and excludes previous task results', async () => {
  const state: AiWorkspace = { version: 1, providers: [], assistants: [{ id: 'a', name: 'Assistant', description: '', systemPrompt: '', parameters: { historyRounds: 20 } }], activeAssistantId: 'a', activeConversationId: 'chat', conversations: [{ id: 'chat', title: 'Original', assistantId: 'a', systemPrompt: '', parameters: { historyRounds: 20 }, messages: [], draft: '', draftAttachments: [], approvedTargets: [], updatedAt: 1, tasks: [{ id: 'task', kind: 'summary', createdAt: 1, prompt: 'Source', results: [{ label: 'A', target: 'p:http://localhost', message: { id: 'result', role: 'assistant', content: 'Generated summary', status: 'complete', attachments: [], createdAt: 1 } }] }] }] };
  backend.load.mockResolvedValue(state);
  render(<AiAssistantPage />);
  fireEvent.click(await screen.findByRole('button', { name: 'Edit summary and continue' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Editable summary' }), { target: { value: 'User corrected summary' } });
  fireEvent.click(screen.getByRole('button', { name: 'Continue with summary' }));
  await waitFor(() => {
    const saved = backend.save.mock.calls[backend.save.mock.calls.length - 1]?.[0] as AiWorkspace;
    expect(saved.conversations.find(chat => chat.id === saved.activeConversationId)?.summary).toBe('User corrected summary');
  });
  expect(screen.queryByRole('region', { name: 'Summary results' })).not.toBeInTheDocument();
});

it('follows task streaming until the user scrolls up', async () => {
  const state: AiWorkspace = { version: 1, providers: [{ id: 'p', name: 'API', kind: 'openai', baseUrl: 'http://localhost', hasApiKey: false, enabled: true, models: [{ id: 'a', name: 'A', supportsImages: false }, { id: 'b', name: 'B', supportsImages: false }] }], assistants: [{ id: 'assistant', name: 'Assistant', description: '', systemPrompt: '', parameters: { historyRounds: 20 } }], activeAssistantId: 'assistant', activeConversationId: 'chat', conversations: [{ id: 'chat', title: 'Original', assistantId: 'assistant', systemPrompt: '', parameters: { historyRounds: 20 }, messages: [], draft: 'Compare', draftAttachments: [], approvedTargets: [], updatedAt: 1 }] };
  backend.load.mockResolvedValue(state);
  let emit: ((event: import('@/tools/ai-assistant/types').AiStreamEvent) => void) | undefined;
  let request: import('@/tools/ai-assistant/types').AiRequest | undefined;
  backend.generate.mockImplementation((value, callback) => { request = value; emit = callback; return new Promise(() => {}); });
  const { container } = render(<AiAssistantPage />);
  fireEvent.click(await screen.findByRole('button', { name: 'Compare models' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'API · A' })); fireEvent.click(screen.getByRole('checkbox', { name: 'API · B' }));
  fireEvent.click(screen.getByRole('button', { name: 'Prepare comparison' })); fireEvent.click(screen.getByRole('button', { name: 'Confirm and generate' }));
  await waitFor(() => expect(request).toBeDefined());
  const scroller = container.querySelector('.ai-messages') as HTMLElement;
  Object.defineProperty(scroller, 'scrollHeight', { configurable: true, value: 1000 }); Object.defineProperty(scroller, 'clientHeight', { configurable: true, value: 200 });
  const { act } = await import('@testing-library/react');
  await act(async () => { emit!({ requestId: request!.requestId, conversationId: request!.conversationId, messageId: request!.messageId, type: 'delta', text: 'First' }); });
  await waitFor(() => expect(scroller.scrollTop).toBe(1000));
  scroller.scrollTop = 10; fireEvent.scroll(scroller);
  await act(async () => { emit!({ requestId: request!.requestId, conversationId: request!.conversationId, messageId: request!.messageId, type: 'delta', text: 'Second' }); });
  expect(scroller.scrollTop).toBe(10);
});
