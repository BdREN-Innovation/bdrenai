import {
  Building2,
  ChartColumn,
  CircleHelp,
  CreditCard,
  LayoutDashboard,
  Mail,
  Repeat,
  ScrollText,
  Settings2,
  ShieldCheck,
  Users,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export type NavPath =
  | '/'
  | '/usage'
  | '/institutions'
  | '/users'
  | '/invitations'
  | '/billing'
  | '/subscriptions'
  | '/configuration'
  | '/admins'
  | '/audit'
  | '/help';

export interface NavItem {
  label: string;
  path: NavPath;
  icon: LucideIcon;
  soon?: boolean;
  keywords?: string[];
}

export interface NavSection {
  title: string;
  items: NavItem[];
}

export const NAV_SECTIONS: NavSection[] = [
  {
    title: 'Overview',
    items: [
      { label: 'Dashboard', path: '/', icon: LayoutDashboard, keywords: ['home'] },
      { label: 'Usage', path: '/usage', icon: ChartColumn, soon: true },
    ],
  },
  {
    title: 'Customers',
    items: [
      { label: 'Institutions', path: '/institutions', icon: Building2, keywords: ['organizations', 'orgs'] },
      { label: 'Users', path: '/users', icon: Users, keywords: ['accounts', 'people'] },
      { label: 'Invitations', path: '/invitations', icon: Mail, keywords: ['invites'] },
    ],
  },
  {
    title: 'Billing',
    items: [
      { label: 'Billing', path: '/billing', icon: CreditCard, soon: true, keywords: ['payments', 'bkash'] },
      { label: 'Subscriptions', path: '/subscriptions', icon: Repeat, soon: true },
    ],
  },
  {
    title: 'Platform',
    items: [
      { label: 'Configuration', path: '/configuration', icon: Settings2, soon: true, keywords: ['packages', 'apps', 'settings'] },
      { label: 'Admins & roles', path: '/admins', icon: ShieldCheck, keywords: ['superadmins', 'roles'] },
      { label: 'Audit log', path: '/audit', icon: ScrollText, keywords: ['history', 'activity'] },
    ],
  },
  {
    title: 'Support',
    items: [{ label: 'Help', path: '/help', icon: CircleHelp, keywords: ['contact', 'support'] }],
  },
];

export const NAV_ITEMS: NavItem[] = NAV_SECTIONS.flatMap((section) => section.items);

export function isActivePath(itemPath: string, currentPath: string): boolean {
  if (itemPath === '/') return currentPath === '/';
  return currentPath === itemPath || currentPath.startsWith(`${itemPath}/`);
}
