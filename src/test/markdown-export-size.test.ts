import { afterEach, describe, expect, it, vi } from 'vitest';
import { measureMarkdownExportHeight } from '@/lib/markdown-export-size';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('Markdown PNG 内容高度', () => {
  for (const [bodyBottom, scrollHeight, expected] of [[272, 320, 320], [12152.5, 12153, 12201]] as const) {
    it(`按实际排版测量 ${expected}px，而不是固定 10000px`, async () => {
      const pending = measureMarkdownExportHeight('<p>导出正文</p>', 1440);
      const frame = document.querySelector('iframe')!;
      expect(frame.style.width).toBe('1440px');
      expect(frame.style.display).not.toBe('none');
      const doc = frame.contentDocument!;
      doc.body.style.marginBottom = '48px';
      // jsdom 不执行布局，提供浏览器布局引擎的边界数据，其余测量和清理走真实代码。
      vi.spyOn(doc.body, 'getBoundingClientRect').mockReturnValue({ bottom: bodyBottom } as DOMRect);
      Object.defineProperty(doc.documentElement, 'scrollHeight', { value: scrollHeight });
      frame.dispatchEvent(new Event('load'));
      await expect(pending).resolves.toBe(expected);
      expect(document.querySelector('iframe')).toBeNull();
    });
  }

  it('等待字体就绪后再测量', async () => {
    let ready!: () => void;
    const pending = measureMarkdownExportHeight('<p>字体</p>', 1440);
    const frame = document.querySelector('iframe')!;
    const doc = frame.contentDocument!;
    Object.defineProperty(doc, 'fonts', { value: { ready: new Promise<void>((resolve) => { ready = resolve; }) } });
    const layout = vi.spyOn(doc.body, 'getBoundingClientRect').mockReturnValue({ bottom: 400 } as DOMRect);
    frame.dispatchEvent(new Event('load'));
    await Promise.resolve();
    expect(layout).not.toHaveBeenCalled();
    ready();
    await expect(pending).resolves.toBe(400);
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('等待图片解码后再测量', async () => {
    const pending = measureMarkdownExportHeight('<img alt="本地图片">', 1440);
    const frame = document.querySelector('iframe')!;
    const doc = frame.contentDocument!;
    const image = doc.createElement('img');
    doc.body.append(image);
    let decoded!: () => void;
    image.decode = () => new Promise<void>((resolve) => { decoded = resolve; });
    const layout = vi.spyOn(doc.body, 'getBoundingClientRect').mockReturnValue({ bottom: 700 } as DOMRect);
    frame.dispatchEvent(new Event('load'));
    await Promise.resolve();
    expect(layout).not.toHaveBeenCalled();
    decoded();
    await expect(pending).resolves.toBe(700);
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('加载超时后清理测量文档', async () => {
    vi.useFakeTimers();
    const pending = measureMarkdownExportHeight('<p>正文</p>', 1440);
    const frame = document.querySelector('iframe')!;
    Object.defineProperty(frame.contentDocument!, 'fonts', { value: { ready: new Promise(() => {}) } });
    frame.dispatchEvent(new Event('load'));
    const rejected = expect(pending).rejects.toThrow('测量导出图片尺寸超时');
    await vi.advanceTimersByTimeAsync(15_000);
    await rejected;
    expect(document.querySelector('iframe')).toBeNull();
  });
});
