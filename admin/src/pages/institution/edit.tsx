import { useEffect, useState } from 'react';
import type { InstitutionDetail, InstitutionSector, InstitutionType, UpdateInstitutionBody } from '@/api/types';
import { Button, Dialog, ErrorState, Field, Input, Notice, Select, Textarea, useToast } from '@/components/ui';
import { DEFAULT_TIMEZONE, INSTITUTION_TYPES, SECTORS, timezones } from '@/lib/labels';
import { isEmail, parseSeatCap } from '@/features/institutions/form';
import { useUpdateInstitution } from '@/api/queries';
import { fieldErrors } from '@/api/client';
import { parseDomains } from '@/lib/slug';

interface EditDraft {
  name: string;
  type: InstitutionType;
  sector: InstitutionSector | '';
  timezone: string;
  contact_email: string;
  domains: string;
  seat_cap: string;
  reason: string;
}

function toDraft(institution: InstitutionDetail): EditDraft {
  return {
    name: institution.name,
    type: institution.type,
    sector: institution.sector,
    timezone: institution.timezone || DEFAULT_TIMEZONE,
    contact_email: institution.contact_email,
    domains: institution.sign_in_domains.join(', '),
    seat_cap: institution.seats.cap === null ? '' : String(institution.seats.cap),
    reason: '',
  };
}

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((value, index) => value === b[index]);

interface EditInstitutionDialogProps {
  institution: InstitutionDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Sends only the changed fields; a seat cap change needs a reason (stored with the cap and in the audit log). */
export function EditInstitutionDialog({ institution, open, onOpenChange }: EditInstitutionDialogProps) {
  const notify = useToast();
  const update = useUpdateInstitution(institution.slug);
  const [draft, setDraft] = useState(() => toDraft(institution));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const zones = timezones();
  const { reset } = update;

  useEffect(() => {
    if (!open) return;
    setDraft(toDraft(institution));
    setErrors({});
    reset();
    // Reset only when the dialog opens, not when a background refetch replaces the institution.
  }, [open, reset]);

  const set = (patch: Partial<EditDraft>) => setDraft((current) => ({ ...current, ...patch }));
  const seatCap = parseSeatCap(draft.seat_cap);
  const capChanged = !seatCap.error && seatCap.cap !== institution.seats.cap;
  const serverErrors = fieldErrors(update.error);
  const shown = { ...serverErrors, ...errors };

  const submit = () => {
    const nextErrors: Record<string, string> = {};
    const { domains, invalid } = parseDomains(draft.domains);
    if (!draft.name.trim()) nextErrors.name = 'Enter the institution name.';
    if (draft.contact_email.trim() && !isEmail(draft.contact_email)) nextErrors.contact_email = 'Enter a valid email address.';
    if (invalid.length > 0) nextErrors.sign_in_domains = `Not a domain: ${invalid.join(', ')}`;
    if (seatCap.error) nextErrors.seat_cap = seatCap.error;
    if (capChanged && !draft.reason.trim()) nextErrors.reason = 'Give a reason for changing the seat cap.';
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    const body: UpdateInstitutionBody = {
      ...(draft.name.trim() !== institution.name ? { name: draft.name.trim() } : {}),
      ...(draft.type !== institution.type ? { type: draft.type } : {}),
      ...(draft.sector !== institution.sector ? { sector: draft.sector } : {}),
      ...(draft.timezone !== institution.timezone ? { timezone: draft.timezone } : {}),
      ...(draft.contact_email.trim() !== institution.contact_email ? { contact_email: draft.contact_email.trim() } : {}),
      ...(!sameList(domains, institution.sign_in_domains) ? { sign_in_domains: domains } : {}),
      ...(capChanged ? { seat_cap: seatCap.cap } : {}),
      ...(draft.reason.trim() ? { reason: draft.reason.trim() } : {}),
    };
    if (Object.keys(body).filter((key) => key !== 'reason').length === 0) {
      onOpenChange(false);
      return;
    }
    update.mutate(body, {
      onSuccess: (result) => {
        onOpenChange(false);
        notify(`${result.name} saved.`);
        if (result.warning === 'over_cap') {
          notify(`The new cap is below the ${result.seats.used} seats in use. New invites are blocked until seats are freed.`, 'warning');
        }
      },
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={`Edit ${institution.name}`}
      onSubmit={submit}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={update.isPending}>
            Save changes
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Institution name" required error={shown.name} className="sm:col-span-2">
          {(props) => <Input {...props} value={draft.name} onChange={(event) => set({ name: event.target.value })} />}
        </Field>
        <Field label="Type" error={shown.type}>
          {(props) => (
            <Select {...props} value={draft.type} onChange={(event) => set({ type: event.target.value as InstitutionType })}>
              {INSTITUTION_TYPES.map((type) => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Sector" error={shown.sector}>
          {(props) => (
            <Select
              {...props}
              value={draft.sector}
              onChange={(event) => set({ sector: event.target.value as InstitutionSector | '' })}
            >
              <option value="">Not set</option>
              {SECTORS.map((sector) => (
                <option key={sector.value} value={sector.value}>
                  {sector.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Timezone" error={shown.timezone}>
          {(props) => (
            <Select {...props} value={draft.timezone} onChange={(event) => set({ timezone: event.target.value })}>
              {zones.map((zone) => (
                <option key={zone} value={zone}>
                  {zone}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Contact email" error={shown.contact_email}>
          {(props) => <Input {...props} type="email" value={draft.contact_email} onChange={(event) => set({ contact_email: event.target.value })} />}
        </Field>
        <Field label="Sign-in domains" error={shown.sign_in_domains} hint="Comma-separated. Blank allows any email.">
          {(props) => <Input {...props} value={draft.domains} spellCheck={false} onChange={(event) => set({ domains: event.target.value })} />}
        </Field>
        <Field label="Seat cap" error={shown.seat_cap} hint={`${institution.seats.used} seats in use. Blank means no cap.`}>
          {(props) => (
            <Input
              {...props}
              type="number"
              min={1}
              step={1}
              inputMode="numeric"
              value={draft.seat_cap}
              onChange={(event) => set({ seat_cap: event.target.value })}
            />
          )}
        </Field>
        <Field
          label="Reason"
          required={capChanged}
          error={shown.reason}
          hint={capChanged ? 'Required when the seat cap changes. Saved in the audit log.' : 'Saved in the audit log.'}
          className="sm:col-span-2"
        >
          {(props) => <Textarea {...props} rows={2} value={draft.reason} onChange={(event) => set({ reason: event.target.value })} />}
        </Field>
      </div>
      {capChanged && seatCap.cap !== null && seatCap.cap < institution.seats.used ? (
        <Notice>
          The new cap is below the {institution.seats.used} seats in use. Nobody is removed, but new invites and approvals will be blocked.
        </Notice>
      ) : null}
      {update.isError ? <ErrorState error={update.error} /> : null}
    </Dialog>
  );
}
