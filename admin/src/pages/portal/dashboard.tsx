import { useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { ChartColumn } from 'lucide-react';
import type { ReactNode } from 'react';
import type { DashboardData, ProductRef } from '@/features/portal/types';
import type { MembersSearch } from '@/features/portal/tabs';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui';
import { PackagesSummary } from '@/features/portal/billing/summary';
import { AppSwitcher, useApps } from '@/features/portal/apps';
import { DayBars, Kpi, KpiRow } from '@/features/portal/charts';
import { usePortalDashboard } from '@/features/portal/queries';
import { formatAmount } from '@/features/portal/period';
import { PORTAL_PATHS } from '@/features/portal/tabs';
import { usePortal } from '@/features/portal/shell';
import { Page } from '@/components/layout/Page';
import { ApiError } from '@/api/client';

const WEEK = '7 days';
const LINK = 'text-[13px] font-semibold text-brand hover:underline';

function Panel({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-3 rounded-xl border border-stroke bg-surface p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
        {action}
      </div>
      <div className="text-[13px] text-ink">{children}</div>
    </section>
  );
}

interface FollowUp {
  count: number;
  text: string;
  search: MembersSearch;
  link: string;
}

function FollowUps({ slug, data }: { slug: string; data: DashboardData }) {
  const { counts } = data;
  const all: FollowUp[] = [
    {
      count: counts.not_covered,
      text: counts.not_covered === 1 ? "person signed up but isn't on your package yet" : "people signed up but aren't on your package yet",
      search: { tab: 'not_covered' },
      link: 'Review',
    },
    {
      count: counts.pending_invitations,
      text: counts.pending_invitations === 1 ? 'invitation waits to be accepted' : 'invitations wait to be accepted',
      search: { tab: 'invited' },
      link: 'See invitations',
    },
    {
      count: counts.expired_invitations,
      text: counts.expired_invitations === 1 ? 'invitation expired unused' : 'invitations expired unused',
      search: { tab: 'invited', status: 'expired' },
      link: 'Resend',
    },
  ];
  const items = all.filter((item) => item.count > 0);
  if (items.length === 0) return <p className="text-ink-muted">Nothing to follow up. Everyone who signed up is on your package.</p>;
  return (
    <ul className="flex flex-col gap-3">
      {items.map((item) => (
        <li key={item.text} className="flex flex-wrap items-baseline justify-between gap-3">
          <span>
            <span className="tabular text-lg font-bold">{formatAmount(item.count)}</span> {item.text}
          </span>
          <Link to={PORTAL_PATHS.members} params={{ slug }} search={item.search} className={LINK}>
            {item.link}
          </Link>
        </li>
      ))}
    </ul>
  );
}

function TopMembers({ data, slug }: { data: NonNullable<DashboardData['usage']>; slug: string }) {
  return (
    <Panel
      title="Most active members"
      action={
        <Link to={PORTAL_PATHS.usage} params={{ slug }} className={LINK}>
          All usage
        </Link>
      }
    >
      {data.top_members.length === 0 ? (
        <p className="text-ink-muted">No member has used an app this week.</p>
      ) : (
        <ol className="flex flex-col divide-y divide-stroke-muted">
          {data.top_members.map((member) => (
            <li key={member.user.id} className="flex items-baseline justify-between gap-3 py-2">
              <span className="min-w-0">
                <span className="block truncate font-medium">{member.user.name || member.user.email}</span>
                <span className="block truncate text-xs text-ink-muted">{member.user.email}</span>
              </span>
              <span className="tabular whitespace-nowrap">{formatAmount(member.quantity)}</span>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}

function Body({ data, slug }: { data: DashboardData; slug: string }) {
  const { seats, counts, usage } = data;
  const free = seats.cap === null ? null : Math.max(0, seats.cap - seats.used);
  return (
    <>
      <KpiRow label="Key figures">
        <Kpi
          label="Seats in use"
          value={seats.cap === null ? formatAmount(seats.used) : `${formatAmount(seats.used)} / ${formatAmount(seats.cap)}`}
          hint={free === null ? 'Unlimited seats' : `${formatAmount(free)} free · members and pending invitations count`}
        />
        <Kpi
          label="Covered members"
          value={formatAmount(counts.covered_active)}
          hint={counts.covered_suspended ? `and ${formatAmount(counts.covered_suspended)} suspended` : "on your institution's package"}
        />
        {usage ? (
          <>
            <Kpi label="Usage this week" value={formatAmount(usage.summary.quantity)} change={usage.summary.change.quantity} period={WEEK} />
            <Kpi label="Requests this week" value={formatAmount(usage.summary.requests)} change={usage.summary.change.requests} period={WEEK} />
          </>
        ) : null}
      </KpiRow>

      {usage ? (
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          <DayBars days={usage.by_day} title="Usage this week" average={false} />
          <TopMembers data={usage} slug={slug} />
        </div>
      ) : (
        <div className="rounded-xl border border-stroke bg-surface">
          <EmptyState icon={ChartColumn} title="No usage yet">
            Usage appears here once your institution has a package and members start using BDREN apps.
          </EmptyState>
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Panel title="To follow up">
          <FollowUps slug={slug} data={data} />
          {counts.personal_plan > 0 ? (
            <p className="mt-3 text-xs text-ink-muted">
              {formatAmount(counts.personal_plan)}{' '}
              {counts.personal_plan === 1
                ? "member pays for a personal plan and doesn't use a seat."
                : "members pay for a personal plan and don't use seats."}
            </p>
          ) : null}
        </Panel>
        <Panel
          title="Packages"
          action={
            <Link to={PORTAL_PATHS.billing} params={{ slug }} className={LINK}>
              Billing
            </Link>
          }
        >
          <PackagesSummary slug={slug} />
        </Panel>
      </div>
    </>
  );
}

/** Institution admin dashboard: seats, members, this week's usage, follow-ups, and packages from the billing data. */
export function PortalDashboardPage() {
  const { institution } = usePortal();
  const [product, setProduct] = useState('');
  const dashboard = usePortalDashboard(institution.slug, product);
  const known = useMemo<ProductRef[]>(() => (dashboard.data ? dashboard.data.packages.map((item) => item.product) : []), [dashboard.data]);
  const apps = useApps(known);
  const invalidApp = dashboard.error instanceof ApiError && dashboard.error.code === 'invalid';

  return (
    <Page title="Dashboard" subtitle={institution.name}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <AppSwitcher apps={apps} value={product} onChange={setProduct} />
        {dashboard.data?.usage ? (
          <p className="text-xs text-ink-muted">Usage covers the last 7 days, in {dashboard.data.usage.range.timezone} time.</p>
        ) : null}
      </div>
      {dashboard.isPending ? <LoadingState label="Loading the dashboard…" /> : null}
      {dashboard.isError ? (
        <ErrorState error={invalidApp ? new Error("We couldn't load this app's figures.") : dashboard.error} onRetry={() => void dashboard.refetch()} />
      ) : null}
      {dashboard.data && !dashboard.isError ? (
        <div aria-busy={dashboard.isFetching} className="flex flex-col gap-5">
          <Body data={dashboard.data} slug={institution.slug} />
        </div>
      ) : null}
    </Page>
  );
}
