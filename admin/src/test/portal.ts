import { screen, within } from '@testing-library/react';
import type { Member } from '@/api/types';
import type * as t from '@/features/portal/types';
import type { Routes } from './api';
import { renderApp } from './render';
import { API, PORTAL } from './fixtures';
import { reply } from './api';

/** `/api/v1/portal/institutions/du/` without the trailing slash, for building route keys. */
export const DU = `${PORTAL}/du`;

export const adminInstitution: t.AdminInstitution = {
  slug: 'du',
  name: 'University of Dhaka',
  status: 'active',
  seats: { used: 142, cap: 200 },
  role: 'admin',
};

export const institution: t.PortalInstitution = {
  slug: 'du',
  name: 'University of Dhaka',
  seats: { used: 142, cap: 200 },
  counts: { members: 140, active: 138, suspended: 2, pending_invitations: 4, expired_invitations: 1, pending_requests: 1, not_covered: 12, personal_plan: 3 },
  sign_in_domains: ['du.ac.bd'],
};

export const nadia: t.Profile = { id: 'u-self', name: 'Nadia Islam', email: 'nadia@du.ac.bd', is_superadmin: false };

const covered = { coverage: 'institution', label: 'covered' } as const;

export const members: Member[] = [
  { membership_id: 'm-self', user: { id: 'u-self', name: 'Nadia Islam', email: 'nadia@du.ac.bd', status: 'active' }, role: 'admin', status: 'active', ...covered, joined_at: '2026-10-01T00:00:00Z' },
  { membership_id: 'm-owner', user: { id: 'u-owner', name: 'Karim Owner', email: 'karim@du.ac.bd', status: 'active' }, role: 'owner', status: 'active', ...covered, joined_at: '2026-09-01T00:00:00Z' },
  { membership_id: 'm-1', user: { id: 'u-1', name: 'Rahim Uddin', email: 'rahim@du.ac.bd', status: 'active' }, role: 'member', status: 'active', ...covered, joined_at: '2026-11-02T00:00:00Z' },
  { membership_id: 'm-2', user: { id: 'u-2', name: 'Sadia Khan', email: 'sadia@du.ac.bd', status: 'active' }, role: 'member', status: 'suspended', ...covered, joined_at: null },
];

export const notCovered: Member[] = [
  { membership_id: 'm-free-1', user: { id: 'u-f1', name: 'Farhana Akter', email: 'farhana@du.ac.bd', status: 'active' }, role: 'member', status: 'active', coverage: 'none', label: 'not_covered', joined_at: '2026-11-10T00:00:00Z' },
  { membership_id: 'm-free-2', user: { id: 'u-f2', name: 'Imran Hossain', email: 'imran@cse.du.ac.bd', status: 'active' }, role: 'member', status: 'active', coverage: 'none', label: 'invited', joined_at: '2026-11-11T00:00:00Z' },
];

export const personal: t.PersonalPlanMember[] = [
  { membership_id: 'm-paid-1', user: { name: 'Tania Rahman', email: 'tania@du.ac.bd' }, label: 'personal_plan', joined_at: '2026-11-05T00:00:00Z' },
];

export const tabCounts: t.TabCounts = { covered: 140, not_covered: 12, personal_plan: 3 };

export const invitations: t.PortalInvitation[] = [
  {
    id: 'inv-1', email: 'tanvir@du.ac.bd', name: 'Tanvir', institution: { slug: 'du', name: 'University of Dhaka' }, role: 'member',
    status: 'pending', source: 'portal', invited_by: { id: 'u-self', name: 'Nadia Islam' }, expires_at: '2026-11-25T00:00:00Z',
    created_at: '2026-11-18T00:00:00Z', last_sent_at: '2026-11-18T00:00:00Z', sent_count: 1, email_status: 'sent', accepted_by: null, accepted_at: null,
  },
];

export function membersPage<T>(results: T[], tabs: t.TabCounts = tabCounts): t.MembersPage<T> {
  return { results, count: results.length, page: 1, page_size: 25, tabs };
}

/** The member list for each tab, read from the request's `tab`. */
export function membersByTab(request: { query: URLSearchParams }): t.MembersPage<Member | t.PersonalPlanMember> {
  const tab = request.query.get('tab');
  if (tab === 'not_covered') return membersPage<Member | t.PersonalPlanMember>(notCovered);
  if (tab === 'personal_plan') return membersPage<Member | t.PersonalPlanMember>(personal);
  return membersPage<Member | t.PersonalPlanMember>(members);
}

/**
 * Renders the app at `/admin<path>` signed in as an institution admin of DU (no superadmin role): the superadmin
 * session answers 403 and the portal lists DU.
 */
export function renderPortal(path: string, routes: Routes = {}) {
  return renderApp(path, {
    [`GET ${API}/session/`]: reply(403, { error: 'not_superadmin', message: 'Forbidden' }),
    [`GET ${PORTAL}/`]: [adminInstitution],
    [`GET /api/v1/auth/profile/`]: nadia,
    [`GET ${DU}/`]: institution,
    [`GET ${DU}/members/`]: membersByTab,
    [`GET ${DU}/invitations/`]: membersPage(invitations),
    [`GET /api/v1/catalog/products/`]: { products: [{ slug: 'synapse', name: 'Synapse' }, { slug: 'mindspear', name: 'Mindspear' }] },
    ...routes,
  });
}

/** Messages shown in the toast region. */
export function toasts() {
  return within(screen.getByRole('region', { name: 'Notifications' }));
}
