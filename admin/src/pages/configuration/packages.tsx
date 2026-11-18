import { useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { Layers, Plus } from 'lucide-react';
import type { ConfigApp, PackageKind, PackageRow, PackageStatus } from '@/api/types';
import {
  Button,
  EmptyState,
  ErrorState,
  Pagination,
  SearchInput,
  Segmented,
  Select,
  StatusChip,
  Table,
  TableMessage,
  Td,
  Th,
  Tr,
} from '@/components/ui';
import { AppChips, Price, VisibilityChips, seatLimitText, trialText } from '@/features/packages/chips';
import { useConfigApps, usePackages } from '@/api/queries';
import { groupBy } from '@/features/packages/describe';
import { PACKAGE_STATUSES } from '@/lib/labels';
import { formatNumber } from '@/lib/format';

const PAGE_SIZE = 25;
const COLUMNS = 8;

type KindFilter = 'all' | PackageKind;

const KIND_FILTERS: { value: KindFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'bundle', label: 'Combined' },
  { value: 'single', label: 'Single' },
];

const groupKey = (row: PackageRow) => (row.kind === 'bundle' ? 'bundle' : (row.apps[0]?.slug ?? ''));

function groupTitle(key: string, rows: PackageRow[]): string {
  return key === 'bundle' ? 'Combined packages' : (rows[0]?.apps[0]?.name ?? 'Other');
}

function PackageRows({ title, rows, catalog }: { title: string; rows: PackageRow[]; catalog: ConfigApp[] }) {
  const navigate = useNavigate();
  return (
    <tbody>
      <tr>
        <th scope="colgroup" colSpan={COLUMNS} className="border-t border-stroke bg-surface-2 px-4 py-2 text-left text-xs font-semibold text-ink">
          {title}
        </th>
      </tr>
      {rows.map((row) => (
        <Tr
          key={row.id}
          onOpen={() => void navigate({ to: '/configuration/packages/$id', params: { id: row.id } })}
          openLabel={`Open ${row.name}`}
        >
          <Td className="min-w-56">
            <div className="flex flex-col gap-1">
              <Link to="/configuration/packages/$id" params={{ id: row.id }} className="font-semibold text-ink hover:text-brand">
                {row.name}
              </Link>
              {row.audience ? <span className="text-xs text-ink-muted">{row.audience}</span> : null}
              <VisibilityChips pkg={row} />
            </div>
          </Td>
          <Td>
            <AppChips pkg={row} catalog={catalog} />
          </Td>
          <Td className="whitespace-nowrap">
            <Price terms={row} />
          </Td>
          <Td className="whitespace-nowrap">{trialText(row.trial_days)}</Td>
          <Td className="tabular whitespace-nowrap">{seatLimitText(row.seat_limit)}</Td>
          <Td className="tabular">v{row.current_version}</Td>
          <Td className="tabular">{formatNumber(row.subscribers)}</Td>
          <Td>
            <StatusChip status={row.status} />
          </Td>
        </Tr>
      ))}
    </tbody>
  );
}

/** The catalog: combined packages first, then one group per app, as the server orders them. */
export function PackagesTab({ onCreate }: { onCreate: (kind: PackageKind) => void }) {
  const [kind, setKind] = useState<KindFilter>('all');
  const [app, setApp] = useState('');
  const [status, setStatus] = useState<'' | PackageStatus>('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const catalog = useConfigApps();
  const apps = catalog.data?.results ?? [];
  const list = usePackages({ kind: kind === 'all' ? undefined : kind, app: app || undefined, status: status || undefined, q, page, page_size: PAGE_SIZE });
  const results = list.data?.results ?? [];
  const filtered = kind !== 'all' || app !== '' || status !== '' || q !== '';
  const groups = [...groupBy(results, groupKey)];

  const filter = <T,>(setter: (value: T) => void) => (value: T) => {
    setter(value);
    setPage(1);
  };

  const empty = !list.isPending && !list.isError && results.length === 0 && !filtered;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented label="Package kind" options={KIND_FILTERS} value={kind} onChange={filter(setKind)} />
        <Select aria-label="App" inline value={app} onChange={(event) => filter(setApp)(event.target.value)}>
          <option value="">All apps</option>
          {apps.map((item) => (
            <option key={item.slug} value={item.slug}>
              {item.name}
            </option>
          ))}
        </Select>
        <Select aria-label="Status" inline value={status} onChange={(event) => filter(setStatus)(event.target.value as '' | PackageStatus)}>
          <option value="">Active and inactive</option>
          {PACKAGE_STATUSES.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
        <SearchInput label="Search packages" value={q} onChange={filter(setQ)} />
      </div>

      {list.isError ? <ErrorState error={list.error} onRetry={() => void list.refetch()} /> : null}

      {empty ? (
        <div className="rounded-xl border border-stroke bg-surface">
          <EmptyState
            icon={Layers}
            title="No packages on sale"
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Button variant="ghost" onClick={() => filter(setStatus)('archived')}>
                  Show archived
                </Button>
                <Button icon={Plus} onClick={() => onCreate('single')}>
                  New package
                </Button>
                <Button variant="primary" icon={Plus} onClick={() => onCreate('bundle')}>
                  New combined package
                </Button>
              </div>
            }
          >
            A single package sells one app. A combined package sells several apps, or all of them, under one price.
            Archived packages are listed under Show archived.
          </EmptyState>
        </div>
      ) : (
        <div>
          <Table label="Packages">
            <thead>
              <tr>
                <Th>Package</Th>
                <Th>Apps</Th>
                <Th>Price</Th>
                <Th>Trial</Th>
                <Th>Seat limit</Th>
                <Th>Version</Th>
                <Th>Subscribers</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            {groups.length === 0 ? (
              <tbody>
                <TableMessage colSpan={COLUMNS}>{list.isPending ? 'Loading…' : 'No packages match these filters.'}</TableMessage>
              </tbody>
            ) : (
              groups.map(([key, rows]) => <PackageRows key={key} title={groupTitle(key, rows)} rows={rows} catalog={apps} />)
            )}
          </Table>
          {list.data ? <Pagination page={page} pageSize={PAGE_SIZE} count={list.data.count} onPage={setPage} noun="packages" /> : null}
        </div>
      )}
    </div>
  );
}
