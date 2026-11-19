import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BillingSubscription, ImportResponse, ImportRowInput, Member, PurchaseKind } from '@/api/types';
import type { InvitationFilter } from './tabs';
import type * as t from './types';
import { CATALOG_PATH, PORTAL_ROOT, PROFILE_PATH, portalApi } from './api';
import { ApiError, request } from '@/api/client';

const enc = encodeURIComponent;

export const portalKeys = {
  all: ['portal'] as const,
  institutions: ['portal', 'institutions'] as const,
  profile: ['portal', 'profile'] as const,
  catalog: ['portal', 'catalog'] as const,
  institution: (slug: string) => ['portal', slug, 'institution'] as const,
  dashboard: (slug: string, product: string) => ['portal', slug, 'dashboard', product] as const,
  usage: (slug: string, params: UsageQuery) => ['portal', slug, 'usage', params] as const,
  memberUsage: (slug: string, membershipId: string) => ['portal', slug, 'member-usage', membershipId] as const,
  members: (slug: string, params: MembersQuery) => ['portal', slug, 'members', params] as const,
  invitations: (slug: string, params: InvitationsQuery) => ['portal', slug, 'invitations', params] as const,
  domains: (slug: string) => ['portal', slug, 'domains'] as const,
  billing: (slug: string) => ['portal', slug, 'billing'] as const,
};

export interface UsageQuery extends t.UsageParams {
  limit: number;
  offset: number;
}

export interface MembersQuery {
  tab: t.MemberTab;
  q: string;
  status?: 'active' | 'suspended';
  role?: 'owner' | 'admin' | 'member';
  page: number;
  page_size: number;
}

export interface InvitationsQuery {
  status: InvitationFilter;
  q: string;
  page: number;
  page_size: number;
}

/** Institutions the signed-in user administers (any signed-in user may ask; the list may be empty). */
export function usePortalInstitutions() {
  return useQuery({
    queryKey: portalKeys.institutions,
    queryFn: ({ signal }) => request<t.AdminInstitution[]>(PORTAL_ROOT, { signal }),
    retry: false,
    staleTime: 5 * 60_000,
  });
}

export function useProfile() {
  return useQuery({
    queryKey: portalKeys.profile,
    queryFn: ({ signal }) => request<t.Profile>(PROFILE_PATH, { signal }),
    retry: false,
    staleTime: 5 * 60_000,
  });
}

/** Every BDREN app in the public catalog, for the app switchers. */
export function useCatalog() {
  return useQuery({
    queryKey: portalKeys.catalog,
    queryFn: ({ signal }) => request<{ products: t.CatalogProduct[] }>(CATALOG_PATH, { signal }),
    staleTime: 10 * 60_000,
  });
}

export function usePortalInstitution(slug: string) {
  return useQuery({
    queryKey: portalKeys.institution(slug),
    queryFn: ({ signal }) => portalApi(slug).get<t.PortalInstitution>('', undefined, signal),
    retry: false,
  });
}

export function usePortalDashboard(slug: string, product: string) {
  return useQuery({
    queryKey: portalKeys.dashboard(slug, product),
    queryFn: ({ signal }) => portalApi(slug).get<t.DashboardData>('dashboard/', { product }, signal),
    placeholderData: keepPreviousData,
  });
}

export function usePortalUsage(slug: string, params: UsageQuery) {
  return useQuery({
    queryKey: portalKeys.usage(slug, params),
    queryFn: ({ signal }) => portalApi(slug).get<t.UsageReport>('usage/', { ...params }, signal),
    placeholderData: keepPreviousData,
  });
}

export function usePortalMembers<T>(slug: string, params: MembersQuery) {
  return useQuery({
    queryKey: portalKeys.members(slug, params),
    queryFn: ({ signal }) => portalApi(slug).get<t.MembersPage<T>>('members/', { ...params }, signal),
    placeholderData: keepPreviousData,
  });
}

