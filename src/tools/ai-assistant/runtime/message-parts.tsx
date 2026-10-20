import { useId, useMemo, useState } from 'react';
import MarkdownIt from 'markdown-it';
import hljs from 'highlight.js';
import { toast } from 'sonner';
import { useAuiState, type TextMessagePartProps, type ReasoningMessagePartProps } from '@assistant-ui/react';
import { useAiText } from '../ui-text';

export function AiTextPart({ text }: TextMessagePartProps) {
  const t = useAiText(); const copyLabel = t('复制代码', 'Copy code'); const blocked = t('远程图片未自动加载', 'Remote image not loaded');
  const rendered = useMemo(() => {
    const blocks: string[] = []; const md = new MarkdownIt({ html: false, linkify: true, breaks: true });
    md.renderer.rules.image = (tokens, index) => `<span class="ai-blocked-image">[${md.utils.escapeHtml(tokens[index].content || blocked)} · ${md.utils.escapeHtml(blocked)}]</span>`;
    md.renderer.rules.fence = (tokens, index) => { const token = tokens[index]; const language = token.info.trim().split(/\s+/)[0]; const html = language && hljs.getLanguage(language) ? hljs.highlight(token.content, { language, ignoreIllegals: true }).value : md.utils.escapeHtml(token.content); const block = blocks.push(token.content) - 1; return `<div class="ai-code-block"><div class="ai-code-header"><span>${md.utils.escapeHtml(language || 'text')}</span><button type="button" data-ai-code="${block}" aria-label="${copyLabel}">${copyLabel}</button></div><pre><code class="hljs">${html}</code></pre></div>`; };
    const original = md.renderer.rules.link_open; md.renderer.rules.link_open = (tokens, index, options, env, self) => { tokens[index].attrSet('target', '_blank'); tokens[index].attrSet('rel', 'noopener noreferrer'); return original ? original(tokens, index, options, env, self) : self.renderToken(tokens, index, options); };
    return { html: md.render(text), blocks };
  }, [text, copyLabel, blocked]);
  return <div className="ai-markdown ai-answer" dangerouslySetInnerHTML={{ __html: rendered.html }} onClick={event => { const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-ai-code]'); if (button) void navigator.clipboard.writeText(rendered.blocks[Number(button.dataset.aiCode)]).then(() => { button.textContent = t('已复制', 'Copied'); toast.success(t('已复制', 'Copied')); }, () => toast.error(t('复制失败，请检查剪贴板权限', 'Could not copy. Check clipboard permissions.'))); }} />;
}

function ThinkingFold({ text, running, thinking }: { text: string; running: boolean; thinking: boolean }) {
  const t = useAiText(); const [open, setOpen] = useState(running); const id = useId();
  return <section className={`ai-thinking ${open ? 'is-open' : ''}`} aria-label={t('思考', 'Thinking')}><button type="button" className="ai-thinking-toggle" aria-label={open ? t('隐藏思考', 'Hide thinking') : t('显示思考', 'Show thinking')} aria-expanded={open} aria-controls={id} onClick={() => setOpen(value => !value)}>{open ? t('隐藏思考', 'Hide thinking') : t('显示思考', 'Show thinking')}{thinking && <span> · {t('模型思考中…', 'Thinking…')}</span>}</button><div id={id} className="ai-thinking-content" hidden={!open}>{text}</div></section>;
}

export function AiReasoningPart({ text }: ReasoningMessagePartProps) {
  const running = useAuiState(state => state.message.status?.type === 'running');
  const answer = useAuiState(state => state.message.content.some(part => part.type === 'text' && part.text.length > 0));
  const version = useAuiState(state => state.message.metadata.custom.selectedVersion);
  const created = useAuiState(state => state.message.createdAt.getTime());
  return <ThinkingFold key={`${created}:${String(version)}:${running ? 'active' : 'settled'}`} text={text} running={running} thinking={running && !answer} />;
}
