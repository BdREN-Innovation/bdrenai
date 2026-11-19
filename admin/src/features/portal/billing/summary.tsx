import { Link } from '@tanstack/react-router';
import type { BillingSubscription } from '@/api/types';
import type { PortalBilling } from '../types';
import { ErrorState, LoadingState } from '@/components/ui';
import { LIVE_STATUSES, RENEW_SOON_DAYS, daysLeft, lastDayText } from './rules';
import { usePortalBilling } from '../queries';
import { PORTAL_PATHS } from '../tabs';
import { cn } from '@/lib/cn';

const CALL = 'inline-flex h-8 items-center rounded-md bg-accent px-3 text-xs font-bold text-on-accent hover:brightness-95';

function ending(subscription: BillingSubscription, now: number): { text: string; soon: boolean } {
  const end = subscription.expires_at;
  const left = daysLeft(end, now);
  if (end === null || left === null) return { text: 'No end date', soon: false };
  const date = lastDayText(end);
  if (left < 0) return { text: `Period ended ${date}`, soon: true };
  const when = left === 0 ? 'last day today' : `${left} ${left === 1 ? 'day' : 'days'} left`;
  return { text: `${subscription.auto_renew ? 'Renew by' : 'Ends'} ${date} (${when})`, soon: left <= RENEW_SOON_DAYS };
}

function Summary({ slug, data }: { slug: string; data: PortalBilling }) {
  const now = Date.now();
  const live = data.subscriptions.filter((subscription) => LIVE_STATUSES.has(subscription.status));
  const renewable = new Set(data.offers.filter((offer) => offer.kind === 'renew').map((offer) => offer.package.id));

  if (live.length === 0) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-ink-muted">Your institution has no active package, so members can't use BDREN apps through it.</p>
        <Link to={PORTAL_PATHS.billing} params={{ slug }} className={CALL}>
          Choose a package
        </Link>
      </div>
    );
  }

  const rows = live.map((subscription) => ({ subscription, end: ending(subscription, now) }));
  const renewSoon = rows.some(
    ({ subscription, end }) =>
      end.soon && (renewable.has(subscription.package.id) || (subscription.scheduled_package && renewable.has(subscription.scheduled_package.id))),
  );
  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col divide-y divide-stroke-muted">
        {rows.map(({ subscription, end }) => (
          <li key={subscription.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
            <span className="min-w-0">
              <span className="font-semibold">{subscription.package.name}</span>
              <span className="text-ink-muted"> · {subscription.apps.map((app) => app.name).join(', ')}</span>
              {subscription.status !== 'active' ? <span className="text-ink-muted"> · {subscription.status === 'trial' ? 'Trial' : 'Payment overdue'}</span> : null}
              {subscription.scheduled_package ? <span className="block text-xs text-ink-muted">Switches to {subscription.scheduled_package.name} at renewal</span> : null}
              {!subscription.auto_renew ? <span className="block text-xs text-ink-muted">Renewal stopped</span> : null}
            </span>
            <span className={cn('tabular', end.soon ? 'font-semibold text-danger-fg' : 'text-ink-muted')}>{end.text}</span>
          </li>
        ))}
      </ul>
      {renewSoon && data.bkash_enabled ? (
        <Link to={PORTAL_PATHS.billing} params={{ slug }} className={cn(CALL, 'self-start')}>
          Renew
        </Link>
      ) : null}
      {renewSoon && !data.bkash_enabled ? <p className="text-xs text-ink-muted">To renew, contact BdREN to pay.</p> : null}
    </div>
  );
}

/** The dashboard's Packages panel: active packages, when each period ends, and a call to renew or choose one. */
export function PackagesSummary({ slug }: { slug: string }) {
  const billing = usePortalBilling(slug);
  if (billing.isPending) return <LoadingState label="Loading packages…" className="py-4" />;
  if (billing.isError) return <ErrorState error={billing.error} onRetry={() => void billing.refetch()} />;
  return <Summary slug={slug} data={billing.data} />;
}
