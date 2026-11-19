/** Request and response shapes of `/api/v1/superadmin/`, exactly as docs/SUPERADMIN_API.md defines them. */

export type ISODate = string;
export type UUID = string;

export interface Page<T> {
  results: T[];
  count: number;
  page: number;
  page_size: number;
}

export interface Results<T> {
  results: T[];
}

export interface ApiErrorBody {
  error: string;
  message?: string;
  fields?: Record<string, string>;
  seats_used?: number;
  seat_cap?: number | null;
  conflicts?: DomainConflict[];
  /** 409 `seats_exceed_package`: seats in use against the package's seat limit. */
  seats?: Seats;
  /** 409 `checkout_in_progress`: the bKash payment already started. */
  payment?: Pick<Payment, 'id' | 'amount' | 'currency' | 'package' | 'status' | 'created_at'>;
  /** 409 `checkout_in_progress`: bKash's page for that payment while bKash still accepts it, else null. */
  redirect_url?: string | null;
}

/** A sign-in domain another institution already lists (409 `domain_taken`). */
export interface DomainConflict {
  domain: string;
  institution: InstitutionRef;
}

export interface Seats {
  used: number;
  cap: number | null;
}

export type InstitutionType = 'university' | 'research' | 'government' | 'school' | 'other';
export type InstitutionSector = 'public' | 'private' | 'other';
export type InstitutionStatus = 'active' | 'suspended' | 'deactivated';
export type Role = 'member' | 'admin' | 'billing' | 'owner';
export type MembershipStatus = 'active' | 'suspended' | 'pending' | 'deprovisioned';
export type UserStatus = 'active' | 'suspended' | 'deactivated';
export type InvitationStatus = 'pending' | 'accepted' | 'revoked' | 'expired';
export type InvitationSource = 'superadmin' | 'portal' | 'import';
/** `institution` = covered by the institution's package; `none` = affiliated only (free tier or a personal plan). */
export type Coverage = 'institution' | 'none';
export type MemberLabel = 'covered' | 'invited' | 'not_covered' | 'personal_plan';

export interface InstitutionRef {
  slug: string;
  name: string;
}

export interface PersonRef {
  id: UUID;
  name: string;
  email: string;
}

export interface SessionUser {
  id: UUID;
  email: string;
  name: string;
  initials: string;
}

export interface Session {
  user: SessionUser;
  roles: string[];
}

/** The role the actor acted in, fixed when the entry was written. */
export type AuditRole = 'superadmin' | 'institution_admin' | 'user' | 'system';

export interface AuditEntry {
  id: UUID;
  action: string;
  target_type: string;
  target_id: string;
  actor: PersonRef | null;
  actor_role: AuditRole;
  metadata: Record<string, unknown>;
  ip_address: string | null;
  created_at: ISODate;
}

export interface DashboardCounts {
  institutions: number;
  active_institutions: number;
  users: number;
  active_users: number;
  pending_invitations: number;
  expired_invitations: number;
  pending_requests: number;
}

export type AttentionItem =
  | { kind: 'seats_near_cap'; institution: InstitutionRef; seats: Seats }
  | { kind: 'expired_invitations'; count: number }
  | { kind: 'pending_requests'; institution: InstitutionRef; count: number };

export interface RecentInstitution extends InstitutionRef {
  created_at: ISODate;
  seats: Seats;
}

export interface Dashboard {
  counts: DashboardCounts;
  attention: AttentionItem[];
  recent_institutions: RecentInstitution[];
  recent_activity: AuditEntry[];
}

export interface InstitutionListItem {
  id: UUID;
  slug: string;
  name: string;
  type: InstitutionType;
  sector: InstitutionSector | '';
  status: InstitutionStatus;
  seats: Seats;
  admins: PersonRef[];
  members_count: number;
  pending_invitations: number;
  pending_requests: number;
  created_at: ISODate;
}

export interface InstitutionOption {
  slug: string;
  name: string;
  status: InstitutionStatus;
  seats: Seats;
}

export interface InstitutionAdmin {
  membership_id: UUID;
  user_id: UUID;
  name: string;
  email: string;
  role: Role;
}

