import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  Bold,
  Italic,
  Strikethrough,
  Code,
  CodeSquare,
  Quote,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  ListChecks,
  Link,
  Image,
  Table,
  Minus,
} from 'lucide-react';

export type ToolbarAction =
  | 'bold'
  | 'italic'
  | 'strikethrough'
  | 'inlineCode'
  | 'codeBlock'
  | 'quote'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'ul'
  | 'ol'
  | 'taskList'
  | 'link'
  | 'image'
  | 'table'
  | 'hr';

interface ToolbarProps {
  onAction: (action: ToolbarAction) => void;
  disabled?: boolean;
}

interface ToolButton {
  action: ToolbarAction;
  icon: React.ComponentType<{ className?: string }>;
  i18nKey: string;
  shortcut?: string;
}

const TOOL_GROUPS: ToolButton[][] = [
  [
    { action: 'bold', icon: Bold, i18nKey: 'bold', shortcut: 'Ctrl+B' },
    { action: 'italic', icon: Italic, i18nKey: 'italic', shortcut: 'Ctrl+I' },
    { action: 'strikethrough', icon: Strikethrough, i18nKey: 'strikethrough' },
    { action: 'inlineCode', icon: Code, i18nKey: 'inlineCode' },
    { action: 'codeBlock', icon: CodeSquare, i18nKey: 'codeBlock', shortcut: 'Ctrl+Shift+K' },
  ],
  [
    { action: 'h1', icon: Heading1, i18nKey: 'h1' },
    { action: 'h2', icon: Heading2, i18nKey: 'h2' },
    { action: 'h3', icon: Heading3, i18nKey: 'h3' },
    { action: 'quote', icon: Quote, i18nKey: 'quote' },
  ],
  [
    { action: 'ul', icon: List, i18nKey: 'ul' },
    { action: 'ol', icon: ListOrdered, i18nKey: 'ol' },
    { action: 'taskList', icon: ListChecks, i18nKey: 'taskList' },
  ],
  [
    { action: 'link', icon: Link, i18nKey: 'link', shortcut: 'Ctrl+K' },
    { action: 'image', icon: Image, i18nKey: 'image' },
    { action: 'table', icon: Table, i18nKey: 'table' },
    { action: 'hr', icon: Minus, i18nKey: 'hr' },
  ],
];

export function Toolbar({ onAction, disabled }: ToolbarProps) {
  const { t } = useTranslation();
  const handleClick = useCallback(
    (action: ToolbarAction) => {
      if (!disabled) onAction(action);
    },
    [onAction, disabled]
  );

  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b px-2 py-1">
      {TOOL_GROUPS.map((group, gi) => (
        <div key={gi} className="flex items-center gap-0.5">
          {gi > 0 && <div className="mx-1 h-4 w-px bg-border" />}
          {group.map(({ action, icon: Icon, i18nKey, shortcut }) => {
            const label = t(`markdownEditor.toolbar.${i18nKey}`);
            return (
              <Button
                key={action}
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                disabled={disabled}
                onClick={() => handleClick(action)}
                title={shortcut ? `${label} (${shortcut})` : label}
              >
                <Icon className="h-3.5 w-3.5" />
              </Button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
