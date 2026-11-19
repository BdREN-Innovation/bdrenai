import { useState } from 'react';
import { getRouteApi } from '@tanstack/react-router';
import { Banknote, CircleAlert, Clock, Download, HandCoins, Plus, Undo2, Wallet } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { BillingTotals, PaymentListParams, PaymentStatus, PaymentTab } from '@/api/types';
import type { PickedInstitution } from '@/features/invitations/picker';
import type { RangeValue } from '@/features/billing/range';
import { Button, Chip, ErrorState, KpiTile, Pagination, SearchInput, Select, Tabs, useToast } from '@/components/ui';
import { BKASH_MODE, PAYMENT_STATUSES, PAYMENT_TABS, describeChange } from '@/features/billing/labels';
import { downloadText, fetchAllPayments, paymentsCsv } from '@/features/billing/export';
import { useBillingSummary, usePackages, usePayments } from '@/api/queries';
import { RangePicker, defaultRange } from '@/features/billing/range';
import { InstitutionPicker } from '@/features/invitations/picker';
import { RecordPaymentDialog } from '@/features/billing/record';
import { PaymentTable } from '@/features/billing/payments';
import { PaymentDrawer } from '@/features/billing/drawer';
import { formatMoney, formatNumber } from '@/lib/format';
import { Page } from '@/components/layout/Page';
import { errorMessage } from '@/api/client';

const PAGE_SIZE = 25;
const route = getRouteApi('/billing');

interface Tile {
  key: keyof BillingTotals;
  label: string;
  icon: LucideIcon;
  money: boolean;
}

const TILES: Tile[] = [
  { key: 'collected', label: 'Collected', icon: Wallet, money: true },
  { key: 'bkash', label: 'Via bKash', icon: HandCoins, money: true },
  { key: 'manual', label: 'Via manual', icon: Banknote, money: true },
  { key: 'refunds', label: 'Refunds', icon: Undo2, money: true },
  { key: 'pending', label: 'Pending', icon: Clock, money: false },
  { key: 'failed', label: 'Failed', icon: CircleAlert, money: false },
];

type SummaryQuery = ReturnType<typeof useBillingSummary>;

function Summary({ summary }: { summary: SummaryQuery }) {
  if (summary.isError) return <ErrorState error={summary.error} onRetry={() => void summary.refetch()} />;
  const data = summary.data;
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      {TILES.map((tile) => {
        const value = data ? data[tile.key] : null;
        const previous = data ? data.previous[tile.key] : null;
        return (
          <KpiTile
            key={tile.key}
            label={tile.label}
            icon={tile.icon}
            value={value === null ? '—' : tile.money ? formatMoney(String(value), 'BDT') : formatNumber(Number(value))}
            detail={value === null || previous === null ? undefined : describeChange(Number(value), Number(previous))}
          />
        );
      })}
    </div>
  );
}

function BkashModeChip({ summary }: { summary: SummaryQuery }) {
  const mode = summary.data?.bkash_mode;
  if (!mode) return null;
  const style = BKASH_MODE[mode];
  return (
    <span title="Set by the server's bKash settings">
      <Chip tone={style.tone}>bKash: {style.label}</Chip>
    </span>
  );
}

export function BillingPage() {
  const notify = useToast();
  const { tab = 'all' } = route.useSearch();
  const navigate = route.useNavigate();
  const [range, setRange] = useState<RangeValue>(defaultRange);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'' | PaymentStatus>('');
  const [institution, setInstitution] = useState<PickedInstitution | null>(null);
  const [packageId, setPackageId] = useState('');
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [exporting, setExporting] = useState(false);
  const packages = usePackages({ page_size: 100 });
  const summary = useBillingSummary({ from: range.from, to: range.to });

  const filter: PaymentListParams = {
    tab: tab === 'all' ? undefined : tab,
    q: q || undefined,
    status: status || undefined,
    institution: institution?.kind === 'existing' ? institution.institution.slug : undefined,
    package: packageId || undefined,
    from: range.from,
    to: range.to,
  };
  const list = usePayments({ ...filter, page, page_size: PAGE_SIZE });

  const reset = <T,>(set: (value: T) => void) => (value: T) => {
    set(value);
    setPage(1);
  };

  const setTab = (next: PaymentTab) => {
    setPage(1);
    void navigate({ search: next === 'all' ? {} : { tab: next }, replace: true });
  };

  const exportCsv = async () => {
    setExporting(true);
    try {
      const rows = await fetchAllPayments(filter);
      downloadText(`payments-${range.from}-to-${range.to}.csv`, paymentsCsv(rows));
      notify(`${formatNumber(rows.length)} payments exported.`);
    } catch (error) {
      notify(errorMessage(error), 'danger');
    } finally {
      setExporting(false);
    }
  };

  return (
    <Page
      title="Billing"
      subtitle="Payments by bKash and manual transfer"
      actions={
        <>
          <BkashModeChip summary={summary} />
          <Button icon={Download} loading={exporting} onClick={() => void exportCsv()}>
            Export CSV
          </Button>
          <Button variant="primary" icon={Plus} onClick={() => setRecording(true)}>
            Record payment
          </Button>
        </>
      }
    >
      <RangePicker value={range} onChange={reset(setRange)} />
      <Summary summary={summary} />

      <Tabs label="Payment view" items={PAYMENT_TABS} value={tab} onChange={setTab} />
      <div className="flex flex-wrap items-end gap-3">
        <SearchInput label="Search receipt, reference, trxID, payer or institution" placeholder="Search payments" value={q} onChange={reset(setQ)} />
        <Select aria-label="Status" inline value={status} onChange={(event) => reset(setStatus)(event.target.value as '' | PaymentStatus)}>
          <option value="">All statuses</option>
          {PAYMENT_STATUSES.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
        <Select aria-label="Package" inline value={packageId} onChange={(event) => reset(setPackageId)(event.target.value)}>
          <option value="">All packages</option>
          {(packages.data?.results ?? []).map((row) => (
            <option key={row.id} value={row.id}>
              {row.name}
            </option>
          ))}
        </Select>
        <div className="w-72">
          <InstitutionPicker label="Institution" value={institution} onChange={reset(setInstitution)} />
        </div>
      </div>

      {list.isError ? <ErrorState error={list.error} onRetry={() => void list.refetch()} /> : null}
      <div>
        <PaymentTable
          label="Payments"
          payments={list.data?.results ?? []}
          loading={list.isPending}
          emptyText={tab === 'attention' ? 'Nothing is waiting for action.' : 'No payments match these filters.'}
          onOpen={(payment) => setOpenId(payment.id)}
        />
        {list.data ? <Pagination page={page} pageSize={PAGE_SIZE} count={list.data.count} onPage={setPage} noun="payments" /> : null}
      </div>

      <PaymentDrawer paymentId={openId} onClose={() => setOpenId(null)} />
      <RecordPaymentDialog open={recording} onOpenChange={setRecording} onRecorded={(payment) => setOpenId(payment.id)} />
    </Page>
  );
}