export interface InstitutionCounts {
  members: number;
  active: number;
  suspended: number;
  pending_invitations: number;
  expired_invitations: number;
  pending_requests: number;
  not_covered: number;
  personal_plan: number;
}

export interface InstitutionDetail {
  id: UUID;
  slug: string;
  name: string;
  type: InstitutionType;
  sector: InstitutionSector | '';
  status: InstitutionStatus;
  timezone: string;
  contact_email: string;
  sign_in_domains: string[];
  seats: Seats;
  seat_cap_reason: string;
  counts: InstitutionCounts;
  admins: InstitutionAdmin[];
  created_at: ISODate;
  updated_at: ISODate;
}

/** A BdREN full member offered as a suggestion when creating an institution. */
export interface DirectoryEntry {
  name: string;
  short_name: string;
  sector: InstitutionSector;
  suggested_slug: string;
  offices: string[];
}

export interface InstitutionFields {
  name: string;
  slug: string;
  type: InstitutionType;
  sector: InstitutionSector | '';
  timezone: string;
  contact_email: string;
  sign_in_domains: string[];
  seat_cap: number | null;
}

export interface CreateInstitutionBody extends InstitutionFields {
  admin?: { email: string; name: string };
}

export interface CreateInstitutionResponse {
  institution: InstitutionDetail;
  invitation: Invitation | null;
  email_sent: boolean;
}

export interface UpdateInstitutionBody {
  name?: string;
  type?: InstitutionType;
  sector?: InstitutionSector | '';
  timezone?: string;
  contact_email?: string;
  sign_in_domains?: string[];
  seat_cap?: number | null;
  reason?: string;
}

export type UpdateInstitutionResponse = InstitutionDetail & { warning?: 'over_cap' };

export interface ReasonBody {
  reason: string;
}

export interface DeactivateBody extends ReasonBody {
  confirm: string;
}

export interface Member {
  membership_id: UUID;
  user: PersonRef & { status: UserStatus };
  role: Role;
  status: MembershipStatus;
  coverage: Coverage;
  /** null for pending sign-up requests and removed memberships. */
  label: MemberLabel | null;
  joined_at: ISODate | null;
}

/** Rows as read from the CSV; the server validates `role` and answers `bad_role` per row. */
export interface ImportRowInput {
  email: string;
  name: string;
  role: string;
}

export type ImportRowStatus = 'ok' | 'error' | 'skip';
export type ImportReason =
  | 'invalid_email'
  | 'duplicate_in_file'
  | 'already_member'
  | 'already_invited'
  | 'member_of_other_institution'
  | 'bad_role'
  | 'over_cap';

/** What the real run does with an `ok` row: invite, cover an affiliated free-tier member, or invite a personal-plan member for consent. */
export type ImportAction = 'invite' | 'cover' | 'consent_invite';

export interface ImportRowResult {
  index: number;
  email: string;
  status: ImportRowStatus;
  reason?: ImportReason | null;
  action?: ImportAction | null;
}

export interface ImportResponse {
  rows: ImportRowResult[];
  summary: { ok: number; error: number; skip: number; fits: number; actions?: Record<ImportAction, number>; seats: Seats };
  created: number;
  covered?: number;
  email_failures: number;
  email_queued: number;
}

export interface UpdateMembershipBody {
  role?: Role;
  status?: 'active' | 'suspended';
  reason?: string;
  force?: boolean;
}

export interface UserMembership {
  membership_id: UUID;
  institution: InstitutionRef;
  role: Role;
  status: MembershipStatus;
  coverage: Coverage;
  /** Same as `Member.label`; null for pending sign-up requests and removed memberships. */
  label: MemberLabel | null;
}

export interface UserListItem {
  id: UUID;
  name: string;
  email: string;
  email_verified: boolean;
  status: UserStatus;
  created_at: ISODate;
  last_login_at: ISODate | null;
  memberships: UserMembership[];
  is_superadmin: boolean;
}

export interface ExternalIdentity {
  issuer: string;
  subject: string;
  provider_type: string;
  created_at: ISODate;
}

