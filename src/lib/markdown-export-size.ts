/** 在与截图相同宽度的独立文档中排版，避免预览容器和窗口高度影响 PNG 尺寸。 */
export async function measureMarkdownExportHeight(html: string, width: number): Promise<number> {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.setAttribute('sandbox', 'allow-same-origin');
  frame.style.cssText = `position:fixed;left:-100000px;top:0;width:${width}px;height:1px;border:0;visibility:hidden;pointer-events:none;`;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await new Promise<number>((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('测量导出图片尺寸超时')), 15_000);
      frame.addEventListener('load', () => {
        void (async () => {
          const doc = frame.contentDocument;
          const view = frame.contentWindow;
          if (!doc?.body || !view) throw new Error('无法测量导出图片尺寸');
          await doc.fonts?.ready;
          await Promise.all(Array.from(doc.images, async (image) => {
            // 懒加载图片也必须在截图前取得尺寸；失效图片不阻塞整个导出。
            image.loading = 'eager';
            await image.decode().catch(() => undefined);
          }));
          const bottom = doc.body.getBoundingClientRect().bottom + view.scrollY;
          const margin = parseFloat(view.getComputedStyle(doc.body).marginBottom) || 0;
          resolve(Math.max(1, Math.ceil(bottom + margin), doc.documentElement.scrollHeight));
        })().catch(reject);
      }, { once: true });
      frame.srcdoc = html;
      document.body.appendChild(frame);
    });
  } finally {
    clearTimeout(timer);
    frame.remove();
  }
}
