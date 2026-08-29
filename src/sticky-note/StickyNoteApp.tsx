import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Check, CircleOff, Folder, GripVertical, ListTodo, Palette, Pencil, Pin, PinOff, Plus, Search, Trash2, X } from 'lucide-react';
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
  timelineEntries?: TimelineEntry[];
}

interface TimelineEntry {
  id: string;
  timestamp: string;
  content: string;
}

interface TimelineEditorDraft {
  entryId: string | null;
  date: string;
  time: string;
  content: string;
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
  notes: [{ id: 'note-1', title: '便签 1', content: '', color: 'yellow', timelineEntries: [] }],
  activeId: 'note-1',
  alwaysOnTop: true,
};

const DRAG_ACTIVATION_DELAY = 140;
const DRAG_ACTIVATION_DISTANCE = 8;

function getNoteColor(color: NoteColor) {
  return NOTE_COLORS.find((item) => item.id === color) ?? NOTE_COLORS[0];
}

function createNote(index: number): StickyNoteItem {
  const color = NOTE_COLORS[Math.floor(Math.random() * NOTE_COLORS.length)].id;
  return { id: `note-${Date.now()}-${index}`, title: `便签 ${index}`, content: '', color, mode: 'plain', timelineEntries: [] };
}

function getLocalDateTimeParts(timestamp = new Date().toISOString()) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return getLocalDateTimeParts();
  const pad = (value: number) => String(value).padStart(2, '0');
  return {
    date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    time: `${pad(date.getHours())}:${pad(date.getMinutes())}`,
  };
}

function formatTimelineTimestamp(timestamp: string) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp;
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date);
}

