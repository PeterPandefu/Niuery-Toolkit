import { createContext, useContext, useReducer, useCallback, type ReactNode } from 'react';
import { MAX_HISTORY, type HistoryCommand } from './types';

interface HistoryState {
  undoStack: HistoryCommand[];
  redoStack: HistoryCommand[];
}

type HistoryAction =
  | { type: 'EXECUTE'; command: HistoryCommand }
  | { type: 'UNDO' }
  | { type: 'REDO' }
  | { type: 'CLEAR' };

function historyReducer(state: HistoryState, action: HistoryAction): HistoryState {
  switch (action.type) {
    case 'EXECUTE': {
      const undoStack = [...state.undoStack, action.command].slice(-MAX_HISTORY);
      return { undoStack, redoStack: [] };
    }
    case 'UNDO': {
      if (state.undoStack.length === 0) return state;
      const command = state.undoStack[state.undoStack.length - 1];
      command.undo();
      return {
        undoStack: state.undoStack.slice(0, -1),
        redoStack: [...state.redoStack, command],
      };
    }
    case 'REDO': {
      if (state.redoStack.length === 0) return state;
      const command = state.redoStack[state.redoStack.length - 1];
      command.execute();
      return {
        undoStack: [...state.undoStack, command],
        redoStack: state.redoStack.slice(0, -1),
      };
    }
    case 'CLEAR':
      return { undoStack: [], redoStack: [] };
    default:
      return state;
  }
}

interface HistoryContextValue {
  execute: (command: HistoryCommand) => void;
  undo: () => void;
  redo: () => void;
  clear: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

const HistoryContext = createContext<HistoryContextValue | null>(null);

export function HistoryProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(historyReducer, {
    undoStack: [],
    redoStack: [],
  });

  const execute = useCallback((command: HistoryCommand) => {
    command.execute();
    dispatch({ type: 'EXECUTE', command });
  }, []);

  const undo = useCallback(() => dispatch({ type: 'UNDO' }), []);
  const redo = useCallback(() => dispatch({ type: 'REDO' }), []);
  const clear = useCallback(() => dispatch({ type: 'CLEAR' }), []);

  return (
    <HistoryContext.Provider
      value={{
        execute,
        undo,
        redo,
        clear,
        canUndo: state.undoStack.length > 0,
        canRedo: state.redoStack.length > 0,
      }}
    >
      {children}
    </HistoryContext.Provider>
  );
}

export function useHistory() {
  const ctx = useContext(HistoryContext);
  if (!ctx) throw new Error('useHistory must be used within HistoryProvider');
  return ctx;
}
