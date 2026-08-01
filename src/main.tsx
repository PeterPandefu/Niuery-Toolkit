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

// 截图窗口使用独立渲染路径（由 Tauri 以 #/screenshot 打开）
const isScreenshotWindow = window.location.hash === '#/screenshot'

// 截图窗口需要透明背景，覆盖 index.css 中的 bg-background
if (isScreenshotWindow) {
  document.documentElement.style.background = 'transparent'
  document.body.style.background = 'transparent'
  document.body.style.overflow = 'hidden'
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isScreenshotWindow ? <ScreenshotApp /> : <App />}
  </StrictMode>,
)
