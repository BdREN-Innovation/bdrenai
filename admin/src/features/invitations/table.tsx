import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Ban, Send } from 'lucide-react';
import type { Invitation } from '@/api/types';
import { ConfirmDialog, Menu, StatusChip, Table, TableMessage, Td, Th, useToast } from '@/components/ui';
import { useResendInvitation, useRevokeInvitation } from '@/api/queries';
import { formatDate, formatRelative } from '@/lib/format';
import { errorMessage } from '@/api/client';
import { ROLE_LABEL } from '@/lib/labels';

const SOURCE_LABEL: Record<Invitation['source'], string> = {
  superadmin: 'Superadmin',
  portal: 'Institution portal',
  import: 'CSV import',
};

interface InvitationTableProps {
  invitations: Invitation[];
  loading: boolean;
  showInstitution?: boolean;
  emptyText: string;
}

const canChange = (invitation: Invitation) => invitation.status === 'pending' || invitation.status === 'expired';

export function InvitationTable({ invitations, loading, showInstitution = true, emptyText }: InvitationTableProps) {
  const notify = useToast();
  const resend = useResendInvitation();
  const revoke = useRevokeInvitation();
  const [revoking, setRevoking] = useState<Invitation | null>(null);
  const columns = showInstitution ? 7 : 6;

  const onResend = (invitation: Invitation) =>
    resend.mutate(invitation.id, {
      onSuccess: (result) =>
        result.email_sent === false
          ? notify(`The email to ${invitation.email} could not be sent.`, 'warning')
          : notify(`Invitation resent to ${invitation.email}. The old link no longer works.`),
      onError: (error) => notify(errorMessage(error), 'danger'),
    });

  return (
    <>
      <Table label="Invitations">
        <thead>
          <tr>
            <Th>Email</Th>
            {showInstitution ? <Th>Institution</Th> : null}
            <Th>Role</Th>
            <Th>Status</Th>
            <Th>Invited by</Th>
            <Th>Expires</Th>
            <Th className="w-12">
              <span className="sr-only">Actions</span>
            </Th>
          </tr>
        </thead>
        <tbody>
          {invitations.length === 0 ? (
            <TableMessage colSpan={columns}>{loading ? 'Loading…' : emptyText}</TableMessage>
          ) : (
            invitations.map((invitation) => (
              <tr key={invitation.id}>
                <Td>
                  <div className="flex flex-col">
                    <span className="font-medium">{invitation.email}</span>
                    {invitation.name ? <span className="text-xs text-ink-muted">{invitation.name}</span> : null}
                  </div>
                </Td>
                {showInstitution ? (
                  <Td>
                    {invitation.institution ? (
                      <Link to="/institutions/$slug" params={{ slug: invitation.institution.slug }} className="font-medium text-brand hover:underline">
                        {invitation.institution.name}
                      </Link>
                    ) : (
                      <span className="text-ink-muted">Individual</span>
                    )}
                  </Td>
                ) : null}
                <Td>{invitation.role ? ROLE_LABEL[invitation.role] : '—'}</Td>
                <Td>
                  <StatusChip status={invitation.status} />
                </Td>
                <Td>
                  <div className="flex flex-col">
                    <span>{invitation.invited_by?.name || invitation.invited_by?.email || '—'}</span>
                    <span className="text-xs text-ink-muted">
                      {SOURCE_LABEL[invitation.source]} · sent {invitation.sent_count}×
                    </span>
                  </div>
                </Td>
                <Td className="tabular whitespace-nowrap" title={formatDate(invitation.expires_at)}>
                  {invitation.status === 'accepted' ? `Accepted ${formatRelative(invitation.accepted_at)}` : formatRelative(invitation.expires_at)}
                </Td>
                <Td className="text-right">
                  {canChange(invitation) ? (
                    <Menu
                      label={`Actions for invitation to ${invitation.email}`}
                      actions={[
                        { label: 'Resend', icon: Send, onSelect: () => onResend(invitation) },
                        { label: 'Revoke', icon: Ban, danger: true, onSelect: () => setRevoking(invitation) },
                      ]}
                    />
                  ) : null}
                </Td>
              </tr>
            ))
          )}
        </tbody>
      </Table>
      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(open) => {
          if (!open) setRevoking(null);
          revoke.reset();
        }}
        title="Revoke invitation"
        description={revoking ? `The link sent to ${revoking.email} will stop working. This frees its seat.` : undefined}
        confirmLabel="Revoke invitation"
        reason="optional"
        pending={revoke.isPending}
        error={revoke.error}
        onConfirm={({ reason }) =>
          revoking &&
          revoke.mutate(
            { id: revoking.id, reason },
            {
              onSuccess: () => {
                notify(`Invitation to ${revoking.email} revoked.`);
                setRevoking(null);
              },
            },
          )
        }
      />
    </>
  );
}