export function usePortalInvitations(slug: string, params: InvitationsQuery) {
  return useQuery({
    queryKey: portalKeys.invitations(slug, params),
    queryFn: ({ signal }) => portalApi(slug).get<t.MembersPage<t.PortalInvitation>>('invitations/', { ...params }, signal),
    placeholderData: keepPreviousData,
  });
}

export function usePortalDomains(slug: string) {
  return useQuery({
    queryKey: portalKeys.domains(slug),
    queryFn: ({ signal }) => portalApi(slug).get<t.DomainsReport>('domains/', undefined, signal),
  });
}

/** Subscriptions, offers with their quotes, downgrade options and payments of the institution. */
export function usePortalBilling(slug: string) {
  return useQuery({
    queryKey: portalKeys.billing(slug),
    queryFn: ({ signal }) => portalApi(slug).get<t.PortalBilling>('billing/', undefined, signal),
  });
}

const SCAN_LIMIT = 200;
const SCAN_PAGES = 5;

interface Found {
  row: t.UsageMember | null;
  report: t.UsageReport;
  complete: boolean;
}

/** Pages through the usage report's member rows (most usage first) until this member's row turns up. */
async function findRow(slug: string, product: string, membershipId: string, signal: AbortSignal): Promise<Found> {
  for (let page = 0; ; page++) {
    const report = await portalApi(slug).get<t.UsageReport>('usage/', { product, limit: SCAN_LIMIT, offset: page * SCAN_LIMIT }, signal);
    const row = report.members.results.find((member) => member.membership_id === membershipId) ?? null;
    const complete = row !== null || (page + 1) * SCAN_LIMIT >= report.members.total;
    if (complete || page + 1 >= SCAN_PAGES) return { row, report, complete };
  }
}

export interface AppUsage {
  product: t.ProductRef;
  quantity: number;
  requests: number;
  last_used: string | null;
}

export interface MemberUsage {
  total: t.UsageMember | null;
  apps: AppUsage[];
  /** False when the member was not among the busiest rows the panel scans. */
  complete: boolean;
}

async function loadMemberUsage(slug: string, membershipId: string, signal: AbortSignal): Promise<MemberUsage> {
  const all = await findRow(slug, '', membershipId, signal);
  if (!all.row) return { total: null, apps: [], complete: all.complete };
  const products = all.report.by_product;
  const perApp = await Promise.all(products.map((product) => findRow(slug, product.product_slug, membershipId, signal)));
  const apps = perApp.flatMap((found, index): AppUsage[] => {
    if (!found.row) return [];
    const product = products[index];
    const { quantity, requests, last_used } = found.row;
    return [{ product: { slug: product.product_slug, name: product.product_name }, quantity, requests, last_used }];
  });
  return {
    total: all.row,
    apps: apps.sort((a, b) => b.quantity - a.quantity),
    complete: perApp.every((found) => found.complete),
  };
}

/** One member's usage over the last 30 days, in all and per app, read from the institution usage report. */
export function useMemberUsage(slug: string, membershipId: string) {
  return useQuery({
    queryKey: portalKeys.memberUsage(slug, membershipId),
    queryFn: ({ signal }) => loadMemberUsage(slug, membershipId, signal),
    retry: false,
  });
}

/** After a portal write, seats, counts, lists and usage all move together. */
function usePortalWrite<TBody, TResult>(fn: (body: TBody) => Promise<TResult>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => client.invalidateQueries({ queryKey: portalKeys.all }),
  });
}

export interface MemberChange {
  role?: t.PortalRole;
  status?: 'active' | 'suspended';
}

export const useUpdateMember = (slug: string) =>
  usePortalWrite(({ id, body }: { id: string; body: MemberChange }) =>
    portalApi(slug).patch<Member>(`members/${enc(id)}/`, body),
  );

