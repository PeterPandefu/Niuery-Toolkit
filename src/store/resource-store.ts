import { create } from 'zustand';
import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { isResourceDesktop, type ResourceId, type ResourceProgress, type ResourceStatus } from '@/lib/resources';

interface ResourceStore {
  resources: ResourceStatus[]; loading: boolean; error: string | null;
  progress: Partial<Record<ResourceId, ResourceProgress>>; busy: Partial<Record<ResourceId, boolean>>;
  errors: Partial<Record<ResourceId, string>>;
  refresh: () => Promise<void>;
  run: (id: ResourceId, command: string, args?: Record<string, unknown>) => Promise<void>;
  setProgress: (value: ResourceProgress) => void;
}
let refreshPending: Promise<void> | null = null;
export const useResourceStore = create<ResourceStore>((set, get) => ({
  resources: [], loading: false, error: null, progress: {}, busy: {}, errors: {},
  refresh: () => {
    if (!isResourceDesktop()) return Promise.resolve();
    if (refreshPending) return refreshPending;
    set({ loading: true, error: null });
    refreshPending = invoke<ResourceStatus[]>('list_resources')
      .then(resources => { set({ resources }); })
      .catch(error => { set({ error: String(error) }); })
      .finally(() => { set({ loading: false }); refreshPending = null; });
    return refreshPending;
  },
  run: async (id, command, args = {}) => {
    if (get().busy[id]) return;
    set(state => ({ busy: { ...state.busy, [id]: true }, errors: { ...state.errors, [id]: undefined } }));
    try { await invoke(command, { id, ...args }); }
    catch (error) { set(state => ({ errors: { ...state.errors, [id]: String(error) } })); }
    finally {
      set(state => ({ busy: { ...state.busy, [id]: false }, progress: { ...state.progress, [id]: undefined } }));
      await get().refresh();
    }
  },
  setProgress: value => set(state => ({ progress: { ...state.progress, [value.id]: value } })),
}));

// Subscribe in feature notices as well as settings, so closing settings does
// not leave another window's readiness/progress stale.
export function useResourceEvents() {
  useEffect(() => {
    if (!isResourceDesktop()) return;
    let disposed = false;
    const cleanups: (() => void)[] = [];
    const register = (pending: Promise<() => void>) => { void pending.then(fn => { if (disposed) fn(); else cleanups.push(fn); }).catch(() => undefined); };
    register(listen<ResourceProgress>('resource-progress', e => useResourceStore.getState().setProgress(e.payload)));
    register(listen<ResourceId>('resource-operation-ended', e => useResourceStore.setState(state => ({ progress: { ...state.progress, [e.payload]: undefined } }))));
    register(listen('resources-changed', () => { void useResourceStore.getState().refresh(); }));
    return () => { disposed = true; cleanups.forEach(fn => fn()); };
  }, []);
}
