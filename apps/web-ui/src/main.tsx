import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';
import { initAuthClientsForCurrentRoute } from './lib/keycloak';
import { ThemeProvider } from './theme/ThemeProvider';

function clearLoginRequiredHash() {
  if (typeof window === 'undefined') {
    return;
  }
  const hash = window.location.hash || '';
  if (!hash.includes('error=login_required')) {
    return;
  }
  const cleanUrl = `${window.location.pathname}${window.location.search}`;
  window.history.replaceState(null, document.title, cleanUrl);
}

async function bootstrap() {
  clearLoginRequiredHash();

  try {
    await Promise.race([
      initAuthClientsForCurrentRoute(),
      new Promise((_resolve, reject) => {
        window.setTimeout(() => reject(new Error('auth_init_timeout')), 6000);
      }),
    ]);
  } catch {
    // Allow UI to render even if OIDC is temporarily unavailable.
  }

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <ThemeProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </ThemeProvider>
    </React.StrictMode>
  );
}

bootstrap();
