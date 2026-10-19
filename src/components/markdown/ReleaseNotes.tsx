import { useMemo } from 'react';
import MarkdownIt from 'markdown-it';

// Release notes come from the update feed; keep embedded HTML escaped.
const markdown = new MarkdownIt({ html: false, linkify: true, breaks: true });
markdown.renderer.rules.link_open = (tokens, index, options, _env, renderer) => {
  tokens[index].attrSet('target', '_blank');
  tokens[index].attrSet('rel', 'noopener noreferrer');
  return renderer.renderToken(tokens, index, options);
};

export function ReleaseNotes({ content }: { content: string }) {
  const html = useMemo(() => markdown.render(content), [content]);

  return (
    <div
      className="prose prose-sm mt-2 max-w-none break-words text-xs leading-relaxed text-muted-foreground
        prose-headings:mb-2 prose-headings:mt-4 prose-headings:font-semibold prose-headings:text-foreground
        prose-h1:text-base prose-h2:text-sm prose-h3:text-[13px] prose-h4:text-xs
        prose-p:my-2 prose-a:text-primary prose-strong:text-foreground
        prose-blockquote:border-border prose-blockquote:text-muted-foreground
        prose-code:rounded prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:font-normal prose-code:text-foreground
        prose-code:before:content-none prose-code:after:content-none
        prose-pre:overflow-x-auto prose-pre:bg-muted prose-pre:p-3 prose-pre:text-foreground
        prose-ol:my-2 prose-ul:my-2 prose-li:my-0.5 marker:text-muted-foreground
        prose-thead:border-border prose-th:text-foreground prose-tr:border-border
        prose-hr:border-border prose-img:my-2 prose-img:max-w-full
        [&_table]:block [&_table]:overflow-x-auto [&>:first-child]:mt-0 [&>:last-child]:mb-0"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
