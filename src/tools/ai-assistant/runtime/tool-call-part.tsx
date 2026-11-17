import { useId, useState } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import type { ToolCallMessagePartProps } from '@assistant-ui/react';
import { useAiText } from '../ui-text';
import { mediaResultPath } from './media-result';

/** Display only: execution and approval both live in Rust, so this never calls
 *  addResult / resume / respondToApproval. */
export function AiToolCallPart({ toolName, argsText, result, isError }: ToolCallMessagePartProps) {
  const t = useAiText();
  const [open, setOpen] = useState(false);
  const id = useId();
  const settled = result !== undefined;
  const mediaPath = mediaResultPath(toolName, result, isError);
  const status = isError ? t('失败', 'Failed') : settled ? t('完成', 'Done') : t('执行中…', 'Running…');
  return <section className={`ai-tool-call${open ? ' is-open' : ''}${isError ? ' is-error' : ''}`} aria-label={t('工具调用', 'Tool call')}>
    <button type="button" className="ai-tool-call-toggle" aria-expanded={open} aria-controls={id} onClick={() => setOpen(value => !value)}>
      <span className="ai-tool-call-name">{toolName}</span>
      <span className="ai-tool-call-status">{status}</span>
    </button>
    {mediaPath && <div className="ai-media-preview">
      {toolName === 'generate_image'
        ? <img src={convertFileSrc(mediaPath)} alt={t('生成的图像', 'Generated image')} loading="lazy" />
        : <video src={convertFileSrc(mediaPath)} controls preload="metadata" aria-label={t('生成的视频', 'Generated video')} />}
    </div>}
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