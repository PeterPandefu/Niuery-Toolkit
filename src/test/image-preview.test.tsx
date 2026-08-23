import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ImagePreview } from '@/tools/graphic/image-studio/image-preview';

describe('ImagePreview', () => {
  beforeEach(() => {
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn((file: File) => `blob:${file.name}`),
      revokeObjectURL: vi.fn(),
    });
  });

  it('opens a selected thumbnail in the shared image viewer', () => {
    const file = new File(['image'], 'sample.png', { type: 'image/png' });
    render(<ImagePreview files={[file]} />);

    fireEvent.click(screen.getByRole('button', { name: '放大查看 已选图片预览' }));

    expect(screen.getByRole('dialog', { name: '图片预览' })).toBeInTheDocument();
    expect(within(screen.getByRole('dialog', { name: '图片预览' })).getByRole('img', { name: '已选图片预览' })).toHaveAttribute('src', 'blob:sample.png');
  });
});
