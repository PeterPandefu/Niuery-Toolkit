import { createKeyValue, createRequest, type ApiRequest, type HttpMethod } from '@/store/api-tester-store';

/**
 * 解析 cURL 命令为 ApiRequest
 * 支持多行（含 \ 换行）
 */
export function parseCurl(curlCommand: string): ApiRequest {
  // 合并多行
  const cmd = curlCommand.replace(/\\\r?\n/g, ' ').trim();

  const request = createRequest();
  request.method = 'GET';

  // 提取 URL
  const urlMatch = cmd.match(/curl\s+(?:.*?\s+)?['"]?(https?:\/\/[^\s'"]+)['"]?/);
  if (urlMatch) {
    request.url = urlMatch[1];
  }

  // 提取方法
  const methodMatch = cmd.match(/-X\s+['"]?(\w+)['"]?/i);
  if (methodMatch) {
    request.method = methodMatch[1].toUpperCase() as HttpMethod;
  }

  // 提取 Headers
  const headerRegex = /-H\s+['"]([^'"]+)['"]/g;
  let headerMatch;
  while ((headerMatch = headerRegex.exec(cmd)) !== null) {
    const [key, ...valueParts] = headerMatch[1].split(':');
    const value = valueParts.join(':').trim();
    request.headers.push(createKeyValue(key.trim(), value));
  }

  // 提取 Body
  const dataMatch = cmd.match(/(?:-d|--data|--data-raw|--data-binary)\s+'([^']*)'/) || cmd.match(/(?:-d|--data|--data-raw|--data-binary)\s+"([^"]*)"/);
  if (dataMatch) {
    request.body = {
      type: 'json',
      content: dataMatch[1],
      formData: [],
    };
    if (request.method === 'GET') {
      request.method = 'POST';
    }
  }

  // 提取 Basic Auth
  const userMatch = cmd.match(/-u\s+'([^']+)'/) || cmd.match(/-u\s+"([^"]+)"/) || cmd.match(/-u\s+([^\s]+)/);
  if (userMatch) {
    const [username, ...passParts] = userMatch[1].split(':');
    request.auth = {
      ...request.auth,
      type: 'basic',
      basicUsername: username,
      basicPassword: passParts.join(':'),
    };
  }

  // 从 URL 提取 query params
  if (request.url.includes('?')) {
    const [baseUrl, queryString] = request.url.split('?');
    request.url = baseUrl;
    const params = new URLSearchParams(queryString);
    params.forEach((value, key) => {
      request.params.push(createKeyValue(key, value));
    });
  }

  return request;
}

/**
 * 将 ApiRequest 导出为 cURL 命令
 */
export function toCurl(request: ApiRequest, resolvedUrl?: string): string {
  const parts: string[] = ['curl'];
  const url = resolvedUrl || request.url;

  // 方法
  if (request.method !== 'GET') {
    parts.push(`-X ${request.method}`);
  }

  // URL（含 query params）
  let fullUrl = url;
  const enabledParams = request.params.filter((p) => p.enabled && p.key.trim());
  if (enabledParams.length > 0) {
    const separator = fullUrl.includes('?') ? '&' : '?';
    const query = enabledParams
      .map((p) => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value)}`)
      .join('&');
    fullUrl += separator + query;
  }
  parts.push(`'${fullUrl}'`);

  // Headers
  const enabledHeaders = request.headers.filter((h) => h.enabled && h.key.trim());
  for (const h of enabledHeaders) {
    parts.push(`-H '${h.key}: ${h.value}'`);
  }

  // Auth
  if (request.auth.type === 'bearer' && request.auth.bearerToken) {
    parts.push(`-H 'Authorization: Bearer ${request.auth.bearerToken}'`);
  } else if (request.auth.type === 'basic' && request.auth.basicUsername) {
    parts.push(`-u '${request.auth.basicUsername}:${request.auth.basicPassword}'`);
  } else if (request.auth.type === 'apikey' && request.auth.apiKeyName) {
    if (request.auth.apiKeyIn === 'header') {
      parts.push(`-H '${request.auth.apiKeyName}: ${request.auth.apiKeyValue}'`);
    }
  }

  // Body
  if (request.body.type !== 'none' && request.method !== 'GET' && request.method !== 'HEAD') {
    if (request.body.type === 'json') {
      parts.push(`-H 'Content-Type: application/json'`);
      parts.push(`-d '${request.body.content.replace(/'/g, "'\\''")}'`);
    } else if (request.body.type === 'xml') {
      parts.push(`-H 'Content-Type: application/xml'`);
      parts.push(`-d '${request.body.content.replace(/'/g, "'\\''")}'`);
    } else if (request.body.type === 'text') {
      parts.push(`-d '${request.body.content.replace(/'/g, "'\\''")}'`);
    } else if (request.body.type === 'x-www-form-urlencoded') {
      parts.push(`-H 'Content-Type: application/x-www-form-urlencoded'`);
      parts.push(`-d '${request.body.content.replace(/'/g, "'\\''")}'`);
    }
  }

  return parts.join(' \\\n  ');
}
