import { useEffect, useState } from 'react';
import type { Role } from '@/api/types';
import { ConfirmDialog, Notice, useToast } from '@/components/ui';
import { useRemoveMembership, useUpdateMembership } from '@/api/queries';
import { ApiError } from '@/api/client';
import { ROLE_LABEL } from '@/lib/labels';

export type MembershipAction =
  | { kind: 'revoke_admin' | 'suspend' | 'activate' | 'approve' | 'remove'; membershipId: string; name: string }
  | { kind: 'role'; membershipId: string; name: string; role: Role };

interface Copy {
  title: string;
  confirm: string;
  done: string;
  tone: 'danger' | 'primary';
  describe: string;
}

function copyFor(action: MembershipAction): Copy {
  const { name } = action;
  switch (action.kind) {
    case 'revoke_admin':
      return { title: 'Revoke admin role', confirm: 'Revoke', done: `${name} is now a member.`, tone: 'danger', describe: `${name} stays a member but can no longer manage the institution.` };
    case 'suspend':
      return { title: 'Suspend member', confirm: 'Suspend', done: `${name} suspended.`, tone: 'danger', describe: `${name} loses access to this institution's apps. Their seat is freed.` };
    case 'activate':
      return { title: 'Reactivate member', confirm: 'Reactivate', done: `${name} reactivated.`, tone: 'primary', describe: `${name} gets access again. This uses a seat.` };
    case 'approve':
      return { title: 'Approve sign-up request', confirm: 'Approve', done: `${name} approved.`, tone: 'primary', describe: `${name} becomes an active member. This uses a seat.` };
    case 'remove':
      return { title: 'Remove member', confirm: 'Remove', done: `${name} removed.`, tone: 'danger', describe: `${name} is removed from the institution and the seat is freed. The account itself stays.` };
    case 'role':
      return { title: 'Change role', confirm: 'Change role', done: `${name} is now ${ROLE_LABEL[action.role]}.`, tone: 'primary', describe: `${name} becomes ${ROLE_LABEL[action.role]}.` };
  }
}

function patchBody(action: MembershipAction) {
  switch (action.kind) {
    case 'revoke_admin':
      return { role: 'member' as const };
    case 'suspend':
      return { status: 'suspended' as const };
    case 'activate':
    case 'approve':
      return { status: 'active' as const };
    case 'role':
      return { role: action.role };
    case 'remove':
      return {};
  }
}

/** Confirms one membership change. A 409 last_admin lets the superadmin retry with force. */
export function MembershipActionDialog({ action, onClose }: { action: MembershipAction | null; onClose: () => void }) {
  const notify = useToast();
  const update = useUpdateMembership();
  const remove = useRemoveMembership();
  const [force, setForce] = useState(false);
  const mutation = action?.kind === 'remove' ? remove : update;
  const lastAdmin = mutation.error instanceof ApiError && mutation.error.code === 'last_admin';
  const resetUpdate = update.reset;
  const resetRemove = remove.reset;

  useEffect(() => {
    setForce(false);
    resetUpdate();
    resetRemove();
  }, [action, resetUpdate, resetRemove]);

  const copy = action ? copyFor(action) : null;
  const isRemove = action?.kind === 'remove';
  const onSuccess = () => {
    if (copy) notify(copy.done);
    onClose();
  };

  const confirm = (reason: string) => {
    if (!action) return;
    if (action.kind === 'remove') {
      remove.mutate({ id: action.membershipId, reason }, { onSuccess });
      return;
    }
    const body = { ...patchBody(action), ...(reason ? { reason } : {}), ...(force ? { force: true } : {}) };
    update.mutate({ id: action.membershipId, body }, { onSuccess });
  };

  return (
    <ConfirmDialog
      open={action !== null}
      onOpenChange={(open) => !open && onClose()}
      title={copy?.title ?? ''}
      description={copy?.describe}
      confirmLabel={force ? `${copy?.confirm} anyway` : (copy?.confirm ?? '')}
      tone={copy?.tone}
      reason={isRemove || action?.kind === 'suspend' ? 'required' : 'optional'}
      pending={mutation.isPending}
      error={lastAdmin && !isRemove ? undefined : mutation.error}
      onConfirm={({ reason }) => confirm(reason)}
    >
      {lastAdmin && !isRemove ? (
        <Notice tone="danger">
          <p>This would leave the institution with no active owner or admin.</p>
          <label className="mt-2 flex items-center gap-2 font-normal">
            <input type="checkbox" checked={force} onChange={(event) => setForce(event.target.checked)} className="size-4 accent-brand" />
            Do it anyway; I will add another admin
          </label>
        </Notice>
      ) : null}
    </ConfirmDialog>
  );
}
