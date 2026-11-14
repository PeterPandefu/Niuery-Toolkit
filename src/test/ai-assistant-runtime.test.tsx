import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AssistantRuntimeProvider, MessagePrimitive, ThreadPrimitive, useExternalStoreRuntime } from '@assistant-ui/react';
import { mapAiMessage } from '@/tools/ai-assistant/runtime/message-mapper';
import i18n from '@/i18n';
import type { AiMessage } from '@/tools/ai-assistant/types';

afterEach(cleanup);
const message = (overrides: Partial<AiMessage> = {}): AiMessage => ({ id: 'a', role: 'assistant', content: 'Answer', thinking: 'Thought', attachments: [], createdAt: 1, status: 'complete', ...overrides });

describe('assistant-ui message bridge', () => {
  it('projects stable message IDs and separate thinking parts without writing to domain state', () => {
    const source = message(); const projected = mapAiMessage(source);
    expect(projected.id).toBe('a'); expect(projected.content).toEqual([{ type: 'reasoning', text: 'Thought' }, { type: 'text', text: 'Answer' }]);
    expect(projected.status).toEqual({ type: 'complete', reason: 'stop' });
    expect(source).toMatchObject({ thinking: 'Thought', status: 'complete' });
    expect(mapAiMessage(source, false).content).toEqual([{ type: 'text', text: 'Answer' }]);
  });
  it.each([
    ['waiting', undefined, { type: 'running' }], ['streaming', undefined, { type: 'running' }],
    ['stopped', undefined, { type: 'incomplete', reason: 'cancelled' }], ['interrupted', undefined, { type: 'incomplete', reason: 'other' }],
    ['failed', undefined, { type: 'incomplete', reason: 'error', error: 'Failure' }],
    ['complete', 'length', { type: 'incomplete', reason: 'length' }], ['complete', 'content_filter', { type: 'incomplete', reason: 'content-filter' }],
  ] as const)('maps %s and %s without changing the stored status', (status, finishReason, expected) => {
    expect(mapAiMessage(message({ status, finishReason, error: status === 'failed' ? 'Failure' : undefined })).status).toEqual(expected);
  });
  it('renders actual framework message parts and follows host updates', async () => {
    const onNew = vi.fn(async (_message: unknown) => {});
    function Harness({ value }: { value: AiMessage }) {
      const runtime = useExternalStoreRuntime({ messages: [value], convertMessage: (message: AiMessage) => mapAiMessage(message), onNew });
      return <AssistantRuntimeProvider runtime={runtime}><ThreadPrimitive.Root><ThreadPrimitive.Messages>{() => <MessagePrimitive.Root><MessagePrimitive.Parts /></MessagePrimitive.Root>}</ThreadPrimitive.Messages><button onClick={() => runtime.thread.append('Next')}>Send test</button></ThreadPrimitive.Root></AssistantRuntimeProvider>;
    }
    const { rerender } = render(<Harness value={message()} />);
    expect(screen.getByText('Answer')).toBeInTheDocument();
    rerender(<Harness value={message({ content: 'Updated' })} />);
    expect(await screen.findByText('Updated')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Send test')); await waitFor(() => expect(onNew).toHaveBeenCalledTimes(1));
    expect(onNew.mock.calls[0]?.[0]).toMatchObject({ role: 'user', content: [{ type: 'text', text: 'Next' }] });
  });
});

it('pages long histories through the runtime and reveals search targets without changing stored messages', async () => {
  await i18n.changeLanguage('en');
  const { AiThread, LoadEarlierMessages } = await import('@/tools/ai-assistant/runtime/thread-view');
  const source = Array.from({ length: 201 }, (_, index) => message({ id: `row-${index}`, content: `History row ${index}`, thinking: undefined }));
  const actions = { append: vi.fn(async () => {}), reload: vi.fn(async () => {}), cancel: vi.fn(async () => {}) };
  function History({ target }: { target?: string }) {
    return <AiThread messages={source} providers={[]} actions={actions} running={false} disabled={false} sendDisabled={false} targetMessageId={target}><main>
      <LoadEarlierMessages /><ThreadPrimitive.Messages>{() => <MessagePrimitive.Root><MessagePrimitive.Parts /></MessagePrimitive.Root>}</ThreadPrimitive.Messages>
    </main></AiThread>;
  }
  const { rerender } = render(<History />);
  expect(screen.getByText('History row 200')).toBeInTheDocument();
  expect(screen.queryByText('History row 0')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Load earlier messages|显示较早的消息/ }));
  await screen.findByText('History row 1');
  expect(screen.queryByText('History row 0')).not.toBeInTheDocument();
  rerender(<History target="row-0" />);
  await screen.findByText('History row 0');
  expect(source).toHaveLength(201);
  expect(source[0].content).toBe('History row 0');
  expect(actions.append).not.toHaveBeenCalled();
});

