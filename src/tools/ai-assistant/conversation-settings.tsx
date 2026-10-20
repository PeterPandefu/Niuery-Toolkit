import { useState } from 'react';
import type { AiConversation, AiModel, AiParameters } from './types';
import { AiDialog } from './ui';
import { useAiText } from './ui-text';

export function ParameterFields({ value, onChange, model }: { value: AiParameters; model?: AiModel; onChange(value: AiParameters): void }) {
  const t = useAiText();
  return <div className="ai-parameter-grid">
    <label>{t('历史轮数', 'History rounds')}<input type="number" min={0} max={100} required value={value.historyRounds} onChange={event => onChange({ ...value, historyRounds: Number(event.target.value) })} /></label>
    <label>{t('温度（留空跟随服务）', 'Temperature (blank: service default)')}<input type="number" disabled={model?.supportsTemperature === false} min={0} max={2} step={0.1} value={value.temperature ?? ''} onChange={event => onChange({ ...value, temperature: event.target.value === '' ? undefined : Number(event.target.value) })} /></label>
    <label>{t('最大输出 token（留空跟随服务）', 'Maximum output tokens (blank: service default)')}<input type="number" min={1} max={model?.maxOutputTokens ?? 1000000} value={value.maxOutputTokens ?? ''} onChange={event => onChange({ ...value, maxOutputTokens: event.target.value === '' ? undefined : Number(event.target.value) })} /></label>
  </div>;
}

export function ConversationSettings({ conversation, model, onSave, onClose }: { conversation: AiConversation; model?: AiModel; onSave(value: Pick<AiConversation, 'systemPrompt' | 'parameters' | 'excludedMessageIds'>): void; onClose(): void }) {
  const t = useAiText();
  const [prompt, setPrompt] = useState(conversation.systemPrompt);
  const [parameters, setParameters] = useState(conversation.parameters);
  const [excluded, setExcluded] = useState(conversation.excludedMessageIds ?? []);
  return <AiDialog title={t('会话参数', 'Conversation settings')} onClose={onClose}><form className="ai-form" onSubmit={event => { event.preventDefault(); onSave({ systemPrompt: prompt, parameters, excludedMessageIds: excluded }); onClose(); }}>
    <p className="ai-muted">{t('只影响当前会话，不修改助手默认值。0 轮仅发送当前消息及系统提示词。', 'Changes apply to this conversation. Zero rounds sends only the current message and system prompt.')}</p>
    <label>{t('系统提示词', 'System prompt')}<textarea rows={6} value={prompt} onChange={event => setPrompt(event.target.value)} /></label>
    <ParameterFields value={parameters} model={model} onChange={setParameters} />
    {!!conversation.messages.length && <details><summary>{t('选择历史上下文', 'Choose history context')}</summary><p className="ai-muted">{t('取消勾选会排除该条消息所在的完整历史轮次，原记录保留。', 'Unchecking excludes the complete historical round. Local messages are retained.')}</p>{conversation.messages.filter(message => message.role === 'user').map(message => <label className="ai-checkbox" key={message.id}><input type="checkbox" checked={!excluded.includes(message.id)} onChange={event => setExcluded(event.target.checked ? excluded.filter(id => id !== message.id) : [...excluded, message.id])} />{message.content.slice(0, 100) || message.attachments[0]?.name}</label>)}</details>}
    <footer><button type="button" onClick={onClose}>{t('取消', 'Cancel')}</button><button type="submit" className="ai-primary">{t('保存', 'Save')}</button></footer>
  </form></AiDialog>;
}
