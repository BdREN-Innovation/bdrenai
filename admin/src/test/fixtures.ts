import type * as t from '@/api/types';

export const API = '/api/v1/superadmin';

export const session: t.Session = {
  user: { id: 'u-self', email: 'boss@bdren.ai', name: 'Boss Admin', initials: 'BA' },
  roles: ['platform_super_admin'],
};

export const actor = { id: 'u-self', name: 'Boss Admin', email: 'boss@bdren.ai' };

export function page<T>(results: T[], count = results.length): t.Page<T> {
  return { results, count, page: 1, page_size: 25 };
}

export const auditEntry: t.AuditEntry = {
  id: 'a-1',
  action: 'organization.suspend',
  target_type: 'organization',
  target_id: '7d1c2a4e-0000-0000-0000-000000000001',
  actor,
  metadata: { reason: 'Unpaid invoice', organization_id: 'org-1' },
  ip_address: '10.0.0.5',
  created_at: '2026-11-17T08:00:00Z',
};

export const institutionItem: t.InstitutionListItem = {
  id: 'org-1',
  slug: 'dhaka-university',
  name: 'Dhaka University',
  type: 'university',
  sector: 'public',
  status: 'active',
  seats: { used: 95, cap: 100 },
  admins: [{ id: 'u-2', name: 'Rahim Uddin', email: 'rahim@du.ac.bd' }],
  members_count: 90,
  pending_invitations: 5,
  pending_requests: 1,
  created_at: '2026-10-01T00:00:00Z',
};

export const institutionDetail: t.InstitutionDetail = {
  id: 'org-1',
  slug: 'dhaka-university',
  name: 'Dhaka University',
  type: 'university',
  sector: 'public',
  status: 'active',
  timezone: 'Asia/Dhaka',
  contact_email: 'it@du.ac.bd',
  sign_in_domains: ['du.ac.bd'],
  seats: { used: 95, cap: 100 },
  seat_cap_reason: 'Initial package',
  counts: { members: 92, active: 90, suspended: 2, pending_invitations: 5, expired_invitations: 1, pending_requests: 1 },
  admins: [{ membership_id: 'm-1', user_id: 'u-2', name: 'Rahim Uddin', email: 'rahim@du.ac.bd', role: 'admin' }],
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-11-01T00:00:00Z',
};

export const invitation: t.Invitation = {
  id: 'inv-1',
  email: 'karim@du.ac.bd',
  name: 'Karim Ahmed',
  institution: { slug: 'dhaka-university', name: 'Dhaka University' },
  role: 'admin',
  status: 'pending',
  source: 'superadmin',
  invited_by: actor,
  expires_at: '2026-11-25T00:00:00Z',
  created_at: '2026-11-18T00:00:00Z',
  last_sent_at: '2026-11-18T00:00:00Z',
  sent_count: 1,
  email_status: 'sent',
  accepted_by: null,
  accepted_at: null,
};

export const user: t.UserListItem = {
  id: 'u-2',
  name: 'Rahim Uddin',
  email: 'rahim@du.ac.bd',
  email_verified: true,
  status: 'active',
  created_at: '2026-10-02T00:00:00Z',
  last_login_at: '2026-11-17T00:00:00Z',
  memberships: [
    { membership_id: 'm-1', institution: { slug: 'dhaka-university', name: 'Dhaka University' }, role: 'admin', status: 'active' },
  ],
  is_superadmin: false,
};
