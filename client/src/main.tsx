import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { migrateLegacyRawMidiData } from './utils/storage';
import { detectLocale } from './i18n';

// One-time migration: move legacy localStorage MIDI data into IndexedDB
void migrateLegacyRawMidiData();

// Set initial document language from detected locale
document.documentElement.lang = detectLocale() === 'zh' ? 'zh-CN' : 'en';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
