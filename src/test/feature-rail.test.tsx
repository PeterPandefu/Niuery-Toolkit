import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FeatureRail } from '@/components/shared/FeatureRail';
import { Minimize2, ScanText, Layers } from 'lucide-react';

const groups = [
  {
    title: '编辑',
    features: [
      { id: 'compress', name: '图片压缩', shortName: '压缩', icon: Minimize2 },
      { id: 'convert', name: '格式转换', shortName: '转换', icon: Minimize2 },
    ],
  },
  { title: '合并', features: [{ id: 'merge-image', name: '合并为图片', shortName: '图片', icon: Layers }] },
  { title: '识别', features: [{ id: 'ocr', name: '图片 OCR', icon: ScanText }] },
];

describe('FeatureRail categories', () => {
  it('只显示当前分类的工具，且单工具分类不展开第二行', () => {
    const onSelect = vi.fn();
    render(<FeatureRail layout="categories" groups={groups} active="compress" onSelect={onSelect} ariaLabel="图片操作" />);

    expect(screen.getByRole('tab', { name: '编辑' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('button', { name: '压缩' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: '转换' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '图片 OCR' })).not.toBeInTheDocument();
  });

  it('切换分类时选中该分类的第一个工具', () => {
    const onSelect = vi.fn();
    render(<FeatureRail layout="categories" groups={groups} active="compress" onSelect={onSelect} ariaLabel="图片操作" />);

    fireEvent.click(screen.getByRole('tab', { name: '识别' }));
    expect(onSelect).toHaveBeenCalledWith('ocr');
  });
});
