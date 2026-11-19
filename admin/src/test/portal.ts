import { screen, within } from '@testing-library/react';
import type { BillingSubscription, Member } from '@/api/types';
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

/* Billing (`GET …/billing/`): DU has Synapse Standard, can renew it or upgrade, and can switch down at renewal. */

const DU_REF = { slug: 'du', name: 'University of Dhaka' };
const SYNAPSE = { slug: 'synapse', name: 'Synapse' };
const MINDSPEAR = { slug: 'mindspear', name: 'Mindspear' };

export const standardSubscription: BillingSubscription = {
  id: 'sub-du',
  institution: DU_REF,
  package: { id: 'pkg-standard', name: 'Synapse Standard', kind: 'single' },
  version: 2,
  apps: [SYNAPSE],
  status: 'active',
  starts_at: '2026-11-01T06:00:00Z',
  expires_at: '2026-12-01T06:00:00Z',
  auto_renew: true,
  scheduled_package: null,
  last_payment: { id: 'pay-done', method: 'bkash', completed_at: '2026-11-01T06:05:00Z' },
};

const offered = (id: string, name: string, kind: 'single' | 'bundle', apps: { slug: string; name: string }[]) => ({ id, name, kind, audience: '', apps });

export const renewOffer: t.Offer = {
  package: offered('pkg-standard', 'Synapse Standard', 'single', [SYNAPSE]),
  kind: 'renew',
  quote: { package_version: 2, amount: '3000.00', currency: 'BDT', periods: 1, period_start: '2026-12-01T06:00:00Z', period_end: '2026-12-31T06:00:00Z', kind: 'renew' },
};

export const upgradeOffer: t.Offer = {
  package: offered('pkg-suite', 'BdREN AI Suite', 'bundle', [SYNAPSE, MINDSPEAR]),
  kind: 'upgrade',
  quote: { package_version: 1, amount: '4500.00', currency: 'BDT', periods: 1, period_start: '2026-11-19T06:00:00Z', period_end: '2026-12-19T06:00:00Z', kind: 'upgrade' },
};

export const newOffer: t.Offer = {
  package: offered('pkg-basic', 'Synapse Basic', 'single', [SYNAPSE]),
  kind: 'new',
  quote: { package_version: 1, amount: '1000.00', currency: 'BDT', periods: 1, period_start: '2026-11-19T06:00:00Z', period_end: '2026-12-19T06:00:00Z', kind: 'new' },
};

export const basicDowngrade: t.DowngradeOption = {
  subscription_id: 'sub-du',
  package: offered('pkg-basic', 'Synapse Basic', 'single', [SYNAPSE]),
  amount: '1000.00',
  currency: 'BDT',
  billing_interval: 'monthly',
  seat_limit: null,
};

export const liteDowngrade: t.DowngradeOption = {
  ...basicDowngrade,
  package: offered('pkg-lite', 'Synapse Lite', 'single', [SYNAPSE]),
  amount: '500.00',
  seat_limit: 100,
};

const portalPayment: t.PortalPayment = {
  id: 'pay-done',
  receipt_number: 'BDR-2026-000031',
  institution: DU_REF,
  account_id: 'acc-du',
  package: { id: 'pkg-standard', name: 'Synapse Standard', kind: 'single' },
  package_version: 2,
  kind: 'renew',
  method: 'bkash',
  status: 'completed',
  amount: '3000.00',
  currency: 'BDT',
  periods: 1,
  period_start: '2026-11-01T06:00:00Z',
  period_end: '2026-12-01T06:00:00Z',
  reference: 'DKJ70PXGQR',
  payer_name: '',
  payment_date: '2026-11-01',
  notes: '',
  applied: true,
  subscription_id: 'sub-applied',
  target_subscription_id: 'sub-applied',
  has_attachment: false,
  bkash: { payment_id: 'TR0011vAVyXMV1795060527293', trx_id: 'DKJ70PXGQR', payer_account: '********378', status: 'Completed' },
  failure_reason: '',
  refunded_amount: '0.00',
  refunds: [],
  recorded_by: { name: 'Nadia Islam' },
  verified_by: null,
  verified_at: null,
  completed_at: '2026-11-01T06:05:00Z',
  created_at: '2026-11-01T06:00:00Z',
};

export const paidPayment = portalPayment;

export const failedPayment: t.PortalPayment = {
  ...portalPayment,
  id: 'pay-failed',
  receipt_number: null,
  status: 'failed',
  reference: '',
  bkash: { payment_id: 'TR0011failed', trx_id: null, payer_account: null, status: 'Failure' },
  failure_reason: 'bKash: Insufficient balance',
  completed_at: null,
  payment_date: '2026-10-31',
  created_at: '2026-10-31T06:00:00Z',
};

export const bankPayment: t.PortalPayment = {
  ...portalPayment,
  id: 'pay-bank',
  receipt_number: 'BDR-2026-000007',
  kind: 'new',
  method: 'bank_transfer',
  reference: 'SONALI-7781',
  has_attachment: true,
  bkash: null,
  completed_at: '2026-10-01T06:00:00Z',
  payment_date: '2026-10-01',
  created_at: '2026-10-01T06:00:00Z',
};

export const pendingPayment: t.PortalPayment = {
  ...portalPayment,
  id: 'pay-pending',
  receipt_number: null,
  kind: 'upgrade',
  status: 'pending',
  amount: '4500.00',
  package: { id: 'pkg-suite', name: 'BdREN AI Suite', kind: 'bundle' },
  reference: '',
  bkash: { payment_id: 'TR0011pending', trx_id: null, payer_account: null, status: 'Initiated' },
  completed_at: null,
  payment_date: '2026-11-19',
  created_at: '2026-11-19T05:58:00Z',
};

/** The pending bKash payment checkout opens for the renew offer, at the quoted charge. */
export const renewCheckoutPayment: t.PortalPayment = {
  ...pendingPayment,
  id: 'pay-renew',
  kind: 'renew',
  amount: renewOffer.quote.amount,
  package: { id: 'pkg-standard', name: 'Synapse Standard', kind: 'single' },
  period_start: renewOffer.quote.period_start,
  period_end: renewOffer.quote.period_end,
};

export const cancelledPayment: t.PortalPayment = {
  ...failedPayment,
  id: 'pay-cancelled',
  status: 'cancelled',
  failure_reason: 'bKash: The payer cancelled the payment.',
};

/** Synapse Standard ended; only Mindspear (another app) is live, and nothing is offered for Synapse. */
export const expiredSubscription: BillingSubscription = {
  ...standardSubscription,
  id: 'sub-du-old',
  status: 'expired',
  starts_at: '2026-09-01T06:00:00Z',
  expires_at: '2026-10-01T06:00:00Z',
};

export const mindspearSubscription: BillingSubscription = {
  ...standardSubscription,
  id: 'sub-du-mindspear',
  package: { id: 'pkg-mindspear', name: 'Mindspear Standard', kind: 'single' },
  apps: [MINDSPEAR],
};

export const billing: t.PortalBilling = {
  subscriptions: [standardSubscription],
  payments: [paidPayment, failedPayment, bankPayment],
  bkash_enabled: true,
  offers: [renewOffer, upgradeOffer],
  downgrades: [basicDowngrade, liteDowngrade],
};

/** Nothing active yet: only first packages are offered. */
export const emptyBilling: t.PortalBilling = { subscriptions: [], payments: [], bkash_enabled: true, offers: [newOffer], downgrades: [] };
