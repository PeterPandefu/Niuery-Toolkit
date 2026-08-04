import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface TranslateStore {
  /** 百度翻译 APP ID */
  baiduAppId: string;
  /** 百度翻译密钥 */
  baiduSecret: string;
  setBaiduCredentials: (appId: string, secret: string) => void;
  /** 重置插件数据 */
  resetTranslateData: () => void;
}

export const useTranslateStore = create<TranslateStore>()(
  persist(
    (set) => ({
      baiduAppId: '',
      baiduSecret: '',
      setBaiduCredentials: (appId, secret) => set({ baiduAppId: appId, baiduSecret: secret }),
      resetTranslateData: () => set({ baiduAppId: '', baiduSecret: '' }),
    }),
    { name: 'niuery-translate-store' }
  )
);
