import { Select } from '@/components/ui/select';
import { useState } from 'react';
import { nanoid } from 'nanoid';
import type { AiAssistant, AiProvider } from './types';
import { ParameterFields } from './conversation-settings';
import { AiDialog } from './ui';
import { useAiText } from './ui-text';

export function AssistantDialog({ assistant, providers, onSave, onClose }: { assistant?: AiAssistant; providers: AiProvider[]; onSave(value: AiAssistant): void; onClose(): void }) {
  const t = useAiText();
  const [value, setValue] = useState<AiAssistant>(() => assistant ?? { id: nanoid(), name: '', description: '', systemPrompt: '', parameters: { historyRounds: 20 } });
  const provider = providers.find(item => item.id === value.providerId);
  return <AiDialog title={assistant ? t('编辑助手', 'Edit assistant') : t('新建助手', 'New assistant')} onClose={onClose}><form className="ai-form" onSubmit={event => { event.preventDefault(); if (value.name.trim()) { onSave({ ...value, name: value.name.trim() }); onClose(); } }}>
    <label>{t('助手名称', 'Assistant name')}<input required maxLength={80} value={value.name} onChange={event => setValue({ ...value, name: event.target.value })} /></label>
    <label>{t('说明', 'Description')}<input value={value.description} onChange={event => setValue({ ...value, description: event.target.value })} /></label>
    <label>{t('系统提示词', 'System prompt')}<textarea rows={5} value={value.systemPrompt} onChange={event => setValue({ ...value, systemPrompt: event.target.value })} /></label>
    <div className="ai-form-row"><label>{t('默认服务', 'Default service')}<Select value={value.providerId ?? ''} onChange={event => setValue({ ...value, providerId: event.target.value || undefined, modelId: undefined })}><option value="">{t('未选择', 'Not selected')}</option>{providers.filter(item => item.enabled).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></label>
      <label>{t('默认模型', 'Default model')}<Select value={value.modelId ?? ''} onChange={event => setValue({ ...value, modelId: event.target.value || undefined })}><option value="">{t('未选择', 'Not selected')}</option>{provider?.models.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}</Select></label></div>
    <ParameterFields value={value.parameters} model={provider?.models.find(model => model.id === value.modelId)} onChange={parameters => setValue({ ...value, parameters })} />
    {assistant && <p className="ai-muted">{t('修改仅影响之后新建的会话，已有会话保留配置快照。', 'Changes apply to new conversations. Existing conversations retain their settings.')}</p>}
    <footer><button type="button" onClick={onClose}>{t('取消', 'Cancel')}</button><button type="submit" className="ai-primary">{t('保存', 'Save')}</button></footer>
  </form></AiDialog>;
}
