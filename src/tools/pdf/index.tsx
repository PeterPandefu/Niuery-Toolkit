import { useState, type ComponentType } from 'react';
import { useToolLogger } from '@/hooks/use-tool-logger';
import { FeatureRail } from '@/components/shared/FeatureRail';
import { PrivacyNote } from './common';
import { CompressPanel, ExtractImagesPanel, MergePanel, SplitPanel, ToImagesPanel, WatermarkPanel } from './panels';
import { Combine, ImageDown, Images, Minimize2, Scissors, Stamp } from 'lucide-react';

type FeatureId = 'compress' | 'merge' | 'split' | 'watermark' | 'extract-images' | 'to-images';

const FEATURES: { id: FeatureId; name: string; icon: ComponentType<{ className?: string }>; desc: string }[] = [
  { id: 'compress', name: 'PDF 压缩', icon: Minimize2, desc: '无损重压缩或栅格化激进压缩' },
  { id: 'merge', name: 'PDF 合并', icon: Combine, desc: '多个 PDF 按顺序合并为一个' },
  { id: 'split', name: 'PDF 拆分', icon: Scissors, desc: '按页范围拆分或每页独立成文件' },
  { id: 'watermark', name: 'PDF 水印', icon: Stamp, desc: '文字水印，支持平铺与旋转' },
  { id: 'extract-images', name: '提取图片', icon: ImageDown, desc: '提取 PDF 内嵌的位图图片' },
  { id: 'to-images', name: 'PDF 转图片', icon: Images, desc: '每页渲染为 PNG / JPEG' },
];

const PANELS: Record<FeatureId, ComponentType> = {
  compress: CompressPanel,
  merge: MergePanel,
  split: SplitPanel,
  watermark: WatermarkPanel,
  'extract-images': ExtractImagesPanel,
  'to-images': ToImagesPanel,
};

/** PDF 工具箱：顶部功能分段 + 预览/属性工作台 */
export default function PdfToolkit() {
  const log = useToolLogger('pdf-toolkit');
  const [active, setActive] = useState<FeatureId>('compress');
  const ActivePanel = PANELS[active];
  const activeFeature = FEATURES.find((f) => f.id === active)!;

  const handleSelect = (id: FeatureId) => {
    if (id === active) return;
    setActive(id);
    log.info('功能标签切换', { id });
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <FeatureRail groups={[{ features: FEATURES }]} active={active} onSelect={handleSelect} ariaLabel="PDF 操作" />
      <main className="min-h-0 min-w-0 flex-1 overflow-y-auto p-4">
        <header className="mb-4">
          <h2 className="text-base font-semibold">{activeFeature.name}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{activeFeature.desc}</p>
        </header>
        <ActivePanel />
        <PrivacyNote />
      </main>
    </div>
  );
}
