import { type ComponentType } from 'react';
import { cn } from '@/lib/utils';

export interface FeatureRailItem<T extends string> {
  id: T;
  name: string;
  shortName?: string;
  icon: ComponentType<{ className?: string }>;
}

interface FeatureRailGroup<T extends string> {
  title?: string;
  features: FeatureRailItem<T>[];
}

interface FeatureRailProps<T extends string> {
  groups: FeatureRailGroup<T>[];
  active: T;
  onSelect: (id: T) => void;
  ariaLabel?: string;
  /** wrap：全部芯片换行（PDF）。categories：分类页签 + 当前分类单行工具（图片工作室）。 */
  layout?: 'wrap' | 'categories';
}

function FeatureChip<T extends string>({
  feature,
  isActive,
  onSelect,
}: {
  feature: FeatureRailItem<T>;
  isActive: boolean;
  onSelect: (id: T) => void;
}) {
  const Icon = feature.icon;
  return (
    <button
      type="button"
      onClick={() => onSelect(feature.id)}
      aria-current={isActive ? 'page' : undefined}
      className={cn(
        'flex min-h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1 text-[13px] transition-colors duration-150',
        isActive
          ? 'bg-primary/12 font-medium text-foreground ring-1 ring-primary/25'
          : 'text-muted-foreground hover:bg-accent hover:text-foreground'
      )}
    >
      <Icon className={cn('h-3.5 w-3.5', isActive ? 'text-primary' : 'text-muted-foreground')} />
      {feature.shortName ?? feature.name}
    </button>
  );
}

function CategorizedFeatureRail<T extends string>({ groups, active, onSelect, ariaLabel }: FeatureRailProps<T>) {
  const activeGroup = groups.find((group) => group.features.some((feature) => feature.id === active)) ?? groups[0];
  const tools = activeGroup?.features ?? [];
  const showTools = tools.length > 1;

  return (
    <nav className="shrink-0 border-b border-border bg-card/80" aria-label={ariaLabel}>
      <div className="flex items-center gap-1 overflow-x-auto px-3 py-1.5" role="tablist" aria-label="功能分类">
        {groups.map((group, index) => {
          const selected = group === activeGroup;
          const first = group.features[0];
          return (
            <button
              key={group.title ?? first?.id ?? String(index)}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => {
                if (!first || group.features.some((feature) => feature.id === active)) return;
                onSelect(first.id);
              }}
              className={cn(
                'flex min-h-8 shrink-0 items-center rounded-md px-3 py-1 text-[13px] transition-colors duration-150',
                selected
                  ? 'bg-primary/12 font-medium text-foreground ring-1 ring-primary/25'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground'
              )}
            >
              {group.title}
            </button>
          );
        })}
      </div>
      {showTools ? (
        <div
          className="flex items-center gap-1 overflow-x-auto border-t border-border/70 px-3 py-1.5"
          role="tablist"
          aria-label={activeGroup?.title ?? '当前分类功能'}
        >
          {tools.map((feature) => (
            <FeatureChip key={feature.id} feature={feature} isActive={active === feature.id} onSelect={onSelect} />
          ))}
        </div>
      ) : null}
    </nav>
  );
}

/** 复合工具顶部功能分段。分类布局把工具限制在当前分组，避免顶栏换行占掉画布。 */
export function FeatureRail<T extends string>({
  groups,
  active,
  onSelect,
  ariaLabel,
  layout = 'wrap',
}: FeatureRailProps<T>) {
  if (layout === 'categories') {
    return <CategorizedFeatureRail groups={groups} active={active} onSelect={onSelect} ariaLabel={ariaLabel} />;
  }

  return (
    <nav className="shrink-0 overflow-x-auto border-b border-border bg-card/80 px-3 py-1.5" aria-label={ariaLabel}>
      <div className="flex min-h-9 flex-wrap items-center gap-1">
        {groups.map((group, index) => (
          <div key={group.title ?? String(index)} className="flex flex-wrap items-center gap-1">
            {index > 0 ? <span className="mx-1 hidden h-4 w-px bg-border sm:block" aria-hidden="true" /> : null}
            {group.title ? <span className="px-1 text-[11px] text-muted-foreground">{group.title}</span> : null}
            {group.features.map((feature) => (
              <FeatureChip key={feature.id} feature={feature} isActive={active === feature.id} onSelect={onSelect} />
            ))}
          </div>
        ))}
      </div>
    </nav>
  );
}
