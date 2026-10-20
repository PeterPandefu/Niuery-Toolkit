import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import i18n from '@/i18n';
import { TaskDialog } from '@/tools/ai-assistant/task-dialog';
import { createWorkspace, newConversation } from '@/tools/ai-assistant/model';
import type { AiProvider } from '@/tools/ai-assistant/types';

beforeEach(async () => { await i18n.changeLanguage('en'); }); afterEach(cleanup);
const providers: AiProvider[] = [{ id: 'p', name: 'Local API', baseUrl: 'http://localhost/v1', kind: 'openai', enabled: true, hasApiKey: false, models: [{ id: 'a', name: 'A', supportsImages: false }, { id: 'b', name: 'B', supportsImages: false }] }];

it('requires a visible destination confirmation before starting comparison generation', () => {
  const chat = newConversation(createWorkspace().assistants[0]); chat.draft = 'Question'; const run = vi.fn();
  render(<TaskDialog kind="comparison" conversation={chat} providers={providers} busy={false} onRun={run} onContinue={() => {}} onClose={() => {}} />);
  fireEvent.click(screen.getByRole('checkbox', { name: 'Local API · A' })); fireEvent.click(screen.getByRole('checkbox', { name: 'Local API · B' }));
  fireEvent.click(screen.getByRole('button', { name: 'Prepare comparison' }));
  expect(run).not.toHaveBeenCalled(); expect(screen.getByText('Confirm destinations')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm and generate' }));
  expect(run.mock.calls[0][0].requests).toHaveLength(2);
});

it('continues with a manually edited summary without any model request', () => {
  const chat = newConversation(createWorkspace().assistants[0]); const run = vi.fn(); const continuation = vi.fn();
  render(<TaskDialog kind="summary" conversation={chat} providers={providers} busy={false} onRun={run} onContinue={continuation} onClose={() => {}} />);
  fireEvent.change(screen.getByRole('textbox', { name: 'Editable summary' }), { target: { value: 'Use SQLite and keep backups' } });
  fireEvent.click(screen.getByRole('button', { name: 'Continue with summary' }));
  expect(continuation.mock.calls[0][0]).toMatchObject({ summary: 'Use SQLite and keep backups', parentConversationId: chat.id, messages: [] });
  expect(run).not.toHaveBeenCalled();
});
