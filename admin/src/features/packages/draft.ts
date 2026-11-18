import type {
  BillingInterval,
  ConfigApp,
  CreatePackageBody,
  LimitPeriod,
  OnLimit,
  PackageDetail,
  PackageKind,
  PackageTermsBody,
  PriceUnit,
} from '@/api/types';
import { ORDER_ERROR, isOrder, parseOrder } from '@/lib/order';
import { SLUG_PATTERN } from '@/lib/slug';

export interface LimitRow {
  /** Local row id, stable across edits. */
  key: string;
  app: string;
  feature_id: string;
  limit_value: string;
  limit_period: LimitPeriod;
  on_limit: OnLimit;
}

/** The presentation fields as typed into a form; shared by the editor and Edit details. */
export interface PresentationValues {
  name: string;
  description: string;
  audience: string;
  is_public: boolean;
  highlight: boolean;
  sort_order: string;
}

export interface PackageDraft extends PresentationValues {
  kind: PackageKind;
  app: string;
  apps: string[];
  slug: string;
  slugEdited: boolean;
  price: string;
  currency: string;
  billing_interval: BillingInterval;
  price_unit: PriceUnit;
  trial_days: string;
  seat_limit: string;
  limits: LimitRow[];
}

export type DraftErrors = Record<string, string>;

let rowCounter = 0;
export const newRowKey = () => `row-${++rowCounter}`;

export type LimitField = 'feature_id' | 'limit_value' | 'limit_period' | 'on_limit';

const LIMIT_FIELDS: readonly LimitField[] = ['feature_id', 'limit_value', 'limit_period', 'on_limit'];

/** The error key of one control in a limit row. */
export const limitError = (rowKey: string, field: LimitField) => `limit.${rowKey}.${field}`;

const SERVER_LIMIT = /^limits\.(\d+)\.(\w+)$/;
const isLimitField = (value: string): value is LimitField => (LIMIT_FIELDS as readonly string[]).includes(value);

/**
 * Server errors keyed by the editor's own keys: `limits.<index>.<field>` becomes the error of that row's control.
 * `rowKeys` are the keys of the rows in the order they were sent, so later edits cannot shift an error to another row.
 */
export function draftServerErrors(fields: DraftErrors, rowKeys: string[]): DraftErrors {
  return Object.fromEntries(
    Object.entries(fields).map(([key, message]) => {
      const match = SERVER_LIMIT.exec(key);
      const rowKey = match ? rowKeys[Number(match[1])] : undefined;
      return [match && rowKey && isLimitField(match[2]) ? limitError(rowKey, match[2]) : key, message];
    }),
  );
}

export function emptyDraft(kind: PackageKind, apps: ConfigApp[]): PackageDraft {
  const firstActive = apps.find((app) => app.status === 'active');
  return {
    kind,
    app: kind === 'single' ? (firstActive?.slug ?? '') : '',
    apps: [],
    name: '',
    slug: '',
    slugEdited: false,
    description: '',
    audience: '',
    is_public: true,
    highlight: false,
    sort_order: '0',
    price: '',
    currency: 'BDT',
    billing_interval: 'monthly',
    price_unit: 'per_seat',
    trial_days: '0',
    seat_limit: '',
    limits: [],
  };
}

/** The editor's starting point for a new version: the current published terms. */
export function draftFromPackage(pkg: PackageDetail): PackageDraft {
  const slugs = pkg.apps.map((app) => app.slug);
  return {
    kind: pkg.kind,
    app: pkg.kind === 'single' ? (slugs[0] ?? '') : '',
    apps: pkg.kind === 'bundle' ? slugs : [],
    name: pkg.name,
    slug: pkg.slug,
    slugEdited: true,
    description: pkg.description,
    audience: pkg.audience,
    is_public: pkg.is_public,
    highlight: pkg.highlight,
    sort_order: String(pkg.sort_order),
    price: pkg.billing_interval === 'free' ? '' : String(Number(pkg.price)),
    currency: pkg.currency,
    billing_interval: pkg.billing_interval,
    price_unit: pkg.price_unit,
    trial_days: String(pkg.trial_days),
    seat_limit: pkg.seat_limit === null ? '' : String(pkg.seat_limit),
    limits: pkg.limits.map((limit) => ({
      key: newRowKey(),
      app: limit.feature.app.slug,
      feature_id: limit.feature.id,
      limit_value: String(limit.limit_value),
      limit_period: limit.limit_period,
      on_limit: limit.on_limit,
    })),
  };
}

