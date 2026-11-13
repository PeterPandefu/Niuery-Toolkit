import { useState } from 'react';
import type { AiStreamEvent, AiToolDecision, AiToolProvenance } from './types';
import { AiDialog } from './ui';
import { useAiText } from './ui-text';

function provenanceLabel(value: AiToolProvenance | undefined, t: (zh: string, en: string) => string) {
  if (value === 'userProvided') return t('来自你的消息或附件', 'From your message or attachment');
  if (value === 'searchDerived') return t('来自本次搜索结果', 'From this task’s search results');
  return t('模型自行提出，未经任何来源核实', 'Proposed by the model, unverified');
}

function questionOptions(event: AiStreamEvent): string[] {
  try {
    const parsed = JSON.parse(event.arguments ?? '{}') as { options?: unknown };
    if (Array.isArray(parsed.options)) return parsed.options.filter((item): item is string => typeof item === 'string').slice(0, 4);
  } catch { /* malformed arguments fall back to free input */ }
  return [];
}

/** The model asked a question; the user answers with text or a preset option.
 *  Closing without answering sends an empty answer, never consent. */
function ToolQuestionDialog({ event, onAnswer }: { event: AiStreamEvent; onAnswer(text: string): void }) {
  const t = useAiText();
  const [draft, setDraft] = useState('');
  const options = questionOptions(event);
  return <AiDialog title={t('AI 助手提问', 'Assistant question')} onClose={() => onAnswer('')}>
    <form className="ai-form ai-tool-approval" onSubmit={submitEvent => { submitEvent.preventDefault(); if (draft.trim()) onAnswer(draft.trim()); }}>
      <p>{event.text ?? t('（未提供问题文本）', '(No question text)')}</p>
      {options.length > 0 && <div className="ai-tool-question-options">
        {options.map(option => <button key={option} type="button" onClick={() => onAnswer(option)}>{option}</button>)}
      </div>}
      <label>{t('自由回答', 'Free answer')}<textarea rows={3} value={draft} onChange={changeEvent => setDraft(changeEvent.target.value)} /></label>
      <footer>
        <button type="button" onClick={() => onAnswer('')}>{t('跳过', 'Skip')}</button>
        <button type="submit" className="ai-primary" disabled={!draft.trim()}>{t('回答', 'Answer')}</button>
      </footer>
    </form>
  </AiDialog>;
}

/** Shows the byte-exact target so the user can verify it against the current
 *  task. Approve / reject only — no "always allow", no remembered hosts. */
export function ToolApprovalDialog({ event, onDecide, onClose, onAnswer }: { event: AiStreamEvent; onDecide(decision: AiToolDecision): void; onClose(): void; onAnswer(text: string): void }) {
  const t = useAiText();
  if (event.type === 'question_required') return <ToolQuestionDialog event={event} onAnswer={onAnswer} />;
  const unverified = event.provenance !== 'userProvided' && event.provenance !== 'searchDerived';
  return <AiDialog title={t('批准工具调用', 'Approve tool call')} onClose={onClose}>
    <div className="ai-form ai-tool-approval">
      <p className="ai-muted">{t('每次调用都需单独批准。请核对下方目标是否与当前任务一致。', 'Every call needs its own approval. Check that the target below matches the current task.')}</p>
      <div className="ai-tool-approval-row"><span>{t('工具', 'Tool')}</span><code>{event.name ?? ''}</code></div>
      {event.url !== undefined && <>
        <div className="ai-tool-approval-row"><span>{t('目标 URL（原样）', 'Target URL (verbatim)')}</span></div>
        <code className="ai-tool-approval-url">{event.url}</code>
        <div className="ai-tool-approval-row"><span>{t('来源', 'Source')}</span><span className={unverified ? 'ai-tool-approval-warn' : ''}>{provenanceLabel(event.provenance, t)}</span></div>
        {unverified && <p className="ai-tool-approval-warn" role="alert">{t('此地址由模型提出，未出现在你的消息或本次搜索结果中。若它指向代理、镜像或与任务无关的站点，请拒绝。', 'The model proposed this address; it appears in neither your messages nor this task’s search results. Reject it if it points at a proxy, a mirror, or a site unrelated to the task.')}</p>}
      </>}
      {event.filePath !== undefined && <>
        <div className="ai-tool-approval-row"><span>{t('文件绝对路径', 'Absolute file path')}</span></div>
        <code className="ai-tool-approval-url">{event.filePath}</code>
        {event.fileSize !== undefined && <div className="ai-tool-approval-row"><span>{t('大小', 'Size')}</span><span>{(event.fileSize / 1024).toFixed(1)} KiB</span></div>}
      </>}
      <div className="ai-tool-approval-row"><span>{t('完整参数', 'Full arguments')}</span></div>
      <pre className="ai-tool-call-json">{event.arguments ?? '{}'}</pre>
      <footer>
        <button type="button" onClick={() => { onDecide('rejected'); onClose(); }}>{t('拒绝', 'Reject')}</button>
        <button type="button" className="ai-primary" onClick={() => { onDecide('approved'); onClose(); }}>{t('批准', 'Approve')}</button>
      </footer>
    </div>
  </AiDialog>;
}