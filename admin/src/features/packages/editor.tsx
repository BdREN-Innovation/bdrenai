import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import type { BillingInterval, ConfigApp, PackageDetail, PackageKind, PackagePreview, PackageTermsBody, PriceUnit } from '@/api/types';
import type { DraftErrors, PackageDraft } from './draft';
import type { ReviewErrors } from './review';
import {
  Button,
  Checkbox,
  Chip,
  Dialog,
  ErrorState,
  Field,
  Input,
  LoadingState,
  Segmented,
  Select,
  useToast,
} from '@/components/ui';
import { draftFromPackage, draftServerErrors, emptyDraft, includedApps, isPrice, validateCreate, validateTerms, withApps } from './draft';
import { useConfigApps, useCreatePackage, usePackagePreview, usePublishVersion } from '@/api/queries';
import { BILLING_INTERVALS, PACKAGE_KIND_LABEL, PRICE_UNITS } from '@/lib/labels';
import { ReviewStep, emptyReview, reviewErrors } from './review';
import { ApiError, fieldErrors } from '@/api/client';
import { formatPrice } from '@/lib/format';
import { PresentationFields } from './presentation';
import { LimitsEditor } from './limits';
import { slugify } from '@/lib/slug';

export type EditorTarget = { mode: 'create'; kind: PackageKind } | { mode: 'version'; pkg: PackageDetail };

interface PackageEditorProps {
  target: EditorTarget | null;
  onClose: () => void;
}

const CREATE_TITLE: Record<PackageKind, string> = { bundle: 'New combined package', single: 'New package' };

const KIND_OPTIONS = (['bundle', 'single'] as const).map((value) => ({ value, label: PACKAGE_KIND_LABEL[value] }));

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3 border-t border-stroke-muted pt-4 first:border-t-0 first:pt-0">
      <h3 id={id} className="text-[13px] font-semibold text-ink">
        {title}
      </h3>
      {children}
    </section>
  );
}

