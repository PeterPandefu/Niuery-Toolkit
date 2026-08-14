import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { loadImageElementMock } = vi.hoisted(() => ({
  loadImageElementMock: vi.fn(),
}));

vi.mock('@/lib/image-utils', async () => {
  const actual = await vi.importActual<typeof import('@/lib/image-utils')>('@/lib/image-utils');
  return { ...actual, loadImageElement: loadImageElementMock };
});

vi.mock('@/tools/graphic/image-studio/image-file-dropzone', () => ({
  ImageFileDropzone: ({ onChange }: { onChange: (files: File[]) => void }) => (
    <button type="button" onClick={() => onChange([new File(['image'], 'source.png', { type: 'image/png' })])}>
      选择测试图片
    </button>
  ),
}));

vi.mock('@/tools/graphic/image-studio/image-preview', () => ({ ImagePreview: () => null }));
vi.mock('@/tools/graphic/image-studio/processing-result-preview', () => ({ ProcessingResultPreview: () => null }));

import { CutoutPanel } from '@/tools/graphic/image-studio/panels-merge';

describe('CutoutPanel', () => {
  const sourceImage = { naturalWidth: 320, naturalHeight: 240 } as HTMLImageElement;
  const contexts = new WeakMap<HTMLCanvasElement, { drawImage: ReturnType<typeof vi.fn>; clearRect: ReturnType<typeof vi.fn> }>();

  beforeEach(() => {
    loadImageElementMock.mockResolvedValue(sourceImage);
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:source'), revokeObjectURL: vi.fn() });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
      const context = { drawImage: vi.fn(), clearRect: vi.fn() };
      contexts.set(this, context);
      return context as unknown as CanvasRenderingContext2D;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('图片加载完成后立即绘制原图，画笔可在可见画布上继续涂抹', async () => {
    render(<CutoutPanel />);
    fireEvent.click(screen.getByRole('button', { name: '选择测试图片' }));

    await waitFor(() => {
      const display = document.querySelector('canvas');
      expect(display).not.toBeNull();
      expect(contexts.get(display!)?.drawImage).toHaveBeenCalledWith(sourceImage, 0, 0);
    });
  });
});
