export type HotkeyBindings = Record<string, string>;

export const DEFAULT_SCREENSHOT_HOTKEY = 'Ctrl+Alt+A';
export const DEFAULT_LONGSHOT_HOTKEY = 'Ctrl+Alt+S';
export const HOTKEYS_CHANGED_EVENT = 'niuery:hotkeys-changed';

export function getScreenshotHotkey(hotkeys: HotkeyBindings): string {
  return hotkeys.screenshot || DEFAULT_SCREENSHOT_HOTKEY;
}

export function getLongshotHotkey(hotkeys: HotkeyBindings): string {
  return hotkeys.longshot || DEFAULT_LONGSHOT_HOTKEY;
}

export function emitHotkeysChanged(hotkeys: HotkeyBindings) {
  window.dispatchEvent(new CustomEvent<HotkeyBindings>(HOTKEYS_CHANGED_EVENT, { detail: hotkeys }));
}
