import { useState, useMemo } from 'react';
import MarkdownIt from 'markdown-it';
import { ToolLayout } from '@/components/shared/ToolLayout';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';

const md = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: true,
  breaks: true,
});

export default function MarkdownPreview() {
  const [input, setInput] = useState('');

  const html = useMemo(() => {
    if (!input.trim()) return '';
    return md.render(input);
  }, [input]);

  const sampleMarkdown = `# Markdown 预览

## 功能特性

- **实时预览**：输入即渲染
- *斜体* 和 **粗体** 支持
- ~~删除线~~ 支持

## 代码块

\`\`\`javascript
function hello() {
  console.log("Hello, World!");
}
\`\`\`

## 表格

| 功能 | 状态 |
|------|------|
| 标题 | ✅ |
| 列表 | ✅ |
| 代码 | ✅ |

## 引用

> 这是一段引用文本。
> 可以有多行。

## 链接

[访问 GitHub](https://github.com)

---

1. 有序列表 1
2. 有序列表 2
3. 有序列表 3
`;

  return (
    <ToolLayout
      inputTitle="Markdown"
      outputTitle="预览"
      onClear={() => setInput('')}
      inputActions={
        <Button variant="ghost" size="sm" onClick={() => setInput(sampleMarkdown)}>
          示例
        </Button>
      }
      input={
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="输入 Markdown..."
          className="h-full resize-none font-mono text-sm"
          spellCheck={false}
        />
      }
      output={
        <div
          className="prose prose-sm dark:prose-invert h-full max-w-none overflow-y-auto rounded-md border bg-muted/30 p-4"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      }
    />
  );
}
