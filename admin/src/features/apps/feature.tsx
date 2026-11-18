import { useState } from 'react';
import type { ConfigApp, CreateFeatureBody, Feature, FeatureStatus, QuotaPolicy, UpdateFeatureBody } from '@/api/types';
import { Button, Dialog, ErrorState, Field, Input, Select, Textarea, useToast } from '@/components/ui';
import { FEATURE_STATUSES, QUOTA_POLICIES } from '@/lib/labels';
import { useCreateFeature, useUpdateFeature } from '@/api/queries';
import { fieldErrors } from '@/api/client';

export interface FeatureTarget {
  app: ConfigApp;
  /** null adds a feature to the app. */
  feature: Feature | null;
}

interface FeatureDraft {
  key: string;
  name: string;
  unit: string;
  description: string;
  quota_policy: QuotaPolicy;
  status: FeatureStatus;
}

const KEY_PATTERN = /^[a-z0-9_]{2,64}$/;

const toDraft = (feature: Feature | null): FeatureDraft => ({
  key: feature?.key ?? '',
  name: feature?.name ?? '',
  unit: feature?.unit ?? '',
  description: feature?.description ?? '',
  quota_policy: feature?.quota_policy ?? 'personal_then_org',
  status: feature?.status ?? 'active',
});

function validate(draft: FeatureDraft): Record<string, string> {
  return {
    ...(KEY_PATTERN.test(draft.key) ? {} : { key: 'Use 2–64 lowercase letters, numbers and underscores.' }),
    ...(draft.name.trim() ? {} : { name: 'Enter the feature name.' }),
    ...(draft.unit.trim() ? {} : { unit: 'Enter what is counted, e.g. messages or pages.' }),
  };
}

function changes(draft: FeatureDraft, feature: Feature): UpdateFeatureBody {
  return {
    ...(draft.key !== feature.key ? { key: draft.key } : {}),
    ...(draft.name.trim() !== feature.name ? { name: draft.name.trim() } : {}),
    ...(draft.unit.trim() !== feature.unit ? { unit: draft.unit.trim() } : {}),
    ...(draft.description.trim() !== feature.description ? { description: draft.description.trim() } : {}),
    ...(draft.quota_policy !== feature.quota_policy ? { quota_policy: draft.quota_policy } : {}),
    ...(draft.status !== feature.status ? { status: draft.status } : {}),
  };
}

function FeatureForm({ target, onClose }: { target: FeatureTarget; onClose: () => void }) {
  const notify = useToast();
  const create = useCreateFeature();
  const update = useUpdateFeature();
  const { app, feature } = target;
  const [draft, setDraft] = useState(() => toDraft(feature));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const locked = feature?.in_use ?? false;
  const failed = create.error ?? update.error;
  const shown = { ...fieldErrors(failed), ...errors };
  const set = (patch: Partial<FeatureDraft>) => setDraft((current) => ({ ...current, ...patch }));
  const done = (result: Feature) => {
    notify(feature ? `${result.name} saved.` : `${result.name} added to ${app.name}.`);
    onClose();
  };

  const submit = () => {
    const next = validate(draft);
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    if (!feature) {
      const body: CreateFeatureBody = {
        key: draft.key,
        name: draft.name.trim(),
        unit: draft.unit.trim(),
        description: draft.description.trim(),
        quota_policy: draft.quota_policy,
      };
      create.mutate({ app: app.slug, body }, { onSuccess: done });
      return;
    }
    const body = changes(draft, feature);
    if (Object.keys(body).length === 0) {
      onClose();
      return;
    }
    update.mutate({ id: feature.id, body }, { onSuccess: done });
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={feature ? `Edit ${feature.name}` : `Add a ${app.name} feature`}
      description="A feature is something a package can limit, such as messages or pages scanned."
      onSubmit={submit}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={create.isPending || update.isPending}>
            {feature ? 'Save changes' : 'Add feature'}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Name" required error={shown.name}>
          {(props) => <Input {...props} value={draft.name} onChange={(event) => set({ name: event.target.value })} />}
        </Field>
        <Field
          label="Key"
          required
          error={shown.key}
          hint={locked ? 'Packages use this feature, so the key is fixed.' : 'Apps report usage with this key, e.g. chat_messages.'}
        >
          {(props) => (
            <Input {...props} value={draft.key} disabled={locked} spellCheck={false} onChange={(event) => set({ key: event.target.value })} />
          )}
        </Field>
        <Field label="Unit" required error={shown.unit} hint={locked ? 'Packages use this feature, so the unit is fixed.' : 'What is counted, e.g. messages.'}>
          {(props) => <Input {...props} value={draft.unit} disabled={locked} onChange={(event) => set({ unit: event.target.value })} />}
        </Field>
        <Field label="Quota policy" error={shown.quota_policy} hint="Whose allowance is used first.">
          {(props) => (
            <Select {...props} value={draft.quota_policy} onChange={(event) => set({ quota_policy: event.target.value as QuotaPolicy })}>
              {QUOTA_POLICIES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Description" error={shown.description} className="sm:col-span-2">
          {(props) => <Textarea {...props} rows={2} value={draft.description} onChange={(event) => set({ description: event.target.value })} />}
        </Field>
        {feature ? (
          <Field label="Status" error={shown.status} hint="Inactive features cannot be added to new versions.">
            {(props) => (
              <Select {...props} value={draft.status} onChange={(event) => set({ status: event.target.value as FeatureStatus })}>
                {FEATURE_STATUSES.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        ) : null}
      </div>
      {failed ? <ErrorState error={failed} /> : null}
    </Dialog>
  );
}

/** Add a feature to an app, or edit one; key and unit lock once a package uses the feature. */
export function FeatureDialog({ target, onClose }: { target: FeatureTarget | null; onClose: () => void }) {
  return target ? <FeatureForm target={target} onClose={onClose} /> : null;
}