export const useRemoveMember = (slug: string) =>
  usePortalWrite((id: string) => portalApi(slug).post<Member>(`members/${enc(id)}/remove/`));

export interface CoverOutcome {
  added: Member[];
  unsent: number;
  failure: { member: Member; error: unknown } | null;
}

const STOP_ERRORS = new Set(['seat_cap_reached', 'throttled']);

/**
 * "Add to package" for one or more people, one request each in order. Stops at an error after which the rest can
 * only fail too (no seat left, rate limit); other errors skip that person and go on.
 */
export const useCoverMembers = (slug: string) =>
  usePortalWrite(async (members: Member[]): Promise<CoverOutcome> => {
    const outcome: CoverOutcome = { added: [], unsent: 0, failure: null };
    for (const member of members) {
      try {
        const result = await portalApi(slug).post<t.CoverResult>(`members/${enc(member.membership_id)}/cover/`);
        outcome.added.push(member);
        if (!result.email_sent) outcome.unsent += 1;
      } catch (error) {
        outcome.failure = { member, error };
        if (error instanceof ApiError && STOP_ERRORS.has(error.code)) break;
      }
    }
    return outcome;
  });

export const useInviteMember = (slug: string) =>
  usePortalWrite((body: { email: string; name: string; role: t.PortalRole }) =>
    portalApi(slug).post<t.InviteResult>('invitations/', body),
  );

export const useResendInvitation = (slug: string) =>
  usePortalWrite((id: string) => portalApi(slug).post<t.ResendResult>(`invitations/${enc(id)}/resend/`));

export const useRevokeInvitation = (slug: string) =>
  usePortalWrite((id: string) => portalApi(slug).post<{ invitation: t.PortalInvitation }>(`invitations/${enc(id)}/revoke/`));

/** The dry run writes nothing, so only the real import refreshes the console. */
export function usePortalImport(slug: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: { rows: ImportRowInput[]; dry_run: boolean }) => portalApi(slug).post<ImportResponse>('import/', body),
    onSuccess: (_result, body) => (body.dry_run ? undefined : client.invalidateQueries({ queryKey: portalKeys.all })),
  });
}

/**
 * Opens a bKash payment for an offer; the caller sends the browser to `redirect_url`. Billing is re-read whatever the
 * outcome, from the hook so it still happens when the dialog that started the checkout is gone (per-call callbacks
 * don't run after unmount).
 */
export function useCheckout(slug: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: { package: string; kind: PurchaseKind }) => portalApi(slug).post<t.CheckoutResult>('billing/checkout/', body),
    onSettled: () => void client.invalidateQueries({ queryKey: portalKeys.billing(slug) }),
  });
}

/**
 * Gives up a pending bKash payment after asking bKash about it (docs/BILLING_API.md, bKash flow step 5). Billing is
 * re-read whatever the answer, since even an error can mean the payment settled meanwhile.
 */
export function useAbandonPayment(slug: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => portalApi(slug).post<t.AbandonResult>(`billing/payments/${enc(id)}/abandon/`),
    onSettled: () => void client.invalidateQueries({ queryKey: portalKeys.billing(slug) }),
  });
}

type SubscriptionChange = { subscription: BillingSubscription };

function useBillingWrite<TBody>(slug: string, fn: (body: TBody) => Promise<SubscriptionChange>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => client.invalidateQueries({ queryKey: portalKeys.billing(slug) }),
  });
}

/** Schedules the move to a cheaper package (by id) at the next renewal. */
export const useScheduleDowngrade = (slug: string) =>
  useBillingWrite(slug, (pkg: string) => portalApi(slug).post<SubscriptionChange>('billing/downgrade/', { package: pkg }));

/** Clears the scheduled change of one subscription (by id). */
export const useCancelDowngrade = (slug: string) =>
  useBillingWrite(slug, (subscription: string) => portalApi(slug).delete<SubscriptionChange>('billing/downgrade/', { subscription }));
