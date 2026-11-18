import { Link, useRouterState } from '@tanstack/react-router';
import { ArrowLeftRight, AtSign, ChartColumn, CircleHelp, LayoutDashboard, ShieldCheck, Users } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
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
import { useAccess } from './access';

export interface PortalNavItem {
  page: PortalPage;
  label: string;
  icon: LucideIcon;
  keywords?: string[];
}

export const PORTAL_NAV: { title: string; items: PortalNavItem[] }[] = [
  {
    title: 'Overview',
    items: [
      { page: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, keywords: ['home', 'seats', 'packages'] },
      { page: 'usage', label: 'Usage', icon: ChartColumn, keywords: ['reports', 'export', 'csv'] },
    ],
  },
  { title: 'People', items: [{ page: 'members', label: 'Members', icon: Users, keywords: ['people', 'invite', 'seats'] }] },
  { title: 'Institution', items: [{ page: 'domains', label: 'Email domains', icon: AtSign, keywords: ['sign-in', 'domains'] }] },
  { title: 'Support', items: [{ page: 'help', label: 'Help', icon: CircleHelp, keywords: ['contact', 'support', 'bdren'] }] },
];

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
      {PORTAL_NAV.map((section) => (
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
