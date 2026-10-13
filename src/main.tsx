import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Shared styles load first so screen stylesheets (imported by pages) win ties.
import './fonts.css';
import './styles.css';
import { App } from './App';
import { UpdateBanner } from './components/UpdateBanner';
import './pwa';
import { applyTheme, getTheme } from './theme';

applyTheme(getTheme());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <UpdateBanner />
  </StrictMode>,
);
