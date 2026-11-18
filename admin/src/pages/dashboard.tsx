import { Link } from '@tanstack/react-router';
import { Building2, CircleCheck, Clock, Gauge, MailWarning, UserPlus, Users } from 'lucide-react';
import type { AttentionItem } from '@/api/types';
import { Card, ErrorState, KpiTile, LoadingState, SeatMeter } from '@/components/ui';
import { formatNumber, formatRelative } from '@/lib/format';
import { ActivityList } from '@/features/audit';
import { useDashboard } from '@/api/queries';
import { Page } from '@/components/layout/Page';

function AttentionRow({ item }: { item: AttentionItem }) {
  const base = 'flex items-center gap-3 border-t border-stroke-muted py-2.5 first:border-t-0 first:pt-0 text-[13px]';
  if (item.kind === 'expired_invitations') {
    return (
      <li className={base}>
        <MailWarning aria-hidden="true" size={16} className="shrink-0 text-warning-fg" />
        <span className="flex-1">
          <strong className="font-semibold">{formatNumber(item.count)}</strong> invitations expired without being accepted
        </span>
        <Link to="/invitations" search={{ status: 'expired' }} className="shrink-0 font-semibold text-brand hover:underline">
          Review
        </Link>
      </li>
    );
  }
  const link = (
    <Link to="/institutions/$slug" params={{ slug: item.institution.slug }} className="font-semibold text-brand hover:underline">
      {item.institution.name}
    </Link>
  );
  if (item.kind === 'pending_requests') {
    return (
      <li className={base}>
        <UserPlus aria-hidden="true" size={16} className="shrink-0 text-warning-fg" />
        <span className="flex-1">
          {link} has <strong className="font-semibold">{formatNumber(item.count)}</strong> sign-up requests waiting for a verified email
        </span>
      </li>
    );
  }
  return (
    <li className={base}>
      <Gauge aria-hidden="true" size={16} className="shrink-0 text-warning-fg" />
      <span className="flex-1">{link} is close to its seat cap</span>
      <SeatMeter seats={item.seats} compact />
    </li>
  );
}

export function DashboardPage() {
  const dashboard = useDashboard();
  const data = dashboard.data;

  return (
    <Page title="Dashboard" subtitle="Institutions, accounts and invitations across BDREN AI">
      {dashboard.isPending ? <LoadingState /> : null}
      {dashboard.isError ? <ErrorState error={dashboard.error} onRetry={() => void dashboard.refetch()} /> : null}
      {data ? (
        <>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(14rem,1fr))] gap-4">
            <KpiTile
              icon={Building2}
              label="Institutions"
              value={data.counts.institutions}
              detail={`${formatNumber(data.counts.active_institutions)} active`}
            />
            <KpiTile icon={Users} label="Users" value={data.counts.users} detail={`${formatNumber(data.counts.active_users)} active`} />
            <KpiTile
              icon={Clock}
              label="Pending invitations"
              value={data.counts.pending_invitations}
              detail={`${formatNumber(data.counts.expired_invitations)} expired`}
            />
            <KpiTile icon={UserPlus} label="Sign-up requests" value={data.counts.pending_requests} detail="waiting for a verified email" />
          </div>
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            <Card title="Needs attention" description="Seats near the cap, expired invitations and waiting requests.">
              {data.attention.length === 0 ? (
                <p className="flex items-center gap-2 text-[13px] text-ink-muted">
                  <CircleCheck aria-hidden="true" size={16} className="text-success-fg" />
                  Nothing needs attention right now.
                </p>
              ) : (
                <ul className="flex flex-col">
                  {data.attention.map((item, index) => (
                    <AttentionRow key={`${item.kind}-${index}`} item={item} />
                  ))}
                </ul>
              )}
            </Card>
            <Card
              title="Recent institutions"
              action={
                <Link to="/institutions" className="text-[13px] font-semibold text-brand hover:underline">
                  View all
                </Link>
              }
            >
              {data.recent_institutions.length === 0 ? (
                <p className="text-[13px] text-ink-muted">No institutions yet.</p>
              ) : (
                <ul className="flex flex-col">
                  {data.recent_institutions.map((institution) => (
                    <li key={institution.slug} className="flex items-center gap-3 border-t border-stroke-muted py-2.5 first:border-t-0 first:pt-0">
                      <div className="flex min-w-0 flex-1 flex-col">
                        <Link to="/institutions/$slug" params={{ slug: institution.slug }} className="truncate text-[13px] font-semibold text-ink hover:text-brand">
                          {institution.name}
                        </Link>
                        <span className="text-xs text-ink-muted">Created {formatRelative(institution.created_at)}</span>
                      </div>
                      <SeatMeter seats={institution.seats} compact />
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
          <Card
            title="Recent activity"
            description="The latest changes made by admins."
            action={
              <Link to="/audit" className="text-[13px] font-semibold text-brand hover:underline">
                Audit log
              </Link>
            }
          >
            <ActivityList entries={data.recent_activity} />
          </Card>
        </>
      ) : null}
    </Page>
  );
}
