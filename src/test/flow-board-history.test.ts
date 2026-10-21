import { describe, expect, it } from 'vitest';
import { createDefaultFlowDocument } from '@/tools/graphic/flow-board/document';
import { createEditorState, editorReducer, isDocumentDirty } from '@/tools/graphic/flow-board/history';

describe('flowchart document history', () => {
  it('stores one history entry for a complete drag transaction', () => {
    let state = createEditorState(createDefaultFlowDocument());
    const original = state.document.nodes[0].position.x;
    state = editorReducer(state, { type: 'begin' });
    for (const x of [200, 220, 240]) state = editorReducer(state, { type: 'preview', document: { ...state.document, nodes: state.document.nodes.map((node, index) => index === 0 ? { ...node, position: { ...node.position, x } } : node) } });
    state = editorReducer(state, { type: 'finish' });
    expect(state.past).toHaveLength(1);
    expect(state.document.pages[0].nodes[0].position.x).toBe(240);
    state = editorReducer(state, { type: 'undo' });
    expect(state.document.nodes[0].position.x).toBe(original);
    expect(isDocumentDirty(state)).toBe(false);
    state = editorReducer(state, { type: 'redo' });
    expect(state.document.nodes[0].position.x).toBe(240);
  });
  it('does not record selection or viewport changes as document edits', () => {
    let state = createEditorState(createDefaultFlowDocument());
    state = editorReducer(state, { type: 'preview', document: { ...state.document, viewport: { x: 100, y: 50, zoom: 2 }, nodes: state.document.nodes.map((node) => ({ ...node, selected: true })) } });
    expect(isDocumentDirty(state)).toBe(false);
    expect(state.past).toHaveLength(0);
  });
  it('clears redo when a new operation follows undo and restores saved-state tracking', () => {
    let state = createEditorState(createDefaultFlowDocument());
    state = editorReducer(state, { type: 'commit', document: { ...state.document, nodes: [] , edges: [] } });
    state = editorReducer(state, { type: 'saved' });
    expect(isDocumentDirty(state)).toBe(false);
    state = editorReducer(state, { type: 'undo' });
    expect(isDocumentDirty(state)).toBe(true);
    state = editorReducer(state, { type: 'commit', document: { ...state.document, nodes: state.document.nodes.slice(0, 1), edges: [] } });
    expect(state.future).toHaveLength(0);
  });
  it('keeps all page contents in undo snapshots', () => {
    let state = createEditorState(createDefaultFlowDocument());
    const second = { ...state.document.pages[0], id: 'page-2', name: '第二页', nodes: [], edges: [] };
    state = editorReducer(state, { type: 'commit', document: { ...state.document, pages: [...state.document.pages, second], activePageId: second.id, nodes: [], edges: [], viewport: second.viewport } });
    expect(state.document.pages[0].nodes).toHaveLength(3);
    state = editorReducer(state, { type: 'undo' });
    expect(state.document.pages).toHaveLength(1);
    expect(state.document.nodes).toHaveLength(3);
  });
});
