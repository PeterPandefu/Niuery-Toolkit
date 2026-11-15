import { AlertTriangle, CircleDot, ShieldCheck } from 'lucide-react';
import { Select, type SelectOption } from '@/components/ui/select';
import type { AiPermissionMode } from './types';
import { useAiText } from './ui-text';

function permissionModeOptions(t: (zh: string, en: string) => string): SelectOption[] {
  return [
    { value: 'ask', label: t('每次询问', 'Ask every time'), description: t('执行命令、修改文件或访问网络前，始终询问', 'Always ask before running commands, changing files or accessing the network'), icon: <ShieldCheck size={15} /> },
    { value: 'auto', label: t('自动审批', 'Auto approve'), description: t('仅在检测到潜在风险时询问', 'Only ask when a potential risk is detected'), icon: <CircleDot size={15} /> },
    { value: 'full', label: t('完全访问', 'Full access'), description: t('不再询问，可自由访问你的文件、终端和网络', 'No more asking; free access to your files, terminal and network'), icon: <AlertTriangle size={15} className="ai-permission-danger" /> },
  ];
}

export function PermissionSelector({ value, disabled, onChange }: { value: AiPermissionMode; disabled?: boolean; onChange(mode: AiPermissionMode): void }) {
  const t = useAiText();
  const options = permissionModeOptions(t);
  const current = options.find(option => option.value === value) ?? options[0];
  return <Select
    className={`ai-selector ai-selector-permission is-${value}`}
    aria-label={t('工具权限', 'Tool permissions')}
    caption={t('工具权限', 'Tool permissions')}
    value={value}
    options={options}
    onValueChange={next => onChange(next as AiPermissionMode)}
    disabled={disabled}
    placement="top"
    variant="compact"
    title={current.description}
    icon={value === 'full' ? <AlertTriangle size={15} className="ai-permission-danger" /> : value === 'auto' ? <CircleDot size={15} /> : <ShieldCheck size={15} />}
  />;
}