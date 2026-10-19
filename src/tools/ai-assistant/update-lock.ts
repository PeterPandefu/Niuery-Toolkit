let holds = 0;
const listeners = new Set<() => void>();

export const aiUpdatePending = () => holds > 0;
export const subscribeAiUpdate = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

/** Also covers AI pages opened after an update download has already started. */
export function holdAiUpdate(): () => void {
  holds++;
  for (const listener of listeners) listener();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holds--;
    for (const listener of listeners) listener();
  };
}