export const includedApps = (draft: PackageDraft): string[] =>
  draft.kind === 'single' ? (draft.app ? [draft.app] : []) : draft.apps;

/** Changing the included apps drops limit rows of apps that left the package. */
export function withApps(draft: PackageDraft, change: Pick<PackageDraft, 'app'> | Pick<PackageDraft, 'apps'>): PackageDraft {
  const next = { ...draft, ...change };
  const keep = new Set(includedApps(next));
  return { ...next, limits: next.limits.filter((row) => keep.has(row.app)) };
}

const PRICE = /^\d+(\.\d{1,2})?$/;
const WHOLE = /^\d+$/;
/** The largest limit the server accepts (`MAX_LIMIT`). */
const MAX_LIMIT = 10 ** 15;

/** A paid price: up to two decimals and above 0. */
export const isPrice = (value: string) => PRICE.test(value.trim()) && Number(value) > 0;

function termsErrors(draft: PackageDraft): DraftErrors {
  const errors: DraftErrors = {};
  if (draft.kind === 'single' && !draft.app) errors.app = 'Choose the app this package is for.';
  if (draft.kind === 'bundle' && draft.apps.length < 2) errors.apps = 'Pick at least two apps for a combined package.';
  if (draft.billing_interval !== 'free' && !isPrice(draft.price)) {
    errors.price = 'Enter a price above 0, like 1500 or 1500.50. Choose Free for no charge.';
  }
  if (!WHOLE.test(draft.trial_days.trim() || '0')) errors.trial_days = 'Enter a whole number of days (0 for no trial).';
  const seats = draft.seat_limit.trim();
  if (seats && !(WHOLE.test(seats) && Number(seats) >= 1)) errors.seat_limit = 'Enter a whole number of at least 1, or leave blank for no limit.';
  for (const row of draft.limits) {
    const value = row.limit_value.trim();
    if (!row.feature_id) errors[limitError(row.key, 'feature_id')] = 'Choose a feature.';
    if (!WHOLE.test(value)) errors[limitError(row.key, 'limit_value')] = 'Enter a whole number, 0 or more.';
    else if (Number(value) > MAX_LIMIT) errors[limitError(row.key, 'limit_value')] = 'Enter at most 1,000,000,000,000,000.';
  }
  return errors;
}

export function presentationErrors(values: PresentationValues): DraftErrors {
  const errors: DraftErrors = {};
  if (!values.name.trim()) errors.name = 'Enter the package name.';
  if (!isOrder(values.sort_order)) errors.sort_order = ORDER_ERROR;
  return errors;
}

export function termsBody(draft: PackageDraft): PackageTermsBody {
  const seats = draft.seat_limit.trim();
  return {
    price: draft.billing_interval === 'free' ? '0.00' : Number(draft.price).toFixed(2),
    currency: draft.currency,
    billing_interval: draft.billing_interval,
    price_unit: draft.price_unit,
    trial_days: Number(draft.trial_days.trim() || '0'),
    seat_limit: seats ? Number(seats) : null,
    ...(draft.kind === 'bundle' ? { apps: draft.apps } : {}),
    limits: draft.limits.map((row) => ({
      feature_id: row.feature_id,
      limit_value: Number(row.limit_value),
      limit_period: row.limit_period,
      on_limit: row.on_limit,
    })),
  };
}

export function validateTerms(draft: PackageDraft): { errors: DraftErrors; body: PackageTermsBody | null } {
  const errors = termsErrors(draft);
  return { errors, body: Object.keys(errors).length === 0 ? termsBody(draft) : null };
}

export function validateCreate(draft: PackageDraft): { errors: DraftErrors; body: CreatePackageBody | null } {
  const errors = {
    ...presentationErrors(draft),
    ...(SLUG_PATTERN.test(draft.slug) ? {} : { slug: 'Use 2–64 lowercase letters, numbers and hyphens.' }),
    ...termsErrors(draft),
  };
  if (Object.keys(errors).length > 0) return { errors, body: null };
  return {
    errors,
    body: {
      kind: draft.kind,
      ...(draft.kind === 'single' ? { app: draft.app } : {}),
      name: draft.name.trim(),
      slug: draft.slug,
      description: draft.description.trim(),
      audience: draft.audience.trim(),
      is_public: draft.is_public,
      highlight: draft.highlight,
      sort_order: parseOrder(draft.sort_order),
      ...termsBody(draft),
    },
  };
}
