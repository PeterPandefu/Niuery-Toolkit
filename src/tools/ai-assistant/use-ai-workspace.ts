import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { nanoid } from 'nanoid';
import { createWorkspace, providerTarget } from './model';
import { requestMessages } from './request-messages';
import { buildBudgetedContext } from './context';
import { retainAnswerVersion } from './branches';
import { validateAttachments } from './attachments';
import { aiUpdatePending, subscribeAiUpdate } from './update-lock';
import type { AiAttachment, AiBackend, AiConversation, AiMessage, AiProvider, AiRequest, AiStreamEvent, AiTaskPlan, AiWorkspace } from './types';

type Busy = Pick<AiRequest, 'requestId' | 'conversationId' | 'messageId'>;
type ActiveRequest = Busy & { previous?: AiMessage; terminated: boolean; startedAt: number; taskId?: string };
type Updater = (workspace: AiWorkspace) => AiWorkspace;
export interface AiSendOptions { editMessageId?: string; content?: string; attachments?: AiAttachment[]; expectedTarget?: string }
export type AiSendOutcome = { type: 'not-sent'; reason: string } | { type: 'settled'; requestId: string };
const describeError = (reason: unknown) => reason instanceof Error ? reason.message : String(reason);

export function useAiWorkspace(backend: AiBackend) {
  const updatePending = useSyncExternalStore(subscribeAiUpdate, aiUpdatePending, aiUpdatePending);
  const [workspace, setWorkspace] = useState<AiWorkspace>(createWorkspace);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy | null>(null);
  const valueRef = useRef(workspace);
  const mounted = useRef(false);
  const initialized = useRef(false);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const active = useRef<ActiveRequest | null>(null);
  const batch = useRef<{ cancelled: boolean } | null>(null);
  const cancelling = useRef<Busy | null>(null);
  const cancelPending = useRef<Promise<void> | null>(null);
  const mutationsPending = useRef(0);
  const exiting = useRef(0);
  const progressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadGeneration = useRef(0);

  const replace = useCallback((next: AiWorkspace) => {
    valueRef.current = next;
    if (mounted.current) setWorkspace(next);
  }, []);

  /** All disk/credential mutations share this queue, preserving write order. */
  const enqueue = useCallback(<T,>(operation: () => Promise<T>): Promise<T> => {
    const pending = queue.current.then(operation);
    queue.current = pending.then(() => {}, () => {});
    return pending;
  }, []);

  const persist = useCallback((snapshot = valueRef.current): Promise<void> => {
    if (!initialized.current) return Promise.reject(new Error('AI 数据尚未成功加载，不能保存。'));
    const pending = active.current;
    // A regeneration only replaces its durable answer after success. If the
    // process crashes mid-stream, reopening still restores the previous reply.
    const durable = pending?.previous && !pending.terminated ? { ...snapshot,
      conversations: snapshot.conversations.map(chat => chat.id === pending.conversationId ? { ...chat,
        messages: chat.messages.map(message => message.id === pending.messageId ? pending.previous! : message),
      } : chat),
    } : snapshot;
    return enqueue(async () => {
      try {
        // Provider operations can complete while a draft snapshot is queued.
        // Take provider metadata at execution time to avoid restoring removed
        // credentials/configuration from an older conversation snapshot.
        await backend.save({ ...durable, providers: valueRef.current.providers });
        if (mounted.current) setSaveError(null);
      } catch (reason) {
        if (mounted.current) setSaveError(describeError(reason));
        throw reason;
      }
    });
  }, [backend, enqueue]);

  const saveQuietly = useCallback(() => { void persist().catch(() => {}); }, [persist]);

  const update = useCallback((updater: Updater) => {
    if (!initialized.current || exiting.current || aiUpdatePending()) return;
    replace(updater(valueRef.current));
    saveQuietly();
  }, [replace, saveQuietly]);

  const changeConversation = useCallback((id: string, updater: (conversation: AiConversation) => AiConversation) => {
    replace({ ...valueRef.current, conversations: valueRef.current.conversations.map(chat => chat.id === id ? updater(chat) : chat) });
  }, [replace]);

  const changeReply = useCallback((request: ActiveRequest, updater: (message: AiMessage) => AiMessage) => {
    changeConversation(request.conversationId, chat => ({ ...chat, updatedAt: Date.now(),
      ...(request.taskId ? { tasks: chat.tasks?.map(task => task.id === request.taskId ? { ...task, results: task.results.map(result => result.message.id === request.messageId ? { ...result, message: updater(result.message) } : result) } : task) }
        : { messages: chat.messages.map(message => message.id === request.messageId ? updater(message) : message) }) }));
  }, [changeConversation]);

  const interruptTasks = useCallback(() => {
    if (!batch.current) return;
    batch.current.cancelled = true;
    replace({ ...valueRef.current, conversations: valueRef.current.conversations.map(chat => ({ ...chat, tasks: chat.tasks?.map(task => ({ ...task,
      results: task.results.map(result => result.message.status === 'waiting' || result.message.status === 'streaming' ? { ...result, message: { ...result.message, status: 'interrupted' } } : result) })) })) });
  }, [replace]);

  const clearProgressTimer = useCallback(() => {
    if (progressTimer.current !== null) clearTimeout(progressTimer.current);
    progressTimer.current = null;
  }, []);

  const finish = useCallback(async (request: ActiveRequest, status: AiMessage['status'], reason?: string) => {
    if (request.terminated || active.current !== request) return;
    request.terminated = true;
    clearProgressTimer();
    changeReply(request, message => {
      if (status !== 'complete' && request.previous) return request.previous;
      const completed = { ...message, status, error: reason, durationMs: Math.max(0, Date.now() - request.startedAt) };
      return status === 'complete' && request.previous ? retainAnswerVersion(request.previous, completed) : completed;
    });
    active.current = null;
    if (mounted.current) {
      if (!cancelling.current && !batch.current) setBusy(null);
      if (reason) setError(reason);
    }
    await persist();
  }, [changeReply, clearProgressTimer, persist]);

  const reload = useCallback(async () => {
    if (active.current || cancelling.current || batch.current) { setError('请先停止当前生成，再重新加载数据。'); return; }
    const generation = ++loadGeneration.current;
    initialized.current = false;
    if (mounted.current) { setLoading(true); setError(null); }
    try {
      await queue.current;
      const saved = await backend.load();
      if (!mounted.current || generation !== loadGeneration.current) return;
      if (saved && saved.version !== 1) throw new Error('不支持此 AI 数据版本，请保留数据并升级应用。');
      const next = saved ?? createWorkspace();
      if (!Array.isArray(next.assistants) || !next.assistants.length || !Array.isArray(next.conversations) || !Array.isArray(next.providers)) {
        throw new Error('AI 数据结构损坏，请打开数据目录检查备份。');
      }
      // Establish complete default metadata before provider/credential commands
      // can operate, so a first-run interruption never leaves providers alone.
      if (!saved) await enqueue(() => backend.save(next));
      if (!mounted.current || generation !== loadGeneration.current) return;
      const recovered: AiWorkspace = { ...next, conversations: next.conversations.map(chat => ({ ...chat,
        messages: chat.messages.map(message => message.status === 'waiting' || message.status === 'streaming' ? { ...message, status: 'interrupted' } : message),
        tasks: chat.tasks?.map(task => ({ ...task, results: task.results.map(result => ({ ...result, message: result.message.status === 'waiting' || result.message.status === 'streaming' ? { ...result.message, status: 'interrupted' } : result.message })) })),
      })) };
      initialized.current = true;
      replace(recovered);
      setSaveError(null);
    } catch (reason) {
      if (mounted.current && generation === loadGeneration.current) setError(describeError(reason));
    } finally {
      if (mounted.current && generation === loadGeneration.current) setLoading(false);
    }
  }, [backend, enqueue, replace]);

  useEffect(() => {
    mounted.current = true;
    void reload();
    return () => {
      mounted.current = false;
      interruptTasks();
      clearProgressTimer();
      const request = active.current;
      if (request) {
        // finish mutates the ref even after unmount, then queues its final snapshot.
        void finish(request, 'interrupted').catch(() => {});
        void backend.cancel(request.requestId).catch(() => {});
      }
    };
  }, [backend, clearProgressTimer, finish, reload, interruptTasks]);

  useEffect(() => {
    if (!backend.onExitRequested) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void backend.onExitRequested(async hold => {
      exiting.current++;
      interruptTasks();
      let retained = false;
      try {
        const request = active.current;
        if (request) {
          const results = await Promise.allSettled([
            finish(request, 'interrupted'), backend.cancel(request.requestId),
          ]);
          for (const result of results) if (result.status === 'rejected') throw result.reason;
        }
        await queue.current;
        if (initialized.current) await persist();
        if (hold) {
          retained = true;
          let released = false;
          return () => { if (!released) { released = true; exiting.current--; } };
        }
      } catch (reason) {
        if (mounted.current) setError(describeError(reason));
        throw reason;
      } finally { if (!retained) exiting.current--; }
    }).then(dispose => { if (disposed) void queue.current.then(dispose); else unlisten = dispose; })
      .catch(reason => { if (mounted.current) setError(describeError(reason)); });
    return () => { disposed = true; if (unlisten) void queue.current.then(unlisten); };
  }, [backend, finish, persist, interruptTasks]);

  const run = useCallback(async (conversationId: string, options: AiSendOptions = {}, regenerate = false): Promise<AiSendOutcome> => {
    if (exiting.current || aiUpdatePending()) return { type: 'not-sent', reason: '应用正在保存退出或更新' };
    if (!initialized.current) { setError('AI 数据尚未加载，请先恢复数据。'); return { type: 'not-sent', reason: 'AI 数据尚未加载' }; }
    if (active.current || cancelling.current || batch.current) { setError('请先停止当前生成，再发送其他消息。'); return { type: 'not-sent', reason: '已有生成任务' }; }
    if (mutationsPending.current) { setError('正在保存或修改 AI 配置，请完成后再发送消息。'); return { type: 'not-sent', reason: '配置正在保存' }; }
    setError(null);
    let request: ActiveRequest | undefined;
    let unsavedDraft: Pick<AiConversation, 'draft' | 'draftAttachments'> | undefined;
    let networkStarted = false;
    try {
      const current = valueRef.current;
      const chat = current.conversations.find(item => item.id === conversationId);
      if (!chat) throw new Error('会话不存在，请重新选择会话。');
      const provider = current.providers.find(item => item.id === chat.providerId && item.enabled);
      const model = provider?.models.find(item => item.id === chat.modelId);
      if (!provider || !model) throw new Error('请先配置并选择可用的模型服务。');
      const target = providerTarget(provider);
      if (options.expectedTarget && options.expectedTarget !== target) throw new Error('目标服务已更改，请重新确认发送。');
      if (chat.approvedTargets.length > 0 && !chat.approvedTargets.includes(target)) throw new Error('目标服务已更改，请先确认将消息和历史发送到此服务。');

      let messages = chat.messages;
      let previous: AiMessage | undefined;
      if (regenerate) {
        const answerIndex = messages.length - 1;
        const answer = messages[answerIndex];
        if (!answer || answer.role !== 'assistant' || messages[answerIndex - 1]?.role !== 'user') throw new Error('没有可重新生成的最后一条回复。');
        previous = answer;
        messages = messages.slice(0, answerIndex);
      } else if (options.editMessageId) {
        const editIndex = messages.findIndex(message => message.id === options.editMessageId && message.role === 'user');
        if (editIndex < 0) throw new Error('要编辑的用户消息不存在。');
        const original = messages[editIndex];
        const content = options.content ?? original.content;
        if (!content.trim() && !original.attachments.length) throw new Error('请输入消息或添加附件。');
        messages = [...messages.slice(0, editIndex), { ...original, content, status: 'complete' as const }];
      } else {
        const content = options.content ?? chat.draft;
        const attachments = options.attachments ?? chat.draftAttachments;
        if (!content.trim() && !attachments.length) throw new Error('请输入消息或添加附件。');
        validateAttachments(attachments);
        messages = [...messages, { id: nanoid(), role: 'user', content, attachments: [...attachments], createdAt: Date.now(), status: 'complete' }];
      }
      const budget = buildBudgetedContext({ ...chat, messages }, model);
      const context = budget.messages;
      for (const message of context) validateAttachments(message.attachments);
      if (!model.supportsImages && context.some(message => message.attachments.some(file => file.kind === 'image'))) {
        throw new Error('当前上下文含图片，请选择支持图片的模型，或使用不含图片的新会话／上下文。');
      }
      request = { requestId: nanoid(), conversationId, messageId: previous?.id ?? nanoid(), previous, terminated: false, startedAt: Date.now() };
      const reply: AiMessage = { id: request.messageId, role: 'assistant', content: '', attachments: [], createdAt: Date.now(),
        status: 'waiting', providerId: provider.id, modelId: model.id };
      const firstQuestion = messages.find(message => message.role === 'user');
      const submittedAttachments = options.attachments ?? chat.draftAttachments;
      const clearDraft = !regenerate && !options.editMessageId
        && (options.content ?? chat.draft) === chat.draft
        && JSON.stringify(submittedAttachments) === JSON.stringify(chat.draftAttachments);
      const nextChat: AiConversation = { ...chat, messages: [...messages, reply],
        draft: clearDraft ? '' : chat.draft,
        draftAttachments: clearDraft ? [] : chat.draftAttachments,
        title: chat.title === '新会话' && firstQuestion ? (firstQuestion.content.trim().slice(0, 40) || firstQuestion.attachments[0]?.name || '新会话') : chat.title,
        approvedTargets: chat.approvedTargets.includes(target) ? chat.approvedTargets : [...chat.approvedTargets, target], updatedAt: Date.now() };
      if (clearDraft) unsavedDraft = { draft: chat.draft, draftAttachments: chat.draftAttachments };
      changeConversation(conversationId, () => nextChat);
      active.current = request;
      setBusy({ requestId: request.requestId, conversationId, messageId: request.messageId });
      // Never start the network until input and attachment copies have reached disk.
      await persist();
      if (active.current !== request || request.terminated || !mounted.current) return { type: 'settled', requestId: request.requestId };
      const running = request;
      const onEvent = (event: AiStreamEvent) => {
        if (active.current !== running || running.terminated || event.requestId !== running.requestId
          || event.conversationId !== running.conversationId || event.messageId !== running.messageId) return;
        if (event.type === 'thinking') {
          changeConversation(conversationId, value => ({ ...value, updatedAt: Date.now(), messages: value.messages.map(message => message.id === running.messageId ? { ...message, thinking: `${message.thinking ?? ''}${event.text ?? ''}`, status: 'streaming' } : message) }));
          if (progressTimer.current === null) progressTimer.current = setTimeout(() => { progressTimer.current = null; saveQuietly(); }, 500);
        } else if (event.type === 'delta') {
          changeConversation(conversationId, value => ({ ...value, updatedAt: Date.now(), messages: value.messages.map(message => message.id === running.messageId
            ? { ...message, content: message.content + (event.text ?? ''), status: 'streaming', firstTokenMs: message.firstTokenMs ?? Math.max(0, Date.now() - running.startedAt) } : message) }));
          if (progressTimer.current === null) progressTimer.current = setTimeout(() => {
            progressTimer.current = null;
            saveQuietly();
          }, 500);
        } else if (event.type === 'metadata') {
          changeConversation(conversationId, value => ({ ...value, messages: value.messages.map(message => message.id === running.messageId ? { ...message, finishReason: event.finishReason ?? message.finishReason, usage: event.usage ?? message.usage } : message) }));
        } else {
          const status = event.type === 'done' ? 'complete' : event.type === 'stopped' ? 'stopped' : 'failed';
          void finish(running, status, event.error || (event.type === 'error' ? '生成失败，请检查模型服务后重试。' : undefined)).catch(() => {});
        }
      };
      networkStarted = true;
      await backend.generate({ requestId: running.requestId, conversationId, messageId: running.messageId,
        providerId: provider.id, modelId: model.id, systemPrompt: budget.systemPrompt, parameters: budget.parameters,
        messages: requestMessages(context) }, onEvent);
      if (active.current === running && !running.terminated) await finish(running, 'interrupted', '回复流意外结束，请重试。');
    } catch (reason) {
      const text = describeError(reason);
      if (request && active.current === request && !request.terminated) {
        if (!networkStarted && unsavedDraft) {
          const originalDraft = unsavedDraft;
          changeConversation(conversationId, value => !value.draft && !value.draftAttachments.length ? { ...value, ...originalDraft } : value);
        }
        await finish(request, 'failed', text).catch(() => {});
      } else if (!request || !request.terminated) {
        if (mounted.current) setError(text);
      }
    }
    return request ? { type: 'settled', requestId: request.requestId } : { type: 'not-sent', reason: '请求未发送' };
  }, [backend, changeConversation, finish, persist, saveQuietly]);

  const send = useCallback((id: string, options?: AiSendOptions) => run(id, options), [run]);
  const regenerate = useCallback((id: string, options: AiSendOptions = {}) => run(id, options, true), [run]);

  const runTask = useCallback(async (conversationId: string, plan: AiTaskPlan) => {
    if (!initialized.current || exiting.current || aiUpdatePending() || active.current || cancelling.current || batch.current || mutationsPending.current) throw new Error('请先完成当前操作，再运行任务。');
    const chat = valueRef.current.conversations.find(chat => chat.id === conversationId);
    if (!chat || !plan.requests.length || plan.requests.some(request => request.conversationId !== conversationId)) throw new Error('任务会话无效');
    for (const request of plan.requests) {
      const provider = valueRef.current.providers.find(provider => provider.id === request.providerId && provider.enabled);
      if (!provider || !provider.models.some(model => model.id === request.modelId) || !plan.targets.includes(providerTarget(provider))) throw new Error('任务目标已更改，请重新创建任务');
    }
    const runningBatch = { cancelled: false }; batch.current = runningBatch;
    setBusy({ requestId: plan.requests[0].requestId, conversationId, messageId: plan.requests[0].messageId });
    setError(null);
    changeConversation(conversationId, chat => ({ ...chat, tasks: [...(chat.tasks ?? []), { id: plan.id, kind: plan.kind, createdAt: plan.createdAt, prompt: plan.prompt, results: plan.results }], approvedTargets: [...new Set([...chat.approvedTargets, ...plan.targets])] }));
    try {
      await persist();
      for (const request of plan.requests) {
        if (runningBatch.cancelled || !mounted.current || exiting.current || aiUpdatePending()) break;
        const running: ActiveRequest = { requestId: request.requestId, conversationId, messageId: request.messageId, startedAt: Date.now(), terminated: false, taskId: plan.id };
        active.current = running; setBusy({ requestId: running.requestId, conversationId, messageId: running.messageId });
        try {
          await backend.generate({ ...request, messages: requestMessages(request.messages) }, event => {
            if (active.current !== running || running.terminated || event.requestId !== running.requestId || event.conversationId !== conversationId || event.messageId !== running.messageId) return;
            if (event.type === 'thinking') {
              changeReply(running, message => ({ ...message, thinking: `${message.thinking ?? ''}${event.text ?? ''}`, status: 'streaming' }));
              if (progressTimer.current === null) progressTimer.current = setTimeout(() => { progressTimer.current = null; saveQuietly(); }, 500);
            } else if (event.type === 'delta') {
              changeReply(running, message => ({ ...message, content: message.content + (event.text ?? ''), status: 'streaming', firstTokenMs: message.firstTokenMs ?? Math.max(0, Date.now() - running.startedAt) }));
              if (progressTimer.current === null) progressTimer.current = setTimeout(() => { progressTimer.current = null; saveQuietly(); }, 500);
            } else if (event.type === 'metadata') {
              changeReply(running, message => ({ ...message, finishReason: event.finishReason ?? message.finishReason, usage: event.usage ?? message.usage }));
            } else void finish(running, event.type === 'done' ? 'complete' : event.type === 'stopped' ? 'stopped' : 'failed', event.error).catch(() => {});
          });
          if (active.current === running && !running.terminated) await finish(running, 'interrupted', '任务回复流意外结束');
        } catch (reason) { if (active.current === running && !running.terminated) await finish(running, 'failed', describeError(reason)); }
        await persist();
      }
    } catch (reason) { runningBatch.cancelled = true; if (mounted.current) setError(describeError(reason)); }
    finally {
      changeConversation(conversationId, chat => ({ ...chat, tasks: chat.tasks?.map(task => task.id === plan.id ? { ...task, results: task.results.map(result => result.message.status === 'waiting' ? { ...result, message: { ...result.message, status: 'stopped' } } : result) } : task) }));
      if (batch.current === runningBatch) batch.current = null;
      if (mounted.current && !cancelling.current) setBusy(null);
      await persist().catch(() => {});
    }
  }, [backend, changeConversation, changeReply, finish, persist, saveQuietly]);

  const stop = useCallback((): Promise<void> => {
    if (batch.current) {
      batch.current.cancelled = true;
      replace({ ...valueRef.current, conversations: valueRef.current.conversations.map(chat => ({ ...chat, tasks: chat.tasks?.map(task => ({ ...task, results: task.results.map(result => result.message.status === 'waiting' ? { ...result, message: { ...result.message, status: 'stopped' } } : result) })) })) });
    }
    if (cancelPending.current) return cancelPending.current;
    const request = active.current;
    if (!request) return persist().catch(() => {});
    cancelling.current = request;
    const saved = finish(request, 'stopped').catch(() => {});
    const pending = (async () => {
      try { await backend.cancel(request.requestId); }
      catch (reason) { if (mounted.current) setError(describeError(reason)); }
      finally {
        cancelling.current = null;
        cancelPending.current = null;
        if (mounted.current) setBusy(null);
      }
      await saved;
    })();
    cancelPending.current = pending;
    return pending;
  }, [backend, finish, replace, persist]);

  const saveProvider = useCallback(async (provider: AiProvider, apiKey?: string) => {
    if (exiting.current || aiUpdatePending()) throw new Error('应用正在保存并准备退出，请稍后修改 AI 数据。');
    if (!initialized.current) throw new Error('AI 数据尚未加载，不能修改服务。');
    if (active.current || cancelling.current || batch.current) throw new Error('请先停止生成，再修改模型服务。');
    mutationsPending.current++;
    try {
      await enqueue(async () => {
        const saved = await backend.saveProvider(provider, apiKey);
        const providers = valueRef.current.providers.filter(item => item.id !== saved.id);
        replace({ ...valueRef.current, providers: [...providers, saved] });
      });
      await persist();
    } catch (reason) { if (mounted.current) setError(describeError(reason)); throw reason; }
    finally { mutationsPending.current--; }
  }, [backend, enqueue, persist, replace]);

  const removeProvider = useCallback(async (id: string) => {
    if (exiting.current || aiUpdatePending()) throw new Error('应用正在保存并准备退出，请稍后修改 AI 数据。');
    if (!initialized.current) throw new Error('AI 数据尚未加载，不能删除服务。');
    if (active.current || cancelling.current || batch.current) throw new Error('请先停止生成，再删除模型服务。');
    mutationsPending.current++;
    try {
      await enqueue(async () => {
        await backend.removeProvider(id);
        replace({ ...valueRef.current, providers: valueRef.current.providers.filter(provider => provider.id !== id) });
      });
      await persist();
    } catch (reason) { if (mounted.current) setError(describeError(reason)); throw reason; }
    finally { mutationsPending.current--; }
  }, [backend, enqueue, persist, replace]);

  const clearHistory = useCallback(async () => {
    if (exiting.current || aiUpdatePending()) throw new Error('应用正在保存并准备退出，请稍后修改 AI 数据。');
    if (!initialized.current) throw new Error('AI 数据尚未加载，不能清空历史。');
    mutationsPending.current++;
    try {
      if (active.current || cancelling.current || batch.current) await stop();
      replace({ ...valueRef.current, conversations: [], activeConversationId: undefined });
      await persist();
    } finally { mutationsPending.current--; }
  }, [persist, replace, stop]);

  const reset = useCallback(async () => {
    if (exiting.current || aiUpdatePending()) throw new Error('应用正在保存并准备退出，请稍后修改 AI 数据。');
    mutationsPending.current++;
    try {
      if (active.current || cancelling.current || batch.current) await stop();
      if (mounted.current) setLoading(true);
      initialized.current = false;
      await enqueue(async () => {
        await backend.reset();
        const next = createWorkspace();
        replace(next);
        await backend.save(next);
      });
      initialized.current = true;
      if (mounted.current) { setError(null); setSaveError(null); setLoading(false); }
    } catch (reason) {
      if (mounted.current) { setLoading(false); setError(describeError(reason)); setSaveError(describeError(reason)); }
      throw reason;
    } finally { mutationsPending.current--; }
  }, [backend, enqueue, replace, stop]);

  return { workspace, loading: loading || updatePending, updating: updatePending, error, saveError, busy, update, reload, send, regenerate, runTask, stop, saveProvider, removeProvider, clearHistory, reset };
}
