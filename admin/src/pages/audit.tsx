import { useState } from 'react';
import { X } from 'lucide-react';
import type { AuditListParams, AuditRole } from '@/api/types';
import { Button, ErrorState, Field, Input, Pagination, SearchInput, Select } from '@/components/ui';
import { AuditTable, actionLabel } from '@/features/audit';
import { useAudit, useAuditFilters } from '@/api/queries';
import { Page } from '@/components/layout/Page';
import { formatNumber, humanize } from '@/lib/format';

const PAGE_SIZE = 50;

interface Filters {
  action: string;
  target_type: string;
  role: AuditRole | '';
  from: string;
  to: string;
}

const NO_FILTERS: Filters = { action: '', target_type: '', role: '', from: '', to: '' };

export function AuditPage() {
  const [q, setQ] = useState('');
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [page, setPage] = useState(1);
  const options = useAuditFilters();
  const params: AuditListParams = {
    q,
    page,
    page_size: PAGE_SIZE,
    action: filters.action || undefined,
    target_type: filters.target_type || undefined,
    role: filters.role || undefined,
    from: filters.from || undefined,
    to: filters.to || undefined,
  };
  const audit = useAudit(params);
  const active = Object.values(filters).some(Boolean) || q !== '';

  const set = <K extends keyof Filters>(key: K, value: Filters[K]) => {
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
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-5">
          <Field label="Action">
            {(props) => (
              <Select {...props} value={filters.action} onChange={(event) => set('action', event.target.value)}>
                <option value="">All actions</option>
                {(options.data?.actions ?? []).map((action) => (
                  <option key={action} value={action}>
                    {actionLabel(action)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Target type">
            {(props) => (
              <Select {...props} value={filters.target_type} onChange={(event) => set('target_type', event.target.value)}>
                <option value="">All targets</option>
                {(options.data?.target_types ?? []).map((type) => (
                  <option key={type} value={type}>
                    {humanize(type)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Role">
            {(props) => (
              <Select {...props} value={filters.role} onChange={(event) => set('role', event.target.value as AuditRole | '')}>
                <option value="">All roles</option>
                {(options.data?.roles ?? []).map((role) => (
                  <option key={role.value} value={role.value}>
                    {role.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="From">
            {(props) => <Input {...props} type="date" value={filters.from} onChange={(event) => set('from', event.target.value)} />}
          </Field>
          <Field label="To">
            {(props) => <Input {...props} type="date" value={filters.to} onChange={(event) => set('to', event.target.value)} />}
          </Field>
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
