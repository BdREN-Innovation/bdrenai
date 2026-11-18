import { useRef, useState } from 'react';
import { CircleCheck, CircleMinus, CircleX, FileUp, RotateCcw, Upload } from 'lucide-react';
import type { ChangeEvent } from 'react';
import type { ImportResponse, ImportRowInput, ImportRowStatus, InstitutionDetail } from '@/api/types';
import type { LucideIcon } from 'lucide-react';
import type { Tone } from '@/components/ui';
import { Button, Card, Chip, ErrorState, Field, Notice, SeatMeter, Table, Td, Textarea, Th, useToast } from '@/components/ui';
import { MAX_IMPORT_ROWS, csvToImportRows } from '@/lib/csv';
import { IMPORT_REASON_LABEL } from '@/lib/labels';
import { formatNumber } from '@/lib/format';
import { useImport } from '@/api/queries';

const SAMPLE = 'email,name,role\nrahim@example.edu,Rahim Uddin,member\nkarim@example.edu,Karim Ahmed,admin';

const ROW_CHIP: Record<ImportRowStatus, { label: string; tone: Tone; icon: LucideIcon }> = {
  ok: { label: 'Ready', tone: 'success', icon: CircleCheck },
  skip: { label: 'Skipped', tone: 'neutral', icon: CircleMinus },
  error: { label: 'Error', tone: 'danger', icon: CircleX },
};

type Step = { kind: 'input' } | { kind: 'preview'; rows: ImportRowInput[]; result: ImportResponse } | { kind: 'done'; rows: ImportRowInput[]; result: ImportResponse };

function ResultTable({ rows, result }: { rows: ImportRowInput[]; result: ImportResponse }) {
  return (
    <Table label="Import rows" className="max-h-[28rem] overflow-y-auto">
      <thead className="sticky top-0 bg-surface">
        <tr>
          <Th className="w-14">Row</Th>
          <Th>Email</Th>
          <Th>Name</Th>
          <Th>Role</Th>
          <Th>Result</Th>
        </tr>
      </thead>
      <tbody>
        {result.rows.map((row) => (
          <tr key={row.index}>
            <Td className="tabular text-ink-muted">{row.index + 1}</Td>
            <Td className="font-medium">{row.email || rows[row.index]?.email || '—'}</Td>
            <Td>{rows[row.index]?.name || '—'}</Td>
            <Td>{rows[row.index]?.role || 'member'}</Td>
            <Td>
              <span className="flex flex-wrap items-center gap-2">
                <Chip tone={ROW_CHIP[row.status].tone} icon={ROW_CHIP[row.status].icon}>
                  {ROW_CHIP[row.status].label}
                </Chip>
                {row.reason ? <span className="text-xs text-ink-muted">{IMPORT_REASON_LABEL[row.reason] ?? row.reason}</span> : null}
              </span>
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

/** Paste or upload a CSV, preview it with a dry run, then create the invitations that fit. */
export function Import({ institution }: { institution: InstitutionDetail }) {
  const notify = useToast();
  const importRows = useImport(institution.slug);
  const fileRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [parseError, setParseError] = useState<string>();
  const [step, setStep] = useState<Step>({ kind: 'input' });

  const loadFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setText(await file.text());
    setParseError(undefined);
  };

  const preview = () => {
    const rows = csvToImportRows(text);
    if (rows.length === 0) return setParseError('Add at least one row with an email address.');
    if (rows.length > MAX_IMPORT_ROWS) return setParseError(`At most ${formatNumber(MAX_IMPORT_ROWS)} rows per import; this file has ${formatNumber(rows.length)}.`);
    setParseError(undefined);
    importRows.mutate({ rows, dry_run: true }, { onSuccess: (result) => setStep({ kind: 'preview', rows, result }) });
    return undefined;
  };

  const confirm = (rows: ImportRowInput[]) =>
    importRows.mutate(
      { rows, dry_run: false },
      {
        onSuccess: (result) => {
          setStep({ kind: 'done', rows, result });
          notify(`${formatNumber(result.created)} invitations created.`);
          if (result.email_failures > 0) notify(`${result.email_failures} emails could not be sent. Resend them from Invitations.`, 'warning');
        },
      },
    );

  const restart = () => {
    setStep({ kind: 'input' });
    setText('');
    importRows.reset();
  };

  if (institution.status === 'deactivated') {
    return <Notice>This institution has been removed, so it cannot take new members.</Notice>;
  }

  if (step.kind === 'input') {
    return (
      <Card title="Import members" description="Each row gets an invitation email. Columns: email, name, role (member, admin, billing or owner; blank means member).">
        <Field label="CSV rows" error={parseError} hint={`Paste rows, or upload a .csv file. A header row is optional. Up to ${formatNumber(MAX_IMPORT_ROWS)} rows.`}>
          {(props) => (
            <Textarea
              {...props}
              rows={10}
              value={text}
              placeholder={SAMPLE}
              spellCheck={false}
              className="font-mono text-xs"
              onChange={(event) => setText(event.target.value)}
            />
          )}
        </Field>
        <input ref={fileRef} type="file" accept=".csv,text/csv,text/plain" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(event) => void loadFile(event)} />
        {importRows.isError ? <ErrorState error={importRows.error} /> : null}
        <div className="flex flex-wrap justify-end gap-2">
          <Button icon={FileUp} onClick={() => fileRef.current?.click()}>
            Upload CSV
          </Button>
          <Button variant="primary" loading={importRows.isPending} disabled={!text.trim()} onClick={preview}>
            Preview import
          </Button>
        </div>
      </Card>
    );
  }

  const { rows, result } = step;
  const summary = result.summary;
  const done = step.kind === 'done';

  return (
    <Card
      title={done ? 'Import finished' : 'Check the import'}
      description={
        done
          ? `${formatNumber(result.created)} invitations created${result.email_failures > 0 ? `, ${result.email_failures} emails failed` : ''}.`
          : 'Nothing has been sent yet. Rows marked ready will be invited, in file order, until the seat cap is reached.'
      }
    >
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
        {[
          ['Ready', summary.ok],
          ['Will fit', summary.fits],
          ['Skipped', summary.skip],
          ['Errors', summary.error],
        ].map(([label, value]) => (
          <div key={label} className="flex flex-col gap-1">
            <span className="tabular text-2xl leading-none font-bold text-ink">{formatNumber(value as number)}</span>
            <span className="text-xs text-ink-muted">{label}</span>
          </div>
        ))}
        <div className="col-span-2 sm:col-span-1">
          <SeatMeter seats={summary.seats} />
        </div>
      </div>
      {!done && summary.fits < summary.ok ? (
        <Notice>
          Only {formatNumber(summary.fits)} of {formatNumber(summary.ok)} ready rows fit under the seat cap. The rest will be marked over the cap.
        </Notice>
      ) : null}
      <ResultTable rows={rows} result={result} />
      {importRows.isError ? <ErrorState error={importRows.error} /> : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button icon={RotateCcw} onClick={restart}>
          {done ? 'Import more' : 'Start over'}
        </Button>
        {!done ? (
          <Button variant="primary" icon={Upload} loading={importRows.isPending} disabled={summary.fits === 0} onClick={() => confirm(rows)}>
            Invite {formatNumber(summary.fits)} {summary.fits === 1 ? 'person' : 'people'}
          </Button>
        ) : null}
      </div>
    </Card>
  );
}
