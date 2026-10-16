import React from 'react';
import { createRoot } from 'react-dom/client';
import '/src/index.css';
import '/src/i18n';
import { ResourceManager } from '/src/components/resources/ResourceManager';

createRoot(document.getElementById('root')!).render(<main className="mx-auto max-w-3xl p-4"><h1>独立数据目录 · 资源管理原生验证</h1><ResourceManager /></main>);
