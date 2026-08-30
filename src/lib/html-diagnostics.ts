import { findRemoteResources } from './markdown-utils';

export interface HtmlDiagnostics {
  remoteResources: string[];
  imageCount: number;
  scriptCount: number;
  warnings: string[];
}

/** 对本地 HTML 做离线资源与常见布局风险检查。 */
export function diagnoseHtml(source: string): HtmlDiagnostics {
  const remoteResources = findRemoteResources(source);
  if (typeof DOMParser === 'undefined') {
    return { remoteResources, imageCount: 0, scriptCount: 0, warnings: [] };
  }
  const document = new DOMParser().parseFromString(source, 'text/html');
  const warnings: string[] = [];
  if (!document.querySelector('meta[name="viewport"]')) warnings.push('缺少 viewport，移动端截图可能出现缩放问题');
  if (!document.querySelector('title')) warnings.push('缺少 title，导出文件名将使用默认名称');
  if (document.querySelectorAll('script').length > 0) warnings.push('包含脚本：离线 Chromium 将在沙箱中执行，外部脚本不会加载');
  if (/width\s*:\s*(?:1[3-9]\d{2}|[2-9]\d{3,})px/i.test(source)) warnings.push('检测到较大的固定宽度，窄视口截图可能发生横向溢出');
  if (remoteResources.length > 0) warnings.push('包含远程资源，导出会被阻止以保持离线');
  return {
    remoteResources,
    imageCount: document.images.length,
    scriptCount: document.scripts.length,
    warnings,
  };
}
