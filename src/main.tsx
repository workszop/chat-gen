import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import '@astryxdesign/core/reset.css';
import '@astryxdesign/core/astryx.css';
import App from './App.tsx';
import Explainer from './explainer/Explainer.tsx';

// The explainer is the main page; the earlier component showcase lives at #showcase
// (or any #v=… link from it).
const hash = window.location.hash;
const isShowcase = hash.startsWith('#showcase') || hash.startsWith('#v=');

createRoot(document.getElementById('root')!).render(
  <StrictMode>{isShowcase ? <App /> : <Explainer />}</StrictMode>,
);
