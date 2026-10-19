import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createWorkspace, newConversation, providerTarget } from '@/tools/ai-assistant/model';
import { useAiWorkspace } from '@/tools/ai-assistant/use-ai-workspace';
import type { AiBackend, AiFlushHandler, AiRequest, AiStreamEvent, AiWorkspace } from '@/tools/ai-assistant/types';

function fixture() {
  const workspace = createWorkspace();
  workspace.providers = [{ id: 'p1', name: 'Local', kind: 'ollama', baseUrl: 'http://localhost:11434', hasApiKey: false,
    models: [{ id: 'm1', name: 'Model', supportsImages: false }], enabled: true }];
  const chat = newConversation(workspace.assistants[0]);
  chat.providerId = 'p1'; chat.modelId = 'm1'; chat.draft = 'Hello';
  workspace.conversations = [chat]; workspace.activeConversationId = chat.id;
  return workspace;
}
function createBackend(workspace = fixture()) {
  let emit: ((event: AiStreamEvent) => void) | undefined;
  let request: AiRequest | undefined;
  let resolveGenerate: (() => void) | undefined;
  const saved: AiWorkspace[] = [];
  const backend: AiBackend = {
    load: vi.fn(async () => workspace),
    save: vi.fn(async value => { saved.push(structuredClone(value)); }),
    saveProvider: vi.fn(async provider => provider), removeProvider: vi.fn(async () => {}),
    listModels: vi.fn(async () => []), testConnection: vi.fn(async () => 'OK'),
    generate: vi.fn((value, callback) => { request = value; emit = callback; return new Promise<void>(resolve => { resolveGenerate = resolve; }); }),
    cancel: vi.fn(async () => {}), openDataDirectory: vi.fn(async () => {}), reset: vi.fn(async () => {}),
  };
  return { backend, saved, get request() { return request; },
    event(type: AiStreamEvent['type'], text?: string, overrides?: Partial<AiStreamEvent>) {
      if (!request || !emit) throw new Error('generation not started');
      emit({ requestId: request.requestId, conversationId: request.conversationId, messageId: request.messageId, type, text, ...overrides });
      if (type !== 'delta') resolveGenerate?.();
    },
  };
}
async function setup(workspace = fixture()) {
  const fake = createBackend(workspace);
  const hook = renderHook(() => useAiWorkspace(fake.backend));
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return { ...hook, fake, chatId: workspace.conversations[0].id };
}

