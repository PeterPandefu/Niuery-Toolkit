import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, CircleOff, Folder, ListTodo, Palette, Pencil, Pin, PinOff, Plus, Search, Trash2, X } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import { isTauri } from '@/lib/api-client';
import { useApplyTheme } from '@/hooks/use-theme';
import { useAppStore } from '@/store/app-store';
import './sticky-note.css';

type NoteColor = 'yellow' | 'lime' | 'pink' | 'blue' | 'purple';
type NoteMode = 'plain' | 'timeline';

interface StickyNoteItem {
  id: string;
  title: string;
  content: string;
  color: NoteColor;
  mode?: NoteMode;
}

interface StickyNotesDocument {
  notes: StickyNoteItem[];
  activeId: string;
  alwaysOnTop: boolean;
}

interface NoteContextMenu {
  noteId: string;
  x: number;
  y: number;
}

const NOTE_COLORS: { id: NoteColor; label: string; surface: string; border: string }[] = [
  { id: 'yellow', label: 'stickyNote.colors.yellow', surface: '#FFF1A6', border: '#E2B94E' },
  { id: 'lime', label: 'stickyNote.colors.lime', surface: '#DDF7A5', border: '#97C65C' },
  { id: 'pink', label: 'stickyNote.colors.pink', surface: '#FFD0E2', border: '#E98CAF' },
  { id: 'blue', label: 'stickyNote.colors.blue', surface: '#CDE9FF', border: '#7DB7DE' },
  { id: 'purple', label: 'stickyNote.colors.purple', surface: '#E2D6FF', border: '#AA91DD' },
];

const EMPTY_DOCUMENT: StickyNotesDocument = {
  notes: [{ id: 'note-1', title: '便签 1', content: '', color: 'yellow' }],
  activeId: 'note-1',
  alwaysOnTop: true,
};

function getNoteColor(color: NoteColor) {
  return NOTE_COLORS.find((item) => item.id === color) ?? NOTE_COLORS[0];
}

function createNote(index: number): StickyNoteItem {
  const color = NOTE_COLORS[Math.floor(Math.random() * NOTE_COLORS.length)].id;
  return { id: `note-${Date.now()}-${index}`, title: `便签 ${index}`, content: '', color, mode: 'plain' };
}

