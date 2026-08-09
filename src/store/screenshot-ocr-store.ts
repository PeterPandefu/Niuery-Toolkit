import { create } from 'zustand';

let nextSessionId = 0;

export interface ScreenshotOcrSession {
  id: number;
  imageDataUrl: string;
  text: string;
}

interface PendingTranslation {
  id: number;
  text: string;
}

interface ScreenshotOcrStore {
  screenshotSession: ScreenshotOcrSession | null;
  pendingTranslation: PendingTranslation | null;
  setScreenshotSession: (session: Omit<ScreenshotOcrSession, 'id'>) => void;
  setPendingTranslation: (text: string) => void;
  consumePendingTranslation: (id: number) => void;
}

/** 截图识别会话只驻留内存，避免图片和识别文本被持久化。 */
export const useScreenshotOcrStore = create<ScreenshotOcrStore>((set) => ({
  screenshotSession: null,
  pendingTranslation: null,
  setScreenshotSession: (session) => set({ screenshotSession: { ...session, id: ++nextSessionId } }),
  setPendingTranslation: (text) => set({ pendingTranslation: { id: ++nextSessionId, text } }),
  consumePendingTranslation: (id) =>
    set((state) => (state.pendingTranslation?.id === id ? { pendingTranslation: null } : state)),
}));
