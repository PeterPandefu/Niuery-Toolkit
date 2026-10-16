let mermaidPromise: Promise<typeof import('mermaid').default> | null = null;

/**
 * Mermaid 11 把 ZenUML 拆成了外部图类型。编辑器和 Markdown 预览共用这一次注册，
 * 否则以 `zenuml` 开头的源码会直接变成 UnknownDiagramError。
 */
export async function getMermaid() {
  mermaidPromise ??= (async () => {
    const [{ default: mermaid }, { default: zenuml }] = await Promise.all([
      import('mermaid'),
      import('@mermaid-js/mermaid-zenuml'),
    ]);
    await mermaid.registerExternalDiagrams([zenuml]);
    return mermaid;
  })();
  return mermaidPromise;
}

/**
 * 将 Mermaid 生成的 HTML 风格 SVG 转成可作为独立图片解码的 XML。
 * Mermaid 的 foreignObject 标签可能包含 `<br>` 和 HTML 实体；直接把
 * 返回字符串放进 `image/svg+xml` Blob 时，WebView2 会拒绝解析这类内容。
 */
export function serializeSvgForImage(svg: string): string {
  if (!/<foreignObject\b/i.test(svg)) return svg;
  if (typeof DOMParser === 'undefined' || typeof XMLSerializer === 'undefined') return svg;
  const document = new DOMParser().parseFromString(svg, 'text/html');
  const root = document.querySelector('svg');
  return root ? new XMLSerializer().serializeToString(root) : svg;
}

/**
 * Mermaid emits `width="100%"` without a height. That is fine for inline SVG,
 * but an SVG loaded through an `<img>` Blob needs intrinsic dimensions so the
 * image viewer can calculate its fit size consistently in WebView2.
 */
export function ensureIntrinsicSvgDimensions(svg: string): string {
  return svg.replace(/<svg\b[^>]*>/i, (openingTag) => {
    const viewBoxMatch = openingTag.match(/(?:^|\s)viewBox\s*=\s*(["'])(.*?)\1/i);
    if (!viewBoxMatch) return openingTag;

    const viewBox = viewBoxMatch[2].trim().split(/[\s,]+/).map(Number);
    if (viewBox.length !== 4 || viewBox.some((value) => !Number.isFinite(value)) || viewBox[2] <= 0 || viewBox[3] <= 0) {
      return openingTag;
    }

    const readPixelDimension = (name: 'width' | 'height'): number | null => {
      const match = openingTag.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(["'])(.*?)\\1`, 'i'));
      const value = match?.[2].trim().match(/^((?:\d+(?:\.\d*)?|\.\d+))(?:px)?$/i)?.[1];
      if (!value) return null;
      const dimension = Number(value);
      return Number.isFinite(dimension) && dimension > 0 ? dimension : null;
    };

    const existingWidth = readPixelDimension('width');
    const existingHeight = readPixelDimension('height');
    if (existingWidth !== null && existingHeight !== null) return openingTag;

    const width = existingWidth ?? (existingHeight === null ? viewBox[2] : existingHeight * viewBox[2] / viewBox[3]);
    const height = existingHeight ?? (existingWidth === null ? viewBox[3] : existingWidth * viewBox[3] / viewBox[2]);
    const setDimension = (tag: string, name: 'width' | 'height', value: number) => {
      const attribute = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(["'])(.*?)\\1`, 'i');
      if (attribute.test(tag)) return tag.replace(attribute, ` ${name}="${value}"`);
      return tag.replace(/\/?\s*>$/, (ending) => ` ${name}="${value}"${ending}`);
    };

    return setDimension(setDimension(openingTag, 'width', width), 'height', height);
  });
}
