import { render } from '@testing-library/react';
import { createMemoryHistory } from '@tanstack/react-router';
import { QueryClient } from '@tanstack/react-query';
import type { Routes } from './api';
import { createAppRouter } from '@/router';
import { API, PORTAL, profile, session } from './fixtures';
import { mockApi } from './api';
import { App } from '@/App';

/** Renders the whole app (shell, router, queries) at `path`, with fetch answered by `routes`. */
export function renderApp(path: string, routes: Routes = {}) {
  document.cookie = 'csrftoken=test-csrf; path=/';
  const api = mockApi({
    [`GET ${API}/session/`]: session,
    [`GET ${PORTAL}/`]: [],
    [`GET /api/v1/auth/profile/`]: profile,
    ...routes,
  });
  const history = createMemoryHistory({ initialEntries: [`/admin${path}`] });
  const router = createAppRouter(history);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const view = render(<App router={router} queryClient={queryClient} />);
  return { ...view, api, router };
}
