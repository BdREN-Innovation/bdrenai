import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import type {
  BillingSubscription,
  InstitutionRef,
  ManualMethod,
  ManualPaymentBody,
  PackageRow,
  Payment,
  PurchaseKind,
  QuoteParams,
} from '@/api/types';
import type { PickedInstitution } from '@/features/invitations/picker';
import type { RadioOption } from '@/components/ui';
import {
  Button,
  Chip,
  Dialog,
  ErrorState,
  Field,
  Input,
  RadioGroup,
  Select,
  StatusChip,
  Textarea,
  useToast,
} from '@/components/ui';
import { useInstitutionBilling, usePackages, useQuote, useRecordPayment, useUploadAttachment } from '@/api/queries';
import { MANUAL_METHODS, addDays, dayOf, daysBetween, formatDay, isAmount, isoDay, toAmount } from './labels';
import { ATTACHMENT_ACCEPT, attachmentProblem } from './drawer';
import { errorMessage, fieldErrors } from '@/api/client';
import { InstitutionPicker } from '@/features/invitations/picker';
import { formatDate, formatMoney } from '@/lib/format';

const CURRENT = new Set(['active', 'trial', 'past_due']);

const KIND_OPTIONS: RadioOption<PurchaseKind>[] = [
  { value: 'renew', label: 'Renew', hint: 'Same package; the next period starts when the current one ends.' },
  { value: 'upgrade', label: 'Upgrade', hint: 'A higher package; a new period starts now and the current one ends.' },
  { value: 'new', label: 'New', hint: 'Nothing active covers these apps yet; starts now.' },
];

const FIELDS = [
  'institution',
  'package',
  'kind',
  'periods',
  'period_start',
  'amount',
  'method',
  'reference',
  'payer_name',
  'payment_date',
  'notes',
  'attachment',
] as const;
type FormField = (typeof FIELDS)[number];
type Errors = Partial<Record<FormField, string>>;

const isPaid = (row: PackageRow) => row.billing_interval !== 'free' && Number(row.price) > 0;
const covers = (row: PackageRow, apps: string[]) => apps.every((slug) => row.apps.some((app) => app.slug === slug));

interface PackageChoice {
  id: string;
  name: string;
  hint: string;
}

/** Packages that fit the kind: renew = what the institution has; upgrade = pricier packages covering its apps. */
function packageChoices(kind: PurchaseKind, current: BillingSubscription[], packages: PackageRow[]): PackageChoice[] {
  const paid = packages.filter(isPaid);
  const priceOf = (id: string) => packages.find((row) => row.id === id)?.price;
  const describe = (row: PackageRow) => `${formatMoney(row.price, row.currency)} / ${row.billing_interval === 'yearly' ? 'year' : 'month'}`;
  if (kind === 'new') return paid.map((row) => ({ id: row.id, name: row.name, hint: describe(row) }));
  if (kind === 'renew') {
    return current.map((sub) => {
      const target = sub.scheduled_package ?? sub.package;
      const row = packages.find((item) => item.id === target.id);
      const hint = sub.scheduled_package ? 'scheduled downgrade applies' : row ? describe(row) : 'current package';
      return { id: target.id, name: target.name, hint };
    });
  }
  const currentIds = new Set(current.map((sub) => sub.package.id));
  return paid
    .filter((row) => !currentIds.has(row.id))
    .filter((row) =>
      current.some((sub) => {
        const price = priceOf(sub.package.id);
        return covers(row, sub.apps.map((app) => app.slug)) && (price === undefined || Number(row.price) > Number(price));
      }),
    )
    .map((row) => ({ id: row.id, name: row.name, hint: describe(row) }));
}

