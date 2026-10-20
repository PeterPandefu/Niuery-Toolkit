import { BotMessageSquare } from 'lucide-react';
import { Select, type SelectOption } from '@/components/ui/select';

export function AiSelector({ label, value, options, placeholder, emptyText, title, disabled, placement = 'bottom', variant = 'assistant', onChange }: {
  label: string;
  value: string;
  options: SelectOption[];
  placeholder?: string;
  emptyText?: string;
  title?: string;
  disabled?: boolean;
  placement?: 'top' | 'bottom';
  variant?: 'assistant' | 'model';
  onChange(value: string): void;
}) {
  return <Select className={`ai-selector ai-selector-${variant}`} aria-label={label} caption={label} value={value} options={options} onValueChange={onChange} placeholder={placeholder} emptyText={emptyText} title={title} disabled={disabled} placement={placement} showGroup={variant === 'model'} variant={variant === 'model' ? 'compact' : 'default'} icon={<BotMessageSquare size={variant === 'assistant' ? 17 : 15} />} />;
}
