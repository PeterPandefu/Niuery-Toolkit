import { Select } from '@/components/ui/select';
import { useState } from 'react';
import { nanoid } from 'nanoid';
import { Archive, Box, Check, Database, KeyRound, Loader2, Plus, RefreshCw, Server, Unplug } from 'lucide-react';
import type { AiBackend, AiConversation, AiModel, AiProvider } from './types';
import { AiDialog, AiError } from './ui';
import { useAiText } from './ui-text';
import { AiEnabledModel, AiModelPicker } from './model-settings';
import { uniqueModels } from './model';

interface SettingsProps {
  providers: AiProvider[];
  conversations?: AiConversation[];
  backend: AiBackend;
  onSave(provider: AiProvider, apiKey?: string): Promise<unknown>;
  onRemove(id: string): Promise<unknown>;
  onClearHistory(): Promise<unknown>;
  onReset(): Promise<unknown>;
  onUnarchive?(id: string): void;
  onSelectConversation?(item: AiConversation): void;
  onClose(): void;
}

export function AiSettings({ providers, conversations = [], backend, onSave, onRemove, onClearHistory, onReset, onUnarchive = () => {}, onSelectConversation = () => {}, onClose }: SettingsProps) {
  const t = useAiText();
  const makeProvider = (): AiProvider => ({ id: nanoid(), name: '', kind: 'openai', baseUrl: 'https://api.openai.com/v1', hasApiKey: false, models: [], enabled: true });
  const [provider, setProvider] = useState<AiProvider>(providers[0] ?? makeProvider());
  const [apiKey, setApiKey] = useState<string | undefined>();
  const [manualId, setManualId] = useState('');
  const [error, setError] = useState<unknown>();
  const [feedback, setFeedback] = useState('');
  const [working, setWorking] = useState(false);
  const [confirm, setConfirm] = useState<'provider' | 'history' | 'reset' | null>(null);
  const [discardTarget, setDiscardTarget] = useState<AiProvider | null>(null);
  const [dirty, setDirty] = useState(false);
  const [catalog, setCatalog] = useState<AiModel[] | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [testModelId, setTestModelId] = useState('');
  const [tab, setTab] = useState<'services' | 'archive'>('services');
  function edit(next: AiProvider) {
    if (next.baseUrl !== provider.baseUrl || next.kind !== provider.kind) setCatalog(null);
    setProvider(next); setDirty(true); setFeedback('');
  }
  function select(next: AiProvider) {
    if (dirty) { setDiscardTarget(next); return; }
    switchTo(next);
  }
  function switchTo(next: AiProvider) { setProvider(next); setApiKey(undefined); setDirty(false); setFeedback(''); setError(undefined); setDiscardTarget(null); setManualId(''); setCatalog(null); setPickerOpen(false); }
  async function run(operation: () => Promise<void>) {
    setWorking(true); setError(undefined); setFeedback('');
    try { await operation(); } catch (error) { setError(error); } finally { setWorking(false); }
  }
  function normalized() {
    if (!provider.name.trim()) throw new Error(t('请输入服务名称', 'Enter a service name.'));
    const url = new URL(provider.baseUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error(t('请输入不含凭据、参数或片段的 HTTP(S) 地址', 'Enter an HTTP(S) URL without embedded credentials, query, or fragment.'));
    const ids = provider.models.map(model => model.id.trim());
    for (const model of provider.models) {
      if ([model.contextWindow, model.maxOutputTokens].some(value => value !== undefined && (!Number.isSafeInteger(value) || value < 1 || value > 10_000_000))) throw new Error(t('模型容量必须为正整数', 'Model capacities must be positive integers.'));
      if (model.contextWindow && model.maxOutputTokens && model.maxOutputTokens >= model.contextWindow) throw new Error(t('最大输出必须小于上下文容量', 'Maximum output must be less than context capacity.'));
    }
    if (ids.some(id => !id) || new Set(ids).size !== ids.length) throw new Error(t('模型 ID 不能为空或重复', 'Model IDs must be nonempty and unique.'));
    return { ...provider, name: provider.name.trim(), baseUrl: provider.baseUrl.trim().replace(/\/+$/, ''), models: provider.models.map(model => ({ ...model, id: model.id.trim(), name: model.name.trim() || model.id.trim() })) };
  }
  async function save() {
    const next = normalized();
    await onSave(next, apiKey);
    const saved = { ...next, hasApiKey: apiKey === undefined ? next.hasApiKey : apiKey.length > 0 };
    setProvider(saved); setApiKey(undefined); setDirty(false); setFeedback(t('服务已保存', 'Service saved'));
    return saved;
  }
  function addManualModel() {
    const id = manualId.trim();
    if (working || !id) return;
    if (!provider.models.some(model => model.id === id)) edit({ ...provider, models: [...provider.models, { id, name: id, supportsImages: false }] });
    setManualId('');
  }
  const archived = conversations.filter(item => item.archived).sort((a, b) => b.updatedAt - a.updatedAt);
  return <AiDialog title={t('设置', 'Settings')} description={t('管理模型服务与本地归档会话。', 'Manage model services and archived local conversations.')} onClose={working ? () => {} : onClose} className="ai-settings-dialog" wide>
    <div className="ai-settings-shell">
      <nav className="ai-settings-nav" aria-label={t('设置分类', 'Settings sections')}>
        <button type="button" className={tab === 'services' ? 'is-active' : ''} aria-current={tab === 'services' ? 'page' : undefined} onClick={() => setTab('services')}><span className="ai-settings-nav-icon"><Server size={16} aria-hidden="true" /></span><strong>{t('模型服务', 'Model services')}</strong></button>
        <button type="button" className={tab === 'archive' ? 'is-active' : ''} aria-current={tab === 'archive' ? 'page' : undefined} onClick={() => setTab('archive')}><span className="ai-settings-nav-icon"><Archive size={16} aria-hidden="true" /></span><strong>{t('归档', 'Archive')}</strong></button>
      </nav>
      {tab === 'archive' ? <section className="ai-archive-panel" aria-labelledby="ai-archive-heading"><div className="ai-settings-section-heading"><span className="ai-settings-section-icon"><Archive size={18} aria-hidden="true" /></span><div><h3 id="ai-archive-heading">{t('已归档会话', 'Archived conversations')}</h3><p>{t('归档的会话会保留在本机，可随时恢复。', 'Archived conversations stay on this device and can be restored anytime.')}</p></div></div>{archived.length ? <div className="ai-archive-list">{archived.map(item => <article key={item.id} className="ai-archive-item"><button type="button" className="ai-archive-item-main" onClick={() => onSelectConversation(item)}><strong>{item.title || t('未命名会话', 'Untitled conversation')}</strong><span>{new Date(item.updatedAt).toLocaleString()} · {item.messages.length} {t('条消息', 'messages')}</span></button><button type="button" onClick={() => onUnarchive(item.id)}>{t('取消归档', 'Unarchive')}</button></article>)}</div> : <div className="ai-archive-empty"><Archive size={28} aria-hidden="true" /><strong>{t('暂无归档会话', 'No archived conversations')}</strong><span>{t('在会话操作中归档的内容会显示在这里。', 'Conversations archived from the conversation menu appear here.')}</span></div>}</section> : <div className="ai-settings-layout">
      <nav className="ai-provider-list" aria-label={t('模型服务', 'Model services')}>
        <div className="ai-provider-caption">{t('模型服务', 'MODEL SERVICES')}<span>{providers.length}</span></div>
        <div className="ai-provider-items">{providers.map(item => <button type="button" key={item.id} disabled={working} aria-current={provider.id === item.id ? 'true' : undefined} className={provider.id === item.id ? 'is-active' : ''} onClick={() => select(item)}><span className="ai-provider-icon"><Server size={17} aria-hidden="true" /></span><span className="ai-provider-name"><strong>{item.name}</strong><small>{item.kind === 'ollama' ? 'Ollama' : 'OpenAI'} · {t(`${item.models.length} 个模型`, `${item.models.length} models`)}</small></span><span className={`ai-provider-dot ${item.enabled ? 'is-enabled' : ''}`} aria-label={item.enabled ? t('已启用', 'Enabled') : t('已停用', 'Disabled')} /></button>)}</div>
        {!providers.some(item => item.id === provider.id) && <div className="ai-provider-draft"><Server size={17} aria-hidden="true" /><span>{provider.name || t('新服务', 'New service')}<small>{t('尚未保存', 'Not saved yet')}</small></span></div>}
        <button type="button" className="ai-add-provider" disabled={working} onClick={() => select(makeProvider())}><Plus size={16} aria-hidden="true" />{t('添加服务', 'Add service')}</button>
        <p className="ai-provider-note"><KeyRound size={14} aria-hidden="true" />{t('密钥安全存储于系统凭据中', 'Keys are stored securely in system credentials')}</p>
      </nav>
      <form className="ai-form ai-provider-form" onSubmit={event => { event.preventDefault(); void run(async () => { await save(); }); }}>
        <div className="ai-provider-scroll">
          <section className="ai-settings-section" aria-labelledby="ai-service-heading">
            <div className="ai-settings-section-heading"><span className="ai-settings-section-icon"><Server size={18} aria-hidden="true" /></span><div><h3 id="ai-service-heading">{t('服务连接', 'Service connection')}</h3><p>{t('配置接口地址与访问凭据', 'Set the endpoint and access credentials')}</p></div><label className="ai-checkbox ai-service-toggle"><input type="checkbox" disabled={working} checked={provider.enabled} onChange={event => edit({ ...provider, enabled: event.target.checked })} />{t('启用服务', 'Enable service')}</label></div>
            <div className="ai-form-row"><label>{t('服务名称', 'Service name')}<input required value={provider.name} placeholder={t('例如：我的 DeepSeek', 'e.g. My DeepSeek')} disabled={working} onChange={event => edit({ ...provider, name: event.target.value })} /></label>
              <label>{t('接口类型', 'API type')}<Select value={provider.kind} disabled={working} onChange={event => edit({ ...provider, kind: event.target.value as AiProvider['kind'], baseUrl: event.target.value === 'ollama' ? 'http://127.0.0.1:11434' : 'https://api.openai.com/v1' })}><option value="openai">{t('OpenAI 兼容', 'OpenAI compatible')}</option><option value="ollama">Ollama</option></Select></label></div>
            <div><label>Base URL<input type="url" required disabled={working} value={provider.baseUrl} onChange={event => edit({ ...provider, baseUrl: event.target.value })} spellCheck={false} aria-describedby="ai-base-url-help" /></label><p className="ai-field-hint" id="ai-base-url-help">{provider.kind === 'ollama' ? t('填写本地 Ollama 地址，例如 http://127.0.0.1:11434', 'Use your local Ollama address, e.g. http://127.0.0.1:11434') : t('填写完整接口前缀，通常以 /v1 结尾，例如 https://api.routin.ai/v1', 'Use the full API prefix, usually ending in /v1, e.g. https://api.openai.com/v1')}</p></div>
            <label>API Key<input type="password" autoComplete="new-password" value={apiKey ?? ''} placeholder={provider.hasApiKey ? t('已安全保存，留空保持不变', 'Saved securely; leave blank to keep') : t('输入服务密钥（本地服务可留空）', 'Enter an API key (optional for local services)')} disabled={working} onChange={event => { setApiKey(event.target.value || undefined); setDirty(true); setFeedback(''); setCatalog(null); }} /></label>
            {provider.hasApiKey && <label className="ai-checkbox ai-key-delete"><input type="checkbox" checked={apiKey === ''} disabled={working} onChange={event => { setApiKey(event.target.checked ? '' : undefined); setDirty(true); setFeedback(''); setCatalog(null); }} />{t('删除已保存的密钥', 'Delete saved API key')}</label>}
            <div className="ai-settings-network"><button type="button" disabled={working} onClick={() => void run(async () => { const saved = await save(); setFeedback(await backend.testConnection(saved.id)); })}>{working ? <Loader2 size={15} className="ai-spin" aria-hidden="true" /> : <Unplug size={15} aria-hidden="true" />}{t('测试连接', 'Test connection')}</button><p>{t('测试和获取模型会保存配置并连接此地址，不发送聊天内容。', 'Testing or fetching models saves this configuration and connects without sending chat content.')}</p></div>
          </section>
          <section className="ai-settings-section ai-models" aria-labelledby="ai-models-heading">
            <div className="ai-form-row ai-model-test-row"><label>{t('待测试模型', 'Model to test')}<Select value={provider.models.some(model => model.id === testModelId) ? testModelId : provider.models[0]?.id ?? ''} onChange={event => setTestModelId(event.target.value)} disabled={working}>{provider.models.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}</Select></label><button type="button" disabled={working || !provider.models.length || !backend.testModel} onClick={() => void run(async () => { const saved = await save(); const id = saved.models.some(model => model.id === testModelId) ? testModelId : saved.models[0]?.id; if (id) setFeedback(await backend.testModel!(saved.id, id)); })}>{t('测试所选模型', 'Test selected model')}</button></div>
            <p className="ai-field-hint">{t('主动发送一条简短测试消息，可能产生少量费用，不发送会话历史。', 'Sends a short test message and may incur a small charge. No conversation history is sent.')}</p>
            <div className="ai-settings-section-heading"><span className="ai-settings-section-icon"><Box size={18} aria-hidden="true" /></span><div><h3 id="ai-models-heading">{t('已启用模型', 'Enabled models')}<span className="ai-count-badge">{provider.models.length}</span></h3><p>{t('只显示你选择的模型，随时添加或停用', 'Keep only the models you choose, and change them anytime')}</p></div></div>
            <div className="ai-model-actions"><button type="button" disabled={working} onClick={() => void run(async () => { const saved = await save(); const fetched = uniqueModels(await backend.listModels(saved.id)); setCatalog(fetched); setPickerOpen(true); setFeedback(t(`已发现 ${fetched.length} 个模型，请选择启用`, `Found ${fetched.length} models. Choose which to enable.`)); })}><RefreshCw size={15} className={working ? 'ai-spin' : undefined} aria-hidden="true" />{t('获取模型列表', 'Fetch models')}</button>{catalog && <button type="button" disabled={working} onClick={() => setPickerOpen(true)}>{t('选择模型', 'Choose models')}</button>}<span className="ai-field-hint">{t('获取后由你勾选启用', 'You choose which models to enable')}</span></div>
            <div className="ai-enabled-models">{provider.models.map((model, index) => <AiEnabledModel key={`${provider.id}-${index}`} model={model} disabled={working} onChange={next => edit({ ...provider, models: provider.models.map((item, at) => at === index ? next : item) })} onDisable={() => edit({ ...provider, models: provider.models.filter((_, at) => at !== index) })} />)}
              {!provider.models.length && <div className="ai-model-empty"><Box size={23} aria-hidden="true" /><strong>{t('还没有启用模型', 'No models enabled yet')}</strong><span>{t('获取模型列表并勾选，或在下方手动添加。', 'Fetch the list and choose models, or add an ID below.')}</span></div>}</div>
            <div className="ai-manual-model"><label htmlFor="ai-manual-model-id">{t('手动添加模型', 'Add a model manually')}</label><div className="ai-button-row"><input id="ai-manual-model-id" aria-label={t('手动模型 ID', 'Manual model ID')} placeholder={t('输入模型 ID，例如 deepseek-v4-flash', 'Enter a model ID, e.g. deepseek-v4-flash')} value={manualId} disabled={working} onChange={event => setManualId(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); if (!event.nativeEvent.isComposing) addManualModel(); } }} /><button type="button" disabled={working || !manualId.trim()} onClick={addManualModel}><Plus size={15} aria-hidden="true" />{t('添加', 'Add')}</button></div><p className="ai-field-hint">{t('模型的图片能力需自行确认，默认关闭。', 'Image support is off by default. Enable it only for supported models.')}</p></div>
          </section>
          <section className="ai-data-settings"><h3><Database size={16} aria-hidden="true" />{t('本地数据', 'Local data')}</h3><p className="ai-muted">{t('会话、草稿与附件保存在本机。发送时仅向所选服务发送本条消息和选定历史；附件遵循所在消息的上下文规则。', 'Conversations, drafts and attachments are stored locally. Sending shares the message and selected history with the chosen service, including attachments in that history.')}</p><div className="ai-button-row"><button type="button" disabled={working} onClick={() => void run(async () => { await backend.openDataDirectory(); })}>{t('打开数据目录', 'Open data directory')}</button><button type="button" disabled={working} onClick={() => setConfirm('history')}>{t('清空历史', 'Clear history')}</button><button type="button" className="ai-danger" disabled={working} onClick={() => setConfirm('reset')}>{t('重置 AI 助手数据', 'Reset AI assistant data')}</button></div></section>
        </div>
        <footer className="ai-settings-footer"><div className="ai-settings-feedback"><AiError error={error} />{!error && <span role="status" className={feedback ? 'ai-feedback' : 'ai-muted'}>{feedback ? <><Check size={14} aria-hidden="true" />{feedback}</> : dirty ? t('有未保存的修改', 'Unsaved changes') : t('配置仅保存在本机', 'Configuration is stored locally')}</span>}</div><div className="ai-button-row">{providers.some(item => item.id === provider.id) && <button type="button" className="ai-danger" disabled={working} onClick={() => setConfirm('provider')}>{t('删除服务', 'Delete service')}</button>}<button type="submit" className="ai-primary" disabled={working}>{working && <Loader2 size={15} className="ai-spin" aria-hidden="true" />}{working ? t('处理中…', 'Working…') : t('保存服务', 'Save service')}</button></div></footer>
      </form>
     </div>}
    </div>
    {pickerOpen && catalog && <AiModelPicker models={catalog} enabled={provider.models} onClose={() => setPickerOpen(false)} onApply={models => { edit({ ...provider, models }); setPickerOpen(false); }} />}
    {confirm && <AiDialog title={confirm === 'provider' ? t('删除服务？', 'Delete service?') : confirm === 'history' ? t('清空所有历史？', 'Clear all history?') : t('重置 AI 助手？', 'Reset AI assistant?')} onClose={() => setConfirm(null)}><div className="ai-form"><p>{confirm === 'provider' ? t('删除此服务及系统凭据，保留聊天历史。', 'Delete this service and its system credential. Chat history is retained.') : confirm === 'history' ? t('删除全部会话、草稿和附件，保留助手、服务配置及密钥。此操作无法撤销。', 'Delete all conversations, drafts and attachments. Assistants, services and keys are retained. This cannot be undone.') : t('删除全部 AI 会话、附件、助手、服务配置及系统凭据，不影响其他工具。此操作无法撤销。', 'Delete all AI conversations, attachments, assistants, services and system credentials. Other tools are unaffected. This cannot be undone.')}</p><footer><button type="button" onClick={() => setConfirm(null)}>{t('取消', 'Cancel')}</button><button type="button" className="ai-danger" onClick={() => { const action = confirm; setConfirm(null); void run(async () => { if (action === 'provider') { await onRemove(provider.id); switchTo(providers.find(item => item.id !== provider.id) ?? makeProvider()); } else if (action === 'history') { await onClearHistory(); setFeedback(t('历史已清空', 'History cleared')); } else { await onReset(); onClose(); } }); }}>{t('确认删除', 'Confirm deletion')}</button></footer></div></AiDialog>}
    {discardTarget && <AiDialog title={t('放弃未保存的修改？', 'Discard unsaved changes?')} onClose={() => setDiscardTarget(null)}><div className="ai-form"><p>{t('当前服务配置尚未保存。', 'The current service has unsaved changes.')}</p><footer><button type="button" onClick={() => setDiscardTarget(null)}>{t('取消', 'Cancel')}</button><button type="button" onClick={() => switchTo(discardTarget)}>{t('放弃修改', 'Discard changes')}</button></footer></div></AiDialog>}
  </AiDialog>;
}
