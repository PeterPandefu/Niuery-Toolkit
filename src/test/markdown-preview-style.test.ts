import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import { describe, expect, it } from 'vitest';

const tailwindConfigPath = '../../tailwind.config.js';

describe('Markdown 预览样式', () => {
  it('为 prose 容器生成标题、列表和文本格式规则', async () => {
    const { default: tailwindConfig } = await import(tailwindConfigPath);
    const result = await postcss([
      tailwindcss({
        ...tailwindConfig,
        content: [{ raw: '<article class="prose prose-sm"></article>', extension: 'html' }],
      }),
    ]).process('@tailwind components;', { from: undefined });

    expect(result.css).toMatch(/\.prose\s+:where\(h1\)/);
    expect(result.css).toMatch(/\.prose\s+:where\(ul\)/);
    expect(result.css).toMatch(/\.prose\s+:where\(ol\)/);
    expect(result.css).toMatch(/\.prose\s+:where\(blockquote\)/);
    expect(result.css).toMatch(/\.prose\s+:where\(strong\)/);
  });
});