export interface UserDetail extends UserListItem {
  zitadel_subject: string | null;
  issuer: string | null;
  external_identities: ExternalIdentity[];
  recent_activity: AuditEntry[];
}

export interface UpdateUserBody {
  status: 'active' | 'suspended';
  reason: string;
}

export interface Invitation {
  id: UUID;
  email: string;
  name: string;
  institution: InstitutionRef | null;
  /** null for an individual (no institution) invitation. */
  role: Role | null;
  status: InvitationStatus;
  source: InvitationSource;
  invited_by: PersonRef | null;
  expires_at: ISODate;
  created_at: ISODate;
  last_sent_at: ISODate;
  sent_count: number;
  email_status: 'queued' | 'sending' | 'sent' | 'failed';
  accepted_by: PersonRef | null;
  accepted_at: ISODate | null;
}

export type CreateInvitationBody =
  | { institution: string; email: string; name: string; role: Role }
  | { new_institution: InstitutionFields; email: string; name: string; role: Role }
  | { institution: null; email: string; name: string };

export interface CreateInvitationResponse {
  /** `covered`: the email belonged to an affiliated free-tier member, who was added to the package at once (no invitation). */
  outcome: 'invited' | 'covered';
  invitation: Invitation | null;
  member: Member | null;
  institution: InstitutionDetail | null;
  email_sent: boolean;
  warning?: 'institution_suspended';
}

export interface ResendInvitationResponse {
  invitation: Invitation;
  email_sent: boolean;
}

export interface RevokeInvitationResponse {
  invitation: Invitation;
}

export interface ResendExpiredResponse {
  resent: number;
  email_failures: number;
  email_queued: number;
}

export interface SuperAdmin {
  user: PersonRef & { status: UserStatus };
  granted_at: ISODate;
}

export type AddAdminBody = { user_id: UUID } | { email: string };

export interface ListParams {
  q?: string;
  page?: number;
  page_size?: number;
}

export interface InstitutionListParams extends ListParams {
  status?: InstitutionStatus;
}

export interface MemberListParams extends ListParams {
  status?: MembershipStatus;
  role?: Role;
  coverage?: Coverage;
  label?: MemberLabel;
}

export interface UserListParams extends ListParams {
  status?: UserStatus;
  institution?: string;
  role?: Role;
}

export interface InvitationListParams extends ListParams {
  status?: InvitationStatus;
  institution?: string;
}

/** GET audit/filters/: the values the audit page's dropdowns offer. */
export interface AuditFilterOptions {
  actions: string[];
  target_types: string[];
  roles: { value: AuditRole; label: string }[];
}

export interface AuditListParams extends ListParams {
  action?: string;
  role?: AuditRole;
  actor?: UUID;
  target_type?: string;
  target_id?: string;
  from?: string;
  to?: string;
}

export type AppStatus = 'active' | 'inactive' | 'archived';
export type FeatureStatus = 'active' | 'inactive';
export type QuotaPolicy = 'personal_only' | 'organization_only' | 'personal_then_org' | 'org_then_personal' | 'both';
export type PackageKind = 'single' | 'bundle';
export type PackageStatus = 'active' | 'inactive' | 'archived';
export type BillingInterval = 'monthly' | 'yearly' | 'free';
export type PriceUnit = 'per_seat' | 'per_institution' | 'flat';
export type LimitPeriod = 'daily' | 'weekly' | 'monthly' | 'yearly' | 'lifetime';
export type OnLimit = 'block' | 'warn';
export type MigrationPolicy = 'new_only' | 'immediate' | 'on_renewal' | 'selected_only';

export interface AppRef {
  slug: string;
  name: string;
}

export interface Feature {
  id: UUID;
  key: string;
  name: string;
  unit: string;
  description: string;
  quota_policy: QuotaPolicy;
  status: FeatureStatus;
  in_use: boolean;
}

export interface ConfigApp extends AppRef {
  id: UUID;
  description: string;
  status: AppStatus;
  sort_order: number;
  features: Feature[];
  packages: { single: number; bundle: number };
}

export interface UpdateAppBody {
  name?: string;
  description?: string;
  status?: AppStatus;
  sort_order?: number;
}

