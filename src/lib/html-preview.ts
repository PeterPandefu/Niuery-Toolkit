export const HTML_PREVIEW_METRICS = 'niuery-html-preview-metrics';

export const HTML_PREVIEW_HARNESS_FILE = 'html-preview-harness.js';

/** 测量脚本以 'self' 外部脚本注入：srcDoc 继承应用 CSP，内联脚本会被拦截。 */
export function buildPreviewDocument(source: string, harnessUrl: string): string {
  return `${source}\n<script src="${harnessUrl}" data-niuery-preview-harness></script>`;
}

export type HtmlPreviewMode = 'fit' | 'actual';

export interface PreviewFrameInput {
  paneWidth: number;
  paneHeight: number;
  contentWidth: number;
  mode: HtmlPreviewMode;
}

export interface PreviewFrame {
  width: number;
  height: number;
  scale: number;
}

/** 宽内容按 pane 宽度整体缩放，窄内容保持 1:1；原始尺寸模式下由外层容器横向滚动。 */
export function computePreviewFrame({ paneWidth, paneHeight, contentWidth, mode }: PreviewFrameInput): PreviewFrame {
  const pane = { width: Math.max(0, Math.floor(paneWidth)), height: Math.max(0, Math.floor(paneHeight)) };
  const width = Math.max(pane.width, Math.ceil(Math.max(0, contentWidth)));
  const scale = mode === 'fit' && width > 0 ? Math.min(1, pane.width / width) : 1;
  return { width, height: Math.ceil(pane.height / scale), scale };
}