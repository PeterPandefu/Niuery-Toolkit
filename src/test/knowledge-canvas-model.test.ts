import { describe, expect, it } from 'vitest';
import {
  createKnowledgeCanvas,
  createKnowledgeCanvasTemplate,
  knowledgeCanvasToSvg,
  parseKnowledgeCanvas,
  prepareCanvasSave,
} from '@/tools/graphic/knowledge-canvas/model';

describe('知识画布文档', () => {
  it('将图片 data URL 转换为同名资源目录引用', () => {
    const document = createKnowledgeCanvas();
    document.nodes[0].image = { source: 'data:image/png;base64,aGVsbG8=', mimeType: 'image/png' };

    const prepared = prepareCanvasSave(document);

    expect(prepared.assets).toEqual([{ filename: 'start.png', base64: 'aGVsbG8=' }]);
    expect(prepared.content).toContain('__ASSET_DIR__/start.png');
  });

  it('拒绝引用不存在卡片的连线', () => {
    const document = createKnowledgeCanvas();
    document.edges[0].to = 'missing';
    expect(() => parseKnowledgeCanvas(JSON.stringify(document))).toThrow('不存在');
  });

  it('拒绝图片字段不完整的画布', () => {
    const document = createKnowledgeCanvas();
    document.nodes[0].image = { source: 42 as unknown as string, mimeType: 'image/png' };
    expect(() => parseKnowledgeCanvas(JSON.stringify(document))).toThrow('无效');
  });

  it('导出包含卡片和有向连线的 SVG', () => {
    const document = createKnowledgeCanvas();
    document.nodes[0].image = { source: 'data:image/png;base64,aGVsbG8=', mimeType: 'image/png' };
    const svg = knowledgeCanvasToSvg(document);
    expect(svg).toContain('<svg');
    expect(svg).toContain('marker-end="url(#arrow)"');
    expect(svg).toContain('从这里开始');
    expect(svg).toContain('href="data:image/png;base64,aGVsbG8="');
  });

  it('根据语言生成默认内容和模板内容', () => {
    expect(createKnowledgeCanvas('en').nodes[0].text).toBe('Start here');
    expect(createKnowledgeCanvasTemplate('problem', 'en').nodes[0].text).toBe('Symptom');
  });
});