it('collapses tool calls into one fold, surfaces forced finish and caps answer height', async () => {
  const { MessageView } = await import('@/tools/ai-assistant/message-view');
  const source = message({
    content: 'Long answer',
    forcedFinish: true,
    toolCalls: [
      { id: 't1', name: 'calculate', arguments: '{}', status: 'complete', result: '42' },
      { id: 't2', name: 'run_command', arguments: '{}', status: 'failed', error: 'boom' },
      { id: 't3', name: 'list_directory', arguments: '{}', status: 'pending' },
    ],
  });
  const { container } = render(<MessageView message={source} disabled={false} lastAssistant={false} onEdit={() => {}} onRegenerate={() => {}} />);
  const toggle = screen.getByRole('button', { name: /工具调用 · 3|Tool calls · 3/ });
  const fold = container.querySelector('.ai-tool-group-content') as HTMLElement;
  expect(fold).not.toBeNull();
  expect(fold.hidden).toBe(true);
  expect(screen.getByText(/已达单次回答的工具轮数上限|tool-round limit/i)).toBeInTheDocument();
  expect(container.querySelector('.ai-markdown.ai-answer')).not.toBeNull();
  fireEvent.click(toggle);
  expect(fold.hidden).toBe(false);
  expect(screen.getByText('run_command')).toBeInTheDocument();
  expect(screen.getByText('list_directory')).toBeInTheDocument();
});

it('pins the streaming thinking fold to the newest line unless the reader scrolls up', async () => {
  const { MessageView } = await import('@/tools/ai-assistant/message-view');
  const view = (thinking: string) => <MessageView message={message({ status: 'streaming', content: '', thinking })} disabled={false} lastAssistant={false} onEdit={() => {}} onRegenerate={() => {}} />;
  const { container, rerender } = render(view('plan line one'));
  const fold = container.querySelector('.ai-thinking-content') as HTMLElement;
  expect(fold.hidden).toBe(false);
  Object.defineProperty(fold, 'scrollHeight', { configurable: true, value: 1000 });
  Object.defineProperty(fold, 'clientHeight', { configurable: true, value: 240 });
  fold.scrollTop = 760;
  rerender(view('plan line one two'));
  expect(fold.scrollTop).toBe(1000);
  fold.scrollTop = 0;
  rerender(view('plan line one two three'));
  expect(fold.scrollTop).toBe(0);
});

it('keeps following the thinking fold when one streamed chunk grows past the follow threshold', async () => {
  const { MessageView } = await import('@/tools/ai-assistant/message-view');
  const view = (thinking: string) => <MessageView message={message({ status: 'streaming', content: '', thinking })} disabled={false} lastAssistant={false} onEdit={() => {}} onRegenerate={() => {}} />;
  const { container, rerender } = render(view('plan'));
  const fold = container.querySelector('.ai-thinking-content') as HTMLElement;
  Object.defineProperty(fold, 'scrollHeight', { configurable: true, value: 1000 });
  Object.defineProperty(fold, 'clientHeight', { configurable: true, value: 240 });
  fold.scrollTop = 760;
  rerender(view('plan baseline'));
  expect(fold.scrollTop).toBe(1000);
  Object.defineProperty(fold, 'scrollHeight', { configurable: true, value: 1400 });
  rerender(view('plan baseline more'));
  expect(fold.scrollTop).toBe(1400);
});
