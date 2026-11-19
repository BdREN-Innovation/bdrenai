import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { QueryKey } from '@tanstack/react-query';
import type * as t from './types';
import { superadmin } from './client';

const enc = encodeURIComponent;

export const keys = {
  session: ['session'] as const,
  dashboard: ['dashboard'] as const,
  institutions: (params: t.InstitutionListParams) => ['institutions', 'list', params] as const,
  institutionOptions: (q: string) => ['institutions', 'options', q] as const,
  institutionDirectory: (q: string) => ['institutions', 'directory', q] as const,
  institution: (slug: string) => ['institutions', 'detail', slug] as const,
  members: (slug: string, params: t.MemberListParams) => ['institutions', 'members', slug, params] as const,
  history: (slug: string, page: number) => ['institutions', 'history', slug, page] as const,
  users: (params: t.UserListParams) => ['users', 'list', params] as const,
  user: (id: string) => ['users', 'detail', id] as const,
  invitations: (params: t.InvitationListParams) => ['invitations', params] as const,
  admins: ['admins'] as const,
  audit: (params: t.AuditListParams) => ['audit', params] as const,
  auditFilters: ['audit', 'filters'] as const,
  configApps: ['config', 'apps'] as const,
  packages: (params: t.PackageListParams) => ['config', 'packages', params] as const,
  package: (id: string) => ['config', 'package', id] as const,
  billingSummary: (range: t.DateRange) => ['billing', 'summary', range] as const,
  payments: (params: t.PaymentListParams) => ['billing', 'payments', params] as const,
  payment: (id: string) => ['billing', 'payment', id] as const,
  quote: (params: t.QuoteParams) => ['billing', 'quote', params] as const,
  subscriptions: (params: t.SubscriptionListParams) => ['billing', 'subscriptions', params] as const,
  institutionBilling: (slug: string) => ['billing', 'institution', slug] as const,
};

/** Prefixes refreshed after any write: lists, counts and history all move together. */
const AFTER_WRITE: QueryKey[] = [
  ['dashboard'],
  ['institutions'],
  ['users'],
  ['invitations'],
  ['admins'],
  ['audit'],
  ['config'],
  ['billing'],
];

function useWrite<TBody, TResult>(fn: (body: TBody) => Promise<TResult>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () =>
      Promise.all(AFTER_WRITE.map((queryKey) => client.invalidateQueries({ queryKey }))),
  });
}

export function useSession() {
  return useQuery({
    queryKey: keys.session,
    queryFn: ({ signal }) => superadmin.get<t.Session>('session/', undefined, signal),
    retry: false,
    staleTime: 5 * 60_000,
  });
}

export function useDashboard() {
  return useQuery({
    queryKey: keys.dashboard,
    queryFn: ({ signal }) => superadmin.get<t.Dashboard>('dashboard/', undefined, signal),
  });
}

export function useInstitutions(params: t.InstitutionListParams) {
  return useQuery({
    queryKey: keys.institutions(params),
    queryFn: ({ signal }) =>
      superadmin.get<t.Page<t.InstitutionListItem>>('institutions/', { ...params }, signal),
    placeholderData: keepPreviousData,
  });
}

