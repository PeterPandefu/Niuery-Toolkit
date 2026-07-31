import { describe, it, expect, beforeEach } from 'vitest';
import { useToolStateStore } from '@/store/tool-state-store';

describe('useToolStateStore', () => {
  beforeEach(() => {
    useToolStateStore.setState({ states: new Map() });
  });

  describe('getToolState', () => {
    it('returns undefined for non-existent tool', () => {
      expect(useToolStateStore.getState().getToolState('unknown')).toBeUndefined();
    });

    it('returns state for existing tool', () => {
      useToolStateStore.getState().setToolState('base64', { input: 'hello' });
      const state = useToolStateStore.getState().getToolState('base64');
      expect(state).toEqual({ input: 'hello', output: '', options: {} });
    });
  });

  describe('setToolState', () => {
    it('creates new entry with defaults for empty partial', () => {
      useToolStateStore.getState().setToolState('uuid', {});
      const state = useToolStateStore.getState().getToolState('uuid');
      expect(state).toEqual({ input: '', output: '', options: {} });
    });

    it('sets input on new entry', () => {
      useToolStateStore.getState().setToolState('base64', { input: 'test data' });
      const state = useToolStateStore.getState().getToolState('base64');
      expect(state?.input).toBe('test data');
      expect(state?.output).toBe('');
    });

    it('merges partial update into existing entry', () => {
      useToolStateStore.getState().setToolState('base64', { input: 'hello' });
      useToolStateStore.getState().setToolState('base64', { output: 'aGVsbG8=' });
      const state = useToolStateStore.getState().getToolState('base64');
      expect(state).toEqual({ input: 'hello', output: 'aGVsbG8=', options: {} });
    });

    it('overwrites specific fields without affecting others', () => {
      useToolStateStore.getState().setToolState('hash', {
        input: 'data',
        output: 'abc123',
        options: { algorithm: 'md5' },
      });
      useToolStateStore.getState().setToolState('hash', { output: 'def456' });
      const state = useToolStateStore.getState().getToolState('hash');
      expect(state?.input).toBe('data');
      expect(state?.output).toBe('def456');
      expect(state?.options).toEqual({ algorithm: 'md5' });
    });

    it('isolates state between different tools', () => {
      useToolStateStore.getState().setToolState('base64', { input: 'aaa' });
      useToolStateStore.getState().setToolState('uuid', { input: 'bbb' });
      expect(useToolStateStore.getState().getToolState('base64')?.input).toBe('aaa');
      expect(useToolStateStore.getState().getToolState('uuid')?.input).toBe('bbb');
    });

    it('produces a new Map reference on update', () => {
      const before = useToolStateStore.getState().states;
      useToolStateStore.getState().setToolState('base64', { input: 'x' });
      const after = useToolStateStore.getState().states;
      expect(after).not.toBe(before);
    });
  });

  describe('clearToolState', () => {
    it('removes existing tool state', () => {
      useToolStateStore.getState().setToolState('base64', { input: 'hello' });
      useToolStateStore.getState().clearToolState('base64');
      expect(useToolStateStore.getState().getToolState('base64')).toBeUndefined();
    });

    it('does not affect other tools', () => {
      useToolStateStore.getState().setToolState('base64', { input: 'a' });
      useToolStateStore.getState().setToolState('uuid', { input: 'b' });
      useToolStateStore.getState().clearToolState('base64');
      expect(useToolStateStore.getState().getToolState('uuid')?.input).toBe('b');
    });

    it('is safe to call on non-existent tool', () => {
      expect(() => {
        useToolStateStore.getState().clearToolState('nonexistent');
      }).not.toThrow();
      expect(useToolStateStore.getState().states.size).toBe(0);
    });
  });
});
