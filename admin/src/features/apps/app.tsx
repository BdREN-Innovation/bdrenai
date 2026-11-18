import { useState } from 'react';
import type { AppStatus, ConfigApp, UpdateAppBody } from '@/api/types';
import { Button, Dialog, ErrorState, Field, Input, Select, Textarea, useToast } from '@/components/ui';
import { useUpdateApp } from '@/api/queries';
import { fieldErrors } from '@/api/client';
import { ORDER_ERROR, isOrder, parseOrder } from '@/lib/order';
import { APP_STATUSES } from '@/lib/labels';

interface AppDraft {
  name: string;
  description: string;
  status: AppStatus;
  sort_order: string;
}

function AppForm({ app, onClose }: { app: ConfigApp; onClose: () => void }) {
  const notify = useToast();
  const update = useUpdateApp();
  const [draft, setDraft] = useState<AppDraft>(() => ({
    name: app.name,
    description: app.description,
    status: app.status,
    sort_order: String(app.sort_order),
  }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const shown = { ...fieldErrors(update.error), ...errors };
  const set = (patch: Partial<AppDraft>) => setDraft((current) => ({ ...current, ...patch }));

  const submit = () => {
    const next: Record<string, string> = {
      ...(draft.name.trim() ? {} : { name: 'Enter the app name.' }),
      ...(isOrder(draft.sort_order) ? {} : { sort_order: ORDER_ERROR }),
    };
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    const order = parseOrder(draft.sort_order);
    const body: UpdateAppBody = {
      ...(draft.name.trim() !== app.name ? { name: draft.name.trim() } : {}),
      ...(draft.description.trim() !== app.description ? { description: draft.description.trim() } : {}),
      ...(draft.status !== app.status ? { status: draft.status } : {}),
      ...(order !== app.sort_order ? { sort_order: order } : {}),
    };
    if (Object.keys(body).length === 0) {
      onClose();
      return;
    }
    update.mutate(
      { slug: app.slug, body },
      {
        onSuccess: (result) => {
          notify(`${result.name} saved.`);
          onClose();
        },
      },
    );
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={`Edit ${app.name}`}
      description="How the app is named and ordered across the admin panel and the website."
      onSubmit={submit}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={update.isPending}>
            Save changes
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Name" required error={shown.name} className="sm:col-span-2">
          {(props) => <Input {...props} value={draft.name} onChange={(event) => set({ name: event.target.value })} />}
        </Field>
        <Field label="Description" error={shown.description} className="sm:col-span-2">
          {(props) => <Textarea {...props} rows={3} value={draft.description} onChange={(event) => set({ description: event.target.value })} />}
        </Field>
        <Field label="Status" error={shown.status} hint="Only active apps can be added to new packages.">
          {(props) => (
            <Select {...props} value={draft.status} onChange={(event) => set({ status: event.target.value as AppStatus })}>
              {APP_STATUSES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Sort order" error={shown.sort_order} hint="Lower numbers are listed first.">
          {(props) => <Input {...props} type="number" step={1} value={draft.sort_order} onChange={(event) => set({ sort_order: event.target.value })} />}
        </Field>
      </div>
      {update.isError ? <ErrorState error={update.error} /> : null}
    </Dialog>
  );
}

/** Rename an app, reword it, change its order or status. */
export function AppDialog({ app, onClose }: { app: ConfigApp | null; onClose: () => void }) {
  return app ? <AppForm app={app} onClose={onClose} /> : null;
}
