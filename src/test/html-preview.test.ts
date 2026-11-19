import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HTML_PREVIEW_HARNESS_FILE, HTML_PREVIEW_METRICS, buildPreviewDocument, computePreviewFrame } from '@/lib/html-preview';

describe('HTML 预览几何', () => {
  it('固定宽内容在窄面板中整体缩放且不再溢出', () => {
    const frame = computePreviewFrame({ paneWidth: 668, paneHeight: 673, contentWidth: 1920, mode: 'fit' });
    expect(frame.width).toBe(1920);
    expect(frame.scale).toBeCloseTo(668 / 1920, 6);
    expect(frame.width * frame.scale).toBeLessThanOrEqual(668);
    expect(frame.height).toBe(Math.ceil(673 / frame.scale));
  });

  it('流式内容保持 1:1 并填满面板', () => {
    const frame = computePreviewFrame({ paneWidth: 668, paneHeight: 673, contentWidth: 600, mode: 'fit' });
    expect(frame).toEqual({ width: 668, height: 673, scale: 1 });
  });

  it('原始尺寸模式保留内容宽度供外层横向滚动', () => {
    const frame = computePreviewFrame({ paneWidth: 668, paneHeight: 673, contentWidth: 1920, mode: 'actual' });
    expect(frame).toEqual({ width: 1920, height: 673, scale: 1 });
  });

  it('面板尚未测量时不产生 NaN 或负尺寸', () => {
    const frame = computePreviewFrame({ paneWidth: 0, paneHeight: 0, contentWidth: 0, mode: 'fit' });
    expect(frame).toEqual({ width: 0, height: 0, scale: 1 });
  });
});

describe('HTML 预览文档注入', () => {
  it('保留原始 HTML 并以外部脚本注入测量器', () => {
    const source = '<!doctype html><html><body><p>内容</p></body></html>';
    const document = buildPreviewDocument(source, 'http://localhost:21516/html-preview-harness.js');
    expect(document.startsWith(source)).toBe(true);
    expect(document).toContain('<script src="http://localhost:21516/html-preview-harness.js" data-niuery-preview-harness></script>');
    expect(document).not.toMatch(/<script(?![^>]*\ssrc=)/);
  });

  it('测量脚本与组件监听的消息类型一致', () => {
    const harness = readFileSync(join(process.cwd(), 'public', HTML_PREVIEW_HARNESS_FILE), 'utf8');
    expect(harness).toContain(`type: '${HTML_PREVIEW_METRICS}'`);
    expect(harness).toContain('window.parent.postMessage');
    expect(harness).toContain('scrollWidth');
  });
});