function AppsPicker({ apps, draft, onChange, error }: { apps: ConfigApp[]; draft: PackageDraft; onChange: (draft: PackageDraft) => void; error?: string }) {
  const selected = new Set(draft.apps);
  const choices = apps.filter((app) => app.status === 'active' || selected.has(app.slug));
  const active = choices.filter((app) => app.status === 'active');
  const allActive = active.length > 0 && active.every((app) => selected.has(app.slug));
  const set = (slugs: Set<string>) => onChange(withApps(draft, { apps: choices.filter((app) => slugs.has(app.slug)).map((app) => app.slug) }));
  const toggle = (slug: string, checked: boolean) => {
    const next = new Set(selected);
    if (checked) next.add(slug);
    else next.delete(slug);
    set(next);
  };

  return (
    <fieldset className="flex flex-col gap-2" aria-describedby={error ? 'apps-error' : undefined}>
      <legend className="pb-1.5 text-xs font-semibold text-ink">
        Included apps <span className="text-ink-muted">(at least two)</span>
      </legend>
      <Checkbox
        label="All apps"
        hint="Includes every active app."
        checked={allActive}
        indeterminate={!allActive && selected.size > 0}
        onChange={(checked) => set(checked ? new Set(active.map((app) => app.slug)) : new Set())}
      />
      <div className="grid grid-cols-1 gap-2 pl-6 sm:grid-cols-2">
        {choices.map((app) => (
          <Checkbox
            key={app.slug}
            label={app.status === 'active' ? app.name : `${app.name} (${app.status})`}
            checked={selected.has(app.slug)}
            onChange={(checked) => toggle(app.slug, checked)}
          />
        ))}
      </div>
      {error ? (
        <p id="apps-error" className="text-xs font-medium text-danger-fg">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}

function PriceFields({ draft, set, errors }: { draft: PackageDraft; set: (patch: Partial<PackageDraft>) => void; errors: DraftErrors }) {
  const free = draft.billing_interval === 'free';
  const shown = free || isPrice(draft.price);
  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Billing">
          {(props) => (
            <Select {...props} value={draft.billing_interval} onChange={(event) => set({ billing_interval: event.target.value as BillingInterval })}>
              {BILLING_INTERVALS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={`Price (${draft.currency})`} required={!free} error={errors.price} hint={free ? 'Free packages have no price.' : undefined}>
          {(props) => (
            <Input
              {...props}
              inputMode="decimal"
              disabled={free}
              value={free ? '0' : draft.price}
              onChange={(event) => set({ price: event.target.value })}
            />
          )}
        </Field>
        <Field label="Price unit">
          {(props) => (
            <Select {...props} value={draft.price_unit} disabled={free} onChange={(event) => set({ price_unit: event.target.value as PriceUnit })}>
              {PRICE_UNITS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Trial days" error={errors.trial_days} hint="0 means no trial.">
          {(props) => (
            <Input {...props} type="number" min={0} step={1} inputMode="numeric" value={draft.trial_days} onChange={(event) => set({ trial_days: event.target.value })} />
          )}
        </Field>
        <Field label="Seat limit" error={errors.seat_limit} hint="Most seats an institution gets. Blank means unlimited.">
          {(props) => (
            <Input {...props} type="number" min={1} step={1} inputMode="numeric" value={draft.seat_limit} onChange={(event) => set({ seat_limit: event.target.value })} />
          )}
        </Field>
      </div>
      {shown ? (
        <p className="text-[13px] text-ink-muted">
          Shown as <span className="font-semibold text-ink">{formatPrice({ ...draft, price: free ? '0' : draft.price })}</span>
        </p>
      ) : null}
    </>
  );
}

interface Review {
  terms: PackageTermsBody;
  preview: PackagePreview;
}

function EditorForm({ target, apps, onClose }: { target: EditorTarget; apps: ConfigApp[]; onClose: () => void }) {
  const navigate = useNavigate();
  const notify = useToast();
  const pkg = target.mode === 'version' ? target.pkg : null;
  const [draft, setDraft] = useState(() => (pkg ? draftFromPackage(pkg) : emptyDraft(target.mode === 'create' ? target.kind : 'single', apps)));
  const [errors, setErrors] = useState<DraftErrors>({});
  const [sentRows, setSentRows] = useState<string[]>([]);
  const [review, setReview] = useState<Review | null>(null);
  const [values, setValues] = useState(emptyReview);
  const [valueErrors, setValueErrors] = useState<ReviewErrors>({});
  const create = useCreatePackage();
  const preview = usePackagePreview(pkg?.id ?? '');
  const publish = usePublishVersion(pkg?.id ?? '');

  const set = (patch: Partial<PackageDraft>) => setDraft((current) => ({ ...current, ...patch }));
  const onName = (name: string) => set({ name, ...(draft.slugEdited ? {} : { slug: slugify(name) }) });
  const changeKind = (kind: PackageKind) =>
    setDraft(withApps({ ...draft, kind }, kind === 'single' ? { app: emptyDraft('single', apps).app } : { apps: [] }));

  const included = new Set(includedApps(draft));
  const limitApps = apps.filter((app) => included.has(app.slug));
  const failed = create.error ?? preview.error;
  const slugTaken = failed instanceof ApiError && failed.code === 'slug_taken';
  const shown: DraftErrors = {
    ...draftServerErrors(fieldErrors(failed), sentRows),
    ...(slugTaken ? { slug: 'Another package already uses this slug.' } : {}),
    ...errors,
  };

  const submitCreate = () => {
    const { errors: next, body } = validateCreate(draft);
    setErrors(next);
    if (!body) return;
    setSentRows(draft.limits.map((row) => row.key));
    create.mutate(body, {
      onSuccess: (result) => {
        notify(`${result.name} created.`);
        onClose();
        void navigate({ to: '/configuration/packages/$id', params: { id: result.id } });
      },
    });
  };

  const submitReview = () => {
    const { errors: next, body } = validateTerms(draft);
    setErrors(next);
    if (!body) return;
    setSentRows(draft.limits.map((row) => row.key));
    preview.mutate(body, {
      onSuccess: (result) => {
        setValues(emptyReview());
        setValueErrors({});
        setReview({ terms: body, preview: result });
      },
    });
  };

  const submitPublish = (current: Review, details: PackageDetail) => {
    const next = reviewErrors(values);
    setValueErrors(next);
    if (Object.keys(next).length > 0 || current.preview.changes.length === 0) return;
    publish.mutate(
      {
        ...current.terms,
        change_reason: values.reason.trim(),
        migration_policy: values.policy,
        ...(values.policy === 'selected_only' ? { selected_subscriptions: values.selected } : {}),
      },
      {
        onSuccess: (result) => {
          const moved = [
            result.migrated > 0 ? `${result.migrated} moved now` : '',
            result.scheduled > 0 ? `${result.scheduled} move at renewal` : '',
          ].filter(Boolean);
          notify(`Version ${result.package.current_version} of ${details.name} published${moved.length > 0 ? `: ${moved.join(', ')}` : ''}.`);
          onClose();
        },
      },
    );
  };

  const submit = () => {
    if (!pkg) submitCreate();
    else if (review) submitPublish(review, pkg);
    else submitReview();
  };

  const title = !pkg ? CREATE_TITLE[draft.kind] : review ? `Review changes to ${pkg.name}` : `New version of ${pkg.name}`;
  const description = !pkg
    ? 'Creates version 1. Price, apps and limits change later only through a new version.'
    : review
      ? 'Check what changes and who it reaches, choose when they move, then publish.'
      : `Version ${pkg.current_version + 1} starts from the current terms. You review the changes before anything is published.`;

  const footer = (
    <>
      {review ? (
        <Button
          variant="ghost"
          onClick={() => {
            setReview(null);
            publish.reset();
          }}
        >
          Back
        </Button>
      ) : (
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      )}
      <Button
        type="submit"
        variant="primary"
        loading={create.isPending || preview.isPending || publish.isPending}
        disabled={review !== null && review.preview.changes.length === 0}
      >
        {!pkg ? 'Create package' : review ? `Publish version ${pkg.current_version + 1}` : 'Review changes'}
      </Button>
    </>
  );

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()} size="xl" title={title} description={description} onSubmit={submit} footer={footer}>
      {review && pkg ? (
        <>
          <ReviewStep preview={review.preview} currency={pkg.currency} values={values} onChange={setValues} errors={valueErrors} />
          {publish.isError ? <ErrorState error={publish.error} /> : null}
        </>
      ) : (
        <>
          <Section id="package-apps" title="Apps">
            {pkg ? (
              <div className="flex flex-wrap items-center gap-2 text-[13px] text-ink-muted">
                <Chip tone="brand">{PACKAGE_KIND_LABEL[pkg.kind]}</Chip>
                {pkg.kind === 'single' ? <span>{pkg.apps[0]?.name}</span> : null}
              </div>
            ) : (
              <Segmented label="Package kind" options={KIND_OPTIONS} value={draft.kind} onChange={changeKind} />
            )}
            {draft.kind === 'bundle' ? (
              <AppsPicker apps={apps} draft={draft} onChange={setDraft} error={shown.apps} />
            ) : !pkg ? (
              <Field label="App" required error={shown.app}>
                {(props) => (
                  <Select {...props} value={draft.app} onChange={(event) => setDraft(withApps(draft, { app: event.target.value }))}>
                    {apps
                      .filter((app) => app.status === 'active')
                      .map((app) => (
                        <option key={app.slug} value={app.slug}>
                          {app.name}
                        </option>
                      ))}
                  </Select>
                )}
              </Field>
            ) : null}
          </Section>
          <Section id="package-details" title="Details">
            {pkg ? (
              <p className="text-[13px] text-ink-muted">
                Name, description and visibility are not part of a version. Change them with Edit details on the package page.
              </p>
            ) : (
              <PresentationFields
                values={draft}
                onChange={(patch) => (patch.name === undefined ? set(patch) : onName(patch.name))}
                errors={shown}
                slug={
                  <Field label="Slug" required error={shown.slug} hint="Used in links and the API. It cannot change later.">
                    {(props) => (
                      <Input {...props} value={draft.slug} spellCheck={false} onChange={(event) => set({ slug: event.target.value, slugEdited: true })} />
                    )}
                  </Field>
                }
              />
            )}
          </Section>
          <Section id="package-price" title="Price and seats">
            <PriceFields draft={draft} set={set} errors={shown} />
          </Section>
          <Section id="package-limits" title="Limits">
            <LimitsEditor apps={limitApps} rows={draft.limits} onChange={(limits) => set({ limits })} errors={shown} />
          </Section>
          {failed && !slugTaken ? <ErrorState error={failed} /> : null}
        </>
      )}
    </Dialog>
  );
}

/** Create a package (version 1) or draft its next version, with a review step before publishing. */
export function PackageEditor({ target, onClose }: PackageEditorProps) {
  const apps = useConfigApps(target !== null);
  if (!target) return null;
  if (!apps.data) {
    const title = target.mode === 'create' ? CREATE_TITLE[target.kind] : `New version of ${target.pkg.name}`;
    return (
      <Dialog open onOpenChange={(open) => !open && onClose()} size="xl" title={title}>
        {apps.isError ? <ErrorState error={apps.error} onRetry={() => void apps.refetch()} /> : <LoadingState />}
      </Dialog>
    );
  }
  return <EditorForm target={target} apps={apps.data.results} onClose={onClose} />;
}
