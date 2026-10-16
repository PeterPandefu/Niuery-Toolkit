import { describe, expect, it } from 'vitest';
import { getScreenshotHotkey, getLongshotHotkey, getStickyNoteHotkey } from '@/lib/hotkeys';

describe('hotkey defaults', () => {
  it('uses new shortcuts when bindings are missing', () => {
    expect(getScreenshotHotkey({})).toBe('Alt+Q');
    expect(getLongshotHotkey({})).toBe('Alt+W');
    expect(getStickyNoteHotkey({})).toBe('Alt+N');
  });

  it('preserves saved custom shortcuts', () => {
    const saved = { screenshot: 'Ctrl+Alt+A', longshot: 'Ctrl+Alt+S', stickyNote: 'Ctrl+Alt+N' };
    expect(getScreenshotHotkey(saved)).toBe('Ctrl+Alt+A');
    expect(getLongshotHotkey(saved)).toBe('Ctrl+Alt+S');
    expect(getStickyNoteHotkey(saved)).toBe('Ctrl+Alt+N');
  });
});