function sortTimelineEntries(entries: TimelineEntry[]) {
  return [...entries].sort((left, right) => {
    const leftTime = Date.parse(left.timestamp);
    const rightTime = Date.parse(right.timestamp);
    if (Number.isFinite(leftTime) && Number.isFinite(rightTime)) return rightTime - leftTime;
    return right.timestamp.localeCompare(left.timestamp);
  });
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
  const [dragPosition, setDragPosition] = useState<{ x: number; y: number } | null>(null);
  const [dropAnchor, setDropAnchor] = useState<{ targetId: string; placeAfter: boolean } | null>(null);
  const [timelineEditor, setTimelineEditor] = useState<TimelineEditorDraft | null>(null);
  const [selectedTimelineEntryId, setSelectedTimelineEntryId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<NoteContextMenu | null>(null);
  const contextMenuRenameRef = useRef<HTMLButtonElement>(null);
  const contextMenuDeleteRef = useRef<HTMLButtonElement>(null);
  const noteTabRefs = useRef(new Map<string, HTMLButtonElement>());
  const noteRowRefs = useRef(new Map<string, HTMLDivElement>());
  const pointerDragRef = useRef<{ noteId: string; pointerId: number; startX: number; startY: number; lastX: number; lastY: number; moved: boolean; activated: boolean } | null>(null);
  const suppressClickRef = useRef(false);
  const dragActivationTimerRef = useRef<number | null>(null);
  const dropAnchorRef = useRef<{ targetId: string; placeAfter: boolean } | null>(null);
  const pendingDragPositionRef = useRef<{ x: number; y: number } | null>(null);
  const dragFrameRef = useRef<number | null>(null);
  const previousRowRectsRef = useRef<Map<string, DOMRect> | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const addedNoteIdRef = useRef<string | null>(null);
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
            notes: savedDocument.notes?.length
              ? savedDocument.notes.map((note) => ({
                ...note,
                content: note.mode === 'timeline' ? '' : note.content,
                timelineEntries: sortTimelineEntries(note.timelineEntries ?? []),
              }))
              : EMPTY_DOCUMENT.notes,
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

  useLayoutEffect(() => {
    const previousRects = previousRowRectsRef.current;
    if (!previousRects) return;

    const animatedRows: HTMLDivElement[] = [];
    noteRowRefs.current.forEach((row, noteId) => {
      const previousRect = previousRects.get(noteId);
      if (!previousRect) return;
      const nextRect = row.getBoundingClientRect();
      const deltaY = previousRect.top - nextRect.top;
      if (Math.abs(deltaY) < 1) return;
      row.style.transition = 'none';
      row.style.transform = `translateY(${deltaY}px)`;
      animatedRows.push(row);
    });
    previousRowRectsRef.current = null;

    if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current);
    animationFrameRef.current = requestAnimationFrame(() => {
      animatedRows.forEach((row) => {
        row.style.transition = '';
        row.style.transform = '';
      });
      animationFrameRef.current = null;
    });
  }, [document.notes, draggedNoteId, dropAnchor]);

  useEffect(() => () => {
    if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current);
    if (dragFrameRef.current !== null) cancelAnimationFrame(dragFrameRef.current);
    if (dragActivationTimerRef.current !== null) window.clearTimeout(dragActivationTimerRef.current);
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
  const timelineEntries = activeNote.timelineEntries ?? [];
  const activeContentLength = isTimeline
    ? timelineEntries.reduce((total, entry) => total + entry.content.length, 0)
    : activeNote.content.length;
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

  const openTimelineEditor = useCallback((entry?: TimelineEntry) => {
    const parts = getLocalDateTimeParts(entry?.timestamp);
    setTimelineEditor({
      entryId: entry?.id ?? null,
      date: parts.date,
      time: parts.time,
      content: entry?.content ?? '',
    });
  }, []);

  const closeTimelineEditor = useCallback(() => setTimelineEditor(null), []);

  useEffect(() => {
    if (!timelineEditor) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeTimelineEditor();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [timelineEditor, closeTimelineEditor]);

  const saveTimelineEditor = useCallback(() => {
    if (!timelineEditor || !timelineEditor.content.trim()) return;
    const timestamp = new Date(`${timelineEditor.date}T${timelineEditor.time}`).toISOString();
    const entry: TimelineEntry = {
      id: timelineEditor.entryId ?? `timeline-${Date.now()}`,
      timestamp,
      content: timelineEditor.content.trim(),
    };
    setDocument((current) => ({
      ...current,
      notes: current.notes.map((note) => {
        if (note.id !== current.activeId) return note;
        const entries = note.timelineEntries ?? [];
        const nextEntries = timelineEditor.entryId
          ? entries.map((item) => (item.id === entry.id ? entry : item))
          : [...entries, entry];
        return { ...note, content: '', timelineEntries: sortTimelineEntries(nextEntries) };
      }),
    }));
    setSelectedTimelineEntryId(entry.id);
    setTimelineEditor(null);
  }, [timelineEditor]);

  const toggleMode = useCallback(() => {
    updateActiveNote({ mode: isTimeline ? 'plain' : 'timeline', content: '' });
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

  const moveNoteByOffset = useCallback((noteId: string, offset: -1 | 1) => {
    const currentIndex = document.notes.findIndex((note) => note.id === noteId);
    if (currentIndex < 0 || currentIndex + offset < 0 || currentIndex + offset >= document.notes.length) return;
    previousRowRectsRef.current = new Map(Array.from(noteRowRefs.current.entries()).map(([id, row]) => [id, row.getBoundingClientRect()]));
    setDocument((current) => {
      const sourceIndex = current.notes.findIndex((note) => note.id === noteId);
      const targetIndex = sourceIndex + offset;
      if (sourceIndex < 0 || targetIndex < 0 || targetIndex >= current.notes.length) return current;
      const notes = [...current.notes];
      const [source] = notes.splice(sourceIndex, 1);
      notes.splice(targetIndex, 0, source);
      return { ...current, notes };
    });
  }, [document.notes]);

  const captureRowRects = useCallback(() => {
    previousRowRectsRef.current = new Map(Array.from(noteRowRefs.current.entries()).map(([id, row]) => [id, row.getBoundingClientRect()]));
  }, []);

  const setAnimatedDropAnchor = useCallback((nextAnchor: { targetId: string; placeAfter: boolean } | null) => {
    const currentAnchor = dropAnchorRef.current;
    if (currentAnchor?.targetId === nextAnchor?.targetId && currentAnchor?.placeAfter === nextAnchor?.placeAfter) return;
    captureRowRects();
    dropAnchorRef.current = nextAnchor;
    setDropAnchor(nextAnchor);
  }, [captureRowRects]);

  const reorderNoteAroundTarget = useCallback((sourceId: string, targetId: string, placeAfter: boolean) => {
    if (sourceId === targetId) return;
    const rows = noteRowRefs.current;
    previousRowRectsRef.current = new Map(Array.from(rows.entries()).map(([id, row]) => [id, row.getBoundingClientRect()]));
    setDocument((current) => {
      const sourceIndex = current.notes.findIndex((note) => note.id === sourceId);
      const targetIndex = current.notes.findIndex((note) => note.id === targetId);
      if (sourceIndex < 0 || targetIndex < 0) return current;
      const notes = [...current.notes];
      const [source] = notes.splice(sourceIndex, 1);
      const adjustedTargetIndex = notes.findIndex((note) => note.id === targetId) + (placeAfter ? 1 : 0);
      if (adjustedTargetIndex === sourceIndex) {
        previousRowRectsRef.current = null;
        return current;
      }
      notes.splice(adjustedTargetIndex, 0, source);
      return { ...current, notes };
    });
  }, []);

  const updateDragFrame = useCallback((position: { x: number; y: number }) => {
    pendingDragPositionRef.current = position;
    if (dragFrameRef.current !== null) return;
    dragFrameRef.current = requestAnimationFrame(() => {
      dragFrameRef.current = null;
      const nextPosition = pendingDragPositionRef.current;
      const drag = pointerDragRef.current;
      if (!nextPosition || !drag) return;
      setDragPosition(nextPosition);
      const candidates = visibleNotes.filter((note) => note.id !== drag.noteId);
      let nextAnchor: { targetId: string; placeAfter: boolean } | null = null;
      for (const note of candidates) {
        const row = noteRowRefs.current.get(note.id);
        if (!row) continue;
        const rect = row.getBoundingClientRect();
        if (nextPosition.y < rect.top + rect.height / 2) {
          nextAnchor = { targetId: note.id, placeAfter: false };
          break;
        }
        nextAnchor = { targetId: note.id, placeAfter: true };
      }
      setAnimatedDropAnchor(nextAnchor);
    });
  }, [setAnimatedDropAnchor, visibleNotes]);

  const activatePointerDrag = useCallback(() => {
    const drag = pointerDragRef.current;
    if (!drag || drag.activated || !drag.moved) return;
    drag.activated = true;
    suppressClickRef.current = true;
    captureRowRects();
    setDraggedNoteId(drag.noteId);
    setDragPosition({ x: drag.lastX, y: drag.lastY });
    setDropAnchor(null);
    dropAnchorRef.current = null;
    updateDragFrame({ x: drag.lastX, y: drag.lastY });
  }, [captureRowRects, updateDragFrame]);

  const handlePointerMove = useCallback((event: { pointerId: number; clientX: number; clientY: number }) => {
    const drag = pointerDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
    if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < DRAG_ACTIVATION_DISTANCE) return;
    drag.moved = true;
    if (!drag.activated) {
      if (dragActivationTimerRef.current === null) activatePointerDrag();
      return;
    }
    suppressClickRef.current = true;
    updateDragFrame({ x: event.clientX, y: event.clientY });
  }, [activatePointerDrag, updateDragFrame]);

  const finishPointerDrag = useCallback((pointerId?: number) => {
    const drag = pointerDragRef.current;
    if (!drag || (pointerId !== undefined && drag.pointerId !== pointerId)) return;
    if (dragActivationTimerRef.current !== null) {
      window.clearTimeout(dragActivationTimerRef.current);
      dragActivationTimerRef.current = null;
    }
    if (!drag.activated) {
      pointerDragRef.current = null;
      return;
    }
    const anchor = dropAnchorRef.current;
    if (anchor) reorderNoteAroundTarget(drag.noteId, anchor.targetId, anchor.placeAfter);
    pointerDragRef.current = null;
    setDraggedNoteId(null);
    setDragPosition(null);
    dropAnchorRef.current = null;
    setDropAnchor(null);
  }, [reorderNoteAroundTarget]);

  useEffect(() => {
    const handleWindowPointerUp = (event: PointerEvent) => finishPointerDrag(event.pointerId);
    const handleWindowPointerCancel = (event: PointerEvent) => finishPointerDrag(event.pointerId);
    const handleWindowPointerMove = (event: PointerEvent) => handlePointerMove(event);
    window.addEventListener('pointermove', handleWindowPointerMove);
    window.addEventListener('pointerup', handleWindowPointerUp);
    window.addEventListener('pointercancel', handleWindowPointerCancel);
    return () => {
      window.removeEventListener('pointerup', handleWindowPointerUp);
      window.removeEventListener('pointercancel', handleWindowPointerCancel);
      window.removeEventListener('pointermove', handleWindowPointerMove);
    };
  }, [finishPointerDrag, handlePointerMove]);

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
          {visibleNotes.filter((note) => note.id !== draggedNoteId).map((note) => {
            const color = getNoteColor(note.color);
            const showGapBefore = dropAnchor?.targetId === note.id && !dropAnchor.placeAfter;
            const showGapAfter = dropAnchor?.targetId === note.id && dropAnchor.placeAfter;
            return (
              <div key={note.id}>
                {showGapBefore && <div className="sticky-note-drop-gap" aria-hidden="true" />}
                <div
                  className={`sticky-note-tab-row${note.id === document.activeId ? ' is-active' : ''}`}
                  style={{ '--tab-surface': color.surface, '--tab-border': color.border } as React.CSSProperties}
                  data-note-id={note.id}
                  ref={(element) => {
                    if (element) noteRowRefs.current.set(note.id, element);
                    else noteRowRefs.current.delete(note.id);
                  }}
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
                  onClick={() => {
                    if (suppressClickRef.current) {
                      suppressClickRef.current = false;
                      return;
                    }
                    setDocument((current) => ({ ...current, activeId: note.id }));
                  }}
                  onContextMenu={(event) => openNoteContextMenu(event, note.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                      event.preventDefault();
                      moveNoteByOffset(note.id, event.key === 'ArrowUp' ? -1 : 1);
                      return;
                    }
                    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
                      event.preventDefault();
                      const bounds = event.currentTarget.getBoundingClientRect();
                      showNoteContextMenu(note.id, bounds.right, bounds.top);
                    }
                  }}
                  aria-haspopup="menu"
                  aria-grabbed={draggedNoteId === note.id}
                  onPointerDown={(event) => {
                    if (event.button !== 0 || event.target instanceof HTMLElement && event.target.closest('[data-note-control]')) return;
                    event.currentTarget.setPointerCapture?.(event.pointerId);
                    pointerDragRef.current = { noteId: note.id, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, lastX: event.clientX, lastY: event.clientY, moved: false, activated: false };
                    dragActivationTimerRef.current = window.setTimeout(() => {
                      dragActivationTimerRef.current = null;
                      activatePointerDrag();
                    }, DRAG_ACTIVATION_DELAY);
                  }}
                  onPointerMove={(event) => {
                    handlePointerMove(event);
                  }}
                  onPointerUp={(event) => {
                    if (pointerDragRef.current?.pointerId !== event.pointerId) return;
                    event.currentTarget.releasePointerCapture?.(event.pointerId);
                    finishPointerDrag(event.pointerId);
                  }}
                  onPointerCancel={() => {
                    finishPointerDrag();
                  }}
                  >
                    <GripVertical className="sticky-note-tab-grip" aria-hidden="true" />
                    <span>{note.mode === 'timeline' ? t('stickyNote.timeline') : note.title}</span>
                  </button>
                </div>
                {showGapAfter && <div className="sticky-note-drop-gap" aria-hidden="true" />}
              </div>
            );
          })}
        </div>
      </aside>

      {draggedNoteId && dragPosition && (() => {
        const draggedNote = document.notes.find((note) => note.id === draggedNoteId);
        if (!draggedNote) return null;
        const color = getNoteColor(draggedNote.color);
        return (
          <div
            className="sticky-note-floating-tab"
            aria-hidden="true"
            style={{ left: 0, top: 0, transform: `translate3d(${dragPosition.x}px, ${dragPosition.y}px, 0) translate(-50%, -50%) rotate(1deg)`, backgroundColor: color.surface, borderColor: color.border }}
          >
            <GripVertical className="sticky-note-tab-grip" />
            <span>{draggedNote.mode === 'timeline' ? t('stickyNote.timeline') : draggedNote.title}</span>
          </div>
        );
      })()}

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
            <button type="button" data-note-control className="sticky-note-icon-button" aria-label={isTimeline ? t('stickyNote.addTimelineEntry') : t('stickyNote.add')} title={isTimeline ? t('stickyNote.addTimelineEntry') : t('stickyNote.add')} onClick={isTimeline ? () => openTimelineEditor() : addNote}>
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
              <button type="button" className="sticky-note-timeline-add-zone" onDoubleClick={() => openTimelineEditor()}>
                <Plus aria-hidden="true" />
                <span>{t('stickyNote.timelinePlaceholder')}</span>
              </button>
              {timelineEntries.map((entry) => (
                <article
                  className={`sticky-note-timeline-entry${selectedTimelineEntryId === entry.id ? ' is-selected' : ''}`}
                  key={entry.id}
                  tabIndex={0}
                  onClick={() => setSelectedTimelineEntryId(entry.id)}
                  onDoubleClick={() => openTimelineEditor(entry)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      openTimelineEditor(entry);
                    }
                  }}
                >
                  <span className="sticky-note-timeline-dot" aria-hidden="true" />
                  <time dateTime={entry.timestamp}>{formatTimelineTimestamp(entry.timestamp)}</time>
                  <p>{entry.content}</p>
                </article>
              ))}
              {!timelineEntries.length && <p className="sticky-note-timeline-empty">{t('stickyNote.timelinePlaceholder')}</p>}
            </div>
          )}
          {!isTimeline && <textarea className="sticky-note-editor" value={activeNote.content} onChange={(event) => updateActiveNote({ content: event.target.value })} placeholder={t('stickyNote.placeholder')} aria-label={t('stickyNote.editorLabel')} spellCheck autoFocus />}

          <footer className="sticky-note-footer">
            <span className={saveError ? 'sticky-note-status is-error' : 'sticky-note-status'} role={saveError ? 'alert' : 'status'}>
              {saveError ? <CircleOff aria-hidden="true" /> : <Check aria-hidden="true" />}
              {saveError ? t('stickyNote.saveFailed') : t('stickyNote.autoSaved')}
            </span>
            <span>{activeContentLength} {t('stickyNote.characters')}</span>
          </footer>
        </section>
      </div>

      {timelineEditor && (
        <div className="sticky-note-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeTimelineEditor(); }}>
          <section className="sticky-note-modal" role="dialog" aria-modal="true" aria-labelledby="sticky-note-timeline-editor-title">
            <div className="sticky-note-modal-header">
              <h2 id="sticky-note-timeline-editor-title">{timelineEditor.entryId ? t('stickyNote.editTimelineEntry') : t('stickyNote.newTimelineEntry')}</h2>
              <button type="button" className="sticky-note-icon-button" aria-label={t('stickyNote.cancel')} onClick={closeTimelineEditor}><X aria-hidden="true" /></button>
            </div>
            <div className="sticky-note-modal-fields">
              <label><span>{t('stickyNote.timelineDate')}</span><input type="date" value={timelineEditor.date} onChange={(event) => setTimelineEditor((current) => current ? { ...current, date: event.target.value } : current)} /></label>
              <label><span>{t('stickyNote.timelineTime')}</span><input type="time" value={timelineEditor.time} onChange={(event) => setTimelineEditor((current) => current ? { ...current, time: event.target.value } : current)} /></label>
            </div>
            <button type="button" className="sticky-note-modal-now" onClick={() => { const parts = getLocalDateTimeParts(); setTimelineEditor((current) => current ? { ...current, ...parts } : current); }}>{t('stickyNote.useCurrentTime')}</button>
            <label className="sticky-note-modal-content"><span>{t('stickyNote.timelineContent')}</span><textarea autoFocus value={timelineEditor.content} onChange={(event) => setTimelineEditor((current) => current ? { ...current, content: event.target.value } : current)} /></label>
            <div className="sticky-note-modal-actions">
              <button type="button" className="sticky-note-modal-button is-secondary" onClick={closeTimelineEditor}>{t('stickyNote.cancel')}</button>
              <button type="button" className="sticky-note-modal-button is-primary" disabled={!timelineEditor.content.trim() || !timelineEditor.date || !timelineEditor.time} onClick={saveTimelineEditor}>{t('stickyNote.confirm')}</button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
