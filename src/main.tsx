import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/space-grotesk'
import '@fontsource-variable/ibm-plex-sans'
import '@fontsource-variable/jetbrains-mono'
import './lib/monaco-setup'
import './index.css'
import './i18n'
import App from './App.tsx'
import ScreenshotApp from './screenshot/ScreenshotApp.tsx'
import LongshotPanel from './screenshot/longshot/LongshotPanel.tsx'

// 截图窗口使用独立渲染路径（由 Tauri 以 #/screenshot 打开）
const hash = window.location.hash
const isScreenshotWindow = hash === '#/screenshot' || hash.startsWith('#/screenshot?')
// 长截图悬浮控制面板（#/longshot-panel?x=..&y=..&w=..&h=..）
const isLongshotPanel = hash.startsWith('#/longshot-panel')

// 截图窗口/长截图边框窗口需要透明背景，覆盖 index.css 中的 bg-background
if (isScreenshotWindow || isLongshotPanel) {
  document.documentElement.style.background = 'transparent'
  document.body.style.background = 'transparent'
  document.body.style.overflow = 'hidden'
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isScreenshotWindow ? <ScreenshotApp /> : isLongshotPanel ? <LongshotPanel /> : <App />}
  </StrictMode>,
)
