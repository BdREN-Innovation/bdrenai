import { useState } from 'react';
import { Mail, RefreshCw } from 'lucide-react';
import type { InstitutionDetail, InvitationStatus } from '@/api/types';
import { Button, ErrorState, Pagination, SearchInput, Tabs, useToast } from '@/components/ui';
import { useInvitations, useResendExpired } from '@/api/queries';
import { InvitationTable } from '@/features/invitations/table';
import { errorMessage } from '@/api/client';

const PAGE_SIZE = 25;

export const INVITATION_FILTERS: { value: '' | InvitationStatus; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'expired', label: 'Expired' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'revoked', label: 'Revoked' },
];

export function InstitutionInvitations({ institution, onInvite }: { institution: InstitutionDetail; onInvite: () => void }) {
  const notify = useToast();
  const [status, setStatus] = useState<'' | InvitationStatus>('pending');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const list = useInvitations({ institution: institution.slug, status: status || undefined, q, page, page_size: PAGE_SIZE });
  const resendExpired = useResendExpired();

  return (
    <div className="flex flex-col gap-4">
      <Tabs
        label="Invitation status"
        items={INVITATION_FILTERS.map((filter) => ({ value: filter.value, label: filter.label }))}
        value={status}
        onChange={(value) => {
          setStatus(value);
          setPage(1);
        }}
      />
      <div className="flex flex-wrap items-center gap-3">
        <SearchInput label="Search invitations" value={q} onChange={(value) => { setQ(value); setPage(1); }} />
        <div className="flex-1" />
        {institution.counts.expired_invitations > 0 ? (
          <Button
            icon={RefreshCw}
            loading={resendExpired.isPending}
            onClick={() =>
              resendExpired.mutate(institution.slug, {
                onSuccess: (result) =>
                  notify(
                    result.email_failures > 0
                      ? `${result.resent} resent; ${result.email_failures} emails could not be sent.`
                      : `${result.resent} expired invitations resent.`,
                    result.email_failures > 0 ? 'warning' : 'success',
                  ),
                onError: (error) => notify(errorMessage(error), 'danger'),
              })
            }
          >
            Resend {institution.counts.expired_invitations} expired
          </Button>
        ) : null}
        {institution.status !== 'deactivated' ? (
          <Button variant="brand" icon={Mail} onClick={onInvite}>
            Invite admin
          </Button>
        ) : null}
      </div>
      {list.isError ? <ErrorState error={list.error} onRetry={() => void list.refetch()} /> : null}
      <div>
        <InvitationTable
          invitations={list.data?.results ?? []}
          loading={list.isPending}
          showInstitution={false}
          emptyText="No invitations with this status."
        />
        {list.data ? <Pagination page={page} pageSize={PAGE_SIZE} count={list.data.count} onPage={setPage} noun="invitations" /> : null}
      </div>
    </div>
  );
}
