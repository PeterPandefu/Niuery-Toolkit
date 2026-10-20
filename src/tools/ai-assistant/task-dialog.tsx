import { useState } from 'react';
import type { AiConversation, AiProvider, AiTaskPlan } from './types';
import { createComparisonTask, createSummaryTask } from './tasks';
import { AiDialog, AiError } from './ui';
import { useAiText } from './ui-text';
import { continueFromSummary } from './branches';

export function TaskDialog({ kind, conversation, providers, busy, onRun, onContinue, onClose }: { kind: 'summary' | 'comparison'; conversation: AiConversation; providers: AiProvider[]; busy: boolean; onRun(plan: AiTaskPlan): void; onContinue(chat: AiConversation): void; onClose(): void }) {
  const t = useAiText();
  const [selected, setSelected] = useState<string[]>([]);
  const [rounds, setRounds] = useState(20);
  const [summary, setSummary] = useState(conversation.summary ?? '');
  const [error, setError] = useState<unknown>();
  const [plan, setPlan] = useState<AiTaskPlan>();
  const options = providers.filter(provider => provider.enabled).flatMap(provider => provider.models.map(model => ({ key: `${provider.id}::${model.id}`, provider, model })));
  const generated = [...(conversation.tasks ?? [])].reverse().find(task => task.kind === 'summary' && task.results[0]?.message.status === 'complete');
  return <AiDialog title={kind === 'summary' ? t('摘要接续', 'Summary continuation') : t('多模型对比', 'Compare models')} onClose={onClose}><div className="ai-form">
    {kind === 'comparison' ? <><p>{t('输入框中的问题及相同历史将按顺序发送给 2–4 个模型。结果独立保留，可能产生多次费用。', 'The draft and identical history are sent sequentially to 2–4 models. Results are saved separately and each request may incur charges.')}</p><blockquote className="ai-template-preview">{conversation.draft || conversation.draftAttachments.map(file => file.name).join(', ')}</blockquote>{options.map(option => <label key={option.key} className="ai-checkbox"><input type="checkbox" checked={selected.includes(option.key)} disabled={busy} onChange={event => { setPlan(undefined); setSelected(event.target.checked ? [...selected, option.key] : selected.filter(key => key !== option.key)); }} />{option.provider.name} · {option.model.name}</label>)}</> : <><p>{t('摘要仅使用所选范围内的完整对话正文，不读取附件正文；可先手动编写，也可生成后编辑，再接续新会话。原会话保留。', 'Summaries use complete conversation text in the selected range, excluding attachment contents. Write or generate a summary, edit it, then continue in a new conversation. The original is retained.')}</p><label>{t('最近完整轮数', 'Recent complete rounds')}<input type="number" min={1} max={1000} value={rounds} onChange={event => { setRounds(Number(event.target.value)); setPlan(undefined); }} /></label><label>{t('可编辑摘要', 'Editable summary')}<textarea rows={8} value={summary} onChange={event => setSummary(event.target.value)} /></label>{generated && <button type="button" onClick={() => setSummary(generated.results[0].message.content)}>{t('载入最近生成的摘要', 'Load latest generated summary')}</button>}<button type="button" disabled={busy || !summary.trim()} onClick={() => { try { onContinue(continueFromSummary(conversation, summary)); onClose(); } catch (reason) { setError(reason); } }}>{t('携带摘要新建会话', 'Continue with summary')}</button></>}
    <AiError error={error} />
    {plan && <div className="ai-task-consent"><strong>{t('确认发送目标', 'Confirm destinations')}</strong>{plan.requests.map(request => { const provider = providers.find(provider => provider.id === request.providerId); return <p key={request.requestId}>{provider?.name} · {request.modelId}<br /><small>{provider?.baseUrl}</small></p>; })}<p>{t(`本次裁剪 ${plan.droppedRounds} 轮。`, `${plan.droppedRounds} rounds trimmed for this task.`)}</p><button type="button" className="ai-primary" disabled={busy} onClick={() => { onRun(plan); onClose(); }}>{t('确认并生成', 'Confirm and generate')}</button></div>}
    <button type="button" disabled={busy || (kind === 'summary' && (!Number.isInteger(rounds) || rounds < 1 || rounds > 1000))} onClick={() => { try { setError(undefined); setPlan(kind === 'summary' ? createSummaryTask(conversation, providers, rounds) : createComparisonTask(conversation, providers, options.filter(option => selected.includes(option.key)).map(option => ({ providerId: option.provider.id, modelId: option.model.id })))); } catch (reason) { setError(reason); } }}>{kind === 'summary' ? t('准备生成摘要', 'Prepare summary') : t('准备对比', 'Prepare comparison')}</button>
  </div></AiDialog>;
}
