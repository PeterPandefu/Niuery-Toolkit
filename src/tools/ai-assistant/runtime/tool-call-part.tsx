import { useId, useState } from 'react';
import type { ToolCallMessagePartProps } from '@assistant-ui/react';
import { useAiText } from '../ui-text';

/** Display only: execution and approval both live in Rust, so this never calls
 *  addResult / resume / respondToApproval. */
export function AiToolCallPart({ toolName, argsText, result, isError }: ToolCallMessagePartProps) {
  const t = useAiText();
  const [open, setOpen] = useState(false);
  const id = useId();
  const settled = result !== undefined;
  const status = isError ? t('失败', 'Failed') : settled ? t('完成', 'Done') : t('执行中…', 'Running…');
  return <section className={`ai-tool-call${open ? ' is-open' : ''}${isError ? ' is-error' : ''}`} aria-label={t('工具调用', 'Tool call')}>
    <button type="button" className="ai-tool-call-toggle" aria-expanded={open} aria-controls={id} onClick={() => setOpen(value => !value)}>
      <span className="ai-tool-call-name">{toolName}</span>
      <span className="ai-tool-call-status">{status}</span>
    </button>
    <div id={id} className="ai-tool-call-content" hidden={!open}>
      <div className="ai-tool-call-label">{t('参数', 'Arguments')}</div>
      <pre className="ai-tool-call-json">{argsText}</pre>
      {settled && <>
        <div className="ai-tool-call-label">{isError ? t('错误', 'Error') : t('结果', 'Result')}</div>
        <pre className="ai-tool-call-json">{String(result)}</pre>
      </>}
    </div>
  </section>;
}