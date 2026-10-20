import type { AiProvider, AiTask } from './types';
import { shouldShowThinking } from './model';
import { MessageView } from './message-view';
import { useAiText } from './ui-text';

export function TaskResults({ tasks, busy, onQuote, onSummary, providers = [] }: { tasks: AiTask[]; busy: boolean; providers?: AiProvider[]; onQuote(text: string): void; onSummary(text: string): void }) {
  const t = useAiText();
  return <div className="ai-task-results">{tasks.map(task => <section key={task.id} aria-label={task.kind === 'comparison' ? t('模型对比结果', 'Comparison results') : t('摘要结果', 'Summary results')} className="ai-task-result"><h3>{task.kind === 'comparison' ? t('模型对比', 'Model comparison') : t('会话摘要', 'Conversation summary')}</h3><details><summary>{t('查看任务输入', 'View task input')}</summary><pre className="ai-template-preview">{task.prompt}</pre></details><div className={task.kind === 'comparison' ? 'ai-comparison-grid' : ''}>{task.results.map(result => <div key={result.message.id}><h4>{result.label}</h4><MessageView message={result.message} showThinking={shouldShowThinking(result.message, providers)} disabled={busy} lastAssistant={false} onEdit={() => {}} onRegenerate={() => {}} onQuote={onQuote} />{task.kind === 'summary' && result.message.status === 'complete' && <button type="button" disabled={busy} onClick={() => onSummary(result.message.content)}>{t('编辑摘要并接续', 'Edit summary and continue')}</button>}</div>)}</div></section>)}</div>;
}
