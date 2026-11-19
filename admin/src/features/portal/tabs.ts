import type { InvitationStatus } from '@/api/types';
import type { MemberTab } from './types';

export type MembersTab = MemberTab | 'invited';

export const MEMBERS_TABS: { value: MembersTab; label: string }[] = [
  { value: 'covered', label: 'Covered' },
  { value: 'invited', label: 'Invited' },
  { value: 'not_covered', label: 'Not covered' },
  { value: 'personal_plan', label: 'Personal plan' },
];

/** `''` lists every invitation; the Invited tab opens on `pending`. */
export type InvitationFilter = '' | InvitationStatus;

export const INVITATION_FILTERS: { value: InvitationFilter; label: string }[] = [
  { value: '', label: 'All invitations' },
  { value: 'pending', label: 'Pending' },
  { value: 'expired', label: 'Expired' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'revoked', label: 'Revoked' },
];

/** Search params of the Members page; `status: 'all'` stands for every invitation, absent for pending. */
export interface MembersSearch {
  tab?: Exclude<MembersTab, 'covered'>;
  status?: Exclude<InvitationStatus, 'pending'> | 'all';
}

const SEARCH_STATUSES: NonNullable<MembersSearch['status']>[] = ['expired', 'accepted', 'revoked', 'all'];

export function validateMembersSearch(search: Record<string, unknown>): MembersSearch {
  const tab = MEMBERS_TABS.find((item) => item.value !== 'covered' && item.value === search.tab)?.value;
  const status = SEARCH_STATUSES.find((value) => value === search.status);
  return {
    ...(tab && tab !== 'covered' ? { tab } : {}),
    ...(status ? { status } : {}),
  };
}

export function filterFromSearch(status: MembersSearch['status']): InvitationFilter {
  if (status === 'all') return '';
  return status ?? 'pending';
}

export function searchFromFilter(filter: InvitationFilter): MembersSearch['status'] {
  if (filter === '') return 'all';
  return filter === 'pending' ? undefined : filter;
}

export type PortalPage = 'dashboard' | 'usage' | 'members' | 'domains' | 'billing' | 'help';

/** Route of each console page, so links stay typed. */
export const PORTAL_PATHS = {
  dashboard: '/portal/$slug/dashboard',
  usage: '/portal/$slug/usage',
  members: '/portal/$slug/members',
  domains: '/portal/$slug/domains',
  billing: '/portal/$slug/billing',
  help: '/portal/$slug/help',
} as const satisfies Record<PortalPage, string>;
