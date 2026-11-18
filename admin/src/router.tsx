import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router';
import type { RouterHistory } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import type { InvitationStatus } from '@/api/types';
import { InstitutionDetailPage, INSTITUTION_TABS } from '@/pages/institution';
import type { InstitutionTab } from '@/pages/institution';
import { InvitationsPage } from '@/pages/invitations';
import { InstitutionsPage } from '@/pages/institutions';
import { DashboardPage } from '@/pages/dashboard';
import { NotFoundPage } from '@/pages/notfound';
import { AdminsPage } from '@/pages/admins';
import { Shell } from '@/components/layout/Shell';
import { UsersPage } from '@/pages/users';
import { AuditPage } from '@/pages/audit';
import { SoonPage } from '@/pages/soon';
import { HelpPage } from '@/pages/help';

const rootRoute = createRootRoute({ component: Shell, notFoundComponent: NotFoundPage });

const page = <TPath extends string>(path: TPath, component: () => ReactNode) =>
  createRoute({ getParentRoute: () => rootRoute, path, component });

const institutionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/institutions/$slug',
  validateSearch: (search: Record<string, unknown>): { tab?: InstitutionTab } => {
    const tab = INSTITUTION_TABS.find((value) => value === search.tab);
    return tab && tab !== 'overview' ? { tab } : {};
  },
  component: InstitutionDetailPage,
});

const INVITATION_STATUSES: InvitationStatus[] = ['pending', 'accepted', 'revoked', 'expired'];

const invitationsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/invitations',
  validateSearch: (search: Record<string, unknown>): { status?: InvitationStatus } => {
    const status = INVITATION_STATUSES.find((value) => value === search.status);
    return status ? { status } : {};
  },
  component: InvitationsPage,
});

const routeTree = rootRoute.addChildren([
  page('/', DashboardPage),
  page('/institutions', InstitutionsPage),
  institutionRoute,
  page('/users', UsersPage),
  invitationsRoute,
  page('/admins', AdminsPage),
  page('/audit', AuditPage),
  page('/help', HelpPage),
  page('/usage', () => <SoonPage area="usage" />),
  page('/billing', () => <SoonPage area="billing" />),
  page('/subscriptions', () => <SoonPage area="subscriptions" />),
  page('/configuration', () => <SoonPage area="configuration" />),
]);

export function createAppRouter(history?: RouterHistory) {
  return createRouter({ routeTree, basepath: '/admin', history, defaultPreload: false });
}

export type AppRouter = ReturnType<typeof createAppRouter>;

declare module '@tanstack/react-router' {
  interface Register {
    router: AppRouter;
  }
}