export default function StickyNoteApp() {
  useApplyTheme();
  const { t } = useTranslation();
  const [document, setDocument] = useState<StickyNotesDocument>(EMPTY_DOCUMENT);
  const [loaded, setLoaded] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [draggedNoteId, setDraggedNoteId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<NoteContextMenu | null>(null);
  const contextMenuRenameRef = useRef<HTMLButtonElement>(null);
  const contextMenuDeleteRef = useRef<HTMLButtonElement>(null);
  const noteTabRefs = useRef(new Map<string, HTMLButtonElement>());
  const addedNoteIdRef = useRef<string | null>(null);
  const [timelineTimestamp] = useState(() => new Date().toLocaleString());
  const [editingTitle, setEditingTitle] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!isTauri) {
      setLoaded(true);
      return;
    }

    void invoke<StickyNotesDocument>('get_sticky_notes')
      .then((savedDocument) => {
        if (!cancelled) {
          setDocument({
            ...EMPTY_DOCUMENT,
            ...savedDocument,
            notes: savedDocument.notes?.length ? savedDocument.notes : EMPTY_DOCUMENT.notes,
          });
        }
      })
      .catch(() => {
        if (!cancelled) setSaveError(true);
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!loaded || !isTauri) return;
    const timer = window.setTimeout(() => {
      void invoke<void>('update_sticky_notes', { document })
        .then(() => setSaveError(false))
        .catch(() => setSaveError(true));
    }, 350);
    return () => window.clearTimeout(timer);
  }, [document, loaded]);

  useEffect(() => {
    if (contextMenu) contextMenuRenameRef.current?.focus();
  }, [contextMenu]);

  useEffect(() => {
    const addedNoteId = addedNoteIdRef.current;
    if (!addedNoteId || addedNoteId !== document.activeId) return;

    const noteTab = noteTabRefs.current.get(addedNoteId);
    if (!noteTab) return;

    noteTab.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    addedNoteIdRef.current = null;
  }, [document.activeId, document.notes.length]);

  useEffect(() => {
    const syncTheme = (event: StorageEvent) => {
      if (event.key === 'niuery-toolkit-store') void useAppStore.persist.rehydrate();
    };
    window.addEventListener('storage', syncTheme);
    return () => window.removeEventListener('storage', syncTheme);
  }, []);

  const activeNote = document.notes.find((note) => note.id === document.activeId) ?? document.notes[0];
  const selectedColor = getNoteColor(activeNote.color);
  const isTimeline = activeNote.mode === 'timeline';
  const visibleNotes = document.notes.filter((note) => {
    const query = searchQuery.trim().toLocaleLowerCase();
    return !query || `${note.title} ${note.content}`.toLocaleLowerCase().includes(query);
  });

  const updateActiveNote = useCallback((patch: Partial<StickyNoteItem>) => {
    setDocument((current) => ({
      ...current,
      notes: current.notes.map((note) => (note.id === current.activeId ? { ...note, ...patch } : note)),
    }));
  }, []);

  const addNote = useCallback(() => {
    setSearchQuery('');
    setDocument((current) => {
      const note = createNote(current.notes.length + 1);
      addedNoteIdRef.current = note.id;
      return { ...current, notes: [...current.notes, note], activeId: note.id };
    });
  }, []);

  const removeNote = useCallback((noteId: string) => {
    setDocument((current) => {
      if (current.notes.length <= 1) return current;

      const removedIndex = current.notes.findIndex((note) => note.id === noteId);
      if (removedIndex < 0) return current;

      const notes = current.notes.filter((note) => note.id !== noteId);
      const activeId = current.activeId === noteId
        ? (notes[removedIndex] ?? notes[removedIndex - 1]).id
        : current.activeId;

      return { ...current, notes, activeId };
    });
  }, []);

  const addTimelineEntry = useCallback(() => {
    updateActiveNote({ content: activeNote.content ? `${activeNote.content}\n` : '' });
  }, [activeNote.content, updateActiveNote]);

  const toggleMode = useCallback(() => {
    updateActiveNote({ mode: isTimeline ? 'plain' : 'timeline' });
  }, [isTimeline, updateActiveNote]);

  const handleDragStart = useCallback((event: React.MouseEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (!isTauri || target.closest('[data-note-control]') || target.closest('input') || target.closest('.sticky-note-title')) return;
    void invoke('start_sticky_note_drag');
  }, []);

  const handleEdgeReveal = useCallback(() => {
    if (!isTauri) return;
    void invoke('expand_sticky_note_from_edge').catch(() => setSaveError(true));
  }, []);

  const toggleAlwaysOnTop = useCallback(() => {
    const alwaysOnTop = !document.alwaysOnTop;
    setDocument((current) => ({ ...current, alwaysOnTop }));
    void invoke('set_sticky_note_always_on_top', { alwaysOnTop }).catch(() => setSaveError(true));
  }, [document.alwaysOnTop]);

  const moveNote = useCallback((sourceId: string, targetId: string) => {
    if (sourceId === targetId) return;
    setDocument((current) => {
      const sourceIndex = current.notes.findIndex((note) => note.id === sourceId);
      const targetIndex = current.notes.findIndex((note) => note.id === targetId);
      if (sourceIndex < 0 || targetIndex < 0) return current;
      const notes = [...current.notes];
      const [source] = notes.splice(sourceIndex, 1);
      notes.splice(targetIndex, 0, source);
      return { ...current, notes };
    });
  }, []);

  const handleClose = useCallback(() => {
    if (isTauri) void invoke('hide_sticky_note');
  }, []);

  const showNoteContextMenu = useCallback((noteId: string, x: number, y: number) => {
    const menuWidth = 156;
    const menuHeight = 76;
    setContextMenu({
      noteId,
      x: Math.max(8, Math.min(x, window.innerWidth - menuWidth - 8)),
      y: Math.max(8, Math.min(y, window.innerHeight - menuHeight - 8)),
    });
  }, []);

  const openNoteContextMenu = useCallback((event: React.MouseEvent<HTMLButtonElement>, noteId: string) => {
    event.preventDefault();
    showNoteContextMenu(noteId, event.clientX, event.clientY);
  }, [showNoteContextMenu]);

  const deleteNoteFromMenu = useCallback(() => {
    if (!contextMenu) return;
    removeNote(contextMenu.noteId);
    setContextMenu(null);
  }, [contextMenu, removeNote]);

  const renameNoteFromMenu = useCallback(() => {
    if (!contextMenu) return;
    setDocument((current) => ({ ...current, activeId: contextMenu.noteId }));
    setEditingTitle(true);
    setContextMenu(null);
  }, [contextMenu]);

  return (
    <main
      className="sticky-note-shell"
      style={{ '--note-surface': selectedColor.surface, '--note-border': selectedColor.border } as React.CSSProperties}
      onMouseEnter={handleEdgeReveal}
      onPointerDown={() => setContextMenu(null)}
      onKeyDown={(event) => {
        if (event.key === 'Escape') setContextMenu(null);
      }}
    >
      <aside className="sticky-note-sidebar" aria-label={t('stickyNote.noteList')}>
        <div className="sticky-note-sidebar-heading"><Folder aria-hidden="true" /><span>{t('stickyNote.all')}</span></div>
        <button type="button" className="sticky-note-add-button" aria-label={t('stickyNote.add')} title={t('stickyNote.add')} onClick={addNote}>
          <Plus aria-hidden="true" />
        </button>
        <div className="sticky-note-tabs">
          {visibleNotes.map((note) => {
            const color = getNoteColor(note.color);
            return (
              <div
                className={`sticky-note-tab-row${note.id === document.activeId ? ' is-active' : ''}`}
                key={note.id}
                style={{ '--tab-surface': color.surface, '--tab-border': color.border } as React.CSSProperties}
              >
                <button
                  type="button"
                  className="sticky-note-tab"
                  aria-label={note.title}
                  aria-pressed={note.id === document.activeId}
                  title={note.title}
                  style={{ backgroundColor: color.surface, borderColor: color.border }}
                  ref={(element) => {
                    if (element) noteTabRefs.current.set(note.id, element);
                    else noteTabRefs.current.delete(note.id);
                  }}
                  onClick={() => setDocument((current) => ({ ...current, activeId: note.id }))}
                  onContextMenu={(event) => openNoteContextMenu(event, note.id)}
                  onKeyDown={(event) => {
                    if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
                    event.preventDefault();
                    const bounds = event.currentTarget.getBoundingClientRect();
                    showNoteContextMenu(note.id, bounds.right, bounds.top);
                  }}
                  aria-haspopup="menu"
                  draggable
                  onDragStart={() => setDraggedNoteId(note.id)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={() => {
                    if (draggedNoteId) moveNote(draggedNoteId, note.id);
                    setDraggedNoteId(null);
                  }}
                >
                  <span>{note.mode === 'timeline' ? t('stickyNote.timeline') : note.title}</span>
                </button>
              </div>
            );
          })}
        </div>
      </aside>

      {contextMenu && (
        <div
          className="sticky-note-context-menu"
          role="menu"
          aria-label={t('stickyNote.noteMenu')}
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            role="menuitem"
            ref={contextMenuRenameRef}
            className="sticky-note-context-menu-item"
            onClick={renameNoteFromMenu}
          >
            <Pencil aria-hidden="true" />
            <span>{t('stickyNote.rename')}</span>
          </button>
          <button
            type="button"
            role="menuitem"
            ref={contextMenuDeleteRef}
            className="sticky-note-context-menu-item is-danger"
            disabled={document.notes.length <= 1}
            title={document.notes.length <= 1 ? t('stickyNote.keepOne') : t('stickyNote.delete')}
            onClick={deleteNoteFromMenu}
          >
            <Trash2 aria-hidden="true" />
            <span>{t('stickyNote.delete')}</span>
          </button>
        </div>
      )}

      <div className="sticky-note-stage">
        <section className="sticky-note" aria-label={t('stickyNote.title')}>
          <header className="sticky-note-header" onMouseDown={handleDragStart}>
          <div className="sticky-note-drag-handle" aria-hidden="true" />
          {editingTitle ? (
            <input
              className="sticky-note-title-input"
              value={activeNote.title}
              aria-label={t('stickyNote.title')}
              autoFocus
              onChange={(event) => updateActiveNote({ title: event.target.value })}
              onBlur={() => setEditingTitle(false)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === 'Escape') setEditingTitle(false);
              }}
            />
          ) : (
            <span className="sticky-note-title" onDoubleClick={() => setEditingTitle(true)} title={t('stickyNote.rename')}>{activeNote.title}</span>
          )}
          {searchOpen && <input className="sticky-note-search-input" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder={t('stickyNote.searchPlaceholder')} aria-label={t('stickyNote.search')} autoFocus />}
          <div className="sticky-note-actions" data-note-control>
            <button type="button" data-note-control className="sticky-note-icon-button" aria-label={isTimeline ? t('stickyNote.addTimelineEntry') : t('stickyNote.add')} title={isTimeline ? t('stickyNote.addTimelineEntry') : t('stickyNote.add')} onClick={isTimeline ? addTimelineEntry : addNote}>
              <Plus aria-hidden="true" />
            </button>
            <button type="button" data-note-control className="sticky-note-icon-button" aria-label={t('stickyNote.toggleMode')} title={t('stickyNote.toggleMode')} aria-pressed={isTimeline} onClick={toggleMode}>
              <ListTodo aria-hidden="true" />
            </button>
            <button type="button" data-note-control className="sticky-note-icon-button" aria-label={t('stickyNote.search')} title={t('stickyNote.search')} aria-pressed={searchOpen} onClick={() => setSearchOpen((open) => !open)}>
              <Search aria-hidden="true" />
            </button>
            <div className="sticky-note-color-menu" aria-label={t('stickyNote.colorLabel')}>
              <Palette className="sticky-note-toolbar-icon" aria-hidden="true" />
              {NOTE_COLORS.map((color) => (
                <button key={color.id} type="button" aria-label={t(color.label)} aria-pressed={activeNote.color === color.id} className="sticky-note-color-button" style={{ backgroundColor: color.surface, borderColor: color.border }} onClick={() => updateActiveNote({ color: color.id })}>
                  {activeNote.color === color.id && <Check aria-hidden="true" />}
                </button>
              ))}
            </div>
            <button type="button" data-note-control className="sticky-note-icon-button" aria-label={document.alwaysOnTop ? t('stickyNote.unpin') : t('stickyNote.pin')} aria-pressed={document.alwaysOnTop} onClick={toggleAlwaysOnTop}>
              {document.alwaysOnTop ? <Pin aria-hidden="true" /> : <PinOff aria-hidden="true" />}
            </button>
            <button type="button" data-note-control className="sticky-note-icon-button" aria-label={t('stickyNote.hide')} onClick={handleClose}>
              <X aria-hidden="true" />
            </button>
          </div>
          </header>

          {isTimeline && (
            <div className="sticky-note-timeline" aria-label={t('stickyNote.timeline')}>
              {activeNote.content.split('\n').filter(Boolean).map((entry, index) => (
                <article className="sticky-note-timeline-entry" key={`${activeNote.id}-${index}`}>
                  <span className="sticky-note-timeline-dot" aria-hidden="true" />
                  <time>{timelineTimestamp}</time>
                  <p>{entry}</p>
                </article>
              ))}
              {!activeNote.content.trim() && <p className="sticky-note-timeline-empty">{t('stickyNote.timelinePlaceholder')}</p>}
            </div>
          )}
          <textarea className={isTimeline ? 'sticky-note-editor sticky-note-editor-timeline' : 'sticky-note-editor'} value={activeNote.content} onChange={(event) => updateActiveNote({ content: event.target.value })} placeholder={t('stickyNote.placeholder')} aria-label={t('stickyNote.editorLabel')} spellCheck autoFocus />

          <footer className="sticky-note-footer">
            <span className={saveError ? 'sticky-note-status is-error' : 'sticky-note-status'} role={saveError ? 'alert' : 'status'}>
              {saveError ? <CircleOff aria-hidden="true" /> : <Check aria-hidden="true" />}
              {saveError ? t('stickyNote.saveFailed') : t('stickyNote.autoSaved')}
            </span>
            <span>{activeNote.content.length} {t('stickyNote.characters')}</span>
          </footer>
        </section>
      </div>
    </main>
  );
}
