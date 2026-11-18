import { EyeOff, Globe, Star } from 'lucide-react';
import type { AppRef, ConfigApp, PackageRow } from '@/api/types';
import type { PriceTerms } from '@/lib/format';
import { formatCadence, formatMoney, formatNumber } from '@/lib/format';
import { Chip } from '@/components/ui';

/** True when a combined package includes every active app, so it reads "All apps". */
export function coversAllApps(apps: AppRef[], catalog: ConfigApp[]): boolean {
  const included = new Set(apps.map((app) => app.slug));
  const active = catalog.filter((app) => app.status === 'active');
  return active.length > 0 && active.every((app) => included.has(app.slug));
}

export function AppChips({ pkg, catalog }: { pkg: Pick<PackageRow, 'kind' | 'apps'>; catalog: ConfigApp[] }) {
  if (pkg.kind === 'bundle' && coversAllApps(pkg.apps, catalog)) {
    return (
      <Chip tone="brand">
        <span title={pkg.apps.map((app) => app.name).join(', ')}>All apps</span>
      </Chip>
    );
  }
  return (
    <span className="flex flex-wrap gap-1">
      {pkg.apps.map((app) => (
        <Chip key={app.slug}>{app.name}</Chip>
      ))}
    </span>
  );
}

/** Public or Hidden, plus Recommended when highlighted. */
export function VisibilityChips({ pkg }: { pkg: Pick<PackageRow, 'is_public' | 'highlight'> }) {
  return (
    <span className="flex flex-wrap gap-1">
      {pkg.is_public ? (
        <Chip tone="info" icon={Globe}>
          Public
        </Chip>
      ) : (
        <Chip icon={EyeOff}>Hidden</Chip>
      )}
      {pkg.highlight ? (
        <Chip tone="warning" icon={Star}>
          Recommended
        </Chip>
      ) : null}
    </span>
  );
}

/** "৳1,500" over "per seat / month", or "Free". */
export function Price({ terms }: { terms: PriceTerms }) {
  if (terms.billing_interval === 'free') return <span className="font-semibold text-ink">Free</span>;
  return (
    <span className="flex flex-col">
      <span className="tabular font-semibold text-ink">{formatMoney(terms.price, terms.currency)}</span>
      <span className="text-xs text-ink-muted">{formatCadence(terms.price_unit, terms.billing_interval)}</span>
    </span>
  );
}

export const trialText = (days: number) => (days > 0 ? `${days} ${days === 1 ? 'day' : 'days'}` : 'None');

export const seatLimitText = (limit: number | null) => (limit === null ? 'Unlimited' : `${formatNumber(limit)} seats`);
