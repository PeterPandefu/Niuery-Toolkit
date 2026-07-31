import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { nanoid } from 'nanoid';

// ==================== 类型定义 ====================

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

export const HTTP_METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

export interface KeyValue {
  id: string;
  key: string;
  value: string;
  enabled: boolean;
}

export type BodyType = 'none' | 'json' | 'form-data' | 'x-www-form-urlencoded' | 'xml' | 'text';

export interface RequestBody {
  type: BodyType;
  content: string;
  formData: KeyValue[];
}

export type AuthType = 'none' | 'bearer' | 'basic' | 'apikey';

export interface AuthConfig {
  type: AuthType;
  bearerToken: string;
  basicUsername: string;
  basicPassword: string;
  apiKeyName: string;
  apiKeyValue: string;
  apiKeyIn: 'header' | 'query';
}

export interface ApiRequest {
  id: string;
  name: string;
  method: HttpMethod;
  url: string;
  params: KeyValue[];
  headers: KeyValue[];
  body: RequestBody;
  auth: AuthConfig;
  preScript: string;
  postScript: string;
}

export interface ApiResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  time: number;
  size: number;
}

export interface Collection {
  id: string;
  name: string;
  items: CollectionItem[];
}

export type CollectionItem =
  | { type: 'request'; data: ApiRequest }
  | { type: 'folder'; data: Collection };

export interface Environment {
  id: string;
  name: string;
  variables: KeyValue[];
}

export interface HistoryEntry {
  id: string;
  request: ApiRequest;
  response: ApiResponse | null;
  timestamp: number;
}

export interface MockRule {
  id: string;
  enabled: boolean;
  name: string;
  method: HttpMethod | '*';
  urlPattern: string;
  statusCode: number;
  headers: KeyValue[];
  body: string;
  delay: number;
}

export interface ScriptLog {
  type: 'info' | 'error' | 'assert-pass' | 'assert-fail';
  message: string;
}

// ==================== 工厂函数 ====================

export function createKeyValue(key = '', value = ''): KeyValue {
  return { id: nanoid(8), key, value, enabled: true };
}

export function createRequest(partial?: Partial<ApiRequest>): ApiRequest {
  return {
    id: nanoid(10),
    name: 'New Request',
    method: 'GET',
    url: '',
    params: [],
    headers: [],
    body: { type: 'none', content: '', formData: [] },
    auth: {
      type: 'none',
      bearerToken: '',
      basicUsername: '',
      basicPassword: '',
      apiKeyName: '',
      apiKeyValue: '',
      apiKeyIn: 'header',
    },
    preScript: '',
    postScript: '',
    ...partial,
  };
}

export function createCollection(name = 'New Collection'): Collection {
  return { id: nanoid(10), name, items: [] };
}

export function createEnvironment(name = 'New Environment'): Environment {
  return { id: nanoid(10), name, variables: [] };
}

export function createMockRule(partial?: Partial<MockRule>): MockRule {
  return {
    id: nanoid(10),
    enabled: true,
    name: 'New Mock Rule',
    method: '*',
    urlPattern: '/api/*',
    statusCode: 200,
    headers: [],
    body: '{"message": "mock response"}',
    delay: 0,
    ...partial,
  };
}

// ==================== Store ====================

interface ApiTesterStore {
  // 当前请求
  currentRequest: ApiRequest;
  setCurrentRequest: (req: Partial<ApiRequest>) => void;
  resetRequest: () => void;

  // 响应
  response: ApiResponse | null;
  responseLoading: boolean;
  scriptLogs: ScriptLog[];
  setResponse: (res: ApiResponse | null) => void;
  setResponseLoading: (loading: boolean) => void;
  setScriptLogs: (logs: ScriptLog[]) => void;

  // 集合
  collections: Collection[];
  addCollection: (name?: string) => void;
  removeCollection: (id: string) => void;
  renameCollection: (id: string, name: string) => void;
  addToCollection: (collectionId: string, request: ApiRequest) => void;
  removeFromCollection: (collectionId: string, requestId: string) => void;
  updateCollectionItem: (collectionId: string, requestId: string, req: Partial<ApiRequest>) => void;
  reorderCollection: (collectionId: string, fromIndex: number, toIndex: number) => void;
  importCollections: (data: Collection[]) => void;

  // 环境
  environments: Environment[];
  activeEnvId: string | null;
  globalVariables: KeyValue[];
  setActiveEnv: (id: string | null) => void;
  addEnvironment: (name?: string) => void;
  removeEnvironment: (id: string) => void;
  updateEnvironment: (id: string, env: Partial<Environment>) => void;
  setGlobalVariables: (vars: KeyValue[]) => void;

  // 历史
  history: HistoryEntry[];
  addHistory: (entry: HistoryEntry) => void;
  removeHistory: (id: string) => void;
  clearHistory: () => void;

  // Mock
  mockRules: MockRule[];
  mockEnabled: boolean;
  setMockEnabled: (enabled: boolean) => void;
  addMockRule: (rule?: Partial<MockRule>) => void;
  removeMockRule: (id: string) => void;
  updateMockRule: (id: string, rule: Partial<MockRule>) => void;

  // 变量解析
  resolveVariables: (text: string) => string;
  setVariable: (key: string, value: string) => void;
}

