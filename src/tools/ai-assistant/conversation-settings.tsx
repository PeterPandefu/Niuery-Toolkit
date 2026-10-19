import { useState } from 'react';
import type { AiConversation, AiParameters } from './types';
import { AiDialog } from './ui';
import { useAiText } from './ui-text';

export function ParameterFields({ value, onChange }: { value: AiParameters; onChange(value: AiParameters): void }) {
  const t = useAiText();
  return <div className="ai-parameter-grid">
    <label>{t('历史轮数', 'History rounds')}<input type="number" min={0} max={100} required value={value.historyRounds} onChange={event => onChange({ ...value, historyRounds: Number(event.target.value) })} /></label>
    <label>{t('温度（留空跟随服务）', 'Temperature (blank: service default)')}<input type="number" min={0} max={2} step={0.1} value={value.temperature ?? ''} onChange={event => onChange({ ...value, temperature: event.target.value === '' ? undefined : Number(event.target.value) })} /></label>
    <label>{t('最大输出 token（留空跟随服务）', 'Maximum output tokens (blank: service default)')}<input type="number" min={1} max={1000000} value={value.maxOutputTokens ?? ''} onChange={event => onChange({ ...value, maxOutputTokens: event.target.value === '' ? undefined : Number(event.target.value) })} /></label>
  </div>;
}

export function ConversationSettings({ conversation, onSave, onClose }: { conversation: AiConversation; onSave(value: Pick<AiConversation, 'systemPrompt' | 'parameters'>): void; onClose(): void }) {
  const t = useAiText();
  const [prompt, setPrompt] = useState(conversation.systemPrompt);
  const [parameters, setParameters] = useState(conversation.parameters);
  return <AiDialog title={t('会话参数', 'Conversation settings')} onClose={onClose}><form className="ai-form" onSubmit={event => { event.preventDefault(); onSave({ systemPrompt: prompt, parameters }); onClose(); }}>
    <p className="ai-muted">{t('只影响当前会话，不修改助手默认值。0 轮仅发送当前消息及系统提示词。', 'Changes apply to this conversation. Zero rounds sends only the current message and system prompt.')}</p>
    <label>{t('系统提示词', 'System prompt')}<textarea rows={6} value={prompt} onChange={event => setPrompt(event.target.value)} /></label>
    <ParameterFields value={parameters} onChange={setParameters} />
    <footer><button type="button" onClick={onClose}>{t('取消', 'Cancel')}</button><button type="submit" className="ai-primary">{t('保存', 'Save')}</button></footer>
  </form></AiDialog>;
}
