import { md5 } from 'js-md5';
import { isTauri } from '@/lib/api-client';

/** 翻译服务商凭证（当前仅百度） */
export interface BaiduCredentials {
  appId: string;
  secret: string;
}

export interface TranslateResult {
  text: string;
  from: string;
  to: string;
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export const BAIDU_API_URL = 'https://fanyi-api.baidu.com/api/trans/vip/translate';

/**
 * 百度尊享版签名规则：query 长度超过 20 时，取「前 10 + 中 10 + 后 10」字符参与签名。
 * 标准版请使用完整 query（truncate: false）。
 */
export function truncateQueryForSign(query: string): string {
  if (query.length <= 20) return query;
  const midStart = Math.floor((query.length - 10) / 2);
  return query.slice(0, 10) + query.slice(midStart, midStart + 10) + query.slice(-10);
}

/** sign = md5(appid + query + salt + secret)；尊享版传入 truncate: true 时截断 query */
export function baiduSign(params: { appId: string; query: string; salt: string; secret: string; truncate?: boolean }): string {
  const { appId, query, salt, secret, truncate = false } = params;
  const q = truncate ? truncateQueryForSign(query) : query;
  return md5(appId + q + salt + secret);
}

/** 百度翻译支持语种（常用列表） */
export const BAIDU_LANGUAGES: { code: string; label: string }[] = [
  { code: 'auto', label: '自动检测' },
  { code: 'zh', label: '中文-简' },
  { code: 'cht', label: '中文-繁' },
  { code: 'en', label: '英语' },
  { code: 'ja', label: '日语' },
  { code: 'ko', label: '韩语' },
  { code: 'fr', label: '法语' },
  { code: 'de', label: '德语' },
  { code: 'es', label: '西班牙语' },
  { code: 'ru', label: '俄语' },
  { code: 'pt', label: '葡萄牙语' },
  { code: 'it', label: '意大利语' },
  { code: 'th', label: '泰语' },
  { code: 'vi', label: '越南语' },
];

/**
 * 解析目标语言的自动选择规则。
 *
 * 百度翻译仅支持自动检测源语言，目标语言必须在请求前确定：
 * - 明确选择中文（简体或繁体）为源语言时，译为英语；
 * - 明确选择其他源语言时，译为简体中文；
 * - 源语言自动检测时，以输入中是否包含汉字作为本地预判。
 */
export function resolveTargetLanguage(text: string, from: string, to: string): string {
  if (to !== 'auto') return to;
  if (from === 'zh' || from === 'cht') return 'en';
  if (from !== 'auto') return 'zh';
  return /\p{Script=Han}/u.test(text) ? 'en' : 'zh';
}

/** 百度翻译错误码映射 */
export const BAIDU_ERROR_MESSAGES: Record<string, string> = {
  '52001': '请求超时，请稍后重试',
  '52002': '翻译服务暂时不可用，请稍后重试',
  '52003': '未授权用户，请检查 APP ID / 密钥或账户状态',
  '54000': '必填参数缺失，请检查输入',
  '54001': '签名无效，请检查密钥是否填写正确',
  '54003': '请求过于频繁，请稍后重试',
  '54004': '账户余额不足，请前往百度翻译开放平台充值',
  '54005': '长文本查询过于频繁，请稍后重试',
  '58000': '客户端 IP 不在白名单内',
  '58001': '翻译服务尚未开通，请在百度翻译开放平台开通',
  '58002': '服务当前关闭，请稍后重试',
  '90001': '请求过于频繁，请稍后重试',
};

interface BaiduApiResponse {
  error_code?: string;
  error_msg?: string;
  from?: string;
  to?: string;
  trans_result?: { src: string; dst: string }[];
}

/** 调用百度翻译 API */
export async function translateWithBaidu(
  text: string,
  from: string,
  to: string,
  creds: BaiduCredentials,
  fetchFn: FetchLike
): Promise<TranslateResult> {
  const salt = `${Date.now()}${Math.floor(Math.random() * 10000)}`;
  const sign = baiduSign({ appId: creds.appId, query: text, salt, secret: creds.secret });

  const body = new URLSearchParams({
    q: text,
    from,
    to,
    appid: creds.appId,
    salt,
    sign,
  });

  const res = await fetchFn(BAIDU_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    throw new Error(`网络请求失败（HTTP ${res.status}），请检查网络连通性`);
  }

  const data: BaiduApiResponse = await res.json();
  if (data.error_code) {
    throw new Error(BAIDU_ERROR_MESSAGES[data.error_code] ?? `翻译服务返回错误（代码 ${data.error_code}）`);
  }

  const lines = (data.trans_result ?? []).map((item) => item.dst);
  return { text: lines.join('\n'), from: data.from ?? from, to: data.to ?? to };
}

/**
 * 获取请求函数：Tauri 环境用 plugin-http 绕过 CORS，浏览器环境回退原生 fetch
 */
export async function resolveFetch(): Promise<FetchLike> {
  if (isTauri) {
    const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http');
    return tauriFetch as unknown as FetchLike;
  }
  return (url, init) => window.fetch(url, init);
}
