import { describe, expect, it } from 'vitest';
import { md5 } from 'js-md5';
import {
  BAIDU_API_URL,
  BAIDU_ERROR_MESSAGES,
  baiduSign,
  resolveTargetLanguage,
  translateWithBaidu,
  truncateQueryForSign,
  type FetchLike,
} from '@/lib/translate-utils';

describe('truncateQueryForSign', () => {
  it('短文本（≤20 字符）原样返回', () => {
    expect(truncateQueryForSign('hello')).toBe('hello');
    expect(truncateQueryForSign('x'.repeat(20))).toBe('x'.repeat(20));
  });

  it('长文本取「前 10 + 中 10 + 后 10」', () => {
    // 长度 40：midStart = floor((40-10)/2) = 15
    const query = '0123456789'.repeat(4);
    expect(truncateQueryForSign(query)).toBe('0123456789' + query.slice(15, 25) + '0123456789');
    expect(truncateQueryForSign(query).length).toBe(30);
  });

  it('21 字符文本中段与首尾重叠时拼接 30 字符', () => {
    const query = 'a'.repeat(21);
    // midStart = floor(11/2) = 5 → 前10 + [5,15) + 后10
    expect(truncateQueryForSign(query)).toBe('a'.repeat(30));
  });
});

describe('baiduSign', () => {
  it('等于 md5(appid + truncatedQuery + salt + secret)', () => {
    const params = { appId: 'app123', query: '你好世界', salt: '16888', secret: 'sec' };
    expect(baiduSign(params)).toBe(md5('app123' + '你好世界' + '16888' + 'sec'));
  });

  it('已知 md5 向量：md5("abc")', () => {
    expect(baiduSign({ appId: '', query: 'abc', salt: '', secret: '' })).toBe('900150983cd24fb0d6963f7d28e17f72');
  });

  it('默认使用完整 query 参与签名', () => {
    const query = 'q'.repeat(50);
    expect(baiduSign({ appId: 'a', query, salt: 's', secret: 'k' })).toBe(md5('a' + query + 's' + 'k'));
  });

  it('尊享版 truncate: true 时先截断再签名', () => {
    const query = 'q'.repeat(50);
    expect(baiduSign({ appId: 'a', query, salt: 's', secret: 'k', truncate: true })).toBe(
      md5('a' + truncateQueryForSign(query) + 's' + 'k')
    );
  });
});

describe('resolveTargetLanguage', () => {
  it('目标语言手动指定时保持用户选择', () => {
    expect(resolveTargetLanguage('你好', 'auto', 'ja')).toBe('ja');
  });

  it('源语言明确为中文时自动译为英语', () => {
    expect(resolveTargetLanguage('hello', 'zh', 'auto')).toBe('en');
    expect(resolveTargetLanguage('hello', 'cht', 'auto')).toBe('en');
  });

  it('源语言明确为非中文时自动译为简体中文', () => {
    expect(resolveTargetLanguage('你好', 'en', 'auto')).toBe('zh');
  });

  it('源语言自动检测时依据输入是否包含汉字选择目标语言', () => {
    expect(resolveTargetLanguage('你好，world', 'auto', 'auto')).toBe('en');
    expect(resolveTargetLanguage('hello world', 'auto', 'auto')).toBe('zh');
  });
});

function mockFetch(payload: unknown, ok = true, status = 200): { fetchFn: FetchLike; calls: { url: string; init: RequestInit }[] } {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchFn: FetchLike = async (url, init) => {
    calls.push({ url, init: init! });
    return { ok, status, json: async () => payload } as Response;
  };
  return { fetchFn, calls };
}

describe('translateWithBaidu', () => {
  it('成功时拼接 trans_result 的 dst', async () => {
    const { fetchFn, calls } = mockFetch({
      from: 'en',
      to: 'zh',
      trans_result: [{ src: 'hello', dst: '你好' }, { src: 'world', dst: '世界' }],
    });
    const result = await translateWithBaidu('hello\nworld', 'auto', 'zh', { appId: 'id', secret: 'sec' }, fetchFn);
    expect(result).toEqual({ text: '你好\n世界', from: 'en', to: 'zh' });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(BAIDU_API_URL);
    expect(calls[0].init.method).toBe('POST');
    const body = new URLSearchParams(calls[0].init.body as string);
    expect(body.get('q')).toBe('hello\nworld');
    expect(body.get('from')).toBe('auto');
    expect(body.get('to')).toBe('zh');
    expect(body.get('appid')).toBe('id');
    expect(body.get('salt')).toBeTruthy();
    // sign 与 salt 一致且可复算
    expect(body.get('sign')).toBe(md5('id' + 'hello\nworld' + body.get('salt') + 'sec'));
  });

  it('错误码映射为可读中文消息', async () => {
    const { fetchFn } = mockFetch({ error_code: '54001', error_msg: 'sign error' });
    await expect(translateWithBaidu('hi', 'auto', 'zh', { appId: 'id', secret: 'sec' }, fetchFn)).rejects.toThrow(
      BAIDU_ERROR_MESSAGES['54001']
    );
  });

  it('未知错误码回退为通用消息', async () => {
    const { fetchFn } = mockFetch({ error_code: '99999' });
    await expect(translateWithBaidu('hi', 'auto', 'zh', { appId: 'id', secret: 'sec' }, fetchFn)).rejects.toThrow('99999');
  });

  it('HTTP 非 2xx 抛网络错误', async () => {
    const { fetchFn } = mockFetch({}, false, 503);
    await expect(translateWithBaidu('hi', 'auto', 'zh', { appId: 'id', secret: 'sec' }, fetchFn)).rejects.toThrow('503');
  });
});
