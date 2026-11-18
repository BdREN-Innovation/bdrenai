import type { PackageRow } from '@/api/types';
import type { PackageStatusAction } from '@/api/queries';
import { ConfirmDialog, useToast } from '@/components/ui';
import { usePackageStatus } from '@/api/queries';

const COPY: Record<PackageStatusAction, { title: string; confirm: string; done: string; describe: (name: string) => string }> = {
  archive: {
    title: 'Archive package',
    confirm: 'Archive',
    done: 'archived',
    describe: (name) =>
      `${name} leaves the public pricing page and takes no new subscribers. Institutions already on it keep it until they change package. Nothing is deleted.`,
  },
  restore: {
    title: 'Restore package',
    confirm: 'Restore',
    done: 'restored',
    describe: (name) => `${name} can take new subscribers again and, if it is public, returns to the pricing page.`,
  },
};

interface PackageStatusDialogProps {
  pkg: Pick<PackageRow, 'id' | 'name'>;
  action: PackageStatusAction | null;
  onClose: () => void;
}

/** Archive (no new subscribers) or restore a package, with the reason kept in the audit log. */
export function PackageStatusDialog({ pkg, action, onClose }: PackageStatusDialogProps) {
  const notify = useToast();
  const change = usePackageStatus(pkg.id);
  const copy = COPY[action ?? 'archive'];

  return (
    <ConfirmDialog
      open={action !== null}
      onOpenChange={(open) => {
        if (open) return;
        onClose();
        change.reset();
      }}
      title={copy.title}
      description={copy.describe(pkg.name)}
      confirmLabel={copy.confirm}
      tone={action === 'restore' ? 'primary' : 'danger'}
      reason="required"
      pending={change.isPending}
      error={change.error}
      onConfirm={({ reason }) => {
        if (!action) return;
        change.mutate(
          { action, reason },
          {
            onSuccess: () => {
              notify(`${pkg.name} ${COPY[action].done}.`);
              onClose();
            },
          },
        );
      }}
    />
  );
}