export interface CreateFeatureBody {
  key: string;
  name: string;
  unit: string;
  description?: string;
  quota_policy?: QuotaPolicy;
}

export interface UpdateFeatureBody {
  key?: string;
  name?: string;
  unit?: string;
  description?: string;
  quota_policy?: QuotaPolicy;
  status?: FeatureStatus;
}

/** The commercial terms a package version snapshots; changing any of them needs a new version. */
export interface PackageTerms {
  price: string;
  currency: string;
  billing_interval: BillingInterval;
  price_unit: PriceUnit;
  trial_days: number;
  seat_limit: number | null;
}

export interface PackagePresentation {
  name: string;
  description: string;
  audience: string;
  is_public: boolean;
  highlight: boolean;
  sort_order: number;
}

export interface PackageRow extends PackageTerms {
  id: UUID;
  kind: PackageKind;
  name: string;
  slug: string;
  status: PackageStatus;
  audience: string;
  is_public: boolean;
  highlight: boolean;
  sort_order: number;
  apps: AppRef[];
  current_version: number;
  subscribers: number;
  updated_at: ISODate;
}

export interface LimitTerms {
  limit_value: number;
  limit_period: LimitPeriod;
  on_limit: OnLimit;
}

export interface LimitFeature {
  id: UUID;
  key: string;
  name: string;
  unit: string;
  app: AppRef;
}

export interface PackageLimit extends LimitTerms {
  feature: LimitFeature;
}

export interface LimitInput extends LimitTerms {
  feature_id: UUID;
}

export interface PackageVersion extends Omit<PackageTerms, 'currency'> {
  version: number;
  created_at: ISODate;
  created_by: PersonRef | null;
  change_reason: string;
  migration_policy: MigrationPolicy;
  apps: AppRef[];
  limits: PackageLimit[];
  subscribers: number;
}

export interface PackageDetail extends PackageRow {
  description: string;
  limits: PackageLimit[];
  versions: PackageVersion[];
}

/** Commercial part of a package draft: what preview and new-version bodies carry. */
export interface PackageTermsBody extends PackageTerms {
  /** Bundles only: the slugs of the included apps. */
  apps?: string[];
  limits: LimitInput[];
}

export interface CreatePackageBody extends PackageTermsBody, PackagePresentation {
  kind: PackageKind;
  slug: string;
  /** Singles only: the slug of the package's app. */
  app?: string;
}

export type UpdatePackageBody = Partial<PackagePresentation>;

export type ScalarField = 'price' | 'currency' | 'billing_interval' | 'price_unit' | 'trial_days' | 'seat_limit';

export type PackageChange =
  | { field: ScalarField; from: string | number | null; to: string | number | null }
  | { field: 'limit'; feature: LimitFeature; from: LimitTerms | null; to: LimitTerms | null }
  | { field: 'apps'; added: AppRef[]; removed: AppRef[] };

/** The holder of a live subscription: an institution, or (slug null) a personal account named by its owner. */
export interface AffectedInstitution {
  slug: string | null;
  name: string;
  subscription_id: UUID;
  status: 'active' | 'trial';
}

export interface PackagePreview {
  changes: PackageChange[];
  affected: { subscriptions: number; institutions: AffectedInstitution[] };
}

export interface NewVersionBody extends PackageTermsBody {
  change_reason: string;
  migration_policy: MigrationPolicy;
  selected_subscriptions?: UUID[];
}

export interface NewVersionResponse {
  package: PackageDetail;
  migrated: number;
  scheduled: number;
}

export interface PackageListParams extends ListParams {
  kind?: PackageKind;
  app?: string;
  status?: PackageStatus;
}

/* Billing and subscriptions (docs/BILLING_API.md, "Superadmin API"). */

export type PurchaseKind = 'new' | 'renew' | 'upgrade';
export type PaymentKind = PurchaseKind | 'legacy';
export type PaymentMethod = 'bkash' | 'bank_transfer' | 'cheque' | 'cash' | 'bkash_manual' | 'other';
export type ManualMethod = Exclude<PaymentMethod, 'bkash'>;
export type PaymentStatus =
  | 'pending'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'rejected'
  | 'refunded'
  | 'partially_refunded';
