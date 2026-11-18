import type { InstitutionSector, InstitutionType, Role } from '@/api/types';

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
