import { useMemo, useState } from 'react';
import { ChartColumn, Download } from 'lucide-react';
import type { FormEvent } from 'react';
import type { DayRange, Preset } from '@/features/portal/period';
import type { ProductRef, UsageReport } from '@/features/portal/types';
import { Button, Chip, CoverageChip, EmptyState, ErrorState, Field, Input, LoadingState, Notice, Pagination, Table, Td, Th } from '@/components/ui';
import { PRESETS, USAGE_TIMEZONE, formatAmount, formatDay, presetRange, rangeDays, rangeProblem, todayIn } from '@/features/portal/period';
import { DayBars, Kpi, KpiRow, ShareBar } from '@/features/portal/charts';
import { AppSwitcher, useApps } from '@/features/portal/apps';
import { usePortalUsage } from '@/features/portal/queries';
import { usageExportUrl } from '@/features/portal/api';
import { usePortal } from '@/features/portal/shell';
import { Page } from '@/components/layout/Page';
import { ApiError } from '@/api/client';
import { cn } from '@/lib/cn';

const LIMIT = 50;

function PresetPicker({ preset, onPreset, range, onCustom }: { preset: Preset; onPreset: (preset: Preset) => void; range: DayRange; onCustom: (range: DayRange) => void }) {
  const [draft, setDraft] = useState<DayRange>(range);
  const [problem, setProblem] = useState<string | null>(null);

  const apply = (event: FormEvent) => {
    event.preventDefault();
    const issue = rangeProblem(draft);
    setProblem(issue);
    if (!issue) onCustom(draft);
  };

  return (
    <div className="flex flex-col gap-3">
      <div role="group" aria-label="Period" className="flex flex-wrap gap-2">
        {PRESETS.map((item) => (
          <button
            key={item.key}
            type="button"
            aria-pressed={preset === item.key}
            onClick={() => {
              if (item.key === 'custom') setDraft(range);
              onPreset(item.key);
            }}
            className={cn(
              'h-8 cursor-pointer rounded-full border px-3 text-[13px] font-semibold transition-colors',
              preset === item.key ? 'border-brand bg-brand-tint text-brand-ink' : 'border-stroke text-ink-muted hover:border-stroke-intense hover:text-ink',
            )}
          >
            {item.label}
          </button>
        ))}
      </div>
      {preset === 'custom' ? (
        <form aria-label="Custom period" onSubmit={apply} noValidate className="flex flex-wrap items-end gap-3">
          <Field label="From" className="w-44">
            {(props) => <Input {...props} type="date" value={draft.start} onChange={(event) => setDraft((current) => ({ ...current, start: event.target.value }))} />}
          </Field>
          <Field label="To" className="w-44">
            {(props) => <Input {...props} type="date" value={draft.end} onChange={(event) => setDraft((current) => ({ ...current, end: event.target.value }))} />}
          </Field>
          <Button type="submit">Apply</Button>
          {problem ? (
            <p role="alert" className="basis-full text-[13px] font-medium text-danger-fg">
              {problem}
            </p>
          ) : null}
        </form>
      ) : null}
    </div>
  );
}

