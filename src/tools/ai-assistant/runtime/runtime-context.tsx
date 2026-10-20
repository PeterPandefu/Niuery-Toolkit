import { createContext, useContext, type ReactNode } from 'react';

const AiRuntimeContext = createContext(false);
export function AiRuntimeScope({ children }: { children: ReactNode }) { return <AiRuntimeContext.Provider value>{children}</AiRuntimeContext.Provider>; }
// Shared context hook is intentionally exported with its provider.
// eslint-disable-next-line react-refresh/only-export-components
export function useHasAiRuntime() { return useContext(AiRuntimeContext); }
