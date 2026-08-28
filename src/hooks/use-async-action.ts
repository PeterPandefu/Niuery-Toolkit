import { useCallback, useRef, useState } from 'react';

/** Wraps an async callback with a reliable pending state and duplicate-click guard. */
export function useAsyncAction<TArgs extends unknown[], TResult>(
  action: (...args: TArgs) => Promise<TResult>,
) {
  const [loading, setLoading] = useState(false);
  const loadingRef = useRef(false);

  const run = useCallback(async (...args: TArgs): Promise<TResult | undefined> => {
    if (loadingRef.current) return undefined;
    loadingRef.current = true;
    setLoading(true);
    try {
      return await action(...args);
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [action]);

  return { loading, run };
}
