import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/space-grotesk'
import '@fontsource-variable/ibm-plex-sans'
import '@fontsource-variable/jetbrains-mono'
import './lib/monaco-setup'
import './index.css'
import './i18n'
import './store/log-store'
import { appLogger } from './lib/logger'
import App from './App.tsx'
import ScreenshotApp from './screenshot/ScreenshotApp.tsx'
import LongshotPanel from './screenshot/longshot/LongshotPanel.tsx'
import CursorHighlightOverlay from './recording/CursorHighlightOverlay.tsx'
import RecordingCaptureBorderOverlay from './recording/RecordingCaptureBorderOverlay.tsx'

// 截图窗口使用独立渲染路径（由 Tauri 以 #/screenshot 打开）
const hash = window.location.hash
const isScreenshotWindow = hash === '#/screenshot' || hash.startsWith('#/screenshot?')
// 长截图悬浮控制面板（#/longshot-panel?x=..&y=..&w=..&h=..）
const isLongshotPanel = hash.startsWith('#/longshot-panel')
const isCursorHighlightWindow = hash === '#/recording-cursor-highlight'
const isRecordingCaptureBorderWindow = hash === '#/recording-capture-border'

// 截图窗口/长截图边框窗口需要透明背景，覆盖 index.css 中的 bg-background
if (isScreenshotWindow || isLongshotPanel || isCursorHighlightWindow || isRecordingCaptureBorderWindow) {
  document.documentElement.style.background = 'transparent'
  document.body.style.background = 'transparent'
  document.body.style.overflow = 'hidden'
}

// 全局错误捕获：未捕获异常统一写入日志，便于排查问题
window.addEventListener('error', (event) => {
  appLogger.error(`未捕获异常: ${event.message}`, { filename: event.filename, line: event.lineno, column: event.colno })
})
window.addEventListener('unhandledrejection', (event) => {
  appLogger.error('未处理的 Promise 拒绝', event.reason)
})

appLogger.info('应用启动', {
  pathname: window.location.pathname,
  hash: window.location.hash,
  userAgent: navigator.userAgent,
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isScreenshotWindow ? <ScreenshotApp /> : isLongshotPanel ? <LongshotPanel /> : isCursorHighlightWindow ? <CursorHighlightOverlay /> : isRecordingCaptureBorderWindow ? <RecordingCaptureBorderOverlay /> : <App />}
  </StrictMode>,
)