function Features({ report }: { report: UsageReport }) {
  if (report.by_feature.length === 0) return <p className="rounded-xl border border-dashed border-stroke px-5 py-6 text-center text-[13px] text-ink-muted">No feature was used in this period.</p>;
  const appNames = new Map(report.by_product.map((product) => [product.product_id, product.product_name]));
  return (
    <Table label="Usage by feature">
      <thead>
        <tr>
          <Th>App</Th>
          <Th>Feature</Th>
          <Th>Usage</Th>
          <Th>Requests</Th>
          <Th>Share</Th>
        </tr>
      </thead>
      <tbody>
        {report.by_feature.map((feature) => (
          <tr key={`${feature.product_id}-${feature.feature_id}`}>
            <Td>{appNames.get(feature.product_id) ?? feature.product_slug}</Td>
            <Td className="font-medium">{feature.feature_name}</Td>
            <Td className="tabular">
              {formatAmount(feature.quantity)} <span className="text-xs text-ink-muted">{feature.unit}</span>
            </Td>
            <Td className="tabular">{formatAmount(feature.requests)}</Td>
            <Td>
              <ShareBar share={feature.share} />
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

function Members({ report, onOffset }: { report: UsageReport; onOffset: (offset: number) => void }) {
  const { results, total, limit, offset } = report.members;
  if (total === 0) return <p className="rounded-xl border border-dashed border-stroke px-5 py-6 text-center text-[13px] text-ink-muted">No member used an app in this period.</p>;
  return (
    <div>
      <Table label={`Usage by member, ${total} in all`}>
        <thead>
          <tr>
            <Th>Member</Th>
            <Th>Standing</Th>
            <Th>Usage</Th>
            <Th>Requests</Th>
            <Th>Last used</Th>
          </tr>
        </thead>
        <tbody>
          {results.map((member) => (
            <tr key={member.user.id}>
              <Td>
                <span className="block font-medium">{member.user.name || '—'}</span>
                <span className="block text-xs text-ink-muted">{member.user.email}</span>
              </Td>
              <Td>{member.label ? <CoverageChip label={member.label} /> : <Chip>Left the institution</Chip>}</Td>
              <Td className="tabular">{formatAmount(member.quantity)}</Td>
              <Td className="tabular">{formatAmount(member.requests)}</Td>
              <Td>{formatDay(member.last_used, true)}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
      <Pagination page={Math.floor(offset / limit) + 1} pageSize={limit} count={total} onPage={(page) => onOffset((page - 1) * limit)} noun="members" />
    </div>
  );
}

function Report({ report, onOffset }: { report: UsageReport; onOffset: (offset: number) => void }) {
  const { summary, range } = report;
  const period = `${range.days} ${range.days === 1 ? 'day' : 'days'}`;
  const perRequest = summary.requests ? summary.quantity / summary.requests : 0;
  return (
    <>
      <KpiRow label="Usage figures">
        <Kpi label="Usage" value={formatAmount(summary.quantity)} change={summary.change.quantity} period={period} />
        <Kpi label="Requests" value={formatAmount(summary.requests)} change={summary.change.requests} period={period} />
        <Kpi label="Members with usage" value={formatAmount(summary.members_with_usage)} change={summary.change.members_with_usage} period={period} />
        <Kpi label="Usage per request" value={formatAmount(perRequest)} hint={`${formatAmount(summary.features_used)} features used`} />
      </KpiRow>
      <DayBars days={report.by_day} title="Usage by day" />
      <section aria-labelledby="by-feature" className="flex flex-col gap-3">
        <h2 id="by-feature" className="text-[15px] font-semibold text-ink">
          By feature
        </h2>
        <Features report={report} />
      </section>
      <section aria-labelledby="by-member" className="flex flex-col gap-3">
        <h2 id="by-member" className="text-[15px] font-semibold text-ink">
          By member
        </h2>
        <Members report={report} onOffset={onOffset} />
      </section>
    </>
  );
}

function Failure({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  if (!(error instanceof ApiError)) return <ErrorState error={new Error("We couldn't load usage.")} onRetry={onRetry} />;
  if (error.status === 404 && error.code === 'no_usage_account') {
    return (
      <div className="rounded-xl border border-stroke bg-surface">
        <EmptyState icon={ChartColumn} title="No usage account yet">
          Your institution has no usage account yet. Usage appears here once BdREN sets up your package.
        </EmptyState>
      </div>
    );
  }
  if (error.status === 400) {
    const fields = Object.values(error.fields);
    return <Notice tone="danger">{fields.length ? fields.join(' ') : error.body.message || 'Check the period and try again.'}</Notice>;
  }
  return <ErrorState error={new Error("We couldn't load usage.")} onRetry={onRetry} />;
}

/** Usage by the institution's members, per app, with date presets, daily trend, features, members and CSV export. */
export function PortalUsagePage() {
  const { institution } = usePortal();
  const today = useMemo(() => todayIn(USAGE_TIMEZONE), []);
  const [preset, setPreset] = useState<Preset>('30d');
  const [custom, setCustom] = useState<DayRange>(() => presetRange('30d', today));
  const [product, setProduct] = useState('');
  const [offset, setOffset] = useState(0);
  const range = preset === 'custom' ? custom : presetRange(preset, today);
  const params = { start: range.start, end: range.end, product };
  const usage = usePortalUsage(institution.slug, { ...params, limit: LIMIT, offset });
  const known = useMemo<ProductRef[]>(
    () => (usage.data ? usage.data.by_product.map((item) => ({ slug: item.product_slug, name: item.product_name })) : []),
    [usage.data],
  );
  const apps = useApps(known);

  const choose = (next: Preset) => {
    if (next === 'custom') setCustom(range);
    setPreset(next);
    setOffset(0);
  };

  return (
    <Page
      title="Usage"
      subtitle={institution.name}
      actions={
        <a
          href={usageExportUrl(institution.slug, params)}
          download
          className="inline-flex h-10 items-center gap-2 rounded-lg border border-stroke bg-surface px-4 text-sm font-semibold text-ink hover:bg-hover"
        >
          <Download aria-hidden="true" size={16} />
          Export CSV
        </a>
      }
    >
      <div className="flex flex-wrap items-end justify-between gap-4">
        <AppSwitcher
          apps={apps}
          value={product}
          onChange={(slug) => {
            setProduct(slug);
            setOffset(0);
          }}
        />
        <PresetPicker
          preset={preset}
          onPreset={choose}
          range={range}
          onCustom={(next) => {
            setCustom(next);
            setOffset(0);
          }}
        />
      </div>
      <p className="text-xs text-ink-muted">
        {formatDay(range.start, true)} – {formatDay(range.end, true)} · {rangeDays(range)} days, in {usage.data?.range.timezone ?? USAGE_TIMEZONE} time. Only
        usage paid for by your institution&apos;s package is shown, and never usage by people on a personal plan.
      </p>
      {usage.isPending ? <LoadingState label="Loading usage…" /> : null}
      {usage.isError ? <Failure error={usage.error} onRetry={() => void usage.refetch()} /> : null}
      {usage.data && !usage.isError ? (
        <div aria-busy={usage.isFetching} className="flex flex-col gap-5">
          <Report report={usage.data} onOffset={setOffset} />
        </div>
      ) : null}
    </Page>
  );
}
