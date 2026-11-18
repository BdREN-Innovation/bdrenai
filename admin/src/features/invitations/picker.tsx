import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import type { InstitutionOption } from '@/api/types';
import type { ComboboxOption } from '@/components/ui';
import { useInstitutionOptions } from '@/api/queries';
import { Combobox, IconButton, StatusChip } from '@/components/ui';
import { useDebouncedValue } from '@/lib/hooks';
import { formatSeats } from '@/lib/format';

export type PickedInstitution =
  | { kind: 'existing'; institution: Pick<InstitutionOption, 'slug' | 'name'> & Partial<InstitutionOption> }
  | { kind: 'new'; name: string };

const CREATE_VALUE = '__create__';

interface InstitutionPickerProps {
  value: PickedInstitution | null;
  onChange: (value: PickedInstitution | null) => void;
  allowCreate?: boolean;
  label?: string;
  error?: string;
  autoFocus?: boolean;
  required?: boolean;
}

/** Searches institutions/options; with allowCreate the last entry offers to create the typed name. */
export function InstitutionPicker({
  value,
  onChange,
  allowCreate = false,
  label = 'Institution',
  error,
  autoFocus,
  required = false,
}: InstitutionPickerProps) {
  const [query, setQuery] = useState('');
  const debounced = useDebouncedValue(query.trim());
  const options = useInstitutionOptions(debounced, value === null);
  const typed = query.trim();
  const settled = debounced === typed && !options.isPlaceholderData && !options.isPending;
  const results = settled ? (options.data?.results ?? []) : [];
  const exact = results.some((item) => item.name.toLowerCase() === typed.toLowerCase());

  const items: ComboboxOption[] = [
    ...results.map((item) => ({
      value: item.slug,
      label: item.name,
      hint: item.status === 'active' ? formatSeats(item.seats) : item.status === 'suspended' ? 'Suspended' : 'Removed',
    })),
    ...(allowCreate && settled && typed && !exact
      ? [{ value: CREATE_VALUE, label: `+ Create new institution "${typed}"` }]
      : []),
  ];

  if (value) {
    const name = value.kind === 'existing' ? value.institution.name : value.name;
    return (
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold text-ink">{label}</span>
        <div className="flex h-10 items-center gap-2 rounded-lg border border-stroke bg-surface-2 pr-1 pl-3">
          {value.kind === 'new' ? <Plus aria-hidden="true" size={14} className="text-brand-ink" /> : null}
          <span className="flex-1 truncate text-sm font-medium text-ink">
            {value.kind === 'new' ? `New institution: ${name}` : name}
          </span>
          {value.kind === 'existing' && value.institution.status && value.institution.status !== 'active' ? (
            <StatusChip status={value.institution.status} />
          ) : null}
          <IconButton icon={X} size="sm" label={`Change institution (${name})`} onClick={() => onChange(null)} />
        </div>
      </div>
    );
  }

  return (
    <Combobox
      label={label}
      required={required}
      autoFocus={autoFocus}
      inputValue={query}
      onInputChange={setQuery}
      options={items}
      loading={!settled || options.isFetching}
      placeholder="Search institutions"
      emptyText={allowCreate ? 'Type a name to search or create' : 'No institutions match'}
      error={error}
      onSelect={(option) => {
        if (option.value === CREATE_VALUE) return onChange({ kind: 'new', name: typed });
        const institution = results.find((item) => item.slug === option.value);
        if (institution) onChange({ kind: 'existing', institution });
        return undefined;
      }}
    />
  );
}
