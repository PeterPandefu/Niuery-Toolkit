import type { ApiResponse, HttpMethod, KeyValue } from '@/store/api-tester-store';

/** 检测是否在 Tauri 桌面环境 */
export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export interface ResolvedRequest {
  method: HttpMethod;
  url: string;
  headers: Record<string, string>;
  body?: string;
}

/**
 * 发送 HTTP 请求
 * Tauri 环境使用 plugin-http 绕过 CORS，浏览器环境回退到 fetch
 */
export async function sendRequest(
  req: ResolvedRequest,
  signal?: AbortSignal
): Promise<ApiResponse> {
  const startTime = performance.now();

  let fetchFn: typeof fetch;

  if (isTauri) {
    const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http');
    fetchFn = tauriFetch;
  } else {
    fetchFn = window.fetch;
  }

  const options: RequestInit = {
    method: req.method,
    headers: req.headers,
    signal,
  };

  // GET/HEAD 不允许 body
  if (req.body && req.method !== 'GET' && req.method !== 'HEAD') {
    options.body = req.body;
  }

  const res = await fetchFn(req.url, options);
  const endTime = performance.now();
  const time = Math.round(endTime - startTime);

  // 读取响应体
  const body = await res.text();
  const size = new Blob([body]).size;

  // 解析响应头
  const headers: Record<string, string> = {};
  res.headers.forEach((value, key) => {
    headers[key] = value;
  });

  return {
    status: res.status,
    statusText: res.statusText,
    headers,
    body,
    time,
    size,
  };
}

/** 将 KeyValue 数组转换为 Record */
export function kvToRecord(items: KeyValue[]): Record<string, string> {
  const record: Record<string, string> = {};
  for (const item of items) {
    if (item.enabled && item.key.trim()) {
      record[item.key.trim()] = item.value;
    }
  }
  return record;
}

/** 构建完整 URL（拼接 query params） */
export function buildUrl(baseUrl: string, params: KeyValue[]): string {
  const enabledParams = params.filter((p) => p.enabled && p.key.trim());
  if (enabledParams.length === 0) return baseUrl;

  const separator = baseUrl.includes('?') ? '&' : '?';
  const query = enabledParams
    .map((p) => `${encodeURIComponent(p.key.trim())}=${encodeURIComponent(p.value)}`)
    .join('&');

  return `${baseUrl}${separator}${query}`;
}

/** 格式化字节大小 */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/** 尝试格式化 JSON */
export function tryFormatJson(text: string): string | null {
  try {
    const parsed = JSON.parse(text);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return null;
  }
}
