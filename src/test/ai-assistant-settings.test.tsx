import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/i18n';
import { AiSettings } from '@/tools/ai-assistant/settings';
import type { AiBackend, AiProvider } from '@/tools/ai-assistant/types';

const model = (id: string, name = id, supportsImages = false) => ({ id, name, supportsImages });
const provider = (models = [model('existing', 'My model', true)]): AiProvider => ({
  id: 'service', name: 'My API', kind: 'openai', baseUrl: 'https://example.test/v1',
  hasApiKey: true, enabled: true, models,
});

function setup(providers = [provider()]) {
  const onSave = vi.fn().mockResolvedValue(undefined);
  const backend: AiBackend = {
    load: vi.fn(), save: vi.fn(), saveProvider: vi.fn(), removeProvider: vi.fn(),
    listModels: vi.fn().mockResolvedValue([model('existing'), model('new-model'), model('new-model'), model('other')]),
    testConnection: vi.fn().mockResolvedValue('Connected'), generate: vi.fn(), cancel: vi.fn(),
    openDataDirectory: vi.fn(), reset: vi.fn(),
  };
  render(<AiSettings providers={providers} backend={backend} onSave={onSave} onRemove={vi.fn()} onClearHistory={vi.fn()} onReset={vi.fn()} onClose={vi.fn()} />);
  return { onSave, backend };
}

beforeEach(async () => { await i18n.changeLanguage('en'); });
afterEach(cleanup);

describe('AI service model selection', () => {
  it('fetches candidates without enabling them and applies only the models selected by the user', async () => {
    const { onSave } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Fetch models' }));
    const picker = await screen.findByRole('dialog', { name: 'Choose enabled models' });
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0].models).toEqual([model('existing', 'My model', true)]);
    expect(within(picker).getByRole('checkbox', { name: 'Enable model: existing' })).toBeChecked();
    expect(within(picker).getAllByRole('checkbox', { name: 'Enable model: new-model' })).toHaveLength(1);
    expect(within(picker).getByRole('checkbox', { name: 'Enable model: new-model' })).not.toBeChecked();

    fireEvent.click(within(picker).getByRole('checkbox', { name: 'Enable model: new-model' }));
    fireEvent.click(within(picker).getByRole('button', { name: 'Apply selection' }));
    expect(screen.queryByRole('dialog', { name: 'Choose enabled models' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save service' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
    expect(onSave.mock.calls[1][0].models).toEqual([model('existing', 'My model', true), model('new-model')]);
  });

  it('cancels model selection without altering the saved or displayed enabled models', async () => {
    const { onSave } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Fetch models' }));
    const picker = await screen.findByRole('dialog', { name: 'Choose enabled models' });
    fireEvent.click(within(picker).getByRole('button', { name: 'Clear selection' }));
    fireEvent.click(within(picker).getByRole('checkbox', { name: 'Enable model: other' }));
    fireEvent.click(within(picker).getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save service' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
    expect(onSave.mock.calls[1][0].models).toEqual([model('existing', 'My model', true)]);
  });

  it('keeps search separate from selection and allows replacing a previously enabled full list', async () => {
    const { onSave } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Fetch models' }));
    const picker = await screen.findByRole('dialog', { name: 'Choose enabled models' });
    fireEvent.click(within(picker).getByRole('button', { name: 'Clear selection' }));
    fireEvent.change(within(picker).getByRole('searchbox', { name: 'Search models' }), { target: { value: 'NEW-MODEL' } });
    expect(within(picker).getAllByRole('checkbox')).toHaveLength(1);
    fireEvent.click(within(picker).getByRole('checkbox', { name: 'Enable model: new-model' }));
    fireEvent.change(within(picker).getByRole('searchbox', { name: 'Search models' }), { target: { value: 'absent' } });
    expect(within(picker).getByText('No matching models')).toBeInTheDocument();
    fireEvent.click(within(picker).getByRole('button', { name: 'Apply selection' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save service' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
    expect(onSave.mock.calls[1][0].models).toEqual([model('new-model')]);
  });

  it('shows one summary for equal IDs and names, with explicitly labelled editing on demand', () => {
    setup([provider([model('same-model')])]);
    expect(screen.getAllByText('same-model')).toHaveLength(1);
    expect(screen.queryByRole('textbox', { name: 'Model ID' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Edit model: same-model' }));
    expect(screen.getByRole('textbox', { name: 'Model ID' })).toHaveValue('same-model');
    expect(screen.getByRole('textbox', { name: 'Model display name' })).toHaveValue('same-model');
  });

  it('does not silently restore disabled models when fetching again', async () => {
    const { onSave } = setup([provider([])]);
    fireEvent.click(screen.getByRole('button', { name: 'Fetch models' }));
    let picker = await screen.findByRole('dialog', { name: 'Choose enabled models' });
    fireEvent.click(within(picker).getByRole('checkbox', { name: 'Enable model: new-model' }));
    fireEvent.click(within(picker).getByRole('button', { name: 'Apply selection' }));
    fireEvent.click(screen.getByRole('button', { name: 'Fetch models' }));
    picker = await screen.findByRole('dialog', { name: 'Choose enabled models' });
    expect(within(picker).getByRole('checkbox', { name: 'Enable model: new-model' })).toBeChecked();
    expect(within(picker).getByRole('checkbox', { name: 'Enable model: existing' })).not.toBeChecked();
    expect(onSave.mock.calls[onSave.mock.calls.length - 1][0].models).toEqual([model('new-model')]);
  });
});
