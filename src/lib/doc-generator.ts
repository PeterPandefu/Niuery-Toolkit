import type { ApiRequest, Collection, CollectionItem } from '@/store/api-tester-store';

/**
 * 从集合生成 Markdown API 文档
 */
export function generateCollectionDoc(collection: Collection): string {
  const lines: string[] = [];
  lines.push(`# ${collection.name} - API 文档`);
  lines.push('');
  lines.push(`> 自动生成于 ${new Date().toLocaleString()}`);
  lines.push('');

  let index = 0;
  for (const item of collection.items) {
    if (item.type === 'request') {
      index++;
      lines.push(...generateRequestDoc(item.data, index));
      lines.push('');
    } else if (item.type === 'folder') {
      lines.push(`## ${item.data.name}`);
      lines.push('');
      for (const subItem of item.data.items) {
        if (subItem.type === 'request') {
          index++;
          lines.push(...generateRequestDoc(subItem.data, index));
          lines.push('');
        }
      }
    }
  }

  return lines.join('\n');
}

/**
 * 从单个请求生成文档片段
 */
export function generateRequestDoc(request: ApiRequest, index?: number): string[] {
  const lines: string[] = [];
  const title = index ? `${index}. ${request.name}` : request.name;
  lines.push(`### ${title}`);
  lines.push('');
  lines.push(`**${request.method}** \`${request.url || '(未设置 URL)'}\``);
  lines.push('');

  // Query Params
  const enabledParams = request.params.filter((p) => p.enabled && p.key.trim());
  if (enabledParams.length > 0) {
    lines.push('**Query 参数：**');
    lines.push('');
    lines.push('| 参数名 | 值 | 说明 |');
    lines.push('|--------|------|------|');
    for (const p of enabledParams) {
      lines.push(`| \`${p.key}\` | ${p.value || '-'} | |`);
    }
    lines.push('');
  }

  // Headers
  const enabledHeaders = request.headers.filter((h) => h.enabled && h.key.trim());
  if (enabledHeaders.length > 0) {
    lines.push('**请求头：**');
    lines.push('');
    lines.push('| Header | 值 |');
    lines.push('|--------|------|');
    for (const h of enabledHeaders) {
      lines.push(`| \`${h.key}\` | ${h.value || '-'} |`);
    }
    lines.push('');
  }

  // Auth
  if (request.auth.type !== 'none') {
    lines.push('**认证方式：**');
    lines.push('');
    switch (request.auth.type) {
      case 'bearer':
        lines.push(`- Bearer Token: \`${request.auth.bearerToken || '{{token}}'}\``);
        break;
      case 'basic':
        lines.push(`- Basic Auth: \`${request.auth.basicUsername}\` / \`***\``);
        break;
      case 'apikey':
        lines.push(`- API Key (\`${request.auth.apiKeyIn}\`): \`${request.auth.apiKeyName}\``);
        break;
    }
    lines.push('');
  }

  // Body
  if (request.body.type !== 'none') {
    lines.push(`**请求体 (${request.body.type})：**`);
    lines.push('');
    if (request.body.type === 'form-data') {
      const enabledFields = request.body.formData.filter((f) => f.enabled && f.key.trim());
      if (enabledFields.length > 0) {
        lines.push('| 字段 | 值 |');
        lines.push('|------|------|');
        for (const f of enabledFields) {
          lines.push(`| \`${f.key}\` | ${f.value || '-'} |`);
        }
      }
    } else if (request.body.content) {
      lines.push('```' + (request.body.type === 'json' ? 'json' : request.body.type === 'xml' ? 'xml' : ''));
      lines.push(request.body.content);
      lines.push('```');
    }
    lines.push('');
  }

  lines.push('---');
  return lines;
}

/**
 * 从多个集合生成完整文档
 */
export function generateFullDoc(collections: Collection[]): string {
  if (collections.length === 0) return '# API 文档\n\n暂无接口。';
  if (collections.length === 1) return generateCollectionDoc(collections[0]);

  const lines: string[] = ['# API 文档', ''];
  lines.push(`> 自动生成于 ${new Date().toLocaleString()}`);
  lines.push('');

  // 目录
  lines.push('## 目录');
  lines.push('');
  for (const col of collections) {
    lines.push(`- **${col.name}**`);
    for (const item of col.items) {
      if (item.type === 'request') {
        lines.push(`  - ${item.data.method} ${item.data.name}`);
      }
    }
  }
  lines.push('');

  // 内容
  for (const col of collections) {
    lines.push(`## ${col.name}`);
    lines.push('');
    let idx = 0;
    for (const item of col.items) {
      if (item.type === 'request') {
        idx++;
        lines.push(...generateRequestDoc(item.data, idx));
        lines.push('');
      } else if (item.type === 'folder') {
        lines.push(`### ${item.data.name}`);
        lines.push('');
        for (const subItem of item.data.items) {
          if (subItem.type === 'request') {
            idx++;
            lines.push(...generateRequestDoc(subItem.data, idx));
            lines.push('');
          }
        }
      }
    }
  }

  return lines.join('\n');
}

/** 从集合中提取所有请求（扁平化） */
export function flattenRequests(items: CollectionItem[]): ApiRequest[] {
  const result: ApiRequest[] = [];
  for (const item of items) {
    if (item.type === 'request') {
      result.push(item.data);
    } else if (item.type === 'folder') {
      result.push(...flattenRequests(item.data.items));
    }
  }
  return result;
}
