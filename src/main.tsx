import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './lib/monaco-setup'
import './index.css'
import './i18n'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
