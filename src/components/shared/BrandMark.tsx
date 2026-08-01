import { cn } from '@/lib/utils';

interface BrandMarkProps {
  /** 尺寸（像素） */
  size?: number;
  className?: string;
}

/**
 * Niuery 品牌标识 —— 余烬渐变底 + Space Grotesk "N" 字标。
 * 字标即品牌，不依赖通用图标，形成独特记忆点。
 */
export function BrandMark({ size = 28, className }: BrandMarkProps) {
  return (
    <div
      className={cn(
        'relative flex shrink-0 items-center justify-center overflow-hidden rounded-[9px]',
        'bg-gradient-to-br from-[hsl(32_92%_62%)] via-[hsl(24_86%_52%)] to-[hsl(16_82%_44%)]',
        'ember-glow select-none',
        className
      )}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {/* 顶部高光 */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/30 to-transparent" />
      <span
        className="font-heading font-bold leading-none text-[hsl(24_30%_9%)]"
        style={{ fontSize: size * 0.58, transform: 'translateY(0.5px)' }}
      >
        N
      </span>
    </div>
  );
}
