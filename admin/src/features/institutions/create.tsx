import { useEffect, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { InstitutionForm, emptyDraft, isEmail, validateDraft } from './form';
import { Button, Dialog, ErrorState, Field, Input, useToast } from '@/components/ui';
import { useCreateInstitution } from '@/api/queries';
import { fieldErrors } from '@/api/client';
import type { DraftErrors } from './form';

interface CreateInstitutionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateInstitutionDialog({ open, onOpenChange }: CreateInstitutionDialogProps) {
  const navigate = useNavigate();
  const notify = useToast();
  const create = useCreateInstitution();
  const [draft, setDraft] = useState(emptyDraft);
  const [adminEmail, setAdminEmail] = useState('');
  const [adminName, setAdminName] = useState('');
  const [errors, setErrors] = useState<DraftErrors & { admin_email?: string }>({});
  const { reset } = create;

  useEffect(() => {
    if (!open) return;
    setDraft(emptyDraft());
    setAdminEmail('');
    setAdminName('');
    setErrors({});
    reset();
  }, [open, reset]);

  const serverErrors = fieldErrors(create.error);

  const submit = () => {
    const { fields, errors: draftErrors } = validateDraft(draft);
    const email = adminEmail.trim();
    const nextErrors = { ...draftErrors, ...(email && !isEmail(email) ? { admin_email: 'Enter a valid email address.' } : {}) };
    setErrors(nextErrors);
    if (!fields || Object.keys(nextErrors).length > 0) return;
    create.mutate(
      { ...fields, ...(email ? { admin: { email, name: adminName.trim() } } : {}) },
      {
        onSuccess: (result) => {
          onOpenChange(false);
          notify(`${result.institution.name} created.`);
          if (result.invitation && !result.email_sent) {
            notify(`The invitation email to ${result.invitation.email} could not be sent. Use Resend.`, 'warning');
          }
          void navigate({ to: '/institutions/$slug', params: { slug: result.institution.slug } });
        },
      },
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title="Create institution"
      description="Adds the institution and, if you enter an admin, emails them an invitation."
      onSubmit={submit}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={create.isPending}>
            Create institution
          </Button>
        </>
      }
    >
      <InstitutionForm draft={draft} onChange={setDraft} errors={{ ...serverErrors, ...errors }} autoFocusName />
      <div role="group" aria-labelledby="initial-admin-heading" className="grid grid-cols-1 gap-4 border-t border-stroke-muted pt-4 sm:grid-cols-2">
        <h3 id="initial-admin-heading" className="text-[13px] font-semibold text-ink sm:col-span-2">
          Initial admin <span className="font-normal text-ink-muted">(optional)</span>
        </h3>
        <Field label="Admin email" error={errors.admin_email ?? serverErrors['admin.email']}>
          {(props) => <Input {...props} type="email" value={adminEmail} onChange={(event) => setAdminEmail(event.target.value)} />}
        </Field>
        <Field label="Admin name" error={serverErrors['admin.name']}>
          {(props) => <Input {...props} value={adminName} onChange={(event) => setAdminName(event.target.value)} />}
        </Field>
      </div>
      {create.isError ? <ErrorState error={create.error} /> : null}
    </Dialog>
  );
}
