import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/i18n';
import { MessageView } from '@/tools/ai-assistant/message-view';
import { AiEnabledModel } from '@/tools/ai-assistant/model-settings';
import { ParameterFields } from '@/tools/ai-assistant/conversation-settings';

beforeEach(async () => { await i18n.changeLanguage('en'); });
afterEach(cleanup);

describe('AI generation feedback', () => {
  it('starts expanded when thinking and answer arrive together during generation', () => {
    render(<MessageView message={{ id: 'a', role: 'assistant', content: 'Answer started', thinking: 'Returned thought', attachments: [], createdAt: 1, status: 'streaming' }} disabled={false} lastAssistant onEdit={() => {}} onRegenerate={() => {}} />);
    expect(screen.getByText('Returned thought')).toBeVisible();
    expect(screen.queryByText(/Thinking…/)).not.toBeInTheDocument();
  });
  it('opens arriving thinking during streaming, respects user folding, and collapses on completion', () => {
    const message = { id: 'a', role: 'assistant' as const, content: '', attachments: [], createdAt: 1, status: 'waiting' as const };
    const props = { disabled: false, lastAssistant: true, onEdit: () => {}, onRegenerate: () => {} };
    const { rerender } = render(<MessageView {...props} message={message} />);
    rerender(<MessageView {...props} message={{ ...message, status: 'streaming', thinking: 'First' }} />);
    expect(screen.getByText('First')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Hide thinking' }));
    rerender(<MessageView {...props} message={{ ...message, status: 'streaming', thinking: 'First second' }} />);
    expect(screen.getByText('First second')).not.toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Show thinking' }));
    rerender(<MessageView {...props} message={{ ...message, status: 'complete', thinking: 'First second', content: 'Answer' }} />);
    expect(screen.getByText('First second')).not.toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Show thinking' }));
    expect(screen.getByText('First second')).toBeVisible();
  });
  it('hides thinking when disabled for a model and renders model text safely', () => {
    const message = { id: 'a', role: 'assistant' as const, content: 'Answer', thinking: '<script>bad()</script>', attachments: [], createdAt: 1, status: 'complete' as const };
    const props = { disabled: false, lastAssistant: true, onEdit: () => {}, onRegenerate: () => {} };
    const { rerender, container } = render(<MessageView {...props} showThinking={false} message={message} />);
    expect(screen.queryByRole('region', { name: 'Thinking' })).not.toBeInTheDocument();
    rerender(<MessageView {...props} message={message} />);
    fireEvent.click(screen.getByRole('button', { name: 'Show thinking' }));
    expect(screen.getByText('<script>bad()</script>')).toBeVisible();
    expect(container.querySelector('script')).toBeNull();
  });
  it('resets the fold for new generation and version switches, but shows no empty fold', () => {
    const message = { id: 'a', role: 'assistant' as const, content: 'Answer', thinking: 'First thought', selectedVersion: 0, attachments: [], createdAt: 1, status: 'complete' as const };
    const props = { disabled: false, lastAssistant: true, onEdit: () => {}, onRegenerate: () => {} };
    const { rerender } = render(<MessageView {...props} message={message} />);
    fireEvent.click(screen.getByRole('button', { name: 'Show thinking' }));
    rerender(<MessageView {...props} message={{ ...message, selectedVersion: 1, thinking: 'Second thought' }} />);
    expect(screen.getByText('Second thought')).not.toBeVisible();
    rerender(<MessageView {...props} message={{ ...message, thinking: undefined, content: '', createdAt: 2, status: 'waiting' }} />);
    expect(screen.queryByRole('region', { name: 'Thinking' })).not.toBeInTheDocument();
    rerender(<MessageView {...props} message={{ ...message, thinking: 'New generation', content: '', createdAt: 2, status: 'streaming' }} />);
    expect(screen.getByText('New generation')).toBeVisible();
  });
  it('never quotes selected thinking as final answer text', () => {
    const onQuote = vi.fn();
    render(<MessageView message={{ id: 'a', role: 'assistant', thinking: 'Do not quote this', content: 'Final answer', attachments: [], createdAt: 1, status: 'complete' }} disabled={false} lastAssistant onQuote={onQuote} onEdit={() => {}} onRegenerate={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Show thinking' }));
    const range = document.createRange(); range.selectNodeContents(screen.getByText('Do not quote this'));
    window.getSelection()?.removeAllRanges(); window.getSelection()?.addRange(range);
    fireEvent.click(screen.getByRole('button', { name: 'Quote message' }));
    expect(onQuote).toHaveBeenCalledWith('Final answer');
    window.getSelection()?.removeAllRanges();
  });
  it('renders returned thinking in a collapsible section and keeps it separate from the answer', () => {
    render(<MessageView message={{ id: 'a', role: 'assistant', content: 'Final answer', thinking: 'I checked the constraints first.', attachments: [], createdAt: 1, status: 'complete' }} disabled={false} lastAssistant onEdit={() => {}} onRegenerate={() => {}} />);
    const section = screen.getByRole('region', { name: 'Thinking' });
    expect(section).toBeInTheDocument();
    expect(screen.getByText('Final answer')).toBeInTheDocument();
    expect(screen.queryByText('I checked the constraints first.')).not.toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Show thinking' }));
    expect(screen.getByText('I checked the constraints first.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Hide thinking' })).toBeInTheDocument();
  });
  it('disables unsupported temperature and limits output to the model capability', () => {
    render(<ParameterFields value={{ historyRounds: 20 }} model={{ id: 'm', name: 'Model', supportsImages: false, supportsTemperature: false, maxOutputTokens: 100 }} onChange={() => {}} />);
    expect(screen.getByRole('spinbutton', { name: /Temperature/ })).toBeDisabled();
    expect(screen.getByRole('spinbutton', { name: /Maximum output/ })).toHaveAttribute('max', '100');
  });
  it('distinguishes output truncation and displays measured tokens and timing', () => {
    render(<MessageView message={{ id: 'a', role: 'assistant', content: 'Partial answer', attachments: [], createdAt: 1, status: 'complete', finishReason: 'length', usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 }, firstTokenMs: 500, durationMs: 1500 }} disabled={false} lastAssistant onEdit={() => {}} onRegenerate={() => {}} />);
    expect(screen.getByText(/Output limit reached/)).toBeInTheDocument();
    expect(screen.getByText(/10.*20.*30/)).toBeInTheDocument();
    expect(screen.getByText(/0.50.*1.50/)).toBeInTheDocument();
  });
  it('exposes model capacities and supported parameters in the model editor', () => {
    render(<AiEnabledModel model={{ id: 'm', name: 'Model', supportsImages: false }} disabled={false} onChange={() => {}} onDisable={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit model: m' }));
    expect(screen.getByRole('spinbutton', { name: 'Context capacity (tokens)' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Supports temperature' })).toBeInTheDocument();
  });
});
