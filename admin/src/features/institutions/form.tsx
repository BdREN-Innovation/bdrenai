import { useMemo } from 'react';
import type { DirectoryEntry, InstitutionFields, InstitutionSector, InstitutionType } from '@/api/types';
import { DEFAULT_TIMEZONE, INSTITUTION_TYPES, SECTORS, timezones } from '@/lib/labels';
import { SLUG_PATTERN, parseDomains, slugify } from '@/lib/slug';
import { Combobox, Field, Input, Select } from '@/components/ui';
import { useInstitutionDirectory } from '@/api/queries';
import { useDebouncedValue } from '@/lib/hooks';

export interface InstitutionDraft {
  name: string;
  slug: string;
  slugEdited: boolean;
  type: InstitutionType;
  sector: InstitutionSector | '';
  timezone: string;
  contact_email: string;
  domains: string;
  seat_cap: string;
}

export type DraftErrors = Partial<Record<keyof InstitutionFields | 'domains', string>>;

export function emptyDraft(name = ''): InstitutionDraft {
  return {
    name,
    slug: slugify(name),
    slugEdited: false,
    type: 'university',
    sector: '',
    timezone: DEFAULT_TIMEZONE,
    contact_email: '',
    domains: '',
    seat_cap: '',
  };
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isEmail(value: string): boolean {
  return EMAIL_PATTERN.test(value.trim());
}

/** Parses a seat cap field: blank is unlimited (null), otherwise a whole number of at least 1. */
export function parseSeatCap(value: string): { cap: number | null; error?: string } {
  const text = value.trim();
  if (text === '') return { cap: null };
  const cap = Number(text);
  if (!Number.isInteger(cap) || cap < 1) return { cap: null, error: 'Enter a whole number of at least 1, or leave blank for no cap.' };
  return { cap };
}

export function validateDraft(draft: InstitutionDraft): { fields?: InstitutionFields; errors: DraftErrors } {
  const errors: DraftErrors = {};
  const name = draft.name.trim();
  if (!name) errors.name = 'Enter the institution name.';
  if (!SLUG_PATTERN.test(draft.slug)) errors.slug = 'Use 2–64 lowercase letters, numbers or hyphens.';
  if (draft.contact_email.trim() && !isEmail(draft.contact_email)) errors.contact_email = 'Enter a valid email address.';
  const { domains, invalid } = parseDomains(draft.domains);
  if (invalid.length > 0) errors.sign_in_domains = `Not a domain: ${invalid.join(', ')}`;
  const seatCap = parseSeatCap(draft.seat_cap);
  if (seatCap.error) errors.seat_cap = seatCap.error;
  if (Object.keys(errors).length > 0) return { errors };
  return {
    errors,
    fields: {
      name,
      slug: draft.slug,
      type: draft.type,
      sector: draft.sector,
      timezone: draft.timezone,
      contact_email: draft.contact_email.trim(),
      sign_in_domains: domains,
      seat_cap: seatCap.cap,
    },
  };
}

interface InstitutionFormProps {
  draft: InstitutionDraft;
  onChange: (draft: InstitutionDraft) => void;
  errors: DraftErrors;
  autoFocusName?: boolean;
}

/** Fills the draft from a BdREN member directory entry; the slug follows unless it was edited by hand. */
export function draftFromDirectory(draft: InstitutionDraft, entry: DirectoryEntry): InstitutionDraft {
  return {
    ...draft,
    name: entry.name,
    slug: draft.slugEdited ? draft.slug : entry.suggested_slug,
    type: 'university',
    sector: entry.sector,
  };
}

function directoryHint(entry: DirectoryEntry): string {
  const sector = SECTORS.find((item) => item.value === entry.sector)?.label ?? '';
  return [entry.short_name, sector].filter(Boolean).join(' · ');
}

export function InstitutionForm({ draft, onChange, errors, autoFocusName }: InstitutionFormProps) {
  const zones = useMemo(timezones, []);
  const set = (patch: Partial<InstitutionDraft>) => onChange({ ...draft, ...patch });
  const search = useDebouncedValue(draft.name.trim());
  const directory = useInstitutionDirectory(search);
  const entries = directory.data?.results ?? [];
  const options = entries.map((entry) => ({ value: entry.suggested_slug, label: entry.name, hint: directoryHint(entry) }));

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <Combobox
          label="Institution name"
          required
          autoFocus={autoFocusName}
          error={errors.name}
          inputValue={draft.name}
          placeholder="Search BdREN members or type a new name"
          options={options}
          loading={directory.isFetching}
          emptyText="Not in the BdREN member list. The name you type is used."
          onInputChange={(name) => set({ name, slug: draft.slugEdited ? draft.slug : slugify(name) })}
          onSelect={(option) => {
            const entry = entries.find((item) => item.suggested_slug === option.value);
            if (entry) onChange(draftFromDirectory(draft, entry));
          }}
        />
      </div>
      <Field label="Slug" required error={errors.slug} hint="Used in links. Cannot be changed later.">
        {(props) => (
          <Input
            {...props}
            value={draft.slug}
            spellCheck={false}
            onChange={(event) => set({ slug: event.target.value.toLowerCase(), slugEdited: true })}
          />
        )}
      </Field>
      <Field label="Type" error={errors.type}>
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
      <Field label="Sector" error={errors.sector}>
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
      <Field label="Timezone" error={errors.timezone}>
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
      <Field label="Contact email" error={errors.contact_email}>
        {(props) => (
          <Input {...props} type="email" value={draft.contact_email} onChange={(event) => set({ contact_email: event.target.value })} />
        )}
      </Field>
      <Field
        label="Sign-in domains"
        error={errors.sign_in_domains}
        hint="Comma-separated, e.g. example.edu. People who sign up with a verified email on one of these join the institution. A domain can belong to one institution only."
      >
        {(props) => (
          <Input {...props} value={draft.domains} spellCheck={false} onChange={(event) => set({ domains: event.target.value })} />
        )}
      </Field>
      <Field label="Seat cap" error={errors.seat_cap} hint="Blank means no cap.">
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
    </div>
  );
}
