import { useState } from 'react';
import { getRouteApi } from '@tanstack/react-router';
import type { InstitutionRef, SubscriptionListParams, SubscriptionStatus } from '@/api/types';
import type { PickedInstitution } from '@/features/invitations/picker';
import { ErrorState, Pagination, Select, Tabs } from '@/components/ui';
import { SubscriptionTable } from '@/features/billing/subscriptions';
import { usePackages, useSubscriptions } from '@/api/queries';
import { SUBSCRIPTION_STATUSES } from '@/features/billing/labels';
import { InstitutionPicker } from '@/features/invitations/picker';
import { RecordPaymentDialog } from '@/features/billing/record';
import { Page } from '@/components/layout/Page';
import { formatNumber } from '@/lib/format';

const PAGE_SIZE = 25;
const route = getRouteApi('/subscriptions');

export const SUBSCRIPTION_VIEWS = ['all', 'expiring', 'scheduled', 'stopped'] as const;
export type SubscriptionView = (typeof SUBSCRIPTION_VIEWS)[number];

const VIEWS: { value: SubscriptionView; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'expiring', label: 'Expiring in 30 days' },
  { value: 'scheduled', label: 'Scheduled downgrades' },
  { value: 'stopped', label: 'Stopped renewal' },
];

const VIEW_PARAMS: Record<SubscriptionView, SubscriptionListParams> = {
  all: {},
  expiring: { expiring_within: 30 },
  scheduled: { scheduled: 1 },
  stopped: { auto_renew: 'false' },
};

const EMPTY: Record<SubscriptionView, string> = {
  all: 'No subscriptions match these filters.',
  expiring: 'Nothing ends in the next 30 days.',
  scheduled: 'No downgrades are scheduled.',
  stopped: 'Every subscription is set to renew.',
};

export function SubscriptionsPage() {
  const { view = 'all' } = route.useSearch();
  const navigate = route.useNavigate();
  const [status, setStatus] = useState<'' | SubscriptionStatus>('');
  const [institution, setInstitution] = useState<PickedInstitution | null>(null);
  const [packageId, setPackageId] = useState('');
  const [page, setPage] = useState(1);
  const [recordFor, setRecordFor] = useState<InstitutionRef | null>(null);
  const packages = usePackages({ page_size: 100 });
  const list = useSubscriptions({
    ...VIEW_PARAMS[view],
    status: status || undefined,
    institution: institution?.kind === 'existing' ? institution.institution.slug : undefined,
    package: packageId || undefined,
    page,
    page_size: PAGE_SIZE,
  });
  const rows = (list.data?.results ?? []).filter((sub) => view !== 'stopped' || !sub.auto_renew);

  const setView = (next: SubscriptionView) => {
    setPage(1);
    void navigate({ search: next === 'all' ? {} : { view: next }, replace: true });
  };

  return (
    <Page title="Subscriptions" subtitle={list.data ? `${formatNumber(list.data.count)} subscriptions` : undefined}>
      <Tabs label="Saved views" items={VIEWS} value={view} onChange={setView} />
      <div className="flex flex-wrap items-end gap-3">
        <Select
          aria-label="Status"
          inline
          value={status}
          onChange={(event) => {
            setStatus(event.target.value as '' | SubscriptionStatus);
            setPage(1);
          }}
        >
          <option value="">All statuses</option>
          {SUBSCRIPTION_STATUSES.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
        <Select
          aria-label="Package"
          inline
          value={packageId}
          onChange={(event) => {
            setPackageId(event.target.value);
            setPage(1);
          }}
        >
          <option value="">All packages</option>
          {(packages.data?.results ?? []).map((row) => (
            <option key={row.id} value={row.id}>
              {row.name}
            </option>
          ))}
        </Select>
        <div className="w-72">
          <InstitutionPicker
            label="Institution"
            value={institution}
            onChange={(value) => {
              setInstitution(value);
              setPage(1);
            }}
          />
        </div>
      </div>

      {list.isError ? <ErrorState error={list.error} onRetry={() => void list.refetch()} /> : null}
      <div>
        <SubscriptionTable
          label="Subscriptions"
          subscriptions={rows}
          loading={list.isPending}
          emptyText={EMPTY[view]}
          onRecordPayment={setRecordFor}
        />
        {list.data ? <Pagination page={page} pageSize={PAGE_SIZE} count={list.data.count} onPage={setPage} noun="subscriptions" /> : null}
      </div>

      <RecordPaymentDialog open={recordFor !== null} onOpenChange={(open) => !open && setRecordFor(null)} institution={recordFor ?? undefined} />
    </Page>
  );
}
