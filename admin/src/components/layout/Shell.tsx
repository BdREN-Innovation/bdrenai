import { useCallback, useEffect, useState } from 'react';
import { Outlet } from '@tanstack/react-router';
import { ApiError } from '@/api/client';
import { useSession } from '@/api/queries';
import { CommandMenuContext } from './Page';
import { AccessDenied } from './AccessDenied';
import { CommandMenu } from './CommandMenu';
import { ErrorState, LoadingState } from '@/components/ui';
import { Sidebar } from './Sidebar';

const SIDEBAR_KEY = 'bdren-admin-sidebar';
const NARROW_QUERY = '(max-width: 1279px)';

function initialCollapsed(): boolean {
  try {
    const stored = window.localStorage.getItem(SIDEBAR_KEY);
    if (stored === 'collapsed' || stored === 'expanded') return stored === 'collapsed';
  } catch {
    /* Storage blocked: fall back to the viewport width. */
  }
  return typeof window.matchMedia === 'function' && window.matchMedia(NARROW_QUERY).matches;
}

function useSidebar() {
  const [collapsed, setCollapsed] = useState(initialCollapsed);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const query = window.matchMedia(NARROW_QUERY);
    const onChange = (event: MediaQueryListEvent) => setCollapsed(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  const toggle = useCallback(() => {
    setCollapsed((current) => {
      try {
        window.localStorage.setItem(SIDEBAR_KEY, current ? 'expanded' : 'collapsed');
      } catch {
        /* Storage blocked: the choice lasts for this tab only. */
      }
      return !current;
    });
  }, []);

  return { collapsed, toggle };
}

function useCommandShortcut(open: () => void) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'k' || !(event.metaKey || event.ctrlKey)) return;
      event.preventDefault();
      open();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);
}

/** Signed-in frame: only a platform superadmin gets past the session check. */
export function Shell() {
  const session = useSession();
  const { collapsed, toggle } = useSidebar();
  const [commandOpen, setCommandOpen] = useState(false);
  const openCommandMenu = useCallback(() => setCommandOpen(true), []);
  useCommandShortcut(openCommandMenu);

  if (session.isPending) return <LoadingState label="Checking your session…" className="min-h-screen" />;

  if (session.isError) {
    const error = session.error;
    if (error instanceof ApiError && error.status === 401) {
      return <LoadingState label="Redirecting to sign in…" className="min-h-screen" />;
    }
    if (error instanceof ApiError && error.status === 403) return <AccessDenied />;
    return (
      <main className="mx-auto max-w-lg p-6">
        <ErrorState error={error} onRetry={() => void session.refetch()} />
      </main>
    );
  }

  return (
    <CommandMenuContext.Provider value={openCommandMenu}>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-80 focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2 focus:text-sm focus:font-semibold"
      >
        Skip to content
      </a>
      <div className="flex h-screen min-w-0 bg-ground">
        <Sidebar session={session.data} collapsed={collapsed} onToggle={toggle} />
        <div className="flex min-w-0 flex-1 flex-col">
          <Outlet />
        </div>
      </div>
      <CommandMenu open={commandOpen} onOpenChange={setCommandOpen} />
    </CommandMenuContext.Provider>
  );
}
