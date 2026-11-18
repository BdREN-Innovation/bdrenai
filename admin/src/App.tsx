import { useState } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import type { QueryClient } from '@tanstack/react-query';
import type { AppRouter } from './router';
import { ToastProvider } from '@/components/ui';
import { createQueryClient } from './queryClient';
import { ThemeProvider } from '@/lib/theme';
import { createAppRouter } from './router';

interface AppProps {
  router?: AppRouter;
  queryClient?: QueryClient;
}

export function App({ router: givenRouter, queryClient: givenClient }: AppProps) {
  const [router] = useState(() => givenRouter ?? createAppRouter());
  const [queryClient] = useState(() => givenClient ?? createQueryClient());
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
