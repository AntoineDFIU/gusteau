import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { initModelService } from './services';
import './index.css';

// Ask the server which model provider to use, then render.
void initModelService().finally(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
