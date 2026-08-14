import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import type { MermaidTemplateKind } from '@/lib/markdown-utils';
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
  GitBranch,
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
  onMermaidTemplate: (template: MermaidTemplateKind) => void;
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

const MERMAID_TEMPLATE_OPTIONS: { template: MermaidTemplateKind; i18nKey: string }[] = [
  { template: 'flowchart', i18nKey: 'mermaidFlowchart' },
  { template: 'sequence', i18nKey: 'mermaidSequence' },
  { template: 'class', i18nKey: 'mermaidClass' },
  { template: 'state', i18nKey: 'mermaidState' },
];

export function Toolbar({ onAction, onMermaidTemplate, disabled }: ToolbarProps) {
  const { t } = useTranslation();
  const [isMermaidMenuOpen, setIsMermaidMenuOpen] = useState(false);
  const mermaidMenuRef = useRef<HTMLDivElement>(null);
  const handleClick = useCallback(
    (action: ToolbarAction) => {
      if (!disabled) onAction(action);
    },
    [onAction, disabled]
  );

  useEffect(() => {
    if (!isMermaidMenuOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!mermaidMenuRef.current?.contains(event.target as Node)) setIsMermaidMenuOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsMermaidMenuOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isMermaidMenuOpen]);

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
      <div ref={mermaidMenuRef} className="relative ml-1 border-l pl-1">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          disabled={disabled}
          onClick={() => setIsMermaidMenuOpen((open) => !open)}
          title={t('markdownEditor.toolbar.mermaid')}
          aria-label={t('markdownEditor.toolbar.mermaid')}
          aria-haspopup="menu"
          aria-expanded={isMermaidMenuOpen}
        >
          <GitBranch className="h-3.5 w-3.5" />
        </Button>
        {isMermaidMenuOpen && (
          <div className="absolute right-0 z-20 mt-1 w-40 rounded-md border bg-popover p-1 shadow-md" role="menu" aria-label={t('markdownEditor.toolbar.mermaid')}>
            {MERMAID_TEMPLATE_OPTIONS.map(({ template, i18nKey }) => (
              <Button
                key={template}
                variant="ghost"
                size="sm"
                className="w-full justify-start"
                role="menuitem"
                onClick={() => {
                  onMermaidTemplate(template);
                  setIsMermaidMenuOpen(false);
                }}
              >
                {t(`markdownEditor.toolbar.${i18nKey}`)}
              </Button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