function CurrentSubscriptions({ subscriptions }: { subscriptions: BillingSubscription[] }) {
  if (subscriptions.length === 0) {
    return <p className="text-[13px] text-ink-muted">No active subscription. Record a new purchase.</p>;
  }
  return (
    <ul aria-label="Current subscriptions" className="flex flex-col gap-2">
      {subscriptions.map((sub) => (
        <li key={sub.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-stroke-muted bg-surface-2 px-3 py-2 text-[13px]">
          <span className="font-semibold text-ink">{sub.package.name}</span>
          <StatusChip status={sub.status} />
          <span className="text-ink-muted">{sub.expires_at ? `Ends ${formatDate(sub.expires_at)}` : 'No end date'}</span>
          {!sub.auto_renew ? <Chip tone="warning">Renewal stopped</Chip> : null}
          {sub.scheduled_package ? <Chip tone="info">Downgrade to {sub.scheduled_package.name} at renewal</Chip> : null}
        </li>
      ))}
    </ul>
  );
}

interface RecordPaymentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Starts with this institution picked (institution row or page). */
  institution?: InstitutionRef;
  onRecorded?: (payment: Payment) => void;
}

/** Mounts the form only while open, so each opening starts fresh and nothing is fetched while closed. */
export function RecordPaymentDialog(props: RecordPaymentDialogProps) {
  return props.open ? <RecordPaymentForm {...props} /> : null;
}

