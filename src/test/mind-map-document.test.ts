import { describe, expect, it } from 'vitest';
import { createMindMapDocument, markdownToMindMap, parseMindMapDocument } from '@/tools/graphic/mind-map/document';

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
    expect(parsed.theme?.template).toBe('classic4');
    expect(parsed.root.data.text).toBe('离线导图');
  });

  it('拒绝会请求远程资源的节点图片', () => {
    const document = createMindMapDocument();
    document.root.data.image = 'https://example.com/image.png';
    expect(() => parseMindMapDocument(JSON.stringify(document))).toThrow('嵌入式图片');
  });
});
