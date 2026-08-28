import { renderHook, act } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useAsyncAction } from '@/hooks/use-async-action';

describe('useAsyncAction', () => {
  it('exposes loading while an async action is pending and resets afterwards', async () => {
    let resolve!: (value: string) => void;
    const pending = new Promise<string>((done) => { resolve = done; });
    const { result } = renderHook(() => useAsyncAction(() => pending));

    let action!: Promise<string | undefined>;
    act(() => { action = result.current.run(); });
    expect(result.current.loading).toBe(true);

    await act(async () => { resolve('ok'); await action; });
    expect(result.current.loading).toBe(false);
  });

  it('resets loading when the action fails', async () => {
    const { result } = renderHook(() => useAsyncAction(async () => { throw new Error('boom'); }));
    await act(async () => { await expect(result.current.run()).rejects.toThrow('boom'); });
    expect(result.current.loading).toBe(false);
  });
});
