import type { MigrationPolicy, PackagePreview } from '@/api/types';
import { Checkbox, Field, Notice, RadioGroup, StatusChip, Textarea } from '@/components/ui';
import { MIGRATION_POLICIES } from '@/lib/labels';
import { formatNumber } from '@/lib/format';
import { describeChange } from './describe';

export interface ReviewValues {
  policy: MigrationPolicy;
  selected: string[];
  reason: string;
}

export const emptyReview = (): ReviewValues => ({ policy: 'new_only', selected: [], reason: '' });

export type ReviewErrors = Partial<Record<'selected' | 'reason', string>>;

export function reviewErrors(values: ReviewValues): ReviewErrors {
  return {
    ...(values.policy === 'selected_only' && values.selected.length === 0
      ? { selected: 'Tick at least one institution, or choose another timing.' }
      : {}),
    ...(values.reason.trim() ? {} : { reason: 'Say why this version is needed. It is kept in the version history.' }),
  };
}

interface ReviewStepProps {
  preview: PackagePreview;
  currency: string;
  values: ReviewValues;
  onChange: (values: ReviewValues) => void;
  errors: ReviewErrors;
}

/** The server's dry-run diff, who it reaches, when they move, and the reason kept with the version. */
export function ReviewStep({ preview, currency, values, onChange, errors }: ReviewStepProps) {
  const { affected } = preview;
  const lines = preview.changes.map((change) => describeChange(change, currency));
  const set = (patch: Partial<ReviewValues>) => onChange({ ...values, ...patch });
  const toggle = (id: string, checked: boolean) =>
    set({ selected: checked ? [...values.selected, id] : values.selected.filter((value) => value !== id) });

  return (
    <div className="flex flex-col gap-5">
      <section aria-labelledby="review-changes" className="flex flex-col gap-2">
        <h3 id="review-changes" className="text-[13px] font-semibold text-ink">
          What changes
        </h3>
        {lines.length === 0 ? (
          <Notice tone="info">Nothing changed. Go back and edit the terms, or close without publishing.</Notice>
        ) : (
          <ul className="flex flex-col gap-1.5 rounded-lg border border-stroke p-3 text-[13px] text-ink">
            {lines.map((line) => (
              <li key={line} className="flex gap-2">
                <span aria-hidden="true" className="text-ink-muted">
                  •
                </span>
                {line}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="review-affected" className="flex flex-col gap-2">
        <h3 id="review-affected" className="text-[13px] font-semibold text-ink">
          Who is affected
        </h3>
        {affected.subscriptions === 0 ? (
          <p className="text-[13px] text-ink-muted">No institution subscribes to this package yet, so only new subscribers get this version.</p>
        ) : (
          <>
            <p className="text-[13px] text-ink-muted">
              {formatNumber(affected.subscriptions)} active or trial {affected.subscriptions === 1 ? 'subscription' : 'subscriptions'} on
              earlier versions.
            </p>
            <ul aria-label="Affected institutions" className="flex max-h-48 flex-col overflow-y-auto rounded-lg border border-stroke">
              {affected.institutions.map((institution) => (
                <li key={institution.subscription_id} className="flex items-center gap-3 border-t border-stroke-muted px-3 py-2 first:border-t-0">
                  <span className="flex-1 truncate text-[13px] font-medium text-ink">{institution.name}</span>
                  <StatusChip status={institution.status} />
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <RadioGroup
        legend="When existing subscribers move"
        value={values.policy}
        onChange={(policy) => set({ policy })}
        options={MIGRATION_POLICIES.map((option) => ({ value: option.value, label: option.label, hint: option.sentence }))}
      />

      {values.policy === 'selected_only' ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="pb-1.5 text-xs font-semibold text-ink">Institutions to move now</legend>
          {affected.institutions.length === 0 ? (
            <p className="text-[13px] text-ink-muted">No institution is on an earlier version.</p>
          ) : (
            affected.institutions.map((institution) => (
              <Checkbox
                key={institution.subscription_id}
                label={institution.name}
                checked={values.selected.includes(institution.subscription_id)}
                onChange={(checked) => toggle(institution.subscription_id, checked)}
              />
            ))
          )}
          {errors.selected ? <p className="text-xs font-medium text-danger-fg">{errors.selected}</p> : null}
        </fieldset>
      ) : null}

      <Field label="Reason for this version" required error={errors.reason} hint="Shown in the version history and the audit log.">
        {(props) => <Textarea {...props} rows={2} value={values.reason} onChange={(event) => set({ reason: event.target.value })} />}
      </Field>
    </div>
  );
}
