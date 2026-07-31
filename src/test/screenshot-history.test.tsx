import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { HistoryProvider, useHistory } from '@/tools/graphic/screenshot/HistoryProvider';
import type { HistoryCommand } from '@/tools/graphic/screenshot/types';

function wrapper({ children }: { children: React.ReactNode }) {
  return <HistoryProvider>{children}</HistoryProvider>;
}

function createCommand(label: string): HistoryCommand & { executed: number; undone: number } {
  const cmd = {
    label,
    executed: 0,
    undone: 0,
    execute() { cmd.executed++; },
    undo() { cmd.undone++; },
  };
  return cmd;
}

describe('HistoryProvider', () => {
  it('should initialize with empty stacks', () => {
    const { result } = renderHook(() => useHistory(), { wrapper });
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
  });

  it('should execute a command and enable undo', () => {
    const { result } = renderHook(() => useHistory(), { wrapper });
    const cmd = createCommand('test');

    act(() => {
      result.current.execute(cmd);
    });

    expect(cmd.executed).toBe(1);
    expect(result.current.canUndo).toBe(true);
    expect(result.current.canRedo).toBe(false);
  });

  it('should undo a command', () => {
    const { result } = renderHook(() => useHistory(), { wrapper });
    const cmd = createCommand('test');

    act(() => {
      result.current.execute(cmd);
    });

    act(() => {
      result.current.undo();
    });

    expect(cmd.undone).toBe(1);
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(true);
  });

  it('should redo a command', () => {
    const { result } = renderHook(() => useHistory(), { wrapper });
    const cmd = createCommand('test');

    act(() => {
      result.current.execute(cmd);
    });

    act(() => {
      result.current.undo();
    });

    act(() => {
      result.current.redo();
    });

    expect(cmd.executed).toBe(2); // initial + redo
    expect(result.current.canUndo).toBe(true);
    expect(result.current.canRedo).toBe(false);
  });

  it('should clear redo stack on new execute', () => {
    const { result } = renderHook(() => useHistory(), { wrapper });
    const cmd1 = createCommand('cmd1');
    const cmd2 = createCommand('cmd2');

    act(() => {
      result.current.execute(cmd1);
    });

    act(() => {
      result.current.undo();
    });

    expect(result.current.canRedo).toBe(true);

    act(() => {
      result.current.execute(cmd2);
    });

    expect(result.current.canRedo).toBe(false);
  });

  it('should limit history to 50 entries', () => {
    const { result } = renderHook(() => useHistory(), { wrapper });

    // Execute 55 commands
    for (let i = 0; i < 55; i++) {
      act(() => {
        result.current.execute(createCommand(`cmd-${i}`));
      });
    }

    // Undo all 50 (should stop at 50)
    let undoCount = 0;
    for (let i = 0; i < 55; i++) {
      if (!result.current.canUndo) break;
      act(() => {
        result.current.undo();
      });
      undoCount++;
    }

    expect(undoCount).toBe(50);
    expect(result.current.canUndo).toBe(false);
  });

  it('should clear all history', () => {
    const { result } = renderHook(() => useHistory(), { wrapper });
    const cmd = createCommand('test');

    act(() => {
      result.current.execute(cmd);
    });

    act(() => {
      result.current.clear();
    });

    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
  });

  it('should handle multiple undo/redo operations', () => {
    const { result } = renderHook(() => useHistory(), { wrapper });
    const cmd1 = createCommand('cmd1');
    const cmd2 = createCommand('cmd2');
    const cmd3 = createCommand('cmd3');

    act(() => { result.current.execute(cmd1); });
    act(() => { result.current.execute(cmd2); });
    act(() => { result.current.execute(cmd3); });

    expect(result.current.canUndo).toBe(true);

    act(() => { result.current.undo(); });
    act(() => { result.current.undo(); });

    expect(cmd3.undone).toBe(1);
    expect(cmd2.undone).toBe(1);
    expect(cmd1.undone).toBe(0);
    expect(result.current.canRedo).toBe(true);

    act(() => { result.current.redo(); });

    expect(cmd2.executed).toBe(2);
    expect(result.current.canRedo).toBe(true);
  });
});
