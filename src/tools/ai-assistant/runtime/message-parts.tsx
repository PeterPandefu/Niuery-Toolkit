import { useId, useLayoutEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react';
import MarkdownIt from 'markdown-it';
import hljs from 'highlight.js';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import { toast } from 'sonner';
import { useAuiState, type TextMessagePartProps, type ReasoningMessagePartProps } from '@assistant-ui/react';
import { useAiText } from '../ui-text';

/** Pins a streaming panel to its newest output unless the reader scrolls up.
 *  The distance is measured against the height before this commit's growth, so
 *  a single large chunk can never knock the follow off the bottom. */
function useFollowBottom(active: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const prevHeight = useRef(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !active) { prevHeight.current = 0; return; }
    const grew = Math.max(0, el.scrollHeight - prevHeight.current);
    prevHeight.current = el.scrollHeight;
    if (el.scrollHeight - grew - el.scrollTop - el.clientHeight < 80) el.scrollTop = el.scrollHeight;
  });
  return ref;
}

export function AiTextPart({ text }: TextMessagePartProps) {
  const t = useAiText(); const copyLabel = t('复制代码', 'Copy code'); const blocked = t('远程图片未自动加载', 'Remote image not loaded');
  const running = useAuiState(state => state.message.status?.type === 'running');
  const scrollRef = useFollowBottom(running);
  const rendered = useMemo(() => {
    const blocks: string[] = []; const md = new MarkdownIt({ html: false, linkify: true, breaks: true });
    md.renderer.rules.image = (tokens, index) => `<span class="ai-blocked-image">[${md.utils.escapeHtml(tokens[index].content || blocked)} · ${md.utils.escapeHtml(blocked)}]</span>`;
    md.renderer.rules.fence = (tokens, index) => { const token = tokens[index]; const language = token.info.trim().split(/\s+/)[0]; const html = language && hljs.getLanguage(language) ? hljs.highlight(token.content, { language, ignoreIllegals: true }).value : md.utils.escapeHtml(token.content); const block = blocks.push(token.content) - 1; return `<div class="ai-code-block"><div class="ai-code-header"><span>${md.utils.escapeHtml(language || 'text')}</span><button type="button" data-ai-code="${block}" aria-label="${copyLabel}">${copyLabel}</button></div><pre><code class="hljs">${html}</code></pre></div>`; };
    const original = md.renderer.rules.link_open; md.renderer.rules.link_open = (tokens, index, options, env, self) => { tokens[index].attrSet('target', '_blank'); tokens[index].attrSet('rel', 'noopener noreferrer'); return original ? original(tokens, index, options, env, self) : self.renderToken(tokens, index, options); };
    const mathBlocks: string[] = [];
    const source = text.replace(/\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|(?<!\\)\$([^$\n]+?)\$/g, (_match, blockDollar, blockBracket, inlineParen, inlineDollar) => {
      const value = blockDollar ?? blockBracket ?? inlineParen ?? inlineDollar ?? '';
      const displayMode = blockDollar !== undefined || blockBracket !== undefined;
      const index = mathBlocks.push(katex.renderToString(value.trim(), { displayMode, throwOnError: false })) - 1;
      return `MATHPLACEHOLDER${index}ENDMATH`;
    });
    const html = md.render(source).replace(/MATHPLACEHOLDER(\d+)ENDMATH/g, (_match, index) => mathBlocks[Number(index)] ?? '');
    return { html, blocks };
  }, [text, copyLabel, blocked]);
  return <div ref={scrollRef} className="ai-markdown ai-answer" dangerouslySetInnerHTML={{ __html: rendered.html }} onClick={event => { const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-ai-code]'); if (button) void navigator.clipboard.writeText(rendered.blocks[Number(button.dataset.aiCode)]).then(() => { button.textContent = t('已复制', 'Copied'); toast.success(t('已复制', 'Copied')); }, () => toast.error(t('复制失败，请检查剪贴板权限', 'Could not copy. Check clipboard permissions.'))); }} />;
}

function ThinkingFold({ text, running, thinking }: { text: string; running: boolean; thinking: boolean }) {
  const t = useAiText(); const [open, setOpen] = useState(running); const id = useId();
  const contentRef = useFollowBottom(open && thinking);
  return <section className={`ai-thinking ${open ? 'is-open' : ''}`} aria-label={t('思考', 'Thinking')}><button type="button" className="ai-thinking-toggle" aria-label={open ? t('隐藏思考', 'Hide thinking') : t('显示思考', 'Show thinking')} aria-expanded={open} aria-controls={id} onClick={() => setOpen(value => !value)}>{open ? t('隐藏思考', 'Hide thinking') : t('显示思考', 'Show thinking')}{thinking && <span> · {t('模型思考中…', 'Thinking…')}</span>}</button><div ref={contentRef} id={id} className="ai-thinking-content" hidden={!open}>{text}</div></section>;
}

export function AiReasoningPart({ text }: ReasoningMessagePartProps) {
  const running = useAuiState(state => state.message.status?.type === 'running');
  const answer = useAuiState(state => state.message.content.some(part => part.type === 'text' && part.text.length > 0));
  const version = useAuiState(state => state.message.metadata.custom.selectedVersion);
  const created = useAuiState(state => state.message.createdAt.getTime());
  return <ThinkingFold key={`${created}:${String(version)}:${running ? 'active' : 'settled'}`} text={text} running={running} thinking={running && !answer} />;
}

/** Adjacent tool-call parts share one collapsible group; everything else renders ungrouped. */
export function AiToolCallGroup({ groupKey, indices, children }: PropsWithChildren<{ groupKey: string | undefined; indices: number[] }>) {
  const t = useAiText();
  const [open, setOpen] = useState(false);
  const id = useId();
  const parts = useAuiState(state => state.message.content);
  const live = parts.some(part => part.type === 'tool-call' && part.result === undefined);
  const contentRef = useFollowBottom(!!groupKey && open && live);
  if (!groupKey) return <>{children}</>;
  const calls = indices.flatMap(index => { const part = parts[index]; return part && part.type === 'tool-call' ? [part] : []; });
  const failed = calls.filter(call => call.isError).length;
  const running = calls.some(call => call.result === undefined);
  return <section className={`ai-tool-group${open ? ' is-open' : ''}`} aria-label={t('工具调用', 'Tool calls')}>
    <button type="button" className="ai-tool-group-toggle" aria-expanded={open} aria-controls={id} onClick={() => setOpen(value => !value)}>
      <span className="ai-tool-group-name">{t('工具调用', 'Tool calls')} · {calls.length}</span>
      <span className={`ai-tool-group-status${failed ? ' is-error' : ''}`}>{running ? t('执行中…', 'Running…') : failed ? t(`${failed} 个失败`, `${failed} failed`) : t('完成', 'Done')}</span>
    </button>
    <div ref={contentRef} id={id} className="ai-tool-group-content" hidden={!open}>{children}</div>
  </section>;
}
