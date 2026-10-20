import { useState } from 'react';
import { nanoid } from 'nanoid';
import type { AiPromptTemplate } from './types';
import { applyTemplate, templateVariables } from './organization';
import { AiDialog, AiError } from './ui';
import { useAiText } from './ui-text';

export function PromptTemplates({ templates, onChange, onApply, onClose }: { templates: AiPromptTemplate[]; onChange(value: AiPromptTemplate[]): void; onApply(text: string): void; onClose(): void }) {
  const t = useAiText();
  const presets: AiPromptTemplate[] = [
    { id: 'translate', name: t('翻译', 'Translate'), content: t('请将以下内容翻译为{{目标语言}}，保持原意和语气：\n{{内容}}', 'Translate this into {{language}}, preserving meaning and tone:\n{{text}}') },
    { id: 'explain', name: t('解释代码', 'Explain code'), content: t('请解释以下代码的行为、边界情况和改进建议：\n{{代码}}', 'Explain the behavior, edge cases, and improvements for this code:\n{{code}}') },
    { id: 'logs', name: t('分析日志', 'Analyze logs'), content: t('请分析以下日志，区分已知事实和推测，给出排查步骤：\n{{日志}}', 'Analyze these logs. Separate facts from hypotheses and suggest diagnostic steps:\n{{logs}}') },
  ];
  const [selected, setSelected] = useState<AiPromptTemplate | null>(null);
  const [editing, setEditing] = useState(false);
  const [variables, setVariables] = useState<Record<string, string>>({});
  const [error, setError] = useState<unknown>();
  const [query, setQuery] = useState('');
  const all = [...templates, ...presets.filter(preset => !templates.some(item => item.id === preset.id))].sort((a, b) => Number(!!b.favorite) - Number(!!a.favorite));
  return <AiDialog title={t('提示词模板', 'Prompt templates')} onClose={onClose}><div className="ai-form">
    <label>{t('搜索模板', 'Search templates')}<input value={query} onChange={event => setQuery(event.target.value)} /></label>
    <div className="ai-template-list">{all.filter(item => `${item.name} ${item.content}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())).map(item => <div key={item.id} className="ai-button-row"><button type="button" onClick={() => { setSelected(item); setVariables({}); setEditing(false); setError(undefined); }}>{item.name}</button><button type="button" aria-label={`${t('收藏模板', 'Favorite template')}: ${item.name}`} aria-pressed={!!item.favorite} onClick={() => onChange([...templates.filter(value => value.id !== item.id), { ...item, favorite: !item.favorite }])}>{item.favorite ? '★' : '☆'}</button><button type="button" aria-label={`${t('编辑模板', 'Edit template')}: ${item.name}`} onClick={() => { setSelected(item); setEditing(true); }}>{t('编辑', 'Edit')}</button>{!presets.some(preset => preset.id === item.id) && <button type="button" aria-label={`${t('删除模板', 'Delete template')}: ${item.name}`} onClick={() => { onChange(templates.filter(value => value.id !== item.id)); if (selected?.id === item.id) setSelected(null); }}>{t('删除', 'Delete')}</button>}</div>)}</div>
    <button type="button" onClick={() => { setSelected({ id: nanoid(), name: '', content: '' }); setVariables({}); setEditing(true); }}>{t('新建模板', 'New template')}</button>
    {selected && <form className="ai-form" onSubmit={event => { event.preventDefault(); try { if (editing) { if (!selected.name.trim() || !selected.content.trim()) throw new Error(t('请输入名称和内容', 'Enter a name and content.')); onChange([...templates.filter(value => value.id !== selected.id), { ...selected, name: selected.name.trim() }]); setEditing(false); } else { onApply(applyTemplate(selected.content, variables)); onClose(); } } catch (reason) { setError(reason); } }}>
      {editing ? <><label>{t('模板名称', 'Template name')}<input required value={selected.name} onChange={event => setSelected({ ...selected, name: event.target.value })} /></label><label>{t('模板内容', 'Template content')}<textarea required rows={5} value={selected.content} onChange={event => setSelected({ ...selected, content: event.target.value })} /></label><p className="ai-muted">{t('使用 {{变量名}} 定义填写项。', 'Use {{variable}} for fields to fill in.')}</p></> : <><pre className="ai-template-preview">{selected.content}</pre>{templateVariables(selected.content).map(variable => <label key={variable}>{variable}<textarea required value={variables[variable] ?? ''} onChange={event => setVariables({ ...variables, [variable]: event.target.value })} /></label>)}</>}
      <AiError error={error} /><button type="submit" className="ai-primary">{editing ? t('保存模板', 'Save template') : t('插入草稿', 'Insert into draft')}</button>
    </form>}
  </div></AiDialog>;
}
