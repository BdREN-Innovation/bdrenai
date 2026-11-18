import type {
  AppStatus,
  BillingInterval,
  FeatureStatus,
  InstitutionSector,
  InstitutionType,
  LimitPeriod,
  MigrationPolicy,
  OnLimit,
  PackageKind,
  PackageStatus,
  PriceUnit,
  QuotaPolicy,
  Role,
} from '@/api/types';

export const INSTITUTION_TYPES: { value: InstitutionType; label: string }[] = [
  { value: 'university', label: 'University' },
  { value: 'research', label: 'Research institute' },
  { value: 'government', label: 'Government' },
  { value: 'school', label: 'School' },
  { value: 'other', label: 'Other' },
];

export const ROLES: { value: Role; label: string }[] = [
  { value: 'member', label: 'Member' },
  { value: 'admin', label: 'Admin' },
  { value: 'billing', label: 'Billing' },
  { value: 'owner', label: 'Owner' },
];

export const ROLE_LABEL: Record<Role, string> = Object.fromEntries(
  ROLES.map((role) => [role.value, role.label]),
) as Record<Role, string>;

export const SECTORS: { value: InstitutionSector; label: string }[] = [
  { value: 'public', label: 'Public' },
  { value: 'private', label: 'Private' },
  { value: 'other', label: 'Other' },
];

export const SECTOR_LABEL: Record<InstitutionSector, string> = { public: 'Public', private: 'Private', other: 'Other' };

export const TYPE_LABEL: Record<InstitutionType, string> = Object.fromEntries(
  INSTITUTION_TYPES.map((type) => [type.value, type.label]),
) as Record<InstitutionType, string>;

export const IMPORT_REASON_LABEL: Record<string, string> = {
  invalid_email: 'Invalid email',
  duplicate_in_file: 'Duplicate in file',
  already_member: 'Already a member',
  already_invited: 'Already invited',
  bad_role: 'Unknown role',
  over_cap: 'Over the seat cap',
  domain_not_allowed: 'Domain not allowed',
};

export const DEFAULT_TIMEZONE = 'Asia/Dhaka';

export function timezones(): string[] {
  const supported =
    typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
  return supported.includes(DEFAULT_TIMEZONE) ? supported : [DEFAULT_TIMEZONE, ...supported];
}

export interface Option<T extends string> {
  value: T;
  label: string;
}

const labelsOf = <T extends string>(options: Option<T>[]) =>
  Object.fromEntries(options.map((option) => [option.value, option.label])) as Record<T, string>;

export const PACKAGE_KIND_LABEL: Record<PackageKind, string> = { bundle: 'Combined', single: 'Single' };

export const PACKAGE_STATUSES: Option<PackageStatus>[] = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'archived', label: 'Archived' },
];

export const APP_STATUSES: Option<AppStatus>[] = PACKAGE_STATUSES;

export const FEATURE_STATUSES: Option<FeatureStatus>[] = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
];

export const BILLING_INTERVALS: Option<BillingInterval>[] = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly', label: 'Yearly' },
  { value: 'free', label: 'Free' },
];

export const PRICE_UNITS: Option<PriceUnit>[] = [
  { value: 'per_seat', label: 'Per seat' },
  { value: 'per_institution', label: 'Per institution' },
  { value: 'flat', label: 'Flat' },
];

export const LIMIT_PERIODS: Option<LimitPeriod>[] = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly', label: 'Yearly' },
  { value: 'lifetime', label: 'Lifetime' },
];

export const ON_LIMIT: Option<OnLimit>[] = [
  { value: 'block', label: 'Block' },
  { value: 'warn', label: 'Warn only' },
];

export const QUOTA_POLICIES: Option<QuotaPolicy>[] = [
  { value: 'personal_then_org', label: 'Personal, then institution' },
  { value: 'org_then_personal', label: 'Institution, then personal' },
  { value: 'personal_only', label: 'Personal only' },
  { value: 'organization_only', label: 'Institution only' },
  { value: 'both', label: 'Both' },
];

export const MIGRATION_POLICIES: (Option<MigrationPolicy> & { sentence: string })[] = [
  {
    value: 'new_only',
    label: 'New subscribers only',
    sentence: 'Institutions already subscribed keep their current version; only new subscriptions get this one.',
  },
  {
    value: 'immediate',
    label: 'Immediately',
    sentence: 'Every affected institution moves to this version as soon as you publish.',
  },
  {
    value: 'on_renewal',
    label: 'At renewal',
    sentence: 'Each affected institution moves to this version when its current period renews.',
  },
  {
    value: 'selected_only',
    label: 'Selected institutions',
    sentence: 'Only the institutions you tick below move now; the rest keep their current version.',
  },
];

export const PRICE_UNIT_LABEL = labelsOf(PRICE_UNITS);
export const PERIOD_LABEL = labelsOf(LIMIT_PERIODS);
export const ON_LIMIT_LABEL = labelsOf(ON_LIMIT);
export const QUOTA_POLICY_LABEL = labelsOf(QUOTA_POLICIES);
export const INTERVAL_LABEL = labelsOf(BILLING_INTERVALS);
export const MIGRATION_LABEL = labelsOf(MIGRATION_POLICIES);
