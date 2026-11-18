import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import type { ImportAction, ImportReason, ImportResponse, ImportRowInput, ImportRowResult } from '@/api/types';
import { Button, Dialog, ErrorState, Field, Notice, Table, Td, Textarea, Th, useToast } from '@/components/ui';
import { MAX_IMPORT_ROWS, csvToImportRows } from '@/lib/csv';
import { portalErrorMessage } from './errors';
import { usePortalImport } from './queries';
import { cn } from '@/lib/cn';

const REASONS: Record<ImportReason, string> = {
  invalid_email: 'Not a valid email',
  duplicate_in_file: 'Listed twice in this file',
  already_member: 'Already on your package',
  already_invited: 'Already has a pending invitation',
  bad_role: 'Role must be member or admin',
  over_cap: 'No seat left for this row',
  member_of_other_institution: 'Belongs to another institution; BdREN support can move them',
};

const ACTIONS: Record<ImportAction, string> = {
  invite: 'Will be invited',
  cover: 'Already signed up: added to your package at once',
  consent_invite: 'On a personal plan: invited, joins when they accept',
};

/** A ready row the preview says won't fit in the free seats: the import leaves it out. */
function overCap(row: ImportRowResult): boolean {
  return row.status === 'ok' && row.reason === 'over_cap';
}

function outcome(row: ImportRowResult): string {
  if (overCap(row)) return "Won't be imported";
  if (row.status === 'ok') return ACTIONS[row.action ?? 'invite'];
  return row.status === 'skip' ? 'Skipped' : 'Error';
}

function Preview({ rows, result }: { rows: ImportRowInput[]; result: ImportResponse }) {
  const { summary } = result;
  const actions = summary.actions ?? { invite: 0, cover: 0, consent_invite: 0 };
  const left = summary.ok - summary.fits;
  return (
    <div className="flex flex-col gap-3">
      <div>
        <p className="tabular text-lg font-bold text-ink">
          {summary.fits} of {rows.length} fit
        </p>
        <p className="text-xs text-ink-muted">
          {summary.ok} ready ({actions.invite} to invite, {actions.cover} to add at once, {actions.consent_invite} to ask for consent) · {summary.skip}{' '}
          skipped · {summary.error} with errors
          {summary.seats.cap !== null ? ` · ${summary.seats.used} / ${summary.seats.cap} seats in use now` : ''}
        </p>
      </div>
      {left > 0 ? (
        <Notice tone="danger">
          {left} ready {left === 1 ? "row won't" : "rows won't"} fit in your seats; they&apos;re marked &ldquo;Won&apos;t be imported&rdquo; below. Remove
          members who no longer need access, or contact BdREN to upgrade your plan.
        </Notice>
      ) : null}
      <Table label="Import preview" className="max-h-80 overflow-y-auto">
        <thead className="sticky top-0 bg-surface">
          <tr>
            <Th className="w-14">Row</Th>
            <Th>Email</Th>
            <Th>Result</Th>
          </tr>
        </thead>
        <tbody>
          {result.rows.map((row) => {
            const ready = row.status === 'ok' && !overCap(row);
            return (
              <tr key={row.index} data-over-cap={overCap(row) || undefined}>
                <Td className="tabular text-ink-muted">{row.index + 1}</Td>
                <Td className="break-all">{row.email || '—'}</Td>
                <Td>
                  <span className={cn('block font-medium', ready ? 'text-ink' : 'text-danger-fg')}>{outcome(row)}</span>
                  {row.reason ? <span className="block text-xs text-ink-muted">{REASONS[row.reason] ?? row.reason}</span> : null}
                </Td>
              </tr>
            );
          })}
        </tbody>
      </Table>
    </div>
  );
}

interface ImportDialogProps {
  slug: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** CSV import: paste or upload rows, a dry-run preview (rows over the seat cap marked), then the real import. */
export function ImportDialog({ slug, open, onOpenChange }: ImportDialogProps) {
  const notify = useToast();
  const importRows = usePortalImport(slug);
  const [text, setText] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ rows: ImportRowInput[]; result: ImportResponse } | null>(null);
  const reset = importRows.reset;
  const version = useRef(0);

  useEffect(() => {
    if (!open) return;
    version.current += 1;
    setText('');
    setProblem(null);
    setPreview(null);
    reset();
  }, [open, reset]);

  const edit = (next: string) => {
    version.current += 1;
    setText(next);
    setPreview(null);
    reset();
  };

  const readFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) edit(await file.text());
  };

  const check = () => {
    setProblem(null);
    const rows = csvToImportRows(text);
    if (rows.length === 0) return setProblem('Add at least one row: email, name, role.');
    if (rows.length > MAX_IMPORT_ROWS) return setProblem(`Import up to ${MAX_IMPORT_ROWS} rows at a time. This file has ${rows.length}.`);
    const checked = version.current;
    importRows.mutate(
      { rows, dry_run: true },
      { onSuccess: (result) => (checked === version.current ? setPreview({ rows, result }) : undefined) },
    );
    return undefined;
  };

  const confirm = () => {
    if (!preview) return;
    importRows.mutate(
      { rows: preview.rows, dry_run: false },
      {
        onSuccess: ({ created, covered = 0, email_failures }) => {
          const failures = email_failures ? ` ${email_failures} emails didn't go out; use Resend on the Invited tab.` : '';
          const added = covered ? ` ${covered} ${covered === 1 ? 'person' : 'people'} added to your package.` : '';
          notify(`${created} ${created === 1 ? 'invitation' : 'invitations'} created.${added}${failures}`, email_failures ? 'warning' : 'success');
          onOpenChange(false);
        },
      },
    );
  };

  const fits = preview?.result.summary.fits ?? 0;
  const failure = importRows.isError
    ? portalErrorMessage(importRows.error, preview ? "We couldn't import these rows. Try again." : "We couldn't check this file. Try again.")
    : null;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title="Import members from CSV"
      description="One person per line: email,name,role. Role is member or admin; leave it empty for member. A header row is fine."
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {preview ? (
            <Button variant="primary" loading={importRows.isPending} disabled={fits === 0} onClick={confirm}>
              Import {fits} {fits === 1 ? 'row' : 'rows'}
            </Button>
          ) : (
            <Button variant="primary" loading={importRows.isPending} disabled={!text.trim()} onClick={check}>
              Preview
            </Button>
          )}
        </>
      }
    >
      <Field label="CSV file">
        {(props) => (
          <input
            {...props}
            type="file"
            accept=".csv,text/csv,text/plain"
            disabled={importRows.isPending}
            onChange={(event) => void readFile(event)}
            className="text-[13px] text-ink file:mr-3 file:h-8 file:cursor-pointer file:rounded-md file:border file:border-stroke file:bg-surface file:px-3 file:text-xs file:font-semibold file:text-ink"
          />
        )}
      </Field>
      <Field label="Or paste rows" error={problem ?? undefined} hint={`Up to ${MAX_IMPORT_ROWS} rows.`}>
        {(props) => (
          <Textarea
            {...props}
            rows={6}
            value={text}
            spellCheck={false}
            disabled={importRows.isPending}
            placeholder={'email,name,role\nrahim@du.ac.bd,Rahim Uddin,member'}
            onChange={(event) => edit(event.target.value)}
            className="font-mono text-xs"
          />
        )}
      </Field>
      {failure ? <ErrorState error={new Error(failure)} /> : null}
      {preview ? <Preview rows={preview.rows} result={preview.result} /> : null}
    </Dialog>
  );
}
