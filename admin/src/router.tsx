import { createRootRoute, createRoute, createRouter, redirect } from '@tanstack/react-router';
import type { RouterHistory } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import type { InvitationStatus, PaymentTab } from '@/api/types';
import { InstitutionDetailPage, INSTITUTION_TABS } from '@/pages/institution';
import type { InstitutionTab } from '@/pages/institution';
import { CONFIGURATION_TABS } from '@/pages/configuration/tabs';
import type { ConfigurationTab } from '@/pages/configuration/tabs';
import { PackageDetailPage } from '@/pages/configuration/package';
import { ConfigurationPage } from '@/pages/configuration';
import { InvitationsPage } from '@/pages/invitations';
import { InstitutionsPage } from '@/pages/institutions';
import { DashboardPage } from '@/pages/dashboard';
import { NotFoundPage } from '@/pages/notfound';
import { AdminsPage } from '@/pages/admins';
import { Shell } from '@/components/layout/Shell';
import { UsersPage } from '@/pages/users';
import { AuditPage } from '@/pages/audit';
import { SoonPage } from '@/pages/soon';
import { BillingPage } from '@/pages/billing';
import { SUBSCRIPTION_VIEWS, SubscriptionsPage } from '@/pages/subscriptions';
import type { SubscriptionView } from '@/pages/subscriptions';
import { HelpPage } from '@/pages/help';
import { AccessGate } from '@/features/portal/access';
import { PortalShell } from '@/features/portal/shell';
import { validateMembersSearch } from '@/features/portal/tabs';
import { validateBillingSearch } from '@/features/portal/billing/rules';
import { PortalDashboardPage } from '@/pages/portal/dashboard';
import { PortalMembersPage } from '@/pages/portal/members';
import { PortalDomainsPage } from '@/pages/portal/domains';
import { PortalUsagePage } from '@/pages/portal/usage';
import { PortalHelpPage } from '@/pages/portal/help';
import { PortalBillingPage } from '@/pages/portal/billing';
import { PortalHomePage } from '@/pages/portal';

/** Who is signed in decides the console: Shell frames the platform pages; `/portal/…` frames itself (PortalShell). */
function Root() {
  return (
    <AccessGate>
      <Shell />
    </AccessGate>
  );
}

const rootRoute = createRootRoute({ component: Root, notFoundComponent: NotFoundPage });

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

const PAYMENT_TABS: PaymentTab[] = ['bkash', 'manual', 'attention'];

const billingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/billing',
  validateSearch: (search: Record<string, unknown>): { tab?: PaymentTab } => {
    const tab = PAYMENT_TABS.find((value) => value === search.tab);
    return tab ? { tab } : {};
  },
  component: BillingPage,
});

const subscriptionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/subscriptions',
  validateSearch: (search: Record<string, unknown>): { view?: SubscriptionView } => {
    const view = SUBSCRIPTION_VIEWS.find((value) => value === search.view);
    return view && view !== 'all' ? { view } : {};
  },
  component: SubscriptionsPage,
});

const configurationRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/configuration',
  validateSearch: (search: Record<string, unknown>): { tab?: ConfigurationTab } => {
    const tab = CONFIGURATION_TABS.find((value) => value === search.tab);
    return tab && tab !== 'packages' ? { tab } : {};
  },
  component: ConfigurationPage,
});

/** The institution console (`/portal/…`): institution admins, and superadmins who also administer an institution. */
const portalHomeRoute = createRoute({ getParentRoute: () => rootRoute, path: '/portal', component: PortalHomePage });

const portalRoute = createRoute({ getParentRoute: () => rootRoute, path: '/portal/$slug', component: PortalShell });

const portalPage = <TPath extends string>(path: TPath, component: () => ReactNode) =>
  createRoute({ getParentRoute: () => portalRoute, path, component });

const portalIndexRoute = createRoute({
  getParentRoute: () => portalRoute,
  path: '/',
  beforeLoad: ({ params }) => {
    throw redirect({ to: '/portal/$slug/dashboard', params, replace: true });
  },
});

const portalMembersRoute = createRoute({
  getParentRoute: () => portalRoute,
  path: '/members',
  validateSearch: validateMembersSearch,
  component: PortalMembersPage,
});

/** bKash's callback sends the browser back here with `?payment=<id>&result=success|failed|cancelled|pending`. */
const portalBillingRoute = createRoute({
  getParentRoute: () => portalRoute,
  path: '/billing',
  validateSearch: validateBillingSearch,
  component: PortalBillingPage,
});

const portalTree = portalRoute.addChildren([
  portalIndexRoute,
  portalPage('/dashboard', PortalDashboardPage),
  portalPage('/usage', PortalUsagePage),
  portalMembersRoute,
  portalPage('/domains', PortalDomainsPage),
  portalBillingRoute,
  portalPage('/help', PortalHelpPage),
]);

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
  billingRoute,
  subscriptionsRoute,
  configurationRoute,
  page('/configuration/packages/$id', PackageDetailPage),
  portalHomeRoute,
  portalTree,
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

