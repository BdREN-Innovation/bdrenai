/** Shapes of the institution-admin portal API `/api/v1/portal/` (docs/SUPERADMIN_API.md, "Portal API"). */
import type {
  AppRef,
  BillingInterval,
  BillingSubscription,
  ISODate,
  Invitation,
  InstitutionCounts,
  Member,
  PackageRef,
  Page,
  Payment,
  PersonRef,
  PurchaseKind,
  Quote,
  Refund,
  Role,
  Seats,
  UUID,
} from '@/api/types';

export type PortalRole = 'member' | 'admin';
export type MemberTab = 'covered' | 'not_covered' | 'personal_plan';
export type TabCounts = Record<MemberTab, number>;

/** An institution the signed-in user administers; suspended ones are listed so the console can explain them. */
export interface AdminInstitution {
  slug: string;
  name: string;
  status: 'active' | 'suspended';
  seats: Seats;
  role: Role;
}

export interface PortalInstitution {
  slug: string;
  name: string;
  seats: Seats;
  counts: InstitutionCounts;
  sign_in_domains: string[];
}

/** A Members list page also counts each tab's members for the current search. */
export interface MembersPage<T> extends Page<T> {
  tabs: TabCounts;
}

/** All an institution admin may see of someone who pays for their own plan (R2). */
export interface PersonalPlanMember {
  membership_id: UUID;
  user: { name: string; email: string };
  label: 'personal_plan' | 'invited';
  joined_at: ISODate | null;
}

/** The portal's invitations carry no inviter email. */
export interface PortalInvitation extends Omit<Invitation, 'invited_by'> {
  invited_by: Omit<PersonRef, 'email'> | null;
}

export interface InviteResult {
  outcome: 'invited' | 'covered';
  invitation: PortalInvitation | null;
  member: Member | null;
  email_sent: boolean;
}

export interface CoverResult {
  member: Member;
  email_sent: boolean;
}

export interface ResendResult {
  invitation: PortalInvitation;
  email_sent?: boolean;
}

export interface ProductRef {
  slug: string;
  name: string;
}

export interface UsageMetrics {
  quantity: number;
  requests: number;
  members_with_usage: number;
  features_used: number;
}

export type UsageMetric = keyof UsageMetrics;

export interface UsageSummary extends UsageMetrics {
  start_day: string;
  end_day: string;
  previous: UsageMetrics & { start_day: string; end_day: string };
  /** Percent change from `previous`; null when the previous value was 0. */
  change: Record<UsageMetric, number | null>;
}

export interface UsageRange {
  start: string;
  end: string;
  days: number;
  timezone: string;
}

export interface UsageDay {
  day: string;
  quantity: number;
  requests: number;
  quantity_avg_7d: number;
}

export interface UsageProduct {
  product_id: UUID;
  product_slug: string;
  product_name: string;
  quantity: number;
  requests: number;
}

export interface UsageFeature {
  product_id: UUID;
  feature_id: UUID;
  product_slug: string;
  feature_key: string;
  feature_name: string;
  unit: string;
  quantity: number;
  requests: number;
  share: number;
}

/** `membership_id`, `coverage` and `label` are null for someone who has left the institution. */
export interface UsageMember {
  user: { id: UUID; name: string; email: string };
  membership_id: UUID | null;
  coverage: Member['coverage'] | null;
  label: Member['label'];
  quantity: number;
  requests: number;
  last_used: string | null;
}

export interface UsageReport {
  range: UsageRange;
  product: ProductRef | null;
  summary: UsageSummary;
  by_product: UsageProduct[];
  by_day: UsageDay[];
  by_feature: UsageFeature[];
  members: { results: UsageMember[]; total: number; limit: number; offset: number };
}

export interface UsageParams {
  start: string;
  end: string;
  product: string;
}

export interface DashboardPackage {
  subscription_id: UUID;
  product: ProductRef;
  package: { name: string; version: number };
  status: 'active' | 'trial' | 'past_due';
  billing_interval: string;
  starts_at: ISODate | null;
  expires_at: ISODate | null;
  auto_renew: boolean;
  days_left: number | null;
  expires_soon: boolean;
}

export interface DashboardData {
  slug: string;
  name: string;
  seats: Seats;
  counts: {
    covered_active: number;
    covered_suspended: number;
    not_covered: number;
    personal_plan: number;
    pending_invitations: number;
    expired_invitations: number;
  };
  product: ProductRef | null;
  usage: { range: UsageRange; summary: UsageSummary; by_day: UsageDay[]; top_members: UsageMember[] } | null;
  packages: DashboardPackage[];
}

export interface DomainsReport {
  domains: { domain: string; confirmed_members: number }[];
  confirmed_members: number;
  other_domains: number;
}

/** The parts of `GET /api/v1/auth/profile/` the console uses. */
export interface Profile {
  id: UUID;
  name: string;
  email: string;
  is_superadmin: boolean;
}

export interface CatalogProduct {
  slug: string;
  name: string;
}

/* Billing (docs/BILLING_API.md, "Portal API additions" and "Portal errors and shapes"). */

/** The portal's payments name people without their email and leave out who made a refund. */
export interface PortalPayment extends Omit<Payment, 'recorded_by' | 'verified_by' | 'refunds'> {
  recorded_by: { name: string } | null;
  verified_by: { name: string } | null;
  refunds: Omit<Refund, 'created_by'>[];
}

export interface OfferedPackage extends PackageRef {
  audience: string;
  apps: AppRef[];
}

/** Something the institution can pay for now: a renewal, an upgrade, or a first package. */
export interface Offer {
  package: OfferedPackage;
  kind: PurchaseKind;
  quote: Quote;
}

/** A cheaper package a renewing subscription can move to at its next renewal. */
export interface DowngradeOption {
  subscription_id: UUID;
  package: OfferedPackage;
  amount: string;
  currency: string;
  billing_interval: Exclude<BillingInterval, 'free'>;
  seat_limit: number | null;
}

export interface PortalBilling {
  subscriptions: BillingSubscription[];
  payments: PortalPayment[];
  bkash_enabled: boolean;
  offers: Offer[];
  downgrades: DowngradeOption[];
}

/** `redirect_url` is null when the payment was abandoned while checkout was still creating it at bKash. */
export interface CheckoutResult {
  payment: PortalPayment;
  redirect_url: string | null;
}

/** What abandoning a pending bKash payment did: bKash had the money (`completed`), or it was closed. */
export type AbandonOutcome = 'completed' | 'cancelled' | 'failed';

export interface AbandonResult {
  payment: PortalPayment;
  result: AbandonOutcome;
}

/** Where the bKash callback sends the browser back: `?payment=<id>&result=…`. */
export type PaymentResult = 'success' | 'failed' | 'cancelled' | 'pending';

export interface BillingSearch {
  payment?: string;
  result?: PaymentResult;
}
