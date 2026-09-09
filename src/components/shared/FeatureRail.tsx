import { type ComponentType } from 'react';
import { cn } from '@/lib/utils';

export interface FeatureRailItem<T extends string> {
  id: T;
  name: string;
  icon: ComponentType<{ className?: string }>;
}

interface FeatureRailProps<T extends string> {
  groups: { title?: string; features: FeatureRailItem<T>[] }[];
  active: T;
  onSelect: (id: T) => void;
  ariaLabel?: string;
}

/** 复合工具顶部功能分段，替代内部侧栏。分组在同一行换行，避免占掉预览高度。 */
export function FeatureRail<T extends string>({ groups, active, onSelect, ariaLabel }: FeatureRailProps<T>) {
  return (
    <nav className="shrink-0 overflow-x-auto border-b border-border bg-card/80 px-3 py-1.5" aria-label={ariaLabel}>
      <div className="flex min-h-9 flex-wrap items-center gap-1">
        {groups.map((group, index) => (
          <div key={group.title ?? String(index)} className="flex flex-wrap items-center gap-1">
            {index > 0 ? <span className="mx-1 hidden h-4 w-px bg-border sm:block" aria-hidden="true" /> : null}
            {group.title ? <span className="px-1 text-[11px] text-muted-foreground">{group.title}</span> : null}
            {group.features.map((feature) => {
              const Icon = feature.icon;
              const isActive = active === feature.id;
              return (
                <button
                  key={feature.id}
                  type="button"
                  onClick={() => onSelect(feature.id)}
                  aria-current={isActive ? 'page' : undefined}
                  className={cn(
                    'flex min-h-8 items-center gap-1.5 rounded-md px-2.5 py-1 text-[13px] transition-colors duration-150',
                    isActive
                      ? 'bg-primary/12 font-medium text-foreground ring-1 ring-primary/25'
                      : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                  )}
                >
                  <Icon className={cn('h-3.5 w-3.5', isActive ? 'text-primary' : 'text-muted-foreground')} />
                  {feature.name}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </nav>
  );
}
