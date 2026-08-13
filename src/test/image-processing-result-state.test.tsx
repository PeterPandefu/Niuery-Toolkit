import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useImageProcessingResult } from '@/tools/graphic/image-studio/common';

describe('useImageProcessingResult', () => {
  it('更换输入文件时清空临时结果', () => {
    const first = new File(['first'], 'first.png', { type: 'image/png', lastModified: 1 });
    const second = new File(['second'], 'second.png', { type: 'image/png', lastModified: 2 });
    const { result, rerender } = renderHook(({ files }) => useImageProcessingResult(files), { initialProps: { files: [first] } });

    act(() => result.current.setResult({ files: [{ name: 'result.png', blob: new Blob(['result']) }], zipName: '结果.zip' }));
    expect(result.current.result).not.toBeNull();

    rerender({ files: [second] });
    expect(result.current.result).toBeNull();
  });
});