describe('AI workspace lifecycle', () => {
  it('flushes the visible partial reply and draft before acknowledging native exit', async () => {
    const workspace = fixture();
    const fake = createBackend(workspace);
    let exit: AiFlushHandler | undefined;
    fake.backend.onExitRequested = vi.fn(async handler => { exit = handler; return () => {}; });
    const { result } = renderHook(() => useAiWorkspace(fake.backend));
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => { void result.current.send(workspace.conversations[0].id); });
    await waitFor(() => expect(fake.request).toBeDefined());
    act(() => {
      fake.event('delta', 'Most recent visible output');
      result.current.update(value => ({ ...value, conversations: value.conversations.map(chat => ({ ...chat, draft: 'Next question' })) }));
    });
    await act(async () => { await exit!(); });
    expect(fake.backend.cancel).toHaveBeenCalledWith(fake.request!.requestId);
    expect(fake.saved[fake.saved.length - 1].conversations[0]).toMatchObject({
      draft: 'Next question', messages: [{ role: 'user' }, { content: 'Most recent visible output', status: 'interrupted' }],
    });
  });

  it('blocks sends and edits throughout an update installation and unlocks after failure', async () => {
    const fake = createBackend();
    let flush: AiFlushHandler | undefined;
    fake.backend.onExitRequested = vi.fn(async handler => { flush = handler; return () => {}; });
    const { result } = renderHook(() => useAiWorkspace(fake.backend));
    await waitFor(() => expect(result.current.loading).toBe(false));
    const chatId = result.current.workspace.conversations[0].id;
    let release: void | (() => void);
    await act(async () => { release = await flush!(true); });
    act(() => result.current.update(value => ({ ...value, conversations: [] })));
    await act(async () => { await result.current.send(chatId); });
    await expect(result.current.reset()).rejects.toThrow(/保存|退出/);
    expect(result.current.workspace.conversations).toHaveLength(1);
    expect(fake.backend.generate).not.toHaveBeenCalled();
    release!(); release!();
    act(() => result.current.update(value => ({ ...value, conversations: [] })));
    expect(result.current.workspace.conversations).toHaveLength(0);
  });

  it('persists user input before sending and ignores stale or foreign stream events', async () => {
    const { result, fake, chatId } = await setup();
    act(() => { void result.current.send(chatId); });
    await waitFor(() => expect(fake.request).toBeDefined());
    expect(fake.saved[fake.saved.length - 1]?.conversations[0].messages[0].content).toBe('Hello');
    act(() => {
      fake.event('delta', 'foreign', { conversationId: 'another-chat' });
      fake.event('delta', 'stale', { requestId: 'old-request' });
      fake.event('delta', 'Answer'); fake.event('done');
    });
    expect(result.current.workspace.conversations[0].messages[1]).toMatchObject({ content: 'Answer', status: 'complete' });
    expect(result.current.busy).toBeNull();
  });

  it('restores the previous answer when regeneration fails and excludes it from request context', async () => {
    const workspace = fixture();
    workspace.conversations[0].messages = [
      { id: 'u1', role: 'user', content: 'Original question', status: 'complete', attachments: [], createdAt: 1 },
      { id: 'a1', role: 'assistant', content: 'Original answer', status: 'complete', attachments: [], createdAt: 2 },
    ];
    const { result, fake, chatId } = await setup(workspace);
    act(() => { void result.current.regenerate(chatId); });
    await waitFor(() => expect(fake.request).toBeDefined());
    expect(fake.request?.messages.map(m => m.content)).toEqual(['Original question']);
    act(() => { fake.event('delta', 'Replacement'); fake.event('error', undefined, { error: 'network failed' }); });
    expect(result.current.workspace.conversations[0].messages[1].content).toBe('Original answer');
    expect(result.current.error).toContain('network failed');
  });

  it('replaces an edited question and removes subsequent conversation', async () => {
    const workspace = fixture();
    workspace.conversations[0].messages = [
      { id: 'u1', role: 'user', content: 'Original', status: 'complete', attachments: [], createdAt: 1 },
      { id: 'a1', role: 'assistant', content: 'Previous answer', status: 'complete', attachments: [], createdAt: 2 },
      { id: 'u2', role: 'user', content: 'Followup', status: 'complete', attachments: [], createdAt: 3 },
    ];
    const { result, fake, chatId } = await setup(workspace);
    act(() => { void result.current.send(chatId, { editMessageId: 'u1', content: 'Edited' }); });
    await waitFor(() => expect(fake.request).toBeDefined());
    expect(fake.request?.messages.map(m => m.content)).toEqual(['Edited']);
    expect(result.current.workspace.conversations[0].messages).toHaveLength(2);
    act(() => fake.event('done'));
  });

  it('refuses images for a model without image support', async () => {
    const workspace = fixture();
    workspace.conversations[0].draftAttachments = [{ id: 'i1', name: 'image.png', kind: 'image', mimeType: 'image/png', size: 1, data: 'YQ==' }];
    const { result, fake, chatId } = await setup(workspace);
    await act(async () => { await result.current.send(chatId); });
    expect(fake.request).toBeUndefined();
    expect(result.current.error).toMatch(/图片/);
    expect(result.current.workspace.conversations[0].draft).toBe('Hello');
  });

  it('refuses a changed provider address until the conversation approves that target', async () => {
    const workspace = fixture();
    workspace.conversations[0].approvedTargets = ['p1:http://old-address:11434'];
    const { result, fake, chatId } = await setup(workspace);
    await act(async () => { await result.current.send(chatId); });
    expect(fake.request).toBeUndefined();
    expect(result.current.error).toMatch(/确认/);
    act(() => result.current.update(value => ({ ...value, conversations: value.conversations.map(chat => ({ ...chat,
      approvedTargets: [...chat.approvedTargets, providerTarget(value.providers[0])] })) })));
    act(() => { void result.current.send(chatId); });
    await waitFor(() => expect(fake.request).toBeDefined());
    act(() => fake.event('done'));
  });

  it('retains the input and prevents network access when the pre-send save fails', async () => {
    const { result, fake, chatId } = await setup();
    vi.mocked(fake.backend.save).mockRejectedValue(new Error('disk full'));
    await act(async () => { await result.current.send(chatId); });
    expect(fake.request).toBeUndefined();
    expect(result.current.saveError).toContain('disk full');
    expect(result.current.busy).toBeNull();
    expect(result.current.workspace.conversations[0].messages[0].content).toBe('Hello');
    expect(result.current.workspace.conversations[0].draft).toBe('Hello');
  });

  it('stops promptly, ignores later tokens and saves the partial answer', async () => {
    const { result, fake, chatId } = await setup();
    act(() => { void result.current.send(chatId); });
    await waitFor(() => expect(fake.request).toBeDefined());
    act(() => fake.event('delta', 'Partial'));
    await act(async () => { await result.current.stop(); fake.event('delta', ' ignored'); });
    expect(result.current.workspace.conversations[0].messages[1]).toMatchObject({ content: 'Partial', status: 'stopped' });
    expect(fake.saved[fake.saved.length - 1]?.conversations[0].messages[1].status).toBe('stopped');
  });

  it('cancels and persists interrupted partial output on unmount', async () => {
    const { result, fake, chatId, unmount } = await setup();
    act(() => { void result.current.send(chatId); });
    await waitFor(() => expect(fake.request).toBeDefined());
    act(() => fake.event('delta', 'Partial'));
    unmount();
    await waitFor(() => expect(fake.saved[fake.saved.length - 1]?.conversations[0].messages[1].status).toBe('interrupted'));
    expect(fake.saved[fake.saved.length - 1]?.conversations[0].messages[1].content).toBe('Partial');
    expect(fake.backend.cancel).toHaveBeenCalledWith(fake.request?.requestId);
  });

  it('does not overwrite existing data when initialization fails', async () => {
    const fake = createBackend();
    vi.mocked(fake.backend.load).mockRejectedValue(new Error('corrupt workspace'));
    const { result } = renderHook(() => useAiWorkspace(fake.backend));
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.update(value => ({ ...value, conversations: [] })));
    expect(fake.saved).toHaveLength(0);
    expect(result.current.error).toContain('corrupt workspace');
  });

  it('serializes slow saves so an older draft cannot overwrite the newest draft', async () => {
    const { result, fake } = await setup();
    const pending: Array<() => void> = [];
    const writes: string[] = [];
    vi.mocked(fake.backend.save).mockImplementation(value => new Promise<void>(resolve => {
      pending.push(() => { writes.push(value.conversations[0].draft); resolve(); });
    }));
    act(() => {
      result.current.update(value => ({ ...value, conversations: value.conversations.map(chat => ({ ...chat, draft: 'First' })) }));
      result.current.update(value => ({ ...value, conversations: value.conversations.map(chat => ({ ...chat, draft: 'Latest' })) }));
    });
    await waitFor(() => expect(pending).toHaveLength(1));
    await act(async () => { pending[0](); });
    await waitFor(() => expect(pending).toHaveLength(2));
    await act(async () => { pending[1](); });
    expect(writes).toEqual(['First', 'Latest']);
    expect(result.current.workspace.conversations[0].draft).toBe('Latest');
  });

  it('restores the previous answer on cancelled regeneration', async () => {
    const workspace = fixture();
    workspace.conversations[0].messages = [
      { id: 'u1', role: 'user', content: 'Question', status: 'complete', attachments: [], createdAt: 1 },
      { id: 'a1', role: 'assistant', content: 'Kept answer', status: 'complete', attachments: [], createdAt: 2 },
    ];
    const { result, fake, chatId } = await setup(workspace);
    act(() => { void result.current.regenerate(chatId); });
    await waitFor(() => expect(fake.request).toBeDefined());
    act(() => fake.event('delta', 'Temporary replacement'));
    await act(async () => { await result.current.stop(); });
    expect(result.current.workspace.conversations[0].messages[1]).toMatchObject({ content: 'Kept answer', status: 'complete' });
  });

  it('preserves the next draft when streaming events arrive', async () => {
    const { result, fake, chatId } = await setup();
    act(() => { void result.current.send(chatId); });
    await waitFor(() => expect(fake.request).toBeDefined());
    act(() => {
      result.current.update(value => ({ ...value, conversations: value.conversations.map(chat => ({ ...chat, draft: 'My next question' })) }));
      fake.event('delta', 'Answer'); fake.event('done');
    });
    expect(result.current.workspace.conversations[0].draft).toBe('My next question');
    await waitFor(() => expect(fake.saved[fake.saved.length - 1]?.conversations[0].draft).toBe('My next question'));
  });

  it('does not start the network if stopped while the pre-send save is pending', async () => {
    const { result, fake, chatId } = await setup();
    let resume: (() => void) | undefined;
    vi.mocked(fake.backend.save).mockImplementationOnce(() => new Promise<void>(resolve => { resume = resolve; }));
    act(() => { void result.current.send(chatId); });
    await waitFor(() => expect(resume).toBeDefined());
    let stopped: Promise<void>;
    act(() => { stopped = result.current.stop(); });
    await act(async () => { resume?.(); await stopped!; });
    expect(fake.request).toBeUndefined();
    expect(result.current.workspace.conversations[0].messages[1].status).toBe('stopped');
  });

  it('recovers pending replies as interrupted without automatic network activity', async () => {
    const workspace = fixture();
    workspace.conversations[0].messages = [{ id: 'partial', role: 'assistant', content: 'Saved output', attachments: [], createdAt: 1, status: 'streaming' }];
    const { result, fake } = await setup(workspace);
    expect(result.current.workspace.conversations[0].messages[0]).toMatchObject({ content: 'Saved output', status: 'interrupted' });
    expect(fake.request).toBeUndefined();
    expect(fake.saved).toHaveLength(0);
  });

  it('keeps the old answer on disk until a regenerated answer succeeds', async () => {
    const workspace = fixture();
    workspace.conversations[0].messages = [
      { id: 'u1', role: 'user', content: 'Question', status: 'complete', attachments: [], createdAt: 1 },
      { id: 'a1', role: 'assistant', content: 'Durable previous answer', status: 'complete', attachments: [], createdAt: 2 },
    ];
    const { result, fake, chatId } = await setup(workspace);
    act(() => { void result.current.regenerate(chatId); });
    await waitFor(() => expect(fake.request).toBeDefined());
    expect(fake.saved[fake.saved.length - 1].conversations[0].messages[1].content).toBe('Durable previous answer');
    act(() => { fake.event('delta', 'Successful replacement'); fake.event('done'); });
    await waitFor(() => expect(fake.saved[fake.saved.length - 1].conversations[0].messages[1].content).toBe('Successful replacement'));
  });

  it('retains the generation lock until backend cancellation finishes', async () => {
    const { result, fake, chatId } = await setup();
    act(() => { void result.current.send(chatId); });
    await waitFor(() => expect(fake.request).toBeDefined());
    let cancelComplete: (() => void) | undefined;
    vi.mocked(fake.backend.cancel).mockImplementation(() => new Promise<void>(resolve => { cancelComplete = resolve; }));
    let stopped: Promise<void>;
    act(() => { stopped = result.current.stop(); });
    const lockDuringCancellation = result.current.busy;
    await act(async () => { cancelComplete?.(); await stopped!; });
    expect(lockDuringCancellation).not.toBeNull();
    expect(result.current.busy).toBeNull();
  });

  it('does not resurrect removed providers when drafts are changed during credential removal', async () => {
    const { result, fake } = await setup();
    let completeRemoval: (() => void) | undefined;
    let removed = false;
    const providerCountsAfterRemoval: number[] = [];
    vi.mocked(fake.backend.removeProvider).mockImplementation(() => new Promise<void>(resolve => {
      completeRemoval = () => { removed = true; resolve(); };
    }));
    vi.mocked(fake.backend.save).mockImplementation(async value => {
      if (removed) providerCountsAfterRemoval.push(value.providers.length);
    });
    let removal: Promise<void>;
    act(() => { removal = result.current.removeProvider('p1'); });
    await waitFor(() => expect(completeRemoval).toBeDefined());
    act(() => result.current.update(value => ({ ...value, conversations: value.conversations.map(chat => ({ ...chat, draft: 'Changed while removing' })) })));
    await act(async () => { completeRemoval?.(); await removal!; });
    expect(providerCountsAfterRemoval.every(count => count === 0)).toBe(true);
    expect(result.current.workspace.conversations[0].draft).toBe('Changed while removing');
  });

  it('prevents sends from racing a service address change', async () => {
    const { result, fake, chatId } = await setup();
    let finishProviderSave: (() => void) | undefined;
    const changed = { ...result.current.workspace.providers[0], baseUrl: 'http://another-host:11434' };
    vi.mocked(fake.backend.saveProvider).mockImplementation(() => new Promise(resolve => {
      finishProviderSave = () => resolve(changed);
    }));
    let saved: Promise<void>;
    act(() => { saved = result.current.saveProvider(changed); });
    await waitFor(() => expect(finishProviderSave).toBeDefined());
    act(() => { void result.current.send(chatId); });
    await act(async () => { finishProviderSave?.(); await saved!; });
    expect(fake.request).toBeUndefined();
    expect(result.current.error).toMatch(/保存|配置|修改/);
  });

  it('keeps a new workspace read-only when its initial durable save fails', async () => {
    const fake = createBackend();
    vi.mocked(fake.backend.load).mockResolvedValue(null);
    vi.mocked(fake.backend.save).mockRejectedValue(new Error('initial save denied'));
    const { result } = renderHook(() => useAiWorkspace(fake.backend));
    await waitFor(() => expect(result.current.loading).toBe(false));
    const originalName = result.current.workspace.assistants[0].name;
    act(() => result.current.update(value => ({ ...value,
      assistants: value.assistants.map(assistant => ({ ...assistant, name: 'Should not persist' })) })));
    expect(result.current.error).toContain('initial save denied');
    expect(result.current.workspace.assistants[0].name).toBe(originalName);
    expect(fake.backend.save).toHaveBeenCalledTimes(1);
  });

  it('does not accept credentials after reset defaults fail to save', async () => {
    const { result, fake } = await setup();
    const provider = result.current.workspace.providers[0];
    vi.mocked(fake.backend.save).mockRejectedValue(new Error('reset save denied'));
    await act(async () => { await result.current.reset().catch(() => {}); });
    await act(async () => {
      await expect(result.current.saveProvider(provider, 'secret')).rejects.toThrow(/尚未加载/);
    });
    expect(fake.backend.saveProvider).not.toHaveBeenCalled();
    expect(result.current.error).toContain('reset save denied');
  });
});
