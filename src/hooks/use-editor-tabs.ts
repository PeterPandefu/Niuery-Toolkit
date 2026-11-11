import { useCallback, useEffect, useMemo, useState } from 'react';

export interface EditorTab {
  id: string;
  name: string;
  content: string;
  error?: string | null;
}

interface PersistedEditorTabs {
  version: 1;
  tabs: EditorTab[];
  activeId: string;
}

interface UseEditorTabsOptions {
  storageKey: string;
  legacyStorageKey?: string;
  defaultContent: string;
  extension: string;
  defaultPrefix?: string;
  maxTabs?: number;
  onStorageError?: (error: unknown) => void;
}

interface UseEditorTabsResult {
  tabs: EditorTab[];
  activeTabId: string;
  activeTab: EditorTab;
  content: string;
  storageError: string | null;
  setContent: (content: string) => void;
  setError: (error: string | null) => void;
  createTab: (content?: string, name?: string) => string | null;
  duplicateTab: (id?: string) => string | null;
  importTab: (name: string, content: string) => string | null;
  renameTab: (id: string, name: string) => void;
  closeTab: (id?: string) => void;
  closeOthers: (id?: string) => void;
  closeToRight: (id?: string) => void;
  closeAll: (id?: string) => void;
  activateTab: (id: string) => void;
  reorderTabs: (sourceId: string, targetId: string) => void;
}

const MAX_TABS = 20;

function createId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function readStored(options: UseEditorTabsOptions): { tabs: EditorTab[]; activeId: string } | null {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(options.storageKey);
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<PersistedEditorTabs>;
      if (parsed.version === 1 && Array.isArray(parsed.tabs) && parsed.tabs.length > 0) {
        const tabs = parsed.tabs.filter((tab): tab is EditorTab => (
          typeof tab?.id === 'string' && typeof tab.name === 'string' && typeof tab.content === 'string'
        ));
        if (tabs.length > 0) {
          return { tabs, activeId: tabs.some((tab) => tab.id === parsed.activeId) ? parsed.activeId! : tabs[0].id };
        }
      }
    }

  } catch {
    // 新结构损坏时继续尝试旧草稿。
  }
  try {
    const legacy = options.legacyStorageKey ? localStorage.getItem(options.legacyStorageKey) : null;
    if (legacy !== null) {
      const tab = { id: createId(), name: `${options.defaultPrefix ?? '未命名'}-1.${options.extension}`, content: legacy };
      return { tabs: [tab], activeId: tab.id };
    }
  } catch {
    // 浏览器存储不可用时使用默认页签。
  }
  return null;
}

function uniqueName(name: string, tabs: EditorTab[], extension: string, fallbackPrefix: string) {
  const trimmed = name.trim() || `${fallbackPrefix}.${extension}`;
  const names = new Set(tabs.map((tab) => tab.name));
  if (!names.has(trimmed)) return trimmed;
  const dot = trimmed.lastIndexOf('.');
  const stem = dot > 0 ? trimmed.slice(0, dot) : trimmed;
  const suffix = dot > 0 ? trimmed.slice(dot) : `.${extension}`;
  let index = 2;
  while (names.has(`${stem}-${index}${suffix}`)) index += 1;
  return `${stem}-${index}${suffix}`;
}

function defaultTab(options: UseEditorTabsOptions): EditorTab {
  return {
    id: createId(),
    name: `${options.defaultPrefix ?? '未命名'}-1.${options.extension}`,
    content: options.defaultContent,
  };
}

function nextDefaultName(tabs: EditorTab[], prefix: string, extension: string) {
  let index = 1;
  const names = new Set(tabs.map((tab) => tab.name));
  while (names.has(`${prefix}-${index}.${extension}`)) index += 1;
  return `${prefix}-${index}.${extension}`;
}

