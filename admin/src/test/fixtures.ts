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

const feature = (id: string, key: string, name: string, unit: string, in_use = false): t.Feature => ({
  id,
  key,
  name,
  unit,
  description: '',
  quota_policy: 'personal_then_org',
  status: 'active',
  in_use,
});

export const configApps: t.ConfigApp[] = [
  {
    id: 'p-1',
    slug: 'synapse',
    name: 'Synapse',
    description: 'AI chat for institutions.',
    status: 'active',
    sort_order: 1,
    features: [feature('f-chat', 'chat_messages', 'Chat messages', 'messages', true), feature('f-ocr', 'ocr_pages', 'OCR pages', 'pages')],
    packages: { single: 1, bundle: 1 },
  },
  {
    id: 'p-2',
    slug: 'mindspear',
    name: 'Mindspear',
    description: 'Quizzes and live polls.',
    status: 'active',
    sort_order: 2,
    features: [feature('f-quiz', 'quizzes', 'Quizzes', 'quizzes')],
    packages: { single: 1, bundle: 1 },
  },
  {
    id: 'p-3',
    slug: 'mail-wizard',
    name: 'AI Mail Wizard',
    description: '',
    status: 'active',
    sort_order: 3,
    features: [feature('f-mail', 'drafts', 'Email drafts', 'drafts')],
    packages: { single: 0, bundle: 1 },
  },
  {
    id: 'p-4',
    slug: 'quigen',
    name: 'QuiGen',
    description: '',
    status: 'active',
    sort_order: 4,
    features: [],
    packages: { single: 0, bundle: 1 },
  },
];

const appRef = (slug: string) => {
  const app = configApps.find((item) => item.slug === slug);
  return { slug, name: app?.name ?? slug };
};

export const bundleRow: t.PackageRow = {
  id: 'pkg-all',
  kind: 'bundle',
  name: 'BdREN AI Suite',
  slug: 'suite',
  status: 'active',
  audience: 'Universities that want every app',
  is_public: true,
  highlight: true,
  sort_order: 0,
  apps: configApps.map((app) => appRef(app.slug)),
  price: '4500.00',
  currency: 'BDT',
  billing_interval: 'monthly',
  price_unit: 'per_institution',
  trial_days: 14,
  seat_limit: null,
  current_version: 1,
  subscribers: 3,
  updated_at: '2026-11-10T00:00:00Z',
};

export const synapseRow: t.PackageRow = {
  id: 'pkg-syn',
  kind: 'single',
  name: 'Synapse Standard',
  slug: 'standard',
  status: 'active',
  audience: '',
  is_public: false,
  highlight: false,
  sort_order: 1,
  apps: [appRef('synapse')],
  price: '1500.00',
  currency: 'BDT',
  billing_interval: 'monthly',
  price_unit: 'per_seat',
  trial_days: 0,
  seat_limit: 100,
  current_version: 2,
  subscribers: 12,
  updated_at: '2026-11-12T00:00:00Z',
};

export const mindspearRow: t.PackageRow = {
  ...synapseRow,
  id: 'pkg-ms',
  name: 'Mindspear Free',
  slug: 'free',
  apps: [appRef('mindspear')],
  price: '0.00',
  billing_interval: 'free',
  current_version: 1,
  subscribers: 0,
};

const limit = (featureId: string, app: string, limit_value: number): t.PackageLimit => {
  const owner = configApps.find((item) => item.slug === app);
  const found = owner?.features.find((item) => item.id === featureId);
  return {
    feature: { id: featureId, key: found?.key ?? featureId, name: found?.name ?? featureId, unit: found?.unit ?? '', app: appRef(app) },
    limit_value,
    limit_period: 'monthly',
    on_limit: 'block',
  };
};

export const synapseDetail: t.PackageDetail = {
  ...synapseRow,
  description: 'Chat and OCR for staff.',
  limits: [limit('f-chat', 'synapse', 2000)],
  versions: [
    {
      version: 2,
      created_at: '2026-11-12T00:00:00Z',
      created_by: actor,
      change_reason: 'More messages for staff',
      migration_policy: 'on_renewal',
      price: '1500.00',
      billing_interval: 'monthly',
      price_unit: 'per_seat',
      trial_days: 0,
      seat_limit: 100,
      apps: [appRef('synapse')],
      limits: [limit('f-chat', 'synapse', 2000)],
      subscribers: 10,
    },
    {
      version: 1,
      created_at: '2026-10-01T00:00:00Z',
      created_by: null,
      change_reason: '',
      migration_policy: 'new_only',
      price: '1200.00',
      billing_interval: 'monthly',
      price_unit: 'per_seat',
      trial_days: 0,
      seat_limit: 100,
      apps: [appRef('synapse')],
      limits: [limit('f-chat', 'synapse', 1000)],
      subscribers: 2,
    },
  ],
};