export function useInstitutionOptions(q: string, enabled = true) {
  return useQuery({
    queryKey: keys.institutionOptions(q),
    queryFn: ({ signal }) =>
      superadmin.get<t.Results<t.InstitutionOption>>('institutions/options/', { q }, signal),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useInstitutionDirectory(q: string, enabled = true) {
  return useQuery({
    queryKey: keys.institutionDirectory(q),
    queryFn: ({ signal }) =>
      superadmin.get<t.Results<t.DirectoryEntry>>('institutions/directory/', { q }, signal),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    enabled,
  });
}

export function useInstitution(slug: string) {
  return useQuery({
    queryKey: keys.institution(slug),
    queryFn: ({ signal }) =>
      superadmin.get<t.InstitutionDetail>(`institutions/${enc(slug)}/`, undefined, signal),
  });
}

export function useMembers(slug: string, params: t.MemberListParams) {
  return useQuery({
    queryKey: keys.members(slug, params),
    queryFn: ({ signal }) =>
      superadmin.get<t.Page<t.Member>>(`institutions/${enc(slug)}/members/`, { ...params }, signal),
    placeholderData: keepPreviousData,
  });
}

export function useInstitutionHistory(slug: string, page: number) {
  return useQuery({
    queryKey: keys.history(slug, page),
    queryFn: ({ signal }) =>
      superadmin.get<t.Page<t.AuditEntry>>(`institutions/${enc(slug)}/history/`, { page }, signal),
    placeholderData: keepPreviousData,
  });
}

export function useUsers(params: t.UserListParams) {
  return useQuery({
    queryKey: keys.users(params),
    queryFn: ({ signal }) =>
      superadmin.get<t.Page<t.UserListItem>>('users/', { ...params }, signal),
    placeholderData: keepPreviousData,
  });
}

export function useUser(id: string | null) {
  return useQuery({
    queryKey: keys.user(id ?? ''),
    queryFn: ({ signal }) => superadmin.get<t.UserDetail>(`users/${enc(id ?? '')}/`, undefined, signal),
    enabled: id !== null,
  });
}

export function useInvitations(params: t.InvitationListParams) {
  return useQuery({
    queryKey: keys.invitations(params),
    queryFn: ({ signal }) =>
      superadmin.get<t.Page<t.Invitation>>('invitations/', { ...params }, signal),
    placeholderData: keepPreviousData,
  });
}

export function useAdmins() {
  return useQuery({
    queryKey: keys.admins,
    queryFn: ({ signal }) => superadmin.get<t.Results<t.SuperAdmin>>('admins/', undefined, signal),
  });
}

export function useAudit(params: t.AuditListParams) {
  return useQuery({
    queryKey: keys.audit(params),
    queryFn: ({ signal }) => superadmin.get<t.Page<t.AuditEntry>>('audit/', { ...params }, signal),
    placeholderData: keepPreviousData,
  });
}

export function useAuditFilters() {
  return useQuery({
    queryKey: keys.auditFilters,
    queryFn: ({ signal }) => superadmin.get<t.AuditFilterOptions>('audit/filters/', undefined, signal),
    staleTime: 60_000,
  });
}

export function useConfigApps(enabled = true) {
  return useQuery({
    queryKey: keys.configApps,
    queryFn: ({ signal }) => superadmin.get<t.Results<t.ConfigApp>>('config/apps/', undefined, signal),
    enabled,
  });
}

export function usePackages(params: t.PackageListParams) {
  return useQuery({
    queryKey: keys.packages(params),
    queryFn: ({ signal }) =>
      superadmin.get<t.Page<t.PackageRow>>('config/packages/', { ...params }, signal),
    placeholderData: keepPreviousData,
  });
}

export function usePackage(id: string) {
  return useQuery({
    queryKey: keys.package(id),
    queryFn: ({ signal }) => superadmin.get<t.PackageDetail>(`config/packages/${enc(id)}/`, undefined, signal),
  });
}

/** Dry run of a new version: no writes, so nothing is invalidated. */
export const usePackagePreview = (id: string) =>
  useMutation({
    mutationFn: (body: t.PackageTermsBody) =>
      superadmin.post<t.PackagePreview>(`config/packages/${enc(id)}/preview/`, body),
  });

export const useCreateInstitution = () =>
  useWrite((body: t.CreateInstitutionBody) =>
    superadmin.post<t.CreateInstitutionResponse>('institutions/', body),
  );

export const useUpdateInstitution = (slug: string) =>
  useWrite((body: t.UpdateInstitutionBody) =>
    superadmin.patch<t.UpdateInstitutionResponse>(`institutions/${enc(slug)}/`, body),
  );

export type InstitutionStatusAction = 'suspend' | 'reactivate' | 'deactivate';

export const useInstitutionStatus = () =>
  useWrite(
    ({ slug, action, body }: { slug: string; action: InstitutionStatusAction; body: t.ReasonBody | t.DeactivateBody }) =>
      superadmin.post<t.InstitutionDetail>(`institutions/${enc(slug)}/${action}/`, body),
  );

export const useImport = (slug: string) =>
  useWrite((body: { rows: t.ImportRowInput[]; dry_run: boolean }) =>
    superadmin.post<t.ImportResponse>(`institutions/${enc(slug)}/import/`, body),
  );

export const useUpdateMembership = () =>
  useWrite(({ id, body }: { id: string; body: t.UpdateMembershipBody }) =>
    superadmin.patch<t.Member>(`memberships/${enc(id)}/`, body),
  );

export const useRemoveMembership = () =>
  useWrite(({ id, reason }: { id: string; reason: string }) =>
    superadmin.post<t.Member>(`memberships/${enc(id)}/remove/`, { reason }),
  );

export const useUpdateUser = () =>
  useWrite(({ id, body }: { id: string; body: t.UpdateUserBody }) =>
    superadmin.patch<t.UserDetail>(`users/${enc(id)}/`, body),
  );

export const useCreateInvitation = () =>
  useWrite((body: t.CreateInvitationBody) =>
    superadmin.post<t.CreateInvitationResponse>('invitations/', body),
  );

export const useResendInvitation = () =>
  useWrite((id: string) =>
    superadmin.post<t.ResendInvitationResponse>(`invitations/${enc(id)}/resend/`),
  );

export const useRevokeInvitation = () =>
  useWrite(({ id, reason }: { id: string; reason?: string }) =>
    superadmin.post<t.RevokeInvitationResponse>(`invitations/${enc(id)}/revoke/`, reason ? { reason } : {}),
  );

export const useResendExpired = () =>
  useWrite((institution?: string) =>
    superadmin.post<t.ResendExpiredResponse>(
      'invitations/resend-expired/',
      institution ? { institution } : {},
    ),
  );

export const useAddAdmin = () =>
  useWrite((body: t.AddAdminBody) => superadmin.post<t.SuperAdmin>('admins/', body));

export const useRemoveAdmin = () =>
  useWrite((userId: string) => superadmin.delete<void>(`admins/${enc(userId)}/`));

export const useUpdateApp = () =>
  useWrite(({ slug, body }: { slug: string; body: t.UpdateAppBody }) =>
    superadmin.patch<t.ConfigApp>(`config/apps/${enc(slug)}/`, body),
  );

export const useCreateFeature = () =>
  useWrite(({ app, body }: { app: string; body: t.CreateFeatureBody }) =>
    superadmin.post<t.Feature>(`config/apps/${enc(app)}/features/`, body),
  );

export const useUpdateFeature = () =>
  useWrite(({ id, body }: { id: string; body: t.UpdateFeatureBody }) =>
    superadmin.patch<t.Feature>(`config/features/${enc(id)}/`, body),
  );

export const useCreatePackage = () =>
  useWrite((body: t.CreatePackageBody) => superadmin.post<t.PackageDetail>('config/packages/', body));

export const useUpdatePackage = (id: string) =>
  useWrite((body: t.UpdatePackageBody) => superadmin.patch<t.PackageDetail>(`config/packages/${enc(id)}/`, body));

export const usePublishVersion = (id: string) =>
  useWrite((body: t.NewVersionBody) =>
    superadmin.post<t.NewVersionResponse>(`config/packages/${enc(id)}/versions/`, body),
  );

export type PackageStatusAction = 'archive' | 'restore';

export const usePackageStatus = (id: string) =>
  useWrite(({ action, reason }: { action: PackageStatusAction; reason: string }) =>
    superadmin.post<t.PackageDetail>(`config/packages/${enc(id)}/${action}/`, { reason }),
  );

export function useBillingSummary(range: t.DateRange) {
  return useQuery({
    queryKey: keys.billingSummary(range),
    queryFn: ({ signal }) => superadmin.get<t.BillingSummary>('billing/summary/', { ...range }, signal),
    placeholderData: keepPreviousData,
  });
}

export function usePayments(params: t.PaymentListParams) {
  return useQuery({
    queryKey: keys.payments(params),
    queryFn: ({ signal }) => superadmin.get<t.Page<t.Payment>>('billing/payments/', { ...params }, signal),
    placeholderData: keepPreviousData,
  });
}

export function usePayment(id: string | null) {
  return useQuery({
    queryKey: keys.payment(id ?? ''),
    queryFn: ({ signal }) => superadmin.get<t.Payment>(`billing/payments/${enc(id ?? '')}/`, undefined, signal),
    enabled: id !== null,
  });
}

export function useQuote(params: t.QuoteParams | null) {
  return useQuery({
    queryKey: keys.quote(params ?? { institution: '', package: '', kind: 'new', periods: 1 }),
    queryFn: ({ signal }) => superadmin.get<t.Quote>('billing/quote/', { ...params }, signal),
    enabled: params !== null,
    retry: false,
  });
}

export function useSubscriptions(params: t.SubscriptionListParams) {
  return useQuery({
    queryKey: keys.subscriptions(params),
    queryFn: ({ signal }) =>
      superadmin.get<t.Page<t.BillingSubscription>>('billing/subscriptions/', { ...params }, signal),
    placeholderData: keepPreviousData,
  });
}

export function useInstitutionBilling(slug: string | null) {
  return useQuery({
    queryKey: keys.institutionBilling(slug ?? ''),
    queryFn: ({ signal }) =>
      superadmin.get<t.InstitutionBilling>(`institutions/${enc(slug ?? '')}/billing/`, undefined, signal),
    enabled: slug !== null,
  });
}

export const useRecordPayment = () =>
  useWrite((body: t.ManualPaymentBody) => superadmin.post<t.Payment>('billing/payments/manual/', body));

export const useVerifyPayment = () =>
  useWrite(({ id, notes }: { id: string; notes?: string }) =>
    superadmin.post<t.Payment>(`billing/payments/${enc(id)}/verify/`, notes ? { notes } : {}),
  );

export const useRejectPayment = () =>
  useWrite(({ id, reason }: { id: string; reason: string }) =>
    superadmin.post<t.Payment>(`billing/payments/${enc(id)}/reject/`, { reason }),
  );

export const useRefundPayment = () =>
  useWrite(({ id, body }: { id: string; body: t.RefundBody }) =>
    superadmin.post<t.Payment>(`billing/payments/${enc(id)}/refund/`, body),
  );

export const useUploadAttachment = () =>
  useWrite(({ id, file }: { id: string; file: File }) =>
    superadmin.upload<t.Payment>(`billing/payments/${enc(id)}/attachment/`, file),
  );

export type SubscriptionAction = 'cancel-scheduled-change' | 'stop-renewal' | 'resume-renewal';

export const useSubscriptionAction = () =>
  useWrite(({ id, action }: { id: string; action: SubscriptionAction }) =>
    superadmin.post<t.BillingSubscription>(`billing/subscriptions/${enc(id)}/${action}/`),
  );
