import { useEffect, useState } from 'react';
import type { InvitationFilter } from './tabs';
import type { PortalInvitation } from './types';
import { Button, ConfirmDialog, ErrorState, Pagination, Select, StatusChip, Table, TableMessage, Td, Th, useToast } from '@/components/ui';
import { usePortalInvitations, useResendInvitation, useRevokeInvitation } from './queries';
import { INVITATION_FILTERS } from './tabs';
import { portalErrorMessage } from './errors';
import { ROLE_LABEL } from '@/lib/labels';
import { formatDate } from '@/lib/format';

const PAGE_SIZE = 25;

interface InvitationsTabProps {
  slug: string;
  q: string;
  status: InvitationFilter;
  onStatus: (status: InvitationFilter) => void;
}

/** The institution's invitations by status, with Resend and Revoke for the open ones. */
export function InvitationsTab({ slug, q, status, onStatus }: InvitationsTabProps) {
  const notify = useToast();
  const [page, setPage] = useState(1);
  const [revoking, setRevoking] = useState<PortalInvitation | null>(null);
  const resend = useResendInvitation(slug);
  const revoke = useRevokeInvitation(slug);
  const list = usePortalInvitations(slug, { status, q, page, page_size: PAGE_SIZE });
  const rows = list.data?.results ?? [];

  useEffect(() => {
    setPage(1);
  }, [q, status]);

  const resendTo = (invitation: PortalInvitation) =>
    resend.mutate(invitation.id, {
      onSuccess: (result) =>
        result.email_sent === false
          ? notify(`The invitation to ${invitation.email} is renewed, but the email didn't go out. Try Resend again shortly.`, 'warning')
          : notify(`A new invitation link went to ${invitation.email}. The old link no longer works.`),
      onError: (error) => notify(portalErrorMessage(error, `We couldn't resend the invitation to ${invitation.email}.`), 'danger'),
    });

  const revokeConfirmed = () => {
    if (!revoking) return;
    const email = revoking.email;
    revoke.mutate(revoking.id, {
      onSuccess: () => {
        notify(`The invitation to ${email} is revoked.`);
        setRevoking(null);
      },
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <Select
        inline
        aria-label="Invitation status"
        value={status}
        onChange={(event) => onStatus(INVITATION_FILTERS.find((item) => item.value === event.target.value)?.value ?? '')}
        className="self-start"
      >
        {INVITATION_FILTERS.map((item) => (
          <option key={item.value} value={item.value}>
            {item.label}
          </option>
        ))}
      </Select>
      {list.isError ? <ErrorState error={new Error("We couldn't load invitations.")} onRetry={() => void list.refetch()} /> : null}
      <div>
        <Table label={`Invitations, ${list.data?.count ?? 0} in all`}>
          <thead>
            <tr>
              <Th>Email</Th>
              <Th>Role</Th>
              <Th>Status</Th>
              <Th>Invited by</Th>
              <Th>Expires</Th>
              <Th>
                <span className="sr-only">Actions</span>
              </Th>
            </tr>
          </thead>
          <tbody aria-busy={list.isFetching}>
            {list.isPending ? <TableMessage colSpan={6}>Loading invitations…</TableMessage> : null}
            {list.data && rows.length === 0 ? <TableMessage colSpan={6}>No invitations here.</TableMessage> : null}
            {rows.map((invitation) => {
              const open = invitation.status === 'pending' || invitation.status === 'expired';
              const busy = (resend.isPending && resend.variables === invitation.id) || (revoke.isPending && revoke.variables === invitation.id);
              return (
                <tr key={invitation.id}>
                  <Td>
                    <span className="block font-medium">{invitation.email}</span>
                    {invitation.name ? <span className="block text-xs text-ink-muted">{invitation.name}</span> : null}
                  </Td>
                  <Td>{invitation.role ? ROLE_LABEL[invitation.role] : '—'}</Td>
                  <Td>
                    <StatusChip status={invitation.status} />
                    <span className="mt-1 block text-xs text-ink-muted">Sent {invitation.sent_count}×</span>
                  </Td>
                  <Td>{invitation.invited_by?.name || '—'}</Td>
                  <Td>{formatDate(invitation.expires_at)}</Td>
                  <Td className="text-right">
                    {open ? (
                      <span role="group" aria-label={`Actions for ${invitation.email}`} className="inline-flex gap-1">
                        <Button size="sm" variant="ghost" disabled={busy} onClick={() => resendTo(invitation)}>
                          Resend
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() => {
                            revoke.reset();
                            setRevoking(invitation);
                          }}
                        >
                          Revoke
                        </Button>
                      </span>
                    ) : null}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
        {list.data ? <Pagination page={list.data.page} pageSize={list.data.page_size} count={list.data.count} onPage={setPage} noun="invitations" /> : null}
      </div>
      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(next) => !next && setRevoking(null)}
        title={revoking ? `Revoke the invitation to ${revoking.email}?` : ''}
        description="The link in their email stops working and the seat it held is freed."
        confirmLabel="Revoke"
        pending={revoke.isPending}
        error={revoke.isError ? new Error(portalErrorMessage(revoke.error, "We couldn't revoke the invitation.")) : undefined}
        onConfirm={revokeConfirmed}
      />
    </div>
  );
}