export type RefundMethod = 'bkash' | 'manual';
export type BkashMode = 'sandbox' | 'live' | 'off';
export type PaymentTab = 'all' | 'bkash' | 'manual' | 'attention';
export type SubscriptionStatus = 'active' | 'trial' | 'past_due' | 'cancelled' | 'expired';

export interface PackageRef {
  id: UUID;
  name: string;
  kind: PackageKind;
}

export interface Refund {
  id: UUID;
  amount: string;
  reason: string;
  method: RefundMethod;
  bkash_refund_trx_id: string | null;
  status: 'completed' | 'failed';
  created_by: PersonRef | null;
  created_at: ISODate;
}

export interface BkashDetails {
  payment_id: string | null;
  trx_id: string | null;
  payer_account: string | null;
  status: string | null;
}

export interface Payment {
  id: UUID;
  receipt_number: string | null;
  institution: InstitutionRef | null;
  account_id: UUID;
  package: PackageRef | null;
  package_version: number | null;
  kind: PaymentKind;
  method: PaymentMethod;
  status: PaymentStatus;
  amount: string;
  currency: string;
  periods: number;
  period_start: ISODate | null;
  period_end: ISODate | null;
  reference: string;
  payer_name: string;
  payment_date: ISODate | null;
  notes: string;
  has_attachment: boolean;
  bkash: BkashDetails | null;
  failure_reason: string;
  refunded_amount: string;
  refunds: Refund[];
  recorded_by: PersonRef | null;
  verified_by: PersonRef | null;
  verified_at: ISODate | null;
  completed_at: ISODate | null;
  created_at: ISODate;
}

export interface BillingTotals {
  collected: string;
  bkash: string;
  manual: string;
  refunds: string;
  pending: number;
  failed: number;
}

export interface BillingSummary extends BillingTotals {
  previous: BillingTotals;
  bkash_mode: BkashMode;
}

export interface DateRange {
  from: string;
  to: string;
}

export interface PaymentListParams extends ListParams, Partial<DateRange> {
  status?: PaymentStatus;
  method?: 'bkash' | 'manual';
  institution?: string;
  package?: UUID;
  tab?: PaymentTab;
}

export interface QuoteParams {
  institution: string;
  package: UUID;
  kind: PurchaseKind;
  periods: number;
}

export interface Quote {
  package_version: number;
  amount: string;
  currency: string;
  periods: number;
  period_start: ISODate;
  period_end: ISODate;
  kind: PurchaseKind;
}

export interface ManualPaymentBody {
  institution: string;
  package: UUID;
  kind: PurchaseKind;
  periods: number;
  /** null takes the start from the quote. */
  period_start: string | null;
  amount: string;
  method: ManualMethod;
  reference: string;
  payer_name: string;
  payment_date: string;
  notes: string;
  pending: boolean;
}

export interface RefundBody {
  amount: string;
  reason: string;
  end_subscription: boolean;
}

export interface BillingSubscription {
  id: UUID;
  institution: InstitutionRef | null;
  package: PackageRef;
  version: number;
  apps: AppRef[];
  status: SubscriptionStatus;
  starts_at: ISODate;
  expires_at: ISODate | null;
  auto_renew: boolean;
  scheduled_package: { id: UUID; name: string } | null;
  last_payment: { id: UUID; method: PaymentMethod; completed_at: ISODate | null } | null;
}

export interface SubscriptionListParams extends ListParams {
  status?: SubscriptionStatus;
  institution?: string;
  package?: UUID;
  expiring_within?: number;
  scheduled?: 1;
  /** Not in the contract's list of filters yet; the Stopped renewal view sends it and also filters the page. */
  auto_renew?: 'false';
}

/** Something the institution can pay for now (renewal, upgrade or first package), with its price quote. */
export interface BillingOffer {
  package: PackageRef & { audience: string; apps: AppRef[] };
  kind: PurchaseKind;
  quote: Quote;
}

export interface InstitutionBilling {
  subscriptions: BillingSubscription[];
  payments: Payment[];
  offers: BillingOffer[];
}
