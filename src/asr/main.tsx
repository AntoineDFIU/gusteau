import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AsrTest } from './AsrTest';
import '../index.css';

// Dev-only page at /asr.html for testing the hands-free loop: speech in, model answer, speech out.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AsrTest />
  </StrictMode>,
);
