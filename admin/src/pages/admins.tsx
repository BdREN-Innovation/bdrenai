import { useState } from 'react';
import { ShieldCheck, Trash2, UserPlus } from 'lucide-react';
import type { SuperAdmin } from '@/api/types';
import {
  Button,
  Card,
  ConfirmDialog,
  Dialog,
  ErrorState,
  Field,
  IconButton,
  Input,
  StatusChip,
  Table,
  TableMessage,
  Td,
  Th,
  useToast,
} from '@/components/ui';
import { useAddAdmin, useAdmins, useRemoveAdmin, useSession } from '@/api/queries';
import { isEmail } from '@/features/institutions/form';
import { Page } from '@/components/layout/Page';
import { formatDate } from '@/lib/format';

function AddAdminDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const notify = useToast();
  const add = useAddAdmin();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string>();

  const change = (value: boolean) => {
    onOpenChange(value);
    if (value) return;
    setEmail('');
    setError(undefined);
    add.reset();
  };

  const submit = () => {
    if (!isEmail(email)) return setError('Enter a valid email address.');
    setError(undefined);
    add.mutate(
      { email: email.trim() },
      {
        onSuccess: (admin) => {
          notify(`${admin.user.email} is now a superadmin.`);
          change(false);
        },
      },
    );
    return undefined;
  };

  return (
    <Dialog
      open={open}
      onOpenChange={change}
      title="Add superadmin"
      description="The person must have signed in to BDREN AI at least once. Superadmins can change every institution and account."
      onSubmit={submit}
      footer={
        <>
          <Button variant="ghost" onClick={() => change(false)}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={add.isPending}>
            Add superadmin
          </Button>
        </>
      }
    >
      <Field label="Email" required error={error}>
        {(props) => <Input {...props} autoFocus type="email" value={email} onChange={(event) => setEmail(event.target.value)} />}
      </Field>
      {add.isError ? <ErrorState error={add.error} /> : null}
    </Dialog>
  );
}

export function AdminsPage() {
  const notify = useToast();
  const session = useSession();
  const admins = useAdmins();
  const remove = useRemoveAdmin();
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<SuperAdmin | null>(null);
  const results = admins.data?.results ?? [];
  const selfId = session.data?.user.id;
  const onlyOne = results.length <= 1;

  return (
    <Page
      title="Admins & roles"
      subtitle="Who can use this panel"
      actions={
        <Button variant="primary" icon={UserPlus} onClick={() => setAdding(true)}>
          Add superadmin
        </Button>
      }
    >
      <Card title="Platform superadmin" description="Full access to every institution, account, invitation and the audit log. Other staff roles come later.">
        <p className="flex items-center gap-2 text-[13px] text-ink-muted">
          <ShieldCheck aria-hidden="true" size={16} className="text-brand-ink" />
          Role: <code className="font-mono text-xs text-ink">platform_super_admin</code>
        </p>
      </Card>
      {admins.isError ? <ErrorState error={admins.error} onRetry={() => void admins.refetch()} /> : null}
      <Table label="Superadmins">
        <thead>
          <tr>
            <Th>Person</Th>
            <Th>Account</Th>
            <Th>Granted</Th>
            <Th className="w-12">
              <span className="sr-only">Actions</span>
            </Th>
          </tr>
        </thead>
        <tbody>
          {results.length === 0 ? (
            <TableMessage colSpan={4}>{admins.isPending ? 'Loading…' : 'No superadmins found.'}</TableMessage>
          ) : (
            results.map((admin) => {
              const isSelf = admin.user.id === selfId;
              const blocked = isSelf ? 'You cannot remove yourself' : onlyOne ? 'The last superadmin cannot be removed' : undefined;
              return (
                <tr key={admin.user.id}>
                  <Td>
                    <div className="flex flex-col">
                      <span className="font-medium">
                        {admin.user.name || '—'}
                        {isSelf ? <span className="font-normal text-ink-muted"> (you)</span> : null}
                      </span>
                      <span className="text-xs text-ink-muted">{admin.user.email}</span>
                    </div>
                  </Td>
                  <Td>
                    <StatusChip status={admin.user.status} />
                  </Td>
                  <Td className="tabular">{formatDate(admin.granted_at)}</Td>
                  <Td className="text-right">
                    <IconButton
                      icon={Trash2}
                      size="sm"
                      label={blocked ?? `Remove ${admin.user.email} as superadmin`}
                      disabled={blocked !== undefined}
                      onClick={() => setRemoving(admin)}
                    />
                  </Td>
                </tr>
              );
            })
          )}
        </tbody>
      </Table>
      <AddAdminDialog open={adding} onOpenChange={setAdding} />
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (open) return;
          setRemoving(null);
          remove.reset();
        }}
        title="Remove superadmin"
        description={removing ? `${removing.user.email} loses access to this panel. Their account and memberships stay.` : undefined}
        confirmLabel="Remove superadmin"
        typedConfirmation={removing?.user.email}
        pending={remove.isPending}
        error={remove.error}
        onConfirm={() =>
          removing &&
          remove.mutate(removing.user.id, {
            onSuccess: () => {
              notify(`${removing.user.email} is no longer a superadmin.`);
              setRemoving(null);
            },
          })
        }
      />
    </Page>
  );
}