export function useEditorTabs(options: UseEditorTabsOptions): UseEditorTabsResult {
  const [initial] = useState(() => readStored(options));
  const [tabs, setTabs] = useState<EditorTab[]>(() => initial?.tabs ?? [defaultTab(options)]);
  const [activeTabId, setActiveTabId] = useState(() => initial?.activeId ?? tabs[0]?.id ?? '');
  const [storageError, setStorageError] = useState<string | null>(null);
  const maxTabs = options.maxTabs ?? MAX_TABS;

  const activeTab = useMemo(
    () => tabs.find((tab) => tab.id === activeTabId) ?? tabs[0],
    [activeTabId, tabs],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const payload: PersistedEditorTabs = { version: 1, tabs, activeId: activeTab?.id ?? tabs[0].id };
        localStorage.setItem(options.storageKey, JSON.stringify(payload));
        setStorageError(null);
      } catch (error) {
        setStorageError('页签无法保存到浏览器本地存储');
        options.onStorageError?.(error);
      }
    }, 300);
    return () => window.clearTimeout(timer);
  }, [activeTab?.id, options, tabs]);

  const setContent = useCallback((content: string) => {
    setTabs((current) => current.map((tab) => tab.id === activeTabId ? { ...tab, content } : tab));
  }, [activeTabId]);

  const setError = useCallback((error: string | null) => {
    setTabs((current) => current.map((tab) => tab.id === activeTabId ? { ...tab, error } : tab));
  }, [activeTabId]);

  const createTab = useCallback((content = options.defaultContent, name?: string) => {
    if (tabs.length >= maxTabs) return null;
    const createdId = createId();
    const next = {
      id: createdId,
      name: name ? uniqueName(name, tabs, options.extension, options.defaultPrefix ?? '未命名') : nextDefaultName(tabs, options.defaultPrefix ?? '未命名', options.extension),
      content,
    };
    setTabs((current) => current.length >= maxTabs ? current : [...current, next]);
    setActiveTabId(createdId);
    return createdId;
  }, [maxTabs, options.defaultContent, options.defaultPrefix, options.extension, tabs]);

  const duplicateTab = useCallback((id = activeTabId) => {
    const source = tabs.find((tab) => tab.id === id);
    if (!source) return null;
    return createTab(source.content, source.name);
  }, [activeTabId, createTab, tabs]);

  const importTab = useCallback((name: string, content: string) => createTab(content, name), [createTab]);

  const renameTab = useCallback((id: string, name: string) => {
    setTabs((current) => current.map((tab) => tab.id === id
      ? { ...tab, name: uniqueName(name, current.filter((candidate) => candidate.id !== id), options.extension, options.defaultPrefix ?? '未命名') }
      : tab));
  }, [options.defaultPrefix, options.extension]);

  const activateTab = useCallback((id: string) => {
    if (tabs.some((tab) => tab.id === id)) setActiveTabId(id);
  }, [tabs]);

  const closeTab = useCallback((id = activeTabId) => {
    setTabs((current) => {
      if (current.length <= 1) return current;
      const index = current.findIndex((tab) => tab.id === id);
      if (index < 0) return current;
      const next = current.filter((tab) => tab.id !== id);
      if (id === activeTabId) setActiveTabId(next[Math.min(index, next.length - 1)].id);
      return next;
    });
  }, [activeTabId]);

  const closeOthers = useCallback((id = activeTabId) => {
    setTabs((current) => {
      const kept = current.find((tab) => tab.id === id) ?? current[0];
      setActiveTabId(kept.id);
      return [kept];
    });
  }, [activeTabId]);

  const closeToRight = useCallback((id = activeTabId) => {
    setTabs((current) => {
      const index = current.findIndex((tab) => tab.id === id);
      if (index < 0) return current;
      return [...current.slice(0, index + 1)];
    });
  }, [activeTabId]);

  const closeAll = useCallback((id = activeTabId) => closeOthers(id), [activeTabId, closeOthers]);

  const reorderTabs = useCallback((sourceId: string, targetId: string) => {
    if (sourceId === targetId) return;
    setTabs((current) => {
      const sourceIndex = current.findIndex((tab) => tab.id === sourceId);
      const targetIndex = current.findIndex((tab) => tab.id === targetId);
      if (sourceIndex < 0 || targetIndex < 0) return current;
      const next = [...current];
      const [moved] = next.splice(sourceIndex, 1);
      next.splice(targetIndex, 0, moved);
      return next;
    });
  }, []);

  return {
    tabs,
    activeTabId,
    activeTab,
    content: activeTab?.content ?? '',
    storageError,
    setContent,
    setError,
    createTab,
    duplicateTab,
    importTab,
    renameTab,
    closeTab,
    closeOthers,
    closeToRight,
    closeAll,
    activateTab,
    reorderTabs,
  };
}
