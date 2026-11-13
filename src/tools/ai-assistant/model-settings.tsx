import { Select } from '@/components/ui/select';
import { useState } from 'react';
import { Check, Pencil, Search, X } from 'lucide-react';
import type { AiModel } from './types';
import { AiDialog } from './ui';
import { iconLabel, useAiText } from './ui-text';
import { uniqueModels } from './model';

export function AiModelPicker({ models, enabled, onApply, onClose }: {
  models: AiModel[]; enabled: AiModel[]; onApply(models: AiModel[]): void; onClose(): void;
}) {
  const t = useAiText();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(() => new Set(enabled.map(model => model.id)));
  const candidates = uniqueModels([...enabled, ...models]);
  const needle = query.trim().toLowerCase();
  const filtered = candidates.filter(model => `${model.id} ${model.name}`.toLowerCase().includes(needle));
  return <AiDialog title={t('选择启用的模型', 'Choose enabled models')} description={t('仅启用勾选的模型，应用选择后保存服务生效。', 'Only checked models are enabled. Apply your selection, then save the service.')} onClose={onClose} className="ai-model-picker">
    <div className="ai-model-picker-toolbar">
      <label className="ai-model-search"><Search size={16} aria-hidden="true" /><input type="search" aria-label={t('搜索模型', 'Search models')} placeholder={t('搜索模型名称或 ID', 'Search by name or ID')} value={query} onChange={event => setQuery(event.target.value)} /></label>
      <div className="ai-model-picker-summary"><span>{t(`共 ${candidates.length} 个模型`, `${candidates.length} models available`)}</span><button type="button" disabled={!selected.size} onClick={() => setSelected(new Set())}>{t('清空选择', 'Clear selection')}</button></div>
    </div>
    <div className="ai-model-candidates">
      {filtered.map(model => <label key={model.id} className={`ai-model-candidate ${selected.has(model.id) ? 'is-selected' : ''}`}>
        <input type="checkbox" aria-label={`${t('启用模型', 'Enable model')}: ${model.id}`} checked={selected.has(model.id)} onChange={event => { const next = new Set(selected); if (event.target.checked) next.add(model.id); else next.delete(model.id); setSelected(next); }} />
        <span><strong>{model.name}</strong>{model.name !== model.id && <code>{model.id}</code>}</span>
        {selected.has(model.id) && <Check size={16} aria-hidden="true" />}
      </label>)}
      {!filtered.length && <p className="ai-model-empty">{t('没有匹配的模型', 'No matching models')}</p>}
    </div>
    <footer className="ai-model-picker-footer"><span role="status" aria-live="polite">{t(`已选择 ${selected.size} 个`, `${selected.size} selected`)}</span><div className="ai-button-row"><button type="button" onClick={onClose}>{t('取消', 'Cancel')}</button><button type="button" className="ai-primary" onClick={() => onApply(candidates.filter(model => selected.has(model.id)))}>{t('应用选择', 'Apply selection')}</button></div></footer>
  </AiDialog>;
}

export function AiEnabledModel({ model, disabled, onChange, onDisable }: { model: AiModel; disabled: boolean; onChange(model: AiModel): void; onDisable(): void }) {
  const t = useAiText();
  const [editing, setEditing] = useState(false);
  return <div className="ai-enabled-model">
    <div className="ai-model-row">
      <div className="ai-model-identity"><strong>{model.name || model.id}</strong>{model.name && model.name !== model.id && <code>{model.id}</code>}</div>
      <label className="ai-checkbox"><input type="checkbox" checked={model.supportsImages} disabled={disabled} onChange={event => onChange({ ...model, supportsImages: event.target.checked })} />{t('支持图片', 'Images')}</label>
      <button type="button" className="ai-icon-button" disabled={disabled} aria-expanded={editing} {...iconLabel(`${t('编辑模型', 'Edit model')}: ${model.id}`)} onClick={() => setEditing(!editing)}><Pencil size={15} aria-hidden="true" /></button>
      <button type="button" className="ai-icon-button" disabled={disabled} {...iconLabel(`${t('停用模型', 'Disable model')}: ${model.id}`)} onClick={onDisable}><X size={16} aria-hidden="true" /></button>
    </div>
    {editing && <><div className="ai-form-row ai-model-edit"><label>{t('模型 ID', 'Model ID')}<input required value={model.id} disabled={disabled} onChange={event => onChange({ ...model, id: event.target.value })} spellCheck={false} /></label><label>{t('模型显示名称', 'Model display name')}<input value={model.name} disabled={disabled} onChange={event => onChange({ ...model, name: event.target.value })} /></label></div>
      <div className="ai-form-row"><label>{t('上下文容量（tokens）', 'Context capacity (tokens)')}<input type="number" min={1} max={10000000} value={model.contextWindow ?? ''} disabled={disabled} placeholder={t('未知', 'Unknown')} onChange={event => onChange({ ...model, contextWindow: event.target.value ? Number(event.target.value) : undefined })} /></label><label>{t('模型最大输出（tokens）', 'Model maximum output (tokens)')}<input type="number" min={1} max={1000000} value={model.maxOutputTokens ?? ''} disabled={disabled} onChange={event => onChange({ ...model, maxOutputTokens: event.target.value ? Number(event.target.value) : undefined })} /></label></div>
      <div className="ai-form-row"><label>{t('输出参数', 'Output parameter')}<Select value={model.outputTokenParameter ?? 'max_tokens'} disabled={disabled} onChange={event => onChange({ ...model, outputTokenParameter: event.target.value as AiModel['outputTokenParameter'] })}><option value="max_tokens">max_tokens</option><option value="max_completion_tokens">max_completion_tokens</option></Select></label><label className="ai-checkbox"><input type="checkbox" checked={model.supportsTemperature !== false} disabled={disabled} onChange={event => onChange({ ...model, supportsTemperature: event.target.checked })} />{t('支持温度参数', 'Supports temperature')}</label><label className="ai-checkbox"><input type="checkbox" checked={!!model.streamUsage} disabled={disabled} onChange={event => onChange({ ...model, streamUsage: event.target.checked })} />{t('请求流式用量', 'Request stream usage')}</label></div>
      <label className="ai-checkbox"><input type="checkbox" checked={model.showThinking !== false} disabled={disabled} onChange={event => onChange({ ...model, showThinking: event.target.checked })} />{t('显示模型思考', 'Show model thinking')}</label>
      <p className="ai-field-hint">{t('仅显示服务返回的思考内容。关闭只隐藏展示，历史内容仍保存在本机。', 'Only displays thinking returned by the service. Turning this off hides it; saved thinking stays on this device.')}</p>
      <p className="ai-field-hint">{t('按服务文档填写；未知容量不执行容量裁剪。图片 token 为保守估算，实际用量以服务返回为准。', 'Use service documentation. Unknown capacity disables budget trimming. Image tokens are estimated; actual usage comes from the service.')}</p></>}
  </div>;
}
