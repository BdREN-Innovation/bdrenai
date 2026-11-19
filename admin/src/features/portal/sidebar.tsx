import { Link, useRouterState } from '@tanstack/react-router';
import { ArrowLeftRight, AtSign, ChartColumn, CircleHelp, LayoutDashboard, ReceiptText, ShieldCheck, Users } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Role } from '@/api/types';
import type { PortalPage } from './tabs';
import {
  AccountLinkContent,
  NavGroup,
  NavLinkContent,
  SidebarFrame,
  WebsiteLink,
  accountLinkClass,
  navLinkClass,
} from '@/components/layout/Sidebar';
import { PORTAL_PATHS } from './tabs';
import { BILLING_ROLES } from './billing/rules';
import { useAccess } from './access';

export interface PortalNavItem {
  page: PortalPage;
  label: string;
  icon: LucideIcon;
  keywords?: string[];
  /** Shown only to these roles in the institution; every role when unset. */
  roles?: ReadonlySet<Role>;
}

export interface PortalNavSection {
  title: string;
  items: PortalNavItem[];
}

export const PORTAL_NAV: PortalNavSection[] = [
  {
    title: 'Overview',
    items: [
      { page: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, keywords: ['home', 'seats', 'packages'] },
      { page: 'usage', label: 'Usage', icon: ChartColumn, keywords: ['reports', 'export', 'csv'] },
    ],
  },
  { title: 'People', items: [{ page: 'members', label: 'Members', icon: Users, keywords: ['people', 'invite', 'seats'] }] },
  {
    title: 'Institution',
    items: [
      { page: 'domains', label: 'Email domains', icon: AtSign, keywords: ['sign-in', 'domains'] },
      { page: 'billing', label: 'Billing', icon: ReceiptText, keywords: ['payments', 'bkash', 'renew', 'upgrade', 'receipts'], roles: BILLING_ROLES },
    ],
  },
  { title: 'Support', items: [{ page: 'help', label: 'Help', icon: CircleHelp, keywords: ['contact', 'support', 'bdren'] }] },
];

/** The console's pages the signed-in user's role in this institution may open. */
export function portalNav(role: Role | undefined): PortalNavSection[] {
  return PORTAL_NAV.map((section) => ({
    ...section,
    items: section.items.filter((item) => !item.roles || (role !== undefined && item.roles.has(role))),
  })).filter((section) => section.items.length > 0);
}

/** The signed-in user's role in the institution at `slug`, once the institution list has loaded. */
export function usePortalRole(slug: string): Role | undefined {
  const { institutions } = useAccess();
  return institutions.find((institution) => institution.slug === slug)?.role;
}

interface PortalSidebarProps {
  slug: string;
  name: string;
  collapsed: boolean;
  onToggle: () => void;
}

/** The institution console's sidebar: its pages, then the user's links to other consoles and the website. */
export function PortalSidebar({ slug, name, collapsed, onToggle }: PortalSidebarProps) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const { session, institutions, user } = useAccess();
  const role = usePortalRole(slug);
  const accountLink = (label: string) => ({
    'aria-label': collapsed ? label : undefined,
    title: collapsed ? label : undefined,
    className: accountLinkClass(collapsed),
  });

  return (
    <SidebarFrame
      label="Institution admin"
      title={name}
      subtitle="Institution admin"
      user={user}
      collapsed={collapsed}
      onToggle={onToggle}
      account={
        <>
          {institutions.length > 1 ? (
            <Link to="/portal" {...accountLink('Switch institution')}>
              <AccountLinkContent icon={ArrowLeftRight} label="Switch institution" collapsed={collapsed} />
            </Link>
          ) : null}
          {session ? (
            <Link to="/" {...accountLink('Platform console')}>
              <AccountLinkContent icon={ShieldCheck} label="Platform console" collapsed={collapsed} />
            </Link>
          ) : null}
          <WebsiteLink collapsed={collapsed} />
        </>
      }
    >
      {portalNav(role).map((section) => (
        <NavGroup key={section.title} title={section.title} collapsed={collapsed}>
          {section.items.map((item) => {
            const path = `/portal/${slug}/${item.page}`;
            const active = pathname === path || pathname.startsWith(`${path}/`);
            return (
              <Link
                key={item.page}
                to={PORTAL_PATHS[item.page]}
                params={{ slug }}
                aria-current={active ? 'page' : undefined}
                aria-label={collapsed ? item.label : undefined}
                title={collapsed ? item.label : undefined}
                className={navLinkClass(active, collapsed)}
              >
                <NavLinkContent icon={item.icon} label={item.label} collapsed={collapsed} />
              </Link>
            );
          })}
        </NavGroup>
      ))}
    </SidebarFrame>
  );
}
