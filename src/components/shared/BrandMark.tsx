import { cn } from '@/lib/utils';

interface BrandMarkProps {
  size?: number;
  className?: string;
}

export function BrandMark({ size = 28, className }: BrandMarkProps) {
  return (
    <div
      className={cn('flex shrink-0 items-center justify-center rounded-xl bg-primary font-heading font-bold leading-none text-primary-foreground shadow-tinted-sm select-none', className)}
      style={{ width: size, height: size, fontSize: size * 0.54 }}
      aria-hidden="true"
    >
      N
    </div>
  );
}
