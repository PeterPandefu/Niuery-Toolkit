import { useState } from 'react';
import { nanoid } from 'nanoid';
import { Plus, Trash2 } from 'lucide-react';
import type { AiBackend, AiProvider } from './types';
import { AiDialog, AiError } from './ui';
import { iconLabel, useAiText } from './ui-text';

interface SettingsProps {
  providers: AiProvider[];
  backend: AiBackend;
  onSave(provider: AiProvider, apiKey?: string): Promise<unknown>;
  onRemove(id: string): Promise<unknown>;
  onClearHistory(): Promise<unknown>;
  onReset(): Promise<unknown>;
  onClose(): void;
}

export function AiSettings({ providers, backend, onSave, onRemove, onClearHistory, onReset, onClose }: SettingsProps) {
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
  function edit(next: AiProvider) { setProvider(next); setDirty(true); setFeedback(''); }
  function select(next: AiProvider) {
    if (dirty) { setDiscardTarget(next); return; }
    setProvider(next); setApiKey(undefined); setError(undefined); setFeedback(''); setDirty(false); setManualId('');
  }
  function switchTo(next: AiProvider) { setProvider(next); setApiKey(undefined); setDirty(false); setFeedback(''); setError(undefined); setDiscardTarget(null); setManualId(''); }
  async function run(operation: () => Promise<void>) {
    setWorking(true); setError(undefined); setFeedback('');
    try { await operation(); } catch (error) { setError(error); } finally { setWorking(false); }
  }
  function normalized() {
    if (!provider.name.trim()) throw new Error(t('请输入服务名称', 'Enter a service name.'));
    const url = new URL(provider.baseUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error(t('请输入不含凭据、参数或片段的 HTTP(S) 地址', 'Enter an HTTP(S) URL without embedded credentials, query, or fragment.'));
    const ids = provider.models.map(model => model.id.trim());
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
  return <AiDialog title={t('AI 设置', 'AI settings')} onClose={working ? () => {} : onClose} wide>
    <div className="ai-settings-layout">
      <nav className="ai-provider-list" aria-label={t('模型服务', 'Model services')}>{providers.map(item => <button type="button" key={item.id} disabled={working} className={provider.id === item.id ? 'is-active' : ''} onClick={() => select(item)}><span>{item.name}</span><small>{item.kind === 'ollama' ? 'Ollama' : 'OpenAI'}</small></button>)}
        <button type="button" disabled={working} onClick={() => select(makeProvider())}><Plus size={15} />{t('添加服务', 'Add service')}</button>
      </nav>
      <form className="ai-form ai-provider-form" onSubmit={event => { event.preventDefault(); void run(async () => { await save(); }); }}>
        <div className="ai-form-row"><label>{t('服务名称', 'Service name')}<input required value={provider.name} disabled={working} onChange={event => edit({ ...provider, name: event.target.value })} /></label>
          <label>{t('接口类型', 'API type')}<select value={provider.kind} disabled={working} onChange={event => edit({ ...provider, kind: event.target.value as AiProvider['kind'], baseUrl: event.target.value === 'ollama' ? 'http://127.0.0.1:11434' : 'https://api.openai.com/v1' })}><option value="openai">{t('OpenAI 兼容', 'OpenAI compatible')}</option><option value="ollama">Ollama</option></select></label></div>
        <label>Base URL<input type="url" required disabled={working} value={provider.baseUrl} onChange={event => edit({ ...provider, baseUrl: event.target.value })} spellCheck={false} /></label>
        <label>API Key<input type="password" autoComplete="new-password" value={apiKey ?? ''} placeholder={provider.hasApiKey ? t('已安全保存，留空保持不变', 'Saved securely; leave blank to keep') : t('可选', 'Optional')} disabled={working} onChange={event => { setApiKey(event.target.value || undefined); setDirty(true); }} /></label>
        {provider.hasApiKey && <label className="ai-checkbox"><input type="checkbox" checked={apiKey === ''} disabled={working} onChange={event => { setApiKey(event.target.checked ? '' : undefined); setDirty(true); }} />{t('删除已保存的密钥', 'Delete saved API key')}</label>}
        <label className="ai-checkbox"><input type="checkbox" disabled={working} checked={provider.enabled} onChange={event => edit({ ...provider, enabled: event.target.checked })} />{t('启用服务', 'Enable service')}</label>
        <div className="ai-settings-network"><p className="ai-muted">{t('测试与获取列表会保存当前配置并连接上述地址，不发送聊天内容。Ollama 需已在本机运行。', 'Testing or fetching models saves this configuration and connects to this address without sending chat content. Ollama must already be running.')}</p>
          <div className="ai-button-row"><button type="button" disabled={working} onClick={() => void run(async () => { const saved = await save(); setFeedback(await backend.testConnection(saved.id)); })}>{t('测试连接', 'Test connection')}</button>
            <button type="button" disabled={working} onClick={() => void run(async () => { const saved = await save(); const fetched = await backend.listModels(saved.id); const models = [...saved.models]; for (const item of fetched) if (!models.some(model => model.id === item.id)) models.push(item); const next = { ...saved, models }; await onSave(next); setProvider(next); setFeedback(t(`已获取 ${fetched.length} 个模型`, `Fetched ${fetched.length} models`)); })}>{t('获取模型列表', 'Fetch models')}</button></div>
        </div>
        <fieldset className="ai-models"><legend>{t('模型', 'Models')}</legend>
          {provider.models.map((model, index) => <div className="ai-model-row" key={`${provider.id}-${index}`}>
            <div><input aria-label={t('模型 ID', 'Model ID')} required value={model.id} disabled={working} onChange={event => edit({ ...provider, models: provider.models.map((item, at) => at === index ? { ...item, id: event.target.value } : item) })} placeholder="model-id" /><input aria-label={t('模型显示名称', 'Model display name')} value={model.name} disabled={working} onChange={event => edit({ ...provider, models: provider.models.map((item, at) => at === index ? { ...item, name: event.target.value } : item) })} placeholder={t('显示名称', 'Display name')} /></div>
            <label className="ai-checkbox"><input type="checkbox" checked={model.supportsImages} disabled={working} onChange={event => edit({ ...provider, models: provider.models.map((item, at) => at === index ? { ...item, supportsImages: event.target.checked } : item) })} />{t('支持图片', 'Images')}</label>
            <button type="button" className="ai-icon-button" disabled={working} {...iconLabel(`${t('删除模型', 'Remove model')}: ${model.id}`)} onClick={() => edit({ ...provider, models: provider.models.filter((_, at) => at !== index) })}><Trash2 size={15} /></button>
          </div>)}
          {!provider.models.length && <p className="ai-muted">{t('获取列表或手动添加模型 ID。未知模型默认不支持图片。', 'Fetch models or add a model ID manually. Unknown models do not support images by default.')}</p>}
          <div className="ai-button-row"><input aria-label={t('手动模型 ID', 'Manual model ID')} placeholder={t('手动输入模型 ID', 'Enter model ID')} value={manualId} disabled={working} onChange={event => setManualId(event.target.value)} /><button type="button" disabled={working || !manualId.trim()} onClick={() => { if (!provider.models.some(model => model.id === manualId.trim())) edit({ ...provider, models: [...provider.models, { id: manualId.trim(), name: manualId.trim(), supportsImages: false }] }); setManualId(''); }}>{t('添加', 'Add')}</button></div>
        </fieldset>
        <AiError error={error} />{feedback && <p role="status" className="ai-feedback">{feedback}</p>}
        <footer>{providers.some(item => item.id === provider.id) && <button type="button" className="ai-danger" disabled={working} onClick={() => setConfirm('provider')}>{t('删除服务', 'Delete service')}</button>}<button type="submit" className="ai-primary" disabled={working}>{working ? t('处理中…', 'Working…') : t('保存服务', 'Save service')}</button></footer>
      </form>
    </div>
    <div className="ai-data-settings"><h3>{t('本地数据', 'Local data')}</h3><p className="ai-muted">{t('会话、草稿与附件保存在本机。发送时仅向所选服务发送本条消息和选定历史；附件遵循所在消息的上下文规则。', 'Conversations, drafts and attachments are stored locally. Sending shares the message and selected history with the chosen service, including attachments in that history.')}</p><div className="ai-button-row"><button type="button" disabled={working} onClick={() => void run(async () => { await backend.openDataDirectory(); })}>{t('打开数据目录', 'Open data directory')}</button><button type="button" disabled={working} onClick={() => setConfirm('history')}>{t('清空历史', 'Clear history')}</button><button type="button" className="ai-danger" disabled={working} onClick={() => setConfirm('reset')}>{t('重置 AI 助手数据', 'Reset AI assistant data')}</button></div></div>
    {confirm && <AiDialog title={confirm === 'provider' ? t('删除服务？', 'Delete service?') : confirm === 'history' ? t('清空所有历史？', 'Clear all history?') : t('重置 AI 助手？', 'Reset AI assistant?')} onClose={() => setConfirm(null)}><div className="ai-form"><p>{confirm === 'provider' ? t('删除此服务及系统凭据，保留聊天历史。', 'Delete this service and its system credential. Chat history is retained.') : confirm === 'history' ? t('删除全部会话、草稿和附件，保留助手、服务配置及密钥。此操作无法撤销。', 'Delete all conversations, drafts and attachments. Assistants, services and keys are retained. This cannot be undone.') : t('删除全部 AI 会话、附件、助手、服务配置及系统凭据，不影响其他工具。此操作无法撤销。', 'Delete all AI conversations, attachments, assistants, services and system credentials. Other tools are unaffected. This cannot be undone.')}</p><footer><button type="button" onClick={() => setConfirm(null)}>{t('取消', 'Cancel')}</button><button type="button" className="ai-danger" onClick={() => { const action = confirm; setConfirm(null); void run(async () => { if (action === 'provider') { await onRemove(provider.id); switchTo(providers.find(item => item.id !== provider.id) ?? makeProvider()); } else if (action === 'history') { await onClearHistory(); setFeedback(t('历史已清空', 'History cleared')); } else { await onReset(); onClose(); } }); }}>{t('确认删除', 'Confirm deletion')}</button></footer></div></AiDialog>}
    {discardTarget && <AiDialog title={t('放弃未保存的修改？', 'Discard unsaved changes?')} onClose={() => setDiscardTarget(null)}><div className="ai-form"><p>{t('当前服务配置尚未保存。', 'The current service has unsaved changes.')}</p><footer><button type="button" onClick={() => setDiscardTarget(null)}>{t('取消', 'Cancel')}</button><button type="button" onClick={() => switchTo(discardTarget)}>{t('放弃修改', 'Discard changes')}</button></footer></div></AiDialog>}
  </AiDialog>;
}
