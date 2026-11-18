import { useState } from 'react';
import { getRouteApi } from '@tanstack/react-router';
import { Mail, RefreshCw, UserPlus } from 'lucide-react';
import type { InvitationStatus } from '@/api/types';
import type { PickedInstitution } from '@/features/invitations/picker';
import { Button, ErrorState, Pagination, SearchInput, Tabs, useToast } from '@/components/ui';
import { InviteAdminDialog, InviteUserDialog } from '@/features/invitations/invite';
import { INVITATION_FILTERS } from '@/pages/institution/invitations';
import { useInvitations, useResendExpired } from '@/api/queries';
import { InstitutionPicker } from '@/features/invitations/picker';
import { InvitationTable } from '@/features/invitations/table';
import { Page } from '@/components/layout/Page';
import { errorMessage } from '@/api/client';
import { formatNumber } from '@/lib/format';

const PAGE_SIZE = 25;
const route = getRouteApi('/invitations');

export function InvitationsPage() {
  const notify = useToast();
  const { status = '' } = route.useSearch();
  const navigate = route.useNavigate();
  const [q, setQ] = useState('');
  const [institution, setInstitution] = useState<PickedInstitution | null>(null);
  const [page, setPage] = useState(1);
  const [invitingAdmin, setInvitingAdmin] = useState(false);
  const [invitingUser, setInvitingUser] = useState(false);
  const slug = institution?.kind === 'existing' ? institution.institution.slug : undefined;
  const list = useInvitations({ status: status || undefined, q, institution: slug, page, page_size: PAGE_SIZE });
  const resendExpired = useResendExpired();

  const setStatus = (value: '' | InvitationStatus) => {
    setPage(1);
    void navigate({ search: value ? { status: value } : {}, replace: true });
  };

  return (
    <Page
      title="Invitations"
      subtitle={list.data ? `${formatNumber(list.data.count)} invitations` : undefined}
      actions={
        <>
          <Button icon={UserPlus} onClick={() => setInvitingUser(true)}>
            Invite individual user
          </Button>
          <Button variant="primary" icon={Mail} onClick={() => setInvitingAdmin(true)}>
            Invite institution admin
          </Button>
        </>
      }
    >
      <Tabs label="Invitation status" items={INVITATION_FILTERS} value={status} onChange={setStatus} />
      <div className="flex flex-wrap items-end gap-3">
        <SearchInput label="Search email or name" value={q} onChange={(value) => { setQ(value); setPage(1); }} />
        <div className="w-72">
          <InstitutionPicker label="Institution" value={institution} onChange={(value) => { setInstitution(value); setPage(1); }} />
        </div>
        <div className="flex-1" />
        {status === 'expired' && (list.data?.count ?? 0) > 0 ? (
          <Button
            icon={RefreshCw}
            loading={resendExpired.isPending}
            onClick={() =>
              resendExpired.mutate(slug, {
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
            Resend all expired
          </Button>
        ) : null}
      </div>
      {list.isError ? <ErrorState error={list.error} onRetry={() => void list.refetch()} /> : null}
      <div>
        <InvitationTable invitations={list.data?.results ?? []} loading={list.isPending} emptyText="No invitations match these filters." />
        {list.data ? <Pagination page={page} pageSize={PAGE_SIZE} count={list.data.count} onPage={setPage} noun="invitations" /> : null}
      </div>
      <InviteAdminDialog open={invitingAdmin} onOpenChange={setInvitingAdmin} />
      <InviteUserDialog open={invitingUser} onOpenChange={setInvitingUser} />
    </Page>
  );
}
