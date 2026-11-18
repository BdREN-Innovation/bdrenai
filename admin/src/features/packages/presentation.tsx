import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { PackageDetail, UpdatePackageBody } from '@/api/types';
import type { DraftErrors, PresentationValues } from './draft';
import { Button, Checkbox, Dialog, ErrorState, Field, Input, Textarea, useToast } from '@/components/ui';
import { presentationErrors } from './draft';
import { parseOrder } from '@/lib/order';
import { useUpdatePackage } from '@/api/queries';
import { fieldErrors } from '@/api/client';

interface PresentationFieldsProps {
  values: PresentationValues;
  onChange: (patch: Partial<PresentationValues>) => void;
  errors: DraftErrors;
  /** The slug field, shown beside the name only when creating. */
  slug?: ReactNode;
}

/** Name, wording, order and visibility: what changes in place, without a new version. */
export function PresentationFields({ values, onChange, errors, slug }: PresentationFieldsProps) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Field label="Name" required error={errors.name} className={slug ? undefined : 'sm:col-span-2'}>
        {(props) => <Input {...props} value={values.name} onChange={(event) => onChange({ name: event.target.value })} />}
      </Field>
      {slug}
      <Field label="Who it is for" error={errors.audience} hint="One line on the pricing page, e.g. “Universities with up to 500 staff”." className="sm:col-span-2">
        {(props) => <Input {...props} value={values.audience} onChange={(event) => onChange({ audience: event.target.value })} />}
      </Field>
      <Field label="Description" error={errors.description} className="sm:col-span-2">
        {(props) => <Textarea {...props} rows={2} value={values.description} onChange={(event) => onChange({ description: event.target.value })} />}
      </Field>
      <Field label="Sort order" error={errors.sort_order} hint="Lower numbers are listed first.">
        {(props) => <Input {...props} type="number" step={1} value={values.sort_order} onChange={(event) => onChange({ sort_order: event.target.value })} />}
      </Field>
      <div className="flex flex-col gap-3 pt-6">
        <Checkbox label="Public" hint="Shown on the public pricing page." checked={values.is_public} onChange={(is_public) => onChange({ is_public })} />
        <Checkbox label="Recommended" hint="Shows a Recommended badge." checked={values.highlight} onChange={(highlight) => onChange({ highlight })} />
      </div>
    </div>
  );
}

const toValues = (pkg: PackageDetail): PresentationValues => ({
  name: pkg.name,
  audience: pkg.audience,
  description: pkg.description,
  sort_order: String(pkg.sort_order),
  is_public: pkg.is_public,
  highlight: pkg.highlight,
});

function changedFields(values: PresentationValues, pkg: PackageDetail): UpdatePackageBody {
  const order = parseOrder(values.sort_order);
  return {
    ...(values.name.trim() !== pkg.name ? { name: values.name.trim() } : {}),
    ...(values.audience.trim() !== pkg.audience ? { audience: values.audience.trim() } : {}),
    ...(values.description.trim() !== pkg.description ? { description: values.description.trim() } : {}),
    ...(order !== pkg.sort_order ? { sort_order: order } : {}),
    ...(values.is_public !== pkg.is_public ? { is_public: values.is_public } : {}),
    ...(values.highlight !== pkg.highlight ? { highlight: values.highlight } : {}),
  };
}

interface PresentationDialogProps {
  pkg: PackageDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Edit details: saved in place, without a new version. Sends only what changed. */
export function PresentationDialog({ pkg, open, onOpenChange }: PresentationDialogProps) {
  const notify = useToast();
  const update = useUpdatePackage(pkg.id);
  const [values, setValues] = useState(() => toValues(pkg));
  const [errors, setErrors] = useState<DraftErrors>({});
  const { reset } = update;

  useEffect(() => {
    if (!open) return;
    setValues(toValues(pkg));
    setErrors({});
    reset();
    // Reset only when the dialog opens, not when a background refetch replaces the package.
  }, [open, reset]);

  const submit = () => {
    const next = presentationErrors(values);
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    const body = changedFields(values, pkg);
    if (Object.keys(body).length === 0) {
      onOpenChange(false);
      return;
    }
    update.mutate(body, {
      onSuccess: (result) => {
        onOpenChange(false);
        notify(`${result.name} saved.`);
      },
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={`Edit ${pkg.name}`}
      description="Name, wording and visibility change in place. Price, apps and limits need a new version."
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
      <PresentationFields
        values={values}
        onChange={(patch) => setValues((current) => ({ ...current, ...patch }))}
        errors={{ ...fieldErrors(update.error), ...errors }}
      />
      {update.isError ? <ErrorState error={update.error} /> : null}
    </Dialog>
  );
}
