import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useState } from 'react';
import i18n from '@/i18n';
import { PromptTemplates } from '@/tools/ai-assistant/prompt-templates';
import type { AiPromptTemplate } from '@/tools/ai-assistant/types';

beforeEach(async () => { await i18n.changeLanguage('en'); });
afterEach(cleanup);

it('fills template variables, inserts the result and preserves a favorite in saved state', () => {
  const apply = vi.fn(); const save = vi.fn();
  function Harness() {
    const [templates, setTemplates] = useState<AiPromptTemplate[]>([]);
    return <PromptTemplates templates={templates} onChange={value => { setTemplates(value); save(value); }} onApply={apply} onClose={() => {}} />;
  }
  render(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: 'Favorite template: Translate' }));
  expect(screen.getByRole('button', { name: 'Favorite template: Translate' })).toHaveAttribute('aria-pressed', 'true');
  expect(save.mock.calls[0][0][0]).toMatchObject({ id: 'translate', favorite: true });
  fireEvent.click(screen.getByRole('button', { name: 'Translate' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'language' }), { target: { value: 'English' } });
  fireEvent.change(screen.getByRole('textbox', { name: 'text' }), { target: { value: '你好' } });
  fireEvent.click(screen.getByRole('button', { name: 'Insert into draft' }));
  expect(apply).toHaveBeenCalledWith('Translate this into English, preserving meaning and tone:\n你好');
});

it('creates, edits and removes a personal template', () => {
  function Harness() {
    const [templates, setTemplates] = useState<AiPromptTemplate[]>([]);
    return <PromptTemplates templates={templates} onChange={setTemplates} onApply={() => {}} onClose={() => {}} />;
  }
  render(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: 'New template' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Template name' }), { target: { value: 'My prompt' } });
  fireEvent.change(screen.getByRole('textbox', { name: 'Template content' }), { target: { value: 'Review {{input}}' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save template' }));
  expect(screen.getByRole('button', { name: 'My prompt' })).toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: 'input' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Delete template: My prompt' }));
  expect(screen.queryByRole('button', { name: 'My prompt' })).not.toBeInTheDocument();
});
