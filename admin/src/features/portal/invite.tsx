import { useEffect, useState } from 'react';
import type { PortalRole } from './types';
import { Button, Dialog, ErrorState, Field, Input, Select, useToast } from '@/components/ui';
import { portalErrorMessage } from './errors';
import { useInviteMember } from './queries';
import { ApiError } from '@/api/client';

const ROLES: { value: PortalRole; label: string }[] = [
  { value: 'member', label: 'Member' },
  { value: 'admin', label: 'Admin: can manage members' },
];

interface InviteForm {
  email: string;
  name: string;
  role: PortalRole;
}

const EMPTY: InviteForm = { email: '', name: '', role: 'member' };

interface InviteDialogProps {
  slug: string;
  institution: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Invite one person by email (any domain). Someone already in the institution on the free tier is added at once. */
export function InviteDialog({ slug, institution, open, onOpenChange }: InviteDialogProps) {
  const notify = useToast();
  const invite = useInviteMember(slug);
  const [form, setForm] = useState<InviteForm>(EMPTY);
  const ready = /.+@.+\..+/.test(form.email.trim());
  const emailError = invite.error instanceof ApiError ? invite.error.fields.email : undefined;
  const reset = invite.reset;

  useEffect(() => {
    if (!open) return;
    setForm(EMPTY);
    reset();
  }, [open, reset]);

  const submit = () => {
    if (!ready || invite.isPending) return;
    invite.mutate(
      { email: form.email.trim(), name: form.name.trim(), role: form.role },
      {
        onSuccess: ({ outcome, invitation, member, email_sent }) => {
          const email = invitation?.email ?? member?.user.email ?? form.email.trim();
          onOpenChange(false);
          if (outcome === 'covered') {
            const added = `${email} already had an account with your institution, so they are on your package now.`;
            notify(email_sent ? `${added} We emailed them.` : `${added} The email telling them didn't go out.`, email_sent ? 'success' : 'warning');
            return;
          }
          if (email_sent) notify(`Invitation sent to ${email}.`);
          else notify(`The invitation to ${email} is saved, but the email didn't go out. Use Resend on the Invited tab.`, 'warning');
        },
      },
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Invite member"
      description={`They get an email with a link to join ${institution}. Any email address works. Someone who already signed up with your institution is added to your package at once; someone on a personal plan must accept first.`}
      onSubmit={submit}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={!ready} loading={invite.isPending}>
            Send invitation
          </Button>
        </>
      }
    >
      <Field label="Email" required error={emailError}>
        {(props) => (
          <Input {...props} type="email" autoComplete="off" value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} />
        )}
      </Field>
      <Field label="Name" hint="Optional">
        {(props) => <Input {...props} autoComplete="off" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} />}
      </Field>
      <Field label="Role">
        {(props) => (
          <Select
            {...props}
            value={form.role}
            onChange={(event) => {
              const role = ROLES.find((item) => item.value === event.target.value)?.value ?? 'member';
              setForm((current) => ({ ...current, role }));
            }}
          >
            {ROLES.map((role) => (
              <option key={role.value} value={role.value}>
                {role.label}
              </option>
            ))}
          </Select>
        )}
      </Field>
      {invite.isError && !emailError ? <ErrorState error={new Error(portalErrorMessage(invite.error, "We couldn't send the invitation. Try again."))} /> : null}
    </Dialog>
  );
}
