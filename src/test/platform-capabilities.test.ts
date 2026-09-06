import { describe, expect, it } from 'vitest';
import { missingToolCapabilities } from '@/lib/platform-capabilities';

describe('平台能力检测', () => {
  it('在浏览器能力不足时返回可操作的缺失项', () => {
    expect(missingToolCapabilities(
      { network: 'offline', permissions: ['screen', 'microphone', 'systemAudio', 'nativeWindow'] },
      {
        runtime: 'browser',
        file: true,
        screen: true,
        microphone: false,
        systemAudio: false,
        clipboard: true,
        nativeWindow: false,
        system: false,
        localNetwork: false,
      },
    )).toEqual(['microphone', 'systemAudio', 'nativeWindow']);
  });

  it('无权限声明的普通离线工具不会产生缺失项', () => {
    expect(missingToolCapabilities({ network: 'offline', permissions: [] }, {
      runtime: 'browser',
      file: true,
      screen: false,
      microphone: false,
      systemAudio: false,
      clipboard: false,
      nativeWindow: false,
      system: false,
      localNetwork: false,
    })).toEqual([]);
  });
});
