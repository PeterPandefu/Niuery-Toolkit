import { describe, it, expect } from 'vitest';
import {
  lookupProvince,
  parseCoordinatePair,
  wgs84ToGcj02,
} from '@/lib/china-province-utils';

describe('china-province-utils', () => {
  it('parses lng-lat and lat-lng pairs', () => {
    expect(parseCoordinatePair('116.4, 39.9')).toEqual({
      longitude: 116.4,
      latitude: 39.9,
    });
    expect(parseCoordinatePair('39.9，116.4', 'lat-lng')).toEqual({
      longitude: 116.4,
      latitude: 39.9,
    });
  });

  it('looks up Beijing for Tiananmen coordinates', () => {
    const result = lookupProvince(116.397428, 39.90923, 'gcj02');
    expect(result?.name).toBe('北京市');
    expect(result?.adcode).toBe('110000');
  });

  it('looks up Guangdong for Canton Tower coordinates', () => {
    const result = lookupProvince(113.32452, 23.10647, 'gcj02');
    expect(result?.name).toBe('广东省');
  });

  it('converts WGS-84 near Beijing into GCJ-02 offset', () => {
    const [lng, lat] = wgs84ToGcj02(116.397428, 39.90923);
    expect(lng).not.toBe(116.397428);
    expect(lat).not.toBe(39.90923);
    expect(lng).toBeGreaterThan(116.3);
    expect(lat).toBeGreaterThan(39.8);
  });

  it('returns null outside matched provinces', () => {
    expect(lookupProvince(0, 0, 'gcj02')).toBeNull();
  });
});
