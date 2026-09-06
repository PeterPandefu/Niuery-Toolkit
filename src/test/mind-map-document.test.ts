import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { createMindMapDocument, markdownToMindMap, mindMapToMarkdown, parseMindMapDocument, parseXMindDocument } from '@/tools/graphic/mind-map/document';

describe('思维导图文档', () => {
  it('将首个一级标题和嵌套列表转换为可编辑的导图层级', () => {
    const document = markdownToMindMap('# 项目计划\n\n## 研发\n- 原型\n  - 测试\n\n> 离线优先');

    expect(document.root.data.text).toBe('项目计划');
    expect(document.root.children[0].data.text).toBe('研发');
    expect(document.root.children[0].children[0].data.text).toBe('原型');
    expect(document.root.children[0].children[0].children[0].data.text).toBe('测试');
    expect(document.root.children[0].children[0].children[0].data.note).toContain('离线优先');
  });

  it('拒绝不完整的 JSON 导图文件', () => {
    expect(() => parseMindMapDocument('{"root":{"data":{}}}')).toThrow('兼容');
  });

  it('保留完整导图配置', () => {
    const document = createMindMapDocument('离线导图');
    const parsed = parseMindMapDocument(JSON.stringify(document));
    expect(parsed.theme?.template).toBe('default');
    expect(parsed.root.data.text).toBe('离线导图');
  });

  it('拒绝会请求远程资源的节点图片', () => {
    const document = createMindMapDocument();
    document.root.data.image = 'https://example.com/image.png';
    expect(() => parseMindMapDocument(JSON.stringify(document))).toThrow('嵌入式图片');
  });

  it('将主题层级和备注导出为可再次导入的 Markdown', () => {
    const document = createMindMapDocument('项目规划');
    document.root.data.note = '离线优先\n可携带';
    document.root.children.push({
      data: { text: '研发', note: '先做原型' },
      children: [{ data: { text: '测试' }, children: [] }],
    });

    const markdown = mindMapToMarkdown(document);
    expect(markdown).toBe('# 项目规划\n> 离线优先\n> 可携带\n- 研发\n  > 先做原型\n  - 测试\n');

    const imported = markdownToMindMap(markdown);
    expect(imported.root.data.note).toBe('离线优先\n可携带');
    expect(imported.root.children[0].data.note).toBe('先做原型');
    expect(imported.root.children[0].children[0].data.text).toBe('测试');
  });

  it('导入 XMind content.json 的主题层级', async () => {
    const zip = new JSZip();
    zip.file('content.json', JSON.stringify({ sheets: [{ rootTopic: {
      title: '项目计划', children: { attached: [{ title: '研发', children: { attached: [{ title: '测试' }] } }] },
    } }] }));
    const document = await parseXMindDocument(await zip.generateAsync({ type: 'uint8array' }));

    expect(document.root.data.text).toBe('项目计划');
    expect(document.root.data.expand).toBe(true);
    expect(document.root.children[0].data.text).toBe('研发');
    expect(document.root.children[0].data.expand).toBe(false);
    expect(document.root.children[0].children[0].data.text).toBe('测试');
  });

  it('导入顶层为单个 sheet 的 XMind content.json', async () => {
    const zip = new JSZip();
    zip.file('content.json', JSON.stringify({
      id: 'sheet-1',
      rootTopic: { title: '样本复查', children: { attached: [{ title: '手动重测' }, { title: '危急值处理重测' }] } },
    }));

    const document = await parseXMindDocument(await zip.generateAsync({ type: 'uint8array' }));

    expect(document.root.data.text).toBe('样本复查');
    expect(document.root.data.expand).toBe(true);
    expect(document.root.children.map((node) => node.data.text)).toEqual(['手动重测', '危急值处理重测']);
    expect(document.root.children[0].data.expand).toBe(false);
  });

  it('解析旧版 XMind content.xml 的 topics 容器', async () => {
    const zip = new JSZip();
    zip.file('content.xml', `<?xml version="1.0"?><xmap-content xmlns="urn:xmind:xmap:xmlns:content:2.0"><sheet><topic><title>旧版导图</title><children><topics type="attached"><topic><title>分支一</title><children><topics type="attached"><topic><title>子项</title></topic></topics></children></topic></topics></children></topic></sheet></xmap-content>`);

    const document = await parseXMindDocument(await zip.generateAsync({ type: 'uint8array' }));

    expect(document.root.data.text).toBe('旧版导图');
    expect(document.root.data.expand).toBe(true);
    expect(document.root.children[0].data.text).toBe('分支一');
    expect(document.root.children[0].data.expand).toBe(false);
    expect(document.root.children[0].children[0].data.text).toBe('子项');
  });
});
