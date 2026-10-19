import React from 'react';
import { createRoot } from 'react-dom/client';
import ResourceUnlocker from '../src/tools/system/resource-unlocker';
import '../src/index.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode><ResourceUnlocker /></React.StrictMode>,
);
