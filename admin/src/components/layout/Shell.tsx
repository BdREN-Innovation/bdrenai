import { useCallback, useEffect, useState } from 'react';
import { Navigate, Outlet, useRouterState } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { useAccess } from '@/features/portal/access';
import { CommandMenuContext } from './Page';
import { CommandMenu } from './CommandMenu';
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

interface FrameProps {
  sidebar: (state: { collapsed: boolean; onToggle: () => void }) => ReactNode;
  commandMenu: (state: { open: boolean; onOpenChange: (open: boolean) => void }) => ReactNode;
  children: ReactNode;
}

/** A console's frame: skip link, collapsible sidebar, the page, and the ⌘K command menu. */
export function Frame({ sidebar, commandMenu, children }: FrameProps) {
  const { collapsed, toggle } = useSidebar();
  const [commandOpen, setCommandOpen] = useState(false);
  const openCommandMenu = useCallback(() => setCommandOpen(true), []);
  useCommandShortcut(openCommandMenu);

  return (
    <CommandMenuContext.Provider value={openCommandMenu}>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-80 focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2 focus:text-sm focus:font-semibold"
      >
        Skip to content
      </a>
      <div className="flex h-screen min-w-0 bg-ground">
        {sidebar({ collapsed, onToggle: toggle })}
        <div className="flex min-w-0 flex-1 flex-col">{children}</div>
      </div>
      {commandMenu({ open: commandOpen, onOpenChange: setCommandOpen })}
    </CommandMenuContext.Provider>
  );
}

const isPortalRoute = (routeId: string) => routeId === '/portal' || routeId.startsWith('/portal/');

/**
 * The platform console's frame. Only a superadmin session gets it; anyone else is sent to the institution console.
 * `/portal/…` pages bring their own frame (PortalShell), so they pass straight through.
 */
export function Shell() {
  const { session, institutions, institutionsError, retryInstitutions } = useAccess();
  const portal = useRouterState({ select: (state) => state.matches.some((match) => isPortalRoute(match.routeId)) });
  if (portal) return <Outlet />;
  if (!session) return <Navigate to="/portal" replace />;

  return (
    <Frame
      sidebar={(state) => <Sidebar session={session} institutions={institutions} onRetryInstitutions={institutionsError ? retryInstitutions : undefined} {...state} />}
      commandMenu={(state) => <CommandMenu {...state} />}
    >
      <Outlet />
    </Frame>
  );
}
