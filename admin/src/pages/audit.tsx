import { useState } from 'react';
import { X } from 'lucide-react';
import type { AuditListParams } from '@/api/types';
import { Button, ErrorState, Field, Input, Pagination, SearchInput } from '@/components/ui';
import { useDebouncedValue } from '@/lib/hooks';
import { Page } from '@/components/layout/Page';
import { AuditTable } from '@/features/audit';
import { formatNumber } from '@/lib/format';
import { useAudit } from '@/api/queries';

const PAGE_SIZE = 50;

interface Filters {
  action: string;
  target_type: string;
  target_id: string;
  actor: string;
  from: string;
  to: string;
}

const NO_FILTERS: Filters = { action: '', target_type: '', target_id: '', actor: '', from: '', to: '' };

const FILTER_FIELDS: { key: keyof Filters; label: string; type?: string; placeholder?: string }[] = [
  { key: 'action', label: 'Action', placeholder: 'e.g. institution.suspend' },
  { key: 'target_type', label: 'Target type', placeholder: 'e.g. organization' },
  { key: 'target_id', label: 'Target ID' },
  { key: 'actor', label: 'Actor user ID' },
  { key: 'from', label: 'From', type: 'date' },
  { key: 'to', label: 'To', type: 'date' },
];

export function AuditPage() {
  const [q, setQ] = useState('');
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [page, setPage] = useState(1);
  const debounced = useDebouncedValue(filters, 300);
  const params: AuditListParams = {
    q,
    page,
    page_size: PAGE_SIZE,
    ...Object.fromEntries(Object.entries(debounced).map(([key, value]) => [key, value.trim() || undefined])),
  };
  const audit = useAudit(params);
  const active = Object.values(filters).some(Boolean) || q !== '';

  const set = (key: keyof Filters, value: string) => {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
  };

  return (
    <Page title="Audit log" subtitle={audit.data ? `${formatNumber(audit.data.count)} entries` : 'Every change made by admins and the system'}>
      <div className="flex flex-col gap-3 rounded-xl border border-stroke bg-surface p-4">
        <div className="flex flex-wrap items-center gap-3">
          <SearchInput label="Search the audit log" value={q} onChange={(value) => { setQ(value); setPage(1); }} />
          <div className="flex-1" />
          {active ? (
            <Button size="sm" variant="ghost" icon={X} onClick={() => { setFilters(NO_FILTERS); setQ(''); setPage(1); }}>
              Clear filters
            </Button>
          ) : null}
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
          {FILTER_FIELDS.map((field) => (
            <Field key={field.key} label={field.label}>
              {(props) => (
                <Input
                  {...props}
                  type={field.type ?? 'text'}
                  placeholder={field.placeholder}
                  value={filters[field.key]}
                  spellCheck={false}
                  onChange={(event) => set(field.key, event.target.value)}
                />
              )}
            </Field>
          ))}
        </div>
      </div>
      {audit.isError ? <ErrorState error={audit.error} onRetry={() => void audit.refetch()} /> : null}
      <div>
        <AuditTable entries={audit.data?.results ?? []} loading={audit.isPending} emptyText={active ? 'No entries match these filters.' : 'No activity recorded yet.'} />
        {audit.data ? <Pagination page={page} pageSize={PAGE_SIZE} count={audit.data.count} onPage={setPage} noun="entries" /> : null}
      </div>
    </Page>
  );
}
