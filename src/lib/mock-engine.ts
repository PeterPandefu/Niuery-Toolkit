import type { ApiResponse, MockRule } from '@/store/api-tester-store';

/**
 * 将 URL 模式转换为正则表达式
 * 支持 * 通配符和 :param 路径参数
 */
function patternToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/:(\w+)/g, '([^/]+)');
  return new RegExp(`^${escaped}$`, 'i');
}

/**
 * 查找匹配的 Mock 规则
 */
export function findMockRule(
  rules: MockRule[],
  method: string,
  url: string
): MockRule | null {
  // 提取路径部分（去掉域名和 query）
  let path = url;
  try {
    const parsed = new URL(url);
    path = parsed.pathname;
  } catch {
    // 如果不是完整 URL，直接使用
    path = url.split('?')[0];
  }

  for (const rule of rules) {
    if (!rule.enabled) continue;
    if (rule.method !== '*' && rule.method !== method.toUpperCase()) continue;

    const regex = patternToRegex(rule.urlPattern);
    if (regex.test(path) || regex.test(url)) {
      return rule;
    }
  }

  return null;
}

/**
 * 根据 Mock 规则生成响应
 */
export function generateMockResponse(rule: MockRule): Promise<ApiResponse> {
  return new Promise((resolve) => {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'x-mock': 'true',
    };

    for (const h of rule.headers) {
      if (h.enabled && h.key.trim()) {
        headers[h.key.trim()] = h.value;
      }
    }

    const body = rule.body;
    const size = new Blob([body]).size;

    const respond = () =>
      resolve({
        status: rule.statusCode,
        statusText: getStatusText(rule.statusCode),
        headers,
        body,
        time: rule.delay,
        size,
      });

    if (rule.delay > 0) {
      setTimeout(respond, rule.delay);
    } else {
      respond();
    }
  });
}

function getStatusText(code: number): string {
  const map: Record<number, string> = {
    200: 'OK',
    201: 'Created',
    204: 'No Content',
    301: 'Moved Permanently',
    302: 'Found',
    304: 'Not Modified',
    400: 'Bad Request',
    401: 'Unauthorized',
    403: 'Forbidden',
    404: 'Not Found',
    405: 'Method Not Allowed',
    409: 'Conflict',
    422: 'Unprocessable Entity',
    429: 'Too Many Requests',
    500: 'Internal Server Error',
    502: 'Bad Gateway',
    503: 'Service Unavailable',
  };
  return map[code] || 'Unknown';
}
