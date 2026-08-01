import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './lib/monaco-setup'
import './index.css'
import './i18n'
import App from './App.tsx'
import ScreenshotApp from './screenshot/ScreenshotApp.tsx'

// 截图窗口使用独立渲染路径（由 Tauri 以 #/screenshot 打开）
const isScreenshotWindow = window.location.hash === '#/screenshot'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isScreenshotWindow ? <ScreenshotApp /> : <App />}
  </StrictMode>,
)
