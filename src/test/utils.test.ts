import { describe, it, expect } from 'vitest';
import { cn, formatBytes, copyToClipboard } from '@/lib/utils';

describe('cn (classnames utility)', () => {
  it('merges class names', () => {
    expect(cn('foo', 'bar')).toBe('foo bar');
  });

  it('handles conditional classes', () => {
    expect(cn('base', false && 'hidden', 'visible')).toBe('base visible');
  });

  it('merges tailwind conflicts correctly', () => {
    expect(cn('px-2', 'px-4')).toBe('px-4');
  });

  it('handles empty input', () => {
    expect(cn()).toBe('');
  });
});

describe('formatBytes', () => {
  it('formats 0 bytes', () => {
    expect(formatBytes(0)).toBe('0 Bytes');
  });

  it('formats bytes', () => {
    expect(formatBytes(500)).toBe('500 Bytes');
  });

  it('formats kilobytes', () => {
    expect(formatBytes(1024)).toBe('1 KB');
  });

  it('formats megabytes', () => {
    expect(formatBytes(1048576)).toBe('1 MB');
  });

  it('formats gigabytes', () => {
    expect(formatBytes(1073741824)).toBe('1 GB');
  });

  it('respects decimal places', () => {
    expect(formatBytes(1536, 1)).toBe('1.5 KB');
  });
});

describe('copyToClipboard', () => {
  it('copies text successfully', async () => {
    // Mock clipboard API
    Object.assign(navigator, {
      clipboard: {
        writeText: async () => {},
      },
    });
    const result = await copyToClipboard('test');
    expect(result).toBe(true);
  });
});
