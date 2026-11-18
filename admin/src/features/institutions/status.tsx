import type { InstitutionRef } from '@/api/types';
import type { InstitutionStatusAction } from '@/api/queries';
import { ConfirmDialog, useToast } from '@/components/ui';
import { useInstitutionStatus } from '@/api/queries';

export interface StatusRequest {
  institution: InstitutionRef;
  action: InstitutionStatusAction;
}

const COPY: Record<InstitutionStatusAction, { title: string; confirm: string; done: string; describe: (name: string) => string }> = {
  suspend: {
    title: 'Suspend institution',
    confirm: 'Suspend',
    done: 'suspended',
    describe: (name) => `Members of ${name} lose access to every app until it is reactivated. Nothing is deleted.`,
  },
  reactivate: {
    title: 'Reactivate institution',
    confirm: 'Reactivate',
    done: 'reactivated',
    describe: (name) => `Members of ${name} get their access back.`,
  },
  deactivate: {
    title: 'Remove institution',
    confirm: 'Remove institution',
    done: 'removed',
    describe: (name) =>
      `${name} is deactivated: members lose access and pending invitations are revoked. Records are kept for the audit trail.`,
  },
};

/** Suspend, reactivate or remove (deactivate) an institution; removing needs the exact name typed. */
export function InstitutionStatusDialog({ request, onClose }: { request: StatusRequest | null; onClose: () => void }) {
  const notify = useToast();
  const change = useInstitutionStatus();
  const copy = request ? COPY[request.action] : COPY.suspend;

  return (
    <ConfirmDialog
      open={request !== null}
      onOpenChange={(open) => {
        if (open) return;
        onClose();
        change.reset();
      }}
      title={copy.title}
      description={request ? copy.describe(request.institution.name) : undefined}
      confirmLabel={copy.confirm}
      tone={request?.action === 'reactivate' ? 'primary' : 'danger'}
      reason="required"
      typedConfirmation={request?.action === 'deactivate' ? request.institution.name : undefined}
      pending={change.isPending}
      error={change.error}
      onConfirm={({ reason }) => {
        if (!request) return;
        const { institution, action } = request;
        const body = action === 'deactivate' ? { reason, confirm: institution.name } : { reason };
        change.mutate(
          { slug: institution.slug, action, body },
          {
            onSuccess: () => {
              notify(`${institution.name} ${COPY[action].done}.`);
              onClose();
            },
          },
        );
      }}
    />
  );
}
