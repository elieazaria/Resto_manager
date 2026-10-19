import '@fontsource-variable/figtree';
import '@fontsource-variable/bricolage-grotesque';
import './index.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import { ApiError } from './lib/api';
import { AuthProvider } from './lib/auth';
import { outbox } from './lib/outbox';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      refetchOnWindowFocus: false,
      // pas de réessai sur une réponse d'erreur (403/404…) ; deux essais sur un souci réseau
      retry: (n, e) => !(e instanceof ApiError) && n < 2,
    },
    mutations: { networkMode: 'always' },
  },
});

registerSW({ immediate: true });
window.addEventListener('online', () => void outbox.flush());
void outbox.flush();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <App />
        <Toaster position="top-center" richColors closeButton toastOptions={{ duration: 3500 }} />
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
);