export const useApiTesterStore = create<ApiTesterStore>()(
  persist(
    (set, get) => ({
      // 当前请求
      currentRequest: createRequest(),
      setCurrentRequest: (partial) =>
        set((state) => ({
          currentRequest: { ...state.currentRequest, ...partial },
        })),
      resetRequest: () => set({ currentRequest: createRequest(), response: null, scriptLogs: [] }),

      // 响应
      response: null,
      responseLoading: false,
      scriptLogs: [],
      setResponse: (res) => set({ response: res }),
      setResponseLoading: (loading) => set({ responseLoading: loading }),
      setScriptLogs: (logs) => set({ scriptLogs: logs }),

      // 集合
      collections: [],
      addCollection: (name) =>
        set((state) => ({
          collections: [...state.collections, createCollection(name)],
        })),
      removeCollection: (id) =>
        set((state) => ({
          collections: state.collections.filter((c) => c.id !== id),
        })),
      renameCollection: (id, name) =>
        set((state) => ({
          collections: state.collections.map((c) =>
            c.id === id ? { ...c, name } : c
          ),
        })),
      addToCollection: (collectionId, request) =>
        set((state) => ({
          collections: state.collections.map((c) =>
            c.id === collectionId
              ? { ...c, items: [...c.items, { type: 'request' as const, data: request }] }
              : c
          ),
        })),
      removeFromCollection: (collectionId, requestId) =>
        set((state) => ({
          collections: state.collections.map((c) =>
            c.id === collectionId
              ? {
                  ...c,
                  items: c.items.filter(
                    (item) => !(item.type === 'request' && item.data.id === requestId)
                  ),
                }
              : c
          ),
        })),
      updateCollectionItem: (collectionId, requestId, partial) =>
        set((state) => ({
          collections: state.collections.map((c) =>
            c.id === collectionId
              ? {
                  ...c,
                  items: c.items.map((item) =>
                    item.type === 'request' && item.data.id === requestId
                      ? { ...item, data: { ...item.data, ...partial } }
                      : item
                  ),
                }
              : c
          ),
        })),
      reorderCollection: (collectionId, fromIndex, toIndex) =>
        set((state) => ({
          collections: state.collections.map((c) => {
            if (c.id !== collectionId) return c;
            const items = [...c.items];
            const [moved] = items.splice(fromIndex, 1);
            items.splice(toIndex, 0, moved);
            return { ...c, items };
          }),
        })),
      importCollections: (data) =>
        set((state) => ({
          collections: [...state.collections, ...data],
        })),

      // 环境
      environments: [],
      activeEnvId: null,
      globalVariables: [],
      setActiveEnv: (id) => set({ activeEnvId: id }),
      addEnvironment: (name) =>
        set((state) => ({
          environments: [...state.environments, createEnvironment(name)],
        })),
      removeEnvironment: (id) =>
        set((state) => ({
          environments: state.environments.filter((e) => e.id !== id),
          activeEnvId: state.activeEnvId === id ? null : state.activeEnvId,
        })),
      updateEnvironment: (id, partial) =>
        set((state) => ({
          environments: state.environments.map((e) =>
            e.id === id ? { ...e, ...partial } : e
          ),
        })),
      setGlobalVariables: (vars) => set({ globalVariables: vars }),

      // 历史
      history: [],
      addHistory: (entry) =>
        set((state) => ({
          history: [entry, ...state.history].slice(0, 100),
        })),
      removeHistory: (id) =>
        set((state) => ({
          history: state.history.filter((h) => h.id !== id),
        })),
      clearHistory: () => set({ history: [] }),

      // Mock
      mockRules: [],
      mockEnabled: false,
      setMockEnabled: (enabled) => set({ mockEnabled: enabled }),
      addMockRule: (rule) =>
        set((state) => ({
          mockRules: [...state.mockRules, createMockRule(rule)],
        })),
      removeMockRule: (id) =>
        set((state) => ({
          mockRules: state.mockRules.filter((r) => r.id !== id),
        })),
      updateMockRule: (id, partial) =>
        set((state) => ({
          mockRules: state.mockRules.map((r) =>
            r.id === id ? { ...r, ...partial } : r
          ),
        })),

      // 变量解析
      resolveVariables: (text) => {
        const { environments, activeEnvId, globalVariables } = get();
        const activeEnv = environments.find((e) => e.id === activeEnvId);
        const vars: Record<string, string> = {};
        // 全局变量优先
        globalVariables.filter((v) => v.enabled && v.key).forEach((v) => {
          vars[v.key] = v.value;
        });
        // 环境变量覆盖
        if (activeEnv) {
          activeEnv.variables.filter((v) => v.enabled && v.key).forEach((v) => {
            vars[v.key] = v.value;
          });
        }
        return text.replace(/\{\{(\w+)\}\}/g, (match, key) => vars[key] ?? match);
      },
      setVariable: (key, value) => {
        const { environments, activeEnvId, globalVariables } = get();
        const activeEnv = environments.find((e) => e.id === activeEnvId);
        if (activeEnv) {
          const existing = activeEnv.variables.find((v) => v.key === key);
          if (existing) {
            get().updateEnvironment(activeEnv.id, {
              variables: activeEnv.variables.map((v) =>
                v.key === key ? { ...v, value } : v
              ),
            });
          } else {
            get().updateEnvironment(activeEnv.id, {
              variables: [...activeEnv.variables, { ...createKeyValue(key, value) }],
            });
          }
        } else {
          const existing = globalVariables.find((v) => v.key === key);
          if (existing) {
            set({
              globalVariables: globalVariables.map((v) =>
                v.key === key ? { ...v, value } : v
              ),
            });
          } else {
            set({ globalVariables: [...globalVariables, createKeyValue(key, value)] });
          }
        }
      },
    }),
    {
      name: 'niuery-api-tester',
      partialize: (state) => ({
        collections: state.collections,
        environments: state.environments,
        activeEnvId: state.activeEnvId,
        globalVariables: state.globalVariables,
        history: state.history,
        mockRules: state.mockRules,
        mockEnabled: state.mockEnabled,
      }),
    }
  )
);
