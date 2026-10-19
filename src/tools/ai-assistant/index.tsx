import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUpRight, BotMessageSquare, Check, Code2, Copy, Languages, Lightbulb, Menu, MessageSquare, Paperclip, Pencil, Plus, Search, Send, Settings2, ShieldCheck, SlidersHorizontal, Square, Trash2 } from 'lucide-react';
import { nanoid } from 'nanoid';
import { saveBytesWithFeedback } from '@/lib/file-save';
import { desktopAiBackend } from './backend';
import { useAiWorkspace } from './use-ai-workspace';
import { buildContext, exportConversation, newConversation, providerTarget } from './model';
import { readAttachment, validateAttachments } from './attachments';
import type { AiAssistant, AiConversation } from './types';
import { AiSettings } from './settings';
import { AssistantDialog } from './assistant-dialog';
import { ConversationSettings } from './conversation-settings';
import { ConversationExport } from './conversation-export';
import { AttachmentPreview, MessageView } from './message-view';
import { AiDialog, AiError } from './ui';
import { iconLabel, useAiText } from './ui-text';
import './ai-assistant.css';

type ConfirmAction = { title: string; description: string; action(): void | Promise<void>; alternative?: { label: string; action(): void } };

export default function AiAssistantPage() {
  const t = useAiText();
  const api = useAiWorkspace(desktopAiBackend);
  const { workspace, loading, updating, error, saveError, busy } = api;
  const [settings, setSettings] = useState(false);
  const [assistantEditor, setAssistantEditor] = useState<AiAssistant | 'new' | null>(null);
  const [parametersOpen, setParametersOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [localError, setLocalError] = useState<unknown>();
  const [confirm, setConfirm] = useState<ConfirmAction | null>(null);
  const [rename, setRename] = useState<AiConversation | null>(null);
  const [deleteAssistant, setDeleteAssistant] = useState<AiAssistant | null>(null);
  const [transferTarget, setTransferTarget] = useState('');
  const [edit, setEdit] = useState<{ id: string; content: string } | null>(null);
  const [followBottom, setFollowBottom] = useState(true);
  const [readingFiles, setReadingFiles] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const composing = useRef(false);
  const loadedSuccessfully = useRef(false);
  if (!loading && !error) loadedSuccessfully.current = true;
  const assistant = workspace.assistants.find(item => item.id === workspace.activeAssistantId) ?? workspace.assistants[0];
  const conversation = workspace.conversations.find(item => item.id === workspace.activeConversationId);
  const currentBusy = busy?.conversationId === conversation?.id;
  const provider = workspace.providers.find(item => item.id === conversation?.providerId && item.enabled);
  const model = provider?.models.find(item => item.id === conversation?.modelId);
  const availableProviders = workspace.providers.filter(item => item.enabled && item.models.length);
  const lastMessage = conversation?.messages[conversation.messages.length - 1];
  const latestAssistantId = lastMessage?.role === 'assistant' ? lastMessage.id : undefined;

  function createConversation(selected: AiAssistant = assistant) {
    const created = newConversation(selected);
    if (!created.providerId) {
      const fallback = availableProviders[0];
      created.providerId = fallback?.id;
      created.modelId = fallback?.models[0]?.id;
    }
    api.update(value => ({ ...value, conversations: [...value.conversations, created], activeConversationId: created.id, activeAssistantId: selected.id }));
    setEdit(null); setSidebarOpen(false); setLocalError(undefined); setFollowBottom(true);
    return created;
  }

  useEffect(() => {
    if (!loading && (!error || loadedSuccessfully.current) && assistant && !conversation) {
      const existing = workspace.conversations.find(item => item.assistantId === assistant.id);
      if (existing) api.update(value => ({ ...value, activeConversationId: existing.id }));
      else createConversation(assistant);
    }
  // Initial selection and clear-history recovery happen only when a conversation is absent.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, error, conversation?.id, assistant?.id]);

  useEffect(() => {
    if (followBottom && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [conversation?.messages, followBottom]);

  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    const resize = () => { input.style.height = '0px'; input.style.height = `${input.scrollHeight}px`; };
    resize();
    if (typeof ResizeObserver === 'undefined') return;
    let width = input.clientWidth;
    const observer = new ResizeObserver(() => {
      if (input.clientWidth !== width) { width = input.clientWidth; resize(); }
    });
    observer.observe(input);
    return () => observer.disconnect();
  }, [conversation?.draft, conversation?.id]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => { if (root.clientWidth >= 800) setSidebarOpen(false); });
    observer.observe(root);
    return () => observer.disconnect();
  }, [loading, conversation?.id]);

  useEffect(() => {
    if (!sidebarOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    const panel = sidebarRef.current;
    panel?.querySelector<HTMLElement>('select,button,input')?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setSidebarOpen(false); }
      if (event.key !== 'Tab') return;
      const nodes = [...(panel?.querySelectorAll<HTMLElement>('button:not(:disabled),input,select') ?? [])];
      if (event.shiftKey && document.activeElement === nodes[0]) { event.preventDefault(); nodes[nodes.length - 1]?.focus(); }
      else if (!event.shiftKey && document.activeElement === nodes[nodes.length - 1]) { event.preventDefault(); nodes[0]?.focus(); }
    };
    document.addEventListener('keydown', keydown, true);
    return () => { document.removeEventListener('keydown', keydown, true); previous?.focus(); };
  }, [sidebarOpen]);

  function patchConversation(change: Partial<AiConversation>, id = conversation?.id) {
    api.update(value => ({ ...value, conversations: value.conversations.map(item => item.id === id ? { ...item, ...change, updatedAt: Date.now() } : item) }));
  }
  async function run(action: () => void | Promise<void>) {
    setLocalError(undefined);
    try { await action(); } catch (error) { setLocalError(error); }
  }
  function selectConversation(item: AiConversation) {
    api.update(value => ({ ...value, activeConversationId: item.id, activeAssistantId: item.assistantId }));
    setEdit(null); setSidebarOpen(false); setLocalError(undefined); setFollowBottom(true);
  }
  function selectAssistant(id: string) {
    const selected = workspace.assistants.find(item => item.id === id);
    if (!selected) return;
    const existing = workspace.conversations.filter(item => item.assistantId === id).sort((a, b) => b.updatedAt - a.updatedAt)[0];
    if (existing) selectConversation(existing); else createConversation(selected);
  }
  function confirmTarget(action: () => void | Promise<void>) {
    if (!conversation || !provider) return;
    const target = providerTarget(provider);
    if (conversation.messages.some(message => message.role === 'user') && !conversation.approvedTargets.includes(target)) {
      setConfirm({ title: t('向此服务发送历史？', 'Send history to this service?'), description: t(`本次将向 ${provider.name}（${provider.baseUrl}）发送消息及选定历史，包括其中的附件。`, `This sends the message and selected history, including its attachments, to ${provider.name} (${provider.baseUrl}).`), action: async () => { patchConversation({ approvedTargets: [...conversation.approvedTargets, target] }); await action(); }, alternative: { label: t('改为新建会话', 'Start a new conversation'), action: () => { const next = createConversation(assistant); patchConversation({ providerId: provider.id, modelId: model?.id, draft: conversation.draft, draftAttachments: conversation.draftAttachments }, next.id); } } });
    } else void run(action);
  }
  function send() {
    if (!conversation || busy || readingFiles) return;
    setFollowBottom(true);
    if (!provider || !model) { setLocalError(t('请选择有效的模型服务与模型', 'Select a valid model service and model.')); return; }
    confirmTarget(() => api.send(conversation.id));
  }
  async function addFiles(files: File[]) {
    if (!conversation || !files.length) return;
    const conversationId = conversation.id;
    setReadingFiles(true); setLocalError(undefined);
    try {
      const attachments = await Promise.all(files.map(readAttachment));
      api.update(value => ({ ...value, conversations: value.conversations.map(item => {
        if (item.id !== conversationId) return item;
        const combined = [...item.draftAttachments, ...attachments]; validateAttachments(combined);
        return { ...item, draftAttachments: combined, updatedAt: Date.now() };
      }) }));
    } catch (error) { setLocalError(error); } finally { setReadingFiles(false); }
  }
  async function exportChat(format: 'markdown' | 'json') {
    if (!conversation) return;
    const extension = format === 'markdown' ? 'md' : 'json';
    const title = [...conversation.title].map(character => character.charCodeAt(0) < 32 || /[<>:"/\\|?*]/.test(character) ? '_' : character).join('').slice(0, 100) || 'conversation';
    await saveBytesWithFeedback(`${title}.${extension}`, new Blob([exportConversation(conversation, format)], { type: format === 'json' ? 'application/json' : 'text/markdown;charset=utf-8' }), format === 'json' ? 'JSON' : 'Markdown', [extension]);
  }
  function removeConversation(item: AiConversation) {
    setConfirm({ title: t('删除会话？', 'Delete conversation?'), description: t('此会话、草稿及其独占附件将从本机删除，无法撤销。', 'This conversation, its draft and unshared attachments will be deleted locally. This cannot be undone.'), action: () => {
      api.update(value => ({ ...value, conversations: value.conversations.filter(chat => chat.id !== item.id), activeConversationId: value.activeConversationId === item.id ? undefined : value.activeConversationId }));
    } });
  }
  let historyRounds = 0;
  if (conversation) {
    const context = buildContext({ ...conversation, messages: [...conversation.messages, { id: 'draft-context-preview', role: 'user', status: 'complete', content: conversation.draft, attachments: conversation.draftAttachments, createdAt: 0 }] });
    historyRounds = Math.max(0, context.filter(message => message.role === 'user').length - 1);
  }
  if (loading || (!conversation && !error)) return <div className="ai-loading" role="status">{updating ? t('正在更新应用，AI 助手已暂停…', 'Updating the app. AI assistant is paused…') : t('正在读取本地会话…', 'Loading local conversations…')}</div>;
  if (error && !loadedSuccessfully.current) return <div className="ai-loading"><AiError error={error} /><div className="ai-button-row"><button type="button" onClick={() => void run(api.reload)}>{t('重新读取', 'Reload')}</button><button type="button" onClick={() => void run(() => desktopAiBackend.openDataDirectory())}>{t('打开数据目录', 'Open data directory')}</button></div><AiError error={localError} /></div>;
  return <div ref={rootRef} className="ai-workspace" onDragOver={event => { if (event.dataTransfer.types.includes('Files')) event.preventDefault(); }} onDrop={event => { if (event.dataTransfer.files.length) { event.preventDefault(); void addFiles([...event.dataTransfer.files]); } }}>
    {sidebarOpen && <button type="button" className="ai-sidebar-scrim" aria-label={t('关闭会话列表', 'Close conversations')} onClick={() => setSidebarOpen(false)} />}
    <aside ref={sidebarRef} role={sidebarOpen ? 'dialog' : undefined} aria-modal={sidebarOpen || undefined} aria-label={t('助手与会话', 'Assistants and conversations')} className={`ai-sidebar ${sidebarOpen ? 'ai-sidebar-open' : ''}`}>
      <div className="ai-assistant-picker"><div className="ai-section-caption">{t('我的助手', 'MY ASSISTANTS')}</div><div className="ai-button-row"><BotMessageSquare size={19} /><select aria-label={t('助手', 'Assistant')} value={assistant?.id ?? ''} onChange={event => selectAssistant(event.target.value)}>{workspace.assistants.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><button type="button" className="ai-icon-button" {...iconLabel(t('新建助手', 'New assistant'))} onClick={() => setAssistantEditor('new')}><Plus size={17} /></button></div>
        <div className="ai-assistant-actions"><button type="button" onClick={() => setAssistantEditor(assistant)}><Pencil size={12} />{t('编辑助手', 'Edit assistant')}</button><button type="button" {...iconLabel(t('复制助手', 'Duplicate assistant'))} onClick={() => { const next = { ...assistant, id: nanoid(), name: `${assistant.name} ${t('副本', 'copy')}`, parameters: { ...assistant.parameters } }; api.update(value => ({ ...value, assistants: [...value.assistants, next] })); createConversation(next); }}><Copy size={12} /></button><button type="button" disabled={workspace.assistants.length <= 1 || !!busy} {...iconLabel(t('删除助手', 'Delete assistant'))} onClick={() => { setDeleteAssistant(assistant); setTransferTarget(workspace.assistants.find(item => item.id !== assistant.id)?.id ?? ''); }}><Trash2 size={12} /></button></div>
      </div>
      <button type="button" className="ai-new-conversation" onClick={() => createConversation()}><Plus size={16} />{t('新建会话', 'New conversation')}</button>
      <div className="ai-conversation-search"><Search size={14} /><input aria-label={t('搜索会话', 'Search conversations')} placeholder={t('搜索会话', 'Search conversations')} value={search} onChange={event => setSearch(event.target.value)} /></div>
      <nav className="ai-conversations" aria-label={t('会话', 'Conversations')}>
        {workspace.conversations.filter(item => item.assistantId === assistant?.id && item.title.toLocaleLowerCase().includes(search.toLocaleLowerCase())).sort((a, b) => b.updatedAt - a.updatedAt).map(item => <div key={item.id} className={`ai-conversation-row ${item.id === conversation?.id ? 'is-active' : ''}`}><button type="button" aria-label={`${t('打开会话', 'Open conversation')}: ${item.title}`} onClick={() => selectConversation(item)}><MessageSquare size={14} /><span>{item.title}</span>{busy?.conversationId === item.id && <span className="ai-generating-dot" />}</button><div className="ai-conversation-actions"><button type="button" className="ai-icon-button" {...iconLabel(`${t('重命名会话', 'Rename conversation')}: ${item.title}`)} onClick={() => setRename(item)}><Pencil size={12} /></button><button type="button" className="ai-icon-button" disabled={busy?.conversationId === item.id} {...iconLabel(`${t('删除会话', 'Delete conversation')}: ${item.title}`)} onClick={() => removeConversation(item)}><Trash2 size={12} /></button></div></div>)}
      </nav>
      <div className="ai-sidebar-footer"><span><ShieldCheck size={13} />{t('会话保存在本机', 'Conversations saved locally')}</span><button type="button" className="ai-settings-button" disabled={!!busy} onClick={() => setSettings(true)}><Settings2 size={16} />{t('模型服务设置', 'Model service settings')}</button></div>
    </aside>
    <main className="ai-chat">
      <header className="ai-chat-header"><button type="button" className="ai-icon-button ai-mobile-menu" {...iconLabel(t('会话列表', 'Conversations'))} onClick={() => setSidebarOpen(!sidebarOpen)}><Menu size={18} /></button><div className="ai-chat-heading"><h2>{conversation?.title || t('新会话', 'New conversation')}</h2><span>{assistant?.name}</span></div>{currentBusy && <span className="ai-chat-progress" role="status"><span className="ai-generating-dot" />{t('正在生成', 'Generating')}</span>}</header>
      {saveError && <div className="ai-save-error"><AiError error={saveError} /><button type="button" onClick={() => api.update(value => ({ ...value }))}>{t('重试保存', 'Retry save')}</button></div>}
      {typeof window !== 'undefined' && !('__TAURI_INTERNALS__' in window) && <p className="ai-preview-notice">{t('浏览器预览：模型连接、系统密钥和本地持久化请在桌面应用中使用。', 'Browser preview: use the desktop app for model connections, system credentials and local persistence.')}</p>}
      <div className="ai-messages" ref={scrollRef} onScroll={event => { const node = event.currentTarget; setFollowBottom(node.scrollHeight - node.scrollTop - node.clientHeight < 80); }}>
        {!conversation?.messages.length ? <div className="ai-welcome"><div className="ai-welcome-icon"><BotMessageSquare size={30} strokeWidth={1.6} /></div><span className="ai-section-caption">{t('想法，从这里开始', 'A LITTLE SPACE TO THINK')}</span><h1>{t('今天，想一起做点什么？', 'What shall we work on today?')}</h1><p>{assistant?.description || t('提个问题，整理思路，或一起解决代码难题。', 'Ask a question, shape an idea, or work through some code.')}</p>{!availableProviders.length ? <div className="ai-welcome-setup"><button type="button" className="ai-primary" onClick={() => setSettings(true)}><Plus size={16} />{t('配置模型服务', 'Configure model service')}</button><span>{t('连接服务并启用模型，即可开始对话', 'Connect a service and enable a model to get started')}</span></div> : <div className="ai-suggestions">{[
          { Icon: Lightbulb, title: t('理清思路', 'Think it through'), text: t('帮我梳理一个问题的思路', 'Help me think through a problem'), hint: t('把复杂问题拆成清晰步骤', 'Break a problem into clear steps') },
          { Icon: Code2, title: t('读懂代码', 'Understand code'), text: t('解释一段代码的实现逻辑', 'Explain how a piece of code works'), hint: t('理解逻辑，找到改进方向', 'Understand the logic and improve it') },
          { Icon: Languages, title: t('润色表达', 'Find the words'), text: t('把这段文字翻译得更自然', 'Translate a passage naturally'), hint: t('让文字更自然、更准确', 'Make your writing feel natural') },
        ].map(({ Icon, title, text, hint }) => <button type="button" key={text} onClick={() => { patchConversation({ draft: text }); inputRef.current?.focus(); }}><Icon size={19} strokeWidth={1.6} /><strong>{title}</strong><span>{hint}</span><ArrowUpRight size={14} className="ai-suggestion-arrow" /></button>)}</div>}<p className="ai-welcome-note"><ShieldCheck size={13} />{t('会话保存在本机，发送时才会连接所选模型服务', 'Conversations stay on this device until you send them to your selected service')}</p></div> : conversation.messages.map(message => <MessageView key={message.id} message={message} disabled={!!busy} lastAssistant={message.id === latestAssistantId} onEdit={message => setEdit({ id: message.id, content: message.content })} onRegenerate={() => confirmTarget(() => api.regenerate(conversation.id))} />)}
      </div>
      <div className="ai-compose-area"><AiError error={localError || error} />
        {!followBottom && <button type="button" className="ai-back-bottom" onClick={() => { setFollowBottom(true); if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }}><ArrowDown size={14} />{t('回到底部', 'Back to bottom')}</button>}
        {busy && !currentBusy && <div className="ai-busy-notice">{t('另一会话正在生成，请先停止后再发送。', 'Another conversation is generating. Stop it before sending here.')}<button type="button" onClick={() => void run(api.stop)}>{t('停止生成', 'Stop generating')}</button></div>}
        {!!conversation?.draftAttachments.length && <div className="ai-attachments ai-draft-attachments">{conversation.draftAttachments.map(attachment => <AttachmentPreview key={attachment.id} attachment={attachment} onRemove={() => patchConversation({ draftAttachments: conversation.draftAttachments.filter(item => item.id !== attachment.id) })} />)}</div>}
        <section className="ai-composer" aria-label={t('消息输入区', 'Message composer')}><textarea ref={inputRef} aria-label={t('消息', 'Message')} placeholder={t('输入消息，或粘贴、拖入附件…', 'Write a message, paste or drop an attachment…')} rows={2} disabled={!conversation} value={conversation?.draft ?? ''} onChange={event => patchConversation({ draft: event.target.value })} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && !composing.current && event.keyCode !== 229) { event.preventDefault(); send(); } }} onPaste={event => { const files = [...event.clipboardData.files].filter(file => file.type.startsWith('image/')); if (files.length) { event.preventDefault(); void addFiles(files); } }} />
          <div className="ai-composer-toolbar">
            <div className="ai-composer-model"><BotMessageSquare size={15} /><select aria-label={t('当前模型', 'Current model')} title={provider ? `${provider.name} · ${provider.baseUrl}` : t('选择已启用的模型', 'Choose an enabled model')} disabled={!conversation || currentBusy} value={provider && model ? `${provider.id}::${model.id}` : ''} onChange={event => { const pair = availableProviders.flatMap(item => item.models.map(model => ({ provider: item, model }))).find(pair => `${pair.provider.id}::${pair.model.id}` === event.target.value); if (pair) patchConversation({ providerId: pair.provider.id, modelId: pair.model.id }); }}><option value="">{t('选择模型', 'Select a model')}</option>{availableProviders.map(item => <optgroup key={item.id} label={item.name}>{item.models.map(model => <option key={model.id} value={`${item.id}::${model.id}`}>{item.name} · {model.name}</option>)}</optgroup>)}</select></div>
            <div className="ai-composer-actions"><input ref={fileRef} type="file" multiple hidden onChange={event => { void addFiles([...(event.target.files ?? [])]); event.target.value = ''; }} accept="image/png,image/jpeg,image/webp,.txt,.md,.markdown,.json,.log,.csv,.xml,.yaml,.yml,.ts,.tsx,.js,.jsx,.py,.rs,.go,.java,.cs,.cpp,.c,.h,.css,.html,.sql,.sh,.ps1,.toml,.ini,.vue,.svelte" /><button type="button" className="ai-icon-button" disabled={readingFiles || !conversation} {...iconLabel(t('添加附件', 'Add attachments'))} onClick={() => fileRef.current?.click()}><Paperclip size={17} /></button>
            <button type="button" className="ai-icon-button" disabled={!conversation || currentBusy} {...iconLabel(t('会话参数', 'Conversation settings'))} onClick={() => setParametersOpen(true)}><SlidersHorizontal size={17} /></button>
            <ConversationExport key={conversation?.id} onExport={format => void run(() => exportChat(format))} />
            {currentBusy ? <button type="button" className="ai-stop-button" onClick={() => void run(api.stop)} {...iconLabel(t('停止生成', 'Stop generating'))}><Square size={13} fill="currentColor" />{t('停止', 'Stop')}</button> : <button type="button" className="ai-primary ai-send-button" disabled={!!busy || readingFiles || !conversation || (!conversation.draft.trim() && !conversation.draftAttachments.length)} onClick={send} {...iconLabel(t('发送', 'Send'))}><Send size={15} />{t('发送', 'Send')}</button>}
            </div>
          </div>
        </section><div className="ai-compose-meta"><span>{readingFiles ? t('读取附件…', 'Reading attachments…') : t(`上下文 ${historyRounds}/${conversation?.parameters.historyRounds ?? 20} 轮`, `Context ${historyRounds}/${conversation?.parameters.historyRounds ?? 20} rounds`)}{model?.supportsImages && <span className="ai-image-capability"><Check size={12} />{t('支持图片', 'Images supported')}</span>}</span><span className="ai-compose-shortcut">{t('Enter 发送 · Shift + Enter 换行', 'Enter to send · Shift + Enter for a new line')}</span></div>
        <p className="ai-compose-note">{t('AI 内容仅供参考，请核实重要信息。', 'AI can make mistakes. Check important information.')}</p>
      </div>
    </main>
    {settings && <AiSettings providers={workspace.providers} backend={desktopAiBackend} onSave={api.saveProvider} onRemove={api.removeProvider} onClearHistory={api.clearHistory} onReset={api.reset} onClose={() => setSettings(false)} />}
    {assistantEditor && <AssistantDialog assistant={assistantEditor === 'new' ? undefined : assistantEditor} providers={workspace.providers} onClose={() => setAssistantEditor(null)} onSave={value => { const exists = workspace.assistants.some(item => item.id === value.id); api.update(current => ({ ...current, assistants: exists ? current.assistants.map(item => item.id === value.id ? value : item) : [...current.assistants, value] })); if (!exists) createConversation(value); }} />}
    {parametersOpen && conversation && <ConversationSettings conversation={conversation} onClose={() => setParametersOpen(false)} onSave={value => patchConversation(value)} />}
    {edit && <AiDialog title={t('编辑消息', 'Edit message')} onClose={() => setEdit(null)}><form className="ai-form" onSubmit={event => { event.preventDefault(); if (!conversation || !edit.content.trim()) return; setConfirm({ title: t('替换后续消息？', 'Replace following messages?'), description: t('此操作将替换该条消息并删除它之后的全部对话，再发送给当前模型。', 'This replaces the message, deletes all following messages, and sends the edited message to the current model.'), action: async () => { const edited = edit; setEdit(null); confirmTarget(() => api.send(conversation.id, { editMessageId: edited.id, content: edited.content })); } }); }}><label>{t('编辑消息内容', 'Edit message content')}<textarea rows={7} value={edit.content} onChange={event => setEdit({ ...edit, content: event.target.value })} /></label><footer><button type="button" onClick={() => setEdit(null)}>{t('取消', 'Cancel')}</button><button type="submit" disabled={!!busy || !edit.content.trim()} className="ai-primary">{t('重新发送编辑消息', 'Resend edited message')}</button></footer></form></AiDialog>}
    {confirm && <AiDialog title={confirm.title} onClose={() => setConfirm(null)}><div className="ai-form"><p>{confirm.description}</p><footer><button type="button" onClick={() => setConfirm(null)}>{t('取消', 'Cancel')}</button>{confirm.alternative && <button type="button" onClick={() => { const action = confirm.alternative!.action; setConfirm(null); action(); }}>{confirm.alternative.label}</button>}<button type="button" className="ai-primary" onClick={() => { const action = confirm.action; setConfirm(null); void run(action); }}>{t('确认', 'Confirm')}</button></footer></div></AiDialog>}
    {rename && <AiDialog title={t('重命名会话', 'Rename conversation')} onClose={() => setRename(null)}><form className="ai-form" onSubmit={event => { event.preventDefault(); if (rename.title.trim()) { patchConversation({ title: rename.title.trim() }, rename.id); setRename(null); } }}><label>{t('会话标题', 'Conversation title')}<input required maxLength={120} value={rename.title} onChange={event => setRename({ ...rename, title: event.target.value })} /></label><footer><button type="button" onClick={() => setRename(null)}>{t('取消', 'Cancel')}</button><button type="submit" className="ai-primary">{t('保存', 'Save')}</button></footer></form></AiDialog>}
    {deleteAssistant && <AiDialog title={t('删除助手', 'Delete assistant')} onClose={() => setDeleteAssistant(null)}><div className="ai-form"><p>{t('请选择保留并转移会话，或一并删除会话及附件。无法撤销。', 'Transfer this assistant’s conversations, or delete them and their attachments together. This cannot be undone.')}</p><label>{t('转移会话至', 'Transfer conversations to')}<select value={transferTarget} onChange={event => setTransferTarget(event.target.value)}>{workspace.assistants.filter(item => item.id !== deleteAssistant.id).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><footer><button type="button" onClick={() => setDeleteAssistant(null)}>{t('取消', 'Cancel')}</button>{[false, true].map(removeHistory => <button type="button" className={removeHistory ? 'ai-danger' : 'ai-primary'} key={String(removeHistory)} onClick={() => { api.update(value => ({ ...value, assistants: value.assistants.filter(item => item.id !== deleteAssistant.id), conversations: removeHistory ? value.conversations.filter(item => item.assistantId !== deleteAssistant.id) : value.conversations.map(item => item.assistantId === deleteAssistant.id ? { ...item, assistantId: transferTarget } : item), activeAssistantId: transferTarget, activeConversationId: undefined })); setDeleteAssistant(null); }}>{removeHistory ? t('连同历史删除', 'Delete with history') : t('转移并删除助手', 'Transfer and delete assistant')}</button>)}</footer></div></AiDialog>}
  </div>;
}
