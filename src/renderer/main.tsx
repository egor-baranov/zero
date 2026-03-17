import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '@renderer/app/app';
import '@renderer/styles/globals.css';

const container = document.getElementById('root');

if (!container) {
  throw new Error('Root container was not found');
}

createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
