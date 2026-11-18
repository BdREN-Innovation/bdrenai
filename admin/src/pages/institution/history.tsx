import { useState } from 'react';
import { ErrorState, Pagination } from '@/components/ui';
import { useInstitutionHistory } from '@/api/queries';
import { AuditTable } from '@/features/audit';

export function History({ slug }: { slug: string }) {
  const [page, setPage] = useState(1);
  const history = useInstitutionHistory(slug, page);
  return (
    <div className="flex flex-col gap-4">
      {history.isError ? <ErrorState error={history.error} onRetry={() => void history.refetch()} /> : null}
      <div>
        <AuditTable label="Institution history" entries={history.data?.results ?? []} loading={history.isPending} emptyText="No changes recorded yet." />
        {history.data ? (
          <Pagination page={page} pageSize={history.data.page_size} count={history.data.count} onPage={setPage} noun="entries" />
        ) : null}
      </div>
    </div>
  );
}
