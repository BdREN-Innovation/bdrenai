import { useEffect, useState } from 'react';
import type { CreateInvitationBody, CreateInvitationResponse, InstitutionRef, Role } from '@/api/types';
import type { PickedInstitution } from './picker';
import { InstitutionForm, emptyDraft, isEmail, validateDraft } from '@/features/institutions/form';
import { Button, Dialog, ErrorState, Field, Input, Select, useToast } from '@/components/ui';
import type { DraftErrors, InstitutionDraft } from '@/features/institutions/form';
import { useCreateInvitation } from '@/api/queries';
import { fieldErrors } from '@/api/client';
import { InstitutionPicker } from './picker';
import { ROLES } from '@/lib/labels';

type Notify = ReturnType<typeof useToast>;

function reportCovered(result: CreateInvitationResponse, notify: Notify) {
  const person = result.member ? result.member.user.name || result.member.user.email : 'This person';
  const institution = result.institution?.name ?? 'the institution';
  notify(`${person} already belonged to ${institution} and is now on its package. No invitation was needed.`);
  if (!result.email_sent) notify(`The notice email to ${person} could not be sent.`, 'warning');
}

function reportInvite(result: CreateInvitationResponse, notify: Notify) {
  if (result.outcome === 'covered' || !result.invitation) return reportCovered(result, notify);
  notify(`Invitation sent to ${result.invitation.email}.`);
  if (result.warning === 'institution_suspended') {
    notify('This institution is suspended. The person can accept, but cannot use the apps until it is reactivated.', 'warning');
  }
  if (!result.email_sent) notify(`The email to ${result.invitation.email} could not be sent. Use Resend.`, 'warning');
  return undefined;
}

interface InviteAdminDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Starts with this institution picked (from an institution row or page). */
  institution?: InstitutionRef;
}

export function InviteAdminDialog({ open, onOpenChange, institution }: InviteAdminDialogProps) {
  const notify = useToast();
  const invite = useCreateInvitation();
  const [picked, setPicked] = useState<PickedInstitution | null>(null);
  const [draft, setDraft] = useState<InstitutionDraft>(emptyDraft);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<Role>('admin');
  const [errors, setErrors] = useState<DraftErrors & { email?: string; institution?: string }>({});
  const { reset } = invite;
  const initialSlug = institution?.slug;
  const initialName = institution?.name;

  useEffect(() => {
    if (!open) return;
    setPicked(initialSlug && initialName ? { kind: 'existing', institution: { slug: initialSlug, name: initialName } } : null);
    setDraft(emptyDraft());
    setEmail('');
    setName('');
    setRole('admin');
    setErrors({});
    reset();
  }, [open, initialSlug, initialName, reset]);

  const pick = (value: PickedInstitution | null) => {
    setPicked(value);
    if (value?.kind === 'new') setDraft(emptyDraft(value.name));
  };

  const serverErrors = fieldErrors(invite.error, 'new_institution.');

  const submit = () => {
    const nextErrors: typeof errors = {};
    if (!picked) nextErrors.institution = 'Pick an institution or create a new one.';
    if (!isEmail(email)) nextErrors.email = 'Enter a valid email address.';
    const created = picked?.kind === 'new' ? validateDraft(draft) : null;
    Object.assign(nextErrors, created?.errors);
    setErrors(nextErrors);
    if (!picked || Object.keys(nextErrors).length > 0) return;

    const person = { email: email.trim(), name: name.trim(), role };
    if (picked.kind === 'existing') return send({ institution: picked.institution.slug, ...person }, false);
    if (created?.fields) send({ new_institution: created.fields, ...person }, true);
    return undefined;
  };

  const send = (body: CreateInvitationBody, createsInstitution: boolean) =>
    invite.mutate(body, {
      onSuccess: (result) => {
        onOpenChange(false);
        if (result.institution && createsInstitution) notify(`${result.institution.name} created.`);
        reportInvite(result, notify);
      },
    });

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title="Invite institution admin"
      description="Pick the institution, or create it here if it is not listed. The admin gets an email with a sign-in link."
      onSubmit={submit}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={invite.isPending}>
            {picked?.kind === 'new' ? 'Create and invite' : 'Send invitation'}
          </Button>
        </>
      }
    >
      <InstitutionPicker
        value={picked?.kind === 'new' ? { kind: 'new', name: draft.name.trim() || picked.name } : picked}
        onChange={pick}
        allowCreate
        required
        autoFocus={!institution}
        error={errors.institution ?? serverErrors.institution}
      />
      {picked?.kind === 'new' ? (
        <div role="group" aria-label="New institution" className="rounded-lg border border-stroke-muted bg-surface-2 p-4">
          <InstitutionForm draft={draft} onChange={setDraft} errors={{ ...serverErrors, ...errors }} />
        </div>
      ) : null}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Email" required error={errors.email ?? serverErrors.email}>
          {(props) => <Input {...props} type="email" value={email} onChange={(event) => setEmail(event.target.value)} />}
        </Field>
        <Field label="Name" error={serverErrors.name}>
          {(props) => <Input {...props} value={name} onChange={(event) => setName(event.target.value)} />}
        </Field>
        <Field label="Role" error={serverErrors.role} hint="Institution admins manage members in the portal.">
          {(props) => (
            <Select {...props} value={role} onChange={(event) => setRole(event.target.value as Role)}>
              {ROLES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      {invite.isError ? <ErrorState error={invite.error} /> : null}
    </Dialog>
  );
}

interface InviteUserDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Individual invite: a personal account with no institution. */
export function InviteUserDialog({ open, onOpenChange }: InviteUserDialogProps) {
  const notify = useToast();
  const invite = useCreateInvitation();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [emailError, setEmailError] = useState<string>();
  const { reset } = invite;

  useEffect(() => {
    if (!open) return;
    setEmail('');
    setName('');
    setEmailError(undefined);
    reset();
  }, [open, reset]);

  const submit = () => {
    if (!isEmail(email)) return setEmailError('Enter a valid email address.');
    setEmailError(undefined);
    invite.mutate(
      { institution: null, email: email.trim(), name: name.trim() },
      {
        onSuccess: (result) => {
          onOpenChange(false);
          reportInvite(result, notify);
        },
      },
    );
    return undefined;
  };

  const serverErrors = fieldErrors(invite.error);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Invite individual user"
      description="Creates a personal account with no institution once they accept."
      onSubmit={submit}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={invite.isPending}>
            Send invitation
          </Button>
        </>
      }
    >
      <Field label="Email" required error={emailError ?? serverErrors.email}>
        {(props) => <Input {...props} autoFocus type="email" value={email} onChange={(event) => setEmail(event.target.value)} />}
      </Field>
      <Field label="Name" error={serverErrors.name}>
        {(props) => <Input {...props} value={name} onChange={(event) => setName(event.target.value)} />}
      </Field>
      {invite.isError ? <ErrorState error={invite.error} /> : null}
    </Dialog>
  );
}