function RecordPaymentForm({ open, onOpenChange, institution, onRecorded }: RecordPaymentDialogProps) {
  const notify = useToast();
  const record = useRecordPayment();
  const upload = useUploadAttachment();
  const [picked, setPicked] = useState<PickedInstitution | null>(
    institution ? { kind: 'existing', institution: { slug: institution.slug, name: institution.name } } : null,
  );
  const slug = picked?.kind === 'existing' ? picked.institution.slug : null;
  const billing = useInstitutionBilling(slug);
  const packages = usePackages({ status: 'active', page_size: 100 });

  const [kind, setKind] = useState<PurchaseKind>('new');
  const [packageId, setPackageId] = useState('');
  const [periods, setPeriods] = useState('1');
  const [startDraft, setStartDraft] = useState<string | null>(null);
  const [amountDraft, setAmountDraft] = useState<string | null>(null);
  const [method, setMethod] = useState<ManualMethod>('bank_transfer');
  const [reference, setReference] = useState('');
  const [payerName, setPayerName] = useState('');
  const [paymentDate, setPaymentDate] = useState(() => isoDay(new Date()));
  const [notes, setNotes] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState<'save' | 'pending' | null>(null);
  const initialised = useRef<string | null>(null);

  const current = (billing.data?.subscriptions ?? []).filter((sub) => CURRENT.has(sub.status));
  const choices = packageChoices(kind, current, packages.data?.results ?? []);

  useEffect(() => {
    if (!slug || !billing.data || initialised.current === slug) return;
    initialised.current = slug;
    const active = billing.data.subscriptions.find((sub) => CURRENT.has(sub.status));
    setKind(active ? 'renew' : 'new');
    setPackageId(active ? (active.scheduled_package ?? active.package).id : '');
  }, [slug, billing.data]);

  const periodCount = Number(periods);
  const periodsOk = Number.isInteger(periodCount) && periodCount >= 1;
  const quoteParams: QuoteParams | null =
    slug && packageId && periodsOk ? { institution: slug, package: packageId, kind, periods: periodCount } : null;
  const quote = useQuote(quoteParams);
  const quoted = quoteParams ? quote.data : undefined;

  const amount = amountDraft ?? quoted?.amount ?? '';
  const quoteStart = quoted ? dayOf(quoted.period_start) : '';
  const start = startDraft ?? quoteStart;
  const length = quoted ? daysBetween(quoteStart, dayOf(quoted.period_end)) : 0;
  const lastDay = start && length > 0 ? addDays(start, length - 1) : '';
  const differs = quoted !== undefined && isAmount(amount) && Number(amount) !== Number(quoted.amount);
  const currency = quoted?.currency ?? 'BDT';
  const packageName = choices.find((choice) => choice.id === packageId)?.name ?? '';

  const server = fieldErrors(record.error);
  const serverKnown = Object.keys(server).some((key) => (FIELDS as readonly string[]).includes(key));
  const general = record.error && !serverKnown ? record.error : null;
  const errorFor = (field: FormField) => errors[field] ?? server[field];

  const changeKind = (next: PurchaseKind) => {
    setKind(next);
    const nextChoices = packageChoices(next, current, packages.data?.results ?? []);
    if (!nextChoices.some((choice) => choice.id === packageId)) setPackageId(nextChoices[0]?.id ?? '');
    setStartDraft(null);
    setAmountDraft(null);
  };

  const onFile = (event: ChangeEvent<HTMLInputElement>) => {
    const next = event.target.files?.[0] ?? null;
    setFile(next);
    setErrors((value) => ({ ...value, attachment: next ? (attachmentProblem(next) ?? undefined) : undefined }));
  };

  const validate = (): Errors => {
    const next: Errors = {};
    if (!slug) next.institution = 'Pick an institution.';
    if (!packageId) next.package = 'Pick a package.';
    if (!periodsOk) next.periods = 'Enter a whole number of periods, 1 or more.';
    if (!isAmount(amount)) next.amount = 'Enter an amount above zero, with at most two decimals.';
    if (!paymentDate) next.payment_date = 'Enter the date the money arrived.';
    if (differs && !notes.trim()) next.notes = `The amount differs from the quote (${formatMoney(quoted?.amount ?? amount, currency)}). Say why.`;
    if (file && attachmentProblem(file)) next.attachment = attachmentProblem(file) ?? undefined;
    return next;
  };

  const attach = (payment: Payment) => {
    if (!file) return;
    upload.mutate(
      { id: payment.id, file },
      { onError: (error) => notify(`Payment saved, but the attachment did not upload: ${errorMessage(error)}`, 'warning') },
    );
  };

  const submit = (pending: boolean) => {
    const next = validate();
    setErrors(next);
    if (Object.keys(next).length > 0 || !slug) return;
    const body: ManualPaymentBody = {
      institution: slug,
      package: packageId,
      kind,
      periods: periodCount,
      period_start: startDraft && startDraft !== quoteStart ? startDraft : null,
      amount: toAmount(amount),
      method,
      reference: reference.trim(),
      payer_name: payerName.trim(),
      payment_date: paymentDate,
      notes: notes.trim(),
      pending,
    };
    setSaving(pending ? 'pending' : 'save');
    record.mutate(body, {
      onSuccess: (payment) => {
        attach(payment);
        onOpenChange(false);
        notify(
          pending
            ? 'Payment saved as pending. Another superadmin can verify it from Billing › Awaiting action.'
            : `Payment recorded${payment.receipt_number ? `, receipt ${payment.receipt_number}` : ''}.`,
        );
        onRecorded?.(payment);
      },
      onSettled: () => setSaving(null),
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title="Record payment"
      description="For money received outside bKash checkout. Saving applies the package for the period at once; Save as pending leaves it for a second person to verify."
      onSubmit={() => submit(false)}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => submit(true)} loading={saving === 'pending'} disabled={saving === 'save'}>
            Save as pending
          </Button>
          <Button type="submit" variant="primary" loading={saving === 'save'} disabled={saving === 'pending'}>
            Save
          </Button>
        </>
      }
    >
      <InstitutionPicker
        value={picked}
        onChange={(value) => {
          setPicked(value);
          setPackageId('');
          setStartDraft(null);
          setAmountDraft(null);
          initialised.current = null;
        }}
        required
        autoFocus={!institution}
        error={errorFor('institution')}
      />

      {slug ? (
        <>
          <section aria-label="Current subscription" className="flex flex-col gap-2">
            <h3 className="text-xs font-semibold text-ink">Current subscription</h3>
            {billing.isPending ? <p className="text-[13px] text-ink-muted">Loading…</p> : null}
            {billing.isError ? <ErrorState error={billing.error} onRetry={() => void billing.refetch()} /> : null}
            {billing.data ? <CurrentSubscriptions subscriptions={current} /> : null}
          </section>

          <RadioGroup legend="What is being paid for" options={KIND_OPTIONS} value={kind} onChange={changeKind} error={errorFor('kind')} />

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_7rem_10rem]">
            <Field
              label="Package"
              required
              error={errorFor('package') ?? (quote.isError ? errorMessage(quote.error) : undefined)}
              hint={choices.length === 0 && !packages.isPending ? 'No package fits this choice.' : undefined}
            >
              {(props) => (
                <Select
                  {...props}
                  value={packageId}
                  onChange={(event) => {
                    setPackageId(event.target.value);
                    setStartDraft(null);
                    setAmountDraft(null);
                  }}
                >
                  <option value="">Choose a package</option>
                  {choices.map((choice) => (
                    <option key={choice.id} value={choice.id}>
                      {choice.name} — {choice.hint}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Periods" required error={errorFor('periods')}>
              {(props) => (
                <Input
                  {...props}
                  type="number"
                  min={1}
                  step={1}
                  value={periods}
                  onChange={(event) => {
                    setPeriods(event.target.value);
                    setAmountDraft(null);
                  }}
                />
              )}
            </Field>
            <Field label="Start date" error={errorFor('period_start')} hint={quoted ? 'From the quote.' : undefined}>
              {(props) => (
                <Input {...props} type="date" value={start} disabled={!quoted} onChange={(event) => setStartDraft(event.target.value || null)} />
              )}
            </Field>
          </div>
        </>
      ) : null}

      <fieldset className="flex flex-col gap-4 border-t border-stroke-muted pt-4">
        <legend className="sr-only">Payment details</legend>
        <h3 aria-hidden="true" className="text-xs font-semibold text-ink">
          Payment details
        </h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field
            label="Amount (৳)"
            required
            error={errorFor('amount')}
            hint={quoted ? `Quote: ${formatMoney(quoted.amount, currency)}` : undefined}
          >
            {(props) => <Input {...props} inputMode="decimal" value={amount} onChange={(event) => setAmountDraft(event.target.value)} />}
          </Field>
          <Field label="Method" required error={errorFor('method')}>
            {(props) => (
              <Select {...props} value={method} onChange={(event) => setMethod(event.target.value as ManualMethod)}>
                {MANUAL_METHODS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Reference" error={errorFor('reference')} hint="Bank, cheque or transaction reference.">
            {(props) => <Input {...props} value={reference} onChange={(event) => setReference(event.target.value)} />}
          </Field>
          <Field label="Payer name" error={errorFor('payer_name')}>
            {(props) => <Input {...props} value={payerName} onChange={(event) => setPayerName(event.target.value)} />}
          </Field>
          <Field label="Payment date" required error={errorFor('payment_date')}>
            {(props) => <Input {...props} type="date" value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} />}
          </Field>
          <Field label="Attachment" error={errorFor('attachment')} hint="Bank slip or cheque scan: PDF, PNG or JPEG, up to 5 MB.">
            {(props) => <Input {...props} type="file" accept={ATTACHMENT_ACCEPT} className="py-1.5" onChange={onFile} />}
          </Field>
        </div>
        <Field
          label="Notes"
          required={differs}
          error={errorFor('notes')}
          hint={differs ? 'Required: the amount differs from the quote.' : undefined}
        >
          {(props) => <Textarea {...props} rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} />}
        </Field>
      </fieldset>

      <p role="status" aria-live="polite" aria-label="Preview" className="rounded-lg bg-brand-tint px-3 py-2.5 text-[13px] font-medium text-brand-ink">
        {slug && packageName && quoted && lastDay && isAmount(amount)
          ? `${picked?.kind === 'existing' ? picked.institution.name : ''} → ${packageName}, ${formatDay(start)} – ${formatDay(lastDay)}, ${formatMoney(toAmount(amount), currency)}`
          : 'Pick the institution and package to see what this payment does.'}
      </p>

      {general ? <ErrorState error={general} /> : null}
    </Dialog>
  );
}
