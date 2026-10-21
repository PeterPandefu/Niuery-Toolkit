import { syncActivePage } from './document';
import type { FlowDocument } from './types';

export interface EditorState { document: FlowDocument; past: FlowDocument[]; future: FlowDocument[]; saved: FlowDocument; transaction: FlowDocument | null; }
export type EditorAction =
  | { type: 'begin' }
  | { type: 'preview'; document: FlowDocument }
  | { type: 'finish' }
  | { type: 'commit'; document: FlowDocument }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'saved'; document?: FlowDocument }
  | { type: 'load'; document: FlowDocument; saved?: boolean };

const clone = (document: FlowDocument) => structuredClone(document);
const same = (a: FlowDocument, b: FlowDocument) => {
  return documentFingerprint(a) === documentFingerprint(b);
};

export function documentFingerprint(document: FlowDocument) {
  const value = syncActivePage(document);
  return JSON.stringify(value.pages.map((page) => ({ id: page.id, name: page.name, layers: page.layers,
    nodes: page.nodes.map((node) => ({ id: node.id, type: node.type, data: node.data, position: node.position, parentId: node.parentId, zIndex: node.zIndex })),
    edges: page.edges.map((edge) => ({ id: edge.id, source: edge.source, target: edge.target, sourceHandle: edge.sourceHandle, targetHandle: edge.targetHandle, data: edge.data })),
  })));
}

export function createEditorState(document: FlowDocument): EditorState {
  const copy = clone(document); return { document: copy, past: [], future: [], saved: clone(copy), transaction: null };
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  if (action.type === 'load') { const next = createEditorState(syncActivePage(action.document)); return action.saved === false ? { ...next, saved: state.saved } : next; }
  if (action.type === 'begin') return { ...state, transaction: clone(state.document) };
  if (action.type === 'preview') return { ...state, document: syncActivePage(action.document) };
  if (action.type === 'finish') {
    if (!state.transaction || same(state.transaction, state.document)) return { ...state, transaction: null };
    return { ...state, past: [...state.past.slice(-49), state.transaction], future: [], transaction: null };
  }
  if (action.type === 'commit') {
    if (same(state.document, action.document)) return state;
    return { ...state, document: syncActivePage(action.document), past: [...state.past.slice(-49), clone(state.document)], future: [] };
  }
  if (action.type === 'undo') {
    const previous = state.past[state.past.length - 1]; if (!previous) return state;
    return { ...state, document: clone(previous), past: state.past.slice(0, -1), future: [clone(state.document), ...state.future] };
  }
  if (action.type === 'redo') {
    const next = state.future[0]; if (!next) return state;
    return { ...state, document: clone(next), future: state.future.slice(1), past: [...state.past, clone(state.document)] };
  }
  if (action.type === 'saved') return { ...state, saved: clone(action.document ?? state.document) };
  return state;
}

export function isDocumentDirty(state: EditorState) { return !same(state.document, state.saved); }
