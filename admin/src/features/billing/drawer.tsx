import { useState } from 'react';
import { BadgeCheck, CircleX, Download, FileText, Undo2, Upload } from 'lucide-react';
import type { ChangeEvent, ReactNode } from 'react';
import type { Payment } from '@/api/types';
import {
  Button,
  Chip,
  ConfirmDialog,
  Drawer,
  ErrorState,
  LoadingState,
  Notice,
  StatusChip,
  useToast,
} from '@/components/ui';
import { usePayment, useRejectPayment, useUploadAttachment, useVerifyPayment } from '@/api/queries';
import { KIND_LABEL, METHOD_LABEL, attachmentUrl, receiptUrl, remaining } from './labels';
import { formatDate, formatDateTime, formatMoney } from '@/lib/format';
import { errorMessage } from '@/api/client';
import { RefundDialog } from './refund';

const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const ATTACHMENT_TYPES = ['application/pdf', 'image/png', 'image/jpeg'];
export const ATTACHMENT_ACCEPT = ATTACHMENT_TYPES.join(',');

/** Client-side check before upload; the server checks the file signature again. */
export function attachmentProblem(file: File): string | null {
  if (!ATTACHMENT_TYPES.includes(file.type)) return 'Attach a PDF, PNG or JPEG file.';
  if (file.size > MAX_ATTACHMENT_BYTES) return 'The file is larger than 5 MB.';
  return null;
}

const REFUNDABLE = new Set(['completed', 'partially_refunded']);
const HAS_RECEIPT = new Set(['completed', 'partially_refunded', 'refunded']);

function Rows({ children }: { children: ReactNode }) {
  return <dl className="grid grid-cols-[8.5rem_1fr] gap-x-3 gap-y-2 text-[13px]">{children}</dl>;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-ink-muted">{label}</dt>
      <dd className="min-w-0 break-words text-ink">{children || '—'}</dd>
    </>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-2.5 border-t border-stroke-muted pt-4">
      <h3 className="text-xs font-semibold tracking-wide text-ink-muted uppercase">{title}</h3>
      {children}
    </section>
  );
}

function period(payment: Payment): string {
  if (!payment.period_start) return '';
  return `${formatDate(payment.period_start)} – ${formatDate(payment.period_end)}`;
}

function AttachmentControls({ payment }: { payment: Payment }) {
  const notify = useToast();
  const upload = useUploadAttachment();
  const [problem, setProblem] = useState<string | null>(null);

  const onFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const found = attachmentProblem(file);
    setProblem(found);
    if (found) return;
    upload.mutate(
      { id: payment.id, file },
      {
        onSuccess: () => notify('Attachment uploaded.'),
        onError: (error) => setProblem(errorMessage(error)),
      },
    );
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {payment.has_attachment ? (
          <a
            href={attachmentUrl(payment.id)}
            download
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-stroke bg-surface px-2.5 text-xs font-semibold text-ink hover:bg-hover"
          >
            <Download aria-hidden="true" size={14} />
            Download attachment
          </a>
        ) : (
          <span className="text-[13px] text-ink-muted">No attachment.</span>
        )}
        <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-ink hover:bg-hover has-focus-visible:outline-2 has-focus-visible:outline-outline">
          <Upload aria-hidden="true" size={14} />
          {upload.isPending ? 'Uploading…' : payment.has_attachment ? 'Replace attachment' : 'Upload attachment'}
          <input type="file" accept={ATTACHMENT_ACCEPT} className="sr-only" onChange={onFile} disabled={upload.isPending} />
        </label>
      </div>
      <p className="text-xs text-ink-muted">Bank slip or cheque scan: PDF, PNG or JPEG, up to 5 MB.</p>
      {problem ? (
        <p role="alert" className="text-xs font-medium text-danger-fg">
          {problem}
        </p>
      ) : null}
    </div>
  );
}

function Details({ payment }: { payment: Payment }) {
  const money = (value: string) => formatMoney(value, payment.currency);
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <StatusChip status={payment.status} />
        <Chip tone="brand">{METHOD_LABEL[payment.method]}</Chip>
        <Chip>{KIND_LABEL[payment.kind]}</Chip>
      </div>
      <p className="tabular text-2xl font-bold tracking-tight text-ink">{money(payment.amount)}</p>
      {payment.failure_reason ? <Notice tone="danger">{payment.failure_reason}</Notice> : null}

      <Rows>
        <Row label="Institution">{payment.institution?.name ?? 'Personal account'}</Row>
        <Row label="Package">
          {payment.package ? `${payment.package.name}${payment.package_version ? ` (v${payment.package_version})` : ''}` : ''}
        </Row>
        <Row label="Periods">{String(payment.periods)}</Row>
        <Row label="Period">{period(payment)}</Row>
        <Row label="Receipt number">{payment.receipt_number}</Row>
        <Row label="Refunded">{Number(payment.refunded_amount) > 0 ? money(payment.refunded_amount) : ''}</Row>
      </Rows>

      <Section title="Payment details">
        <Rows>
          <Row label="Reference">{payment.reference}</Row>
          <Row label="Payer name">{payment.payer_name}</Row>
          <Row label="Payment date">{payment.payment_date ? formatDate(payment.payment_date) : ''}</Row>
          <Row label="Recorded by">{payment.recorded_by ? payment.recorded_by.name || payment.recorded_by.email : ''}</Row>
          <Row label="Verified by">
            {payment.verified_by ? `${payment.verified_by.name || payment.verified_by.email}, ${formatDateTime(payment.verified_at)}` : ''}
          </Row>
          <Row label="Created">{formatDateTime(payment.created_at)}</Row>
          <Row label="Completed">{payment.completed_at ? formatDateTime(payment.completed_at) : ''}</Row>
          <Row label="Notes">{payment.notes}</Row>
        </Rows>
      </Section>

      {payment.bkash ? (
        <Section title="bKash">
          <Rows>
            <Row label="Payment ID">
              <span className="font-mono text-xs">{payment.bkash.payment_id}</span>
            </Row>
            <Row label="trxID">
              <span className="font-mono text-xs">{payment.bkash.trx_id}</span>
            </Row>
            <Row label="Payer account">
              <span className="font-mono text-xs">{payment.bkash.payer_account}</span>
            </Row>
            <Row label="bKash status">{payment.bkash.status}</Row>
          </Rows>
        </Section>
      ) : null}

      <Section title="Refunds">
        {payment.refunds.length === 0 ? (
          <p className="text-[13px] text-ink-muted">No refunds.</p>
        ) : (
          <ul aria-label="Refunds" className="flex flex-col gap-2">
            {payment.refunds.map((refund) => (
              <li key={refund.id} className="flex flex-col gap-1 rounded-lg border border-stroke-muted p-3 text-[13px]">
                <div className="flex items-center gap-2">
                  <span className="tabular font-semibold text-ink">{money(refund.amount)}</span>
                  <StatusChip status={refund.status} />
                  <span className="ml-auto text-xs text-ink-muted">{refund.method === 'bkash' ? 'via bKash' : 'Manual'}</span>
                </div>
                <p className="text-ink">{refund.reason}</p>
                <p className="text-xs text-ink-muted">
                  {[refund.created_by?.name || refund.created_by?.email, formatDateTime(refund.created_at), refund.bkash_refund_trx_id]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {payment.method !== 'bkash' ? (
        <Section title="Attachment">
          <AttachmentControls payment={payment} />
        </Section>
      ) : null}
    </>
  );
}

type Action = 'verify' | 'reject' | 'refund';

function Actions({ payment, onAction }: { payment: Payment; onAction: (action: Action) => void }) {
  const pendingManual = payment.status === 'pending' && payment.method !== 'bkash';
  const refundable = REFUNDABLE.has(payment.status) && remaining(payment.amount, payment.refunded_amount) > 0;
  return (
    <>
      {HAS_RECEIPT.has(payment.status) && payment.receipt_number ? (
        <a
          href={receiptUrl(payment.id)}
          target="_blank"
          rel="noopener noreferrer"
          className="mr-auto inline-flex h-10 items-center gap-2 rounded-lg px-3 text-sm font-medium text-ink hover:bg-hover"
        >
          <FileText aria-hidden="true" size={16} />
          Receipt
          <span className="sr-only">(opens in a new tab)</span>
        </a>
      ) : null}
      {refundable ? (
        <Button variant="danger" icon={Undo2} onClick={() => onAction('refund')}>
          Refund
        </Button>
      ) : null}
      {pendingManual ? (
        <>
          <Button variant="danger" icon={CircleX} onClick={() => onAction('reject')}>
            Reject
          </Button>
          <Button variant="primary" icon={BadgeCheck} onClick={() => onAction('verify')}>
            Verify
          </Button>
        </>
      ) : null}
    </>
  );
}

export function PaymentDrawer({ paymentId, onClose }: { paymentId: string | null; onClose: () => void }) {
  const notify = useToast();
  const detail = usePayment(paymentId);
  const verify = useVerifyPayment();
  const reject = useRejectPayment();
  const [action, setAction] = useState<Action | null>(null);
  const payment = detail.data;

  const start = (next: Action) => {
    verify.reset();
    reject.reset();
    setAction(next);
  };

  return (
    <>
      <Drawer
        open={paymentId !== null}
        onOpenChange={(open) => !open && onClose()}
        title={payment?.receipt_number ? `Payment ${payment.receipt_number}` : 'Payment'}
        description={payment ? `${payment.institution?.name ?? 'Personal account'} · ${formatDate(payment.completed_at ?? payment.payment_date ?? payment.created_at)}` : undefined}
        footer={payment ? <Actions payment={payment} onAction={start} /> : undefined}
      >
        {detail.isPending ? <LoadingState /> : null}
        {detail.isError ? <ErrorState error={detail.error} onRetry={() => void detail.refetch()} /> : null}
        {payment ? <Details payment={payment} /> : null}
      </Drawer>

      {payment ? (
        <>
          <ConfirmDialog
            open={action === 'verify'}
            onOpenChange={(open) => !open && setAction(null)}
            title="Verify payment"
            description={`Confirms ${formatMoney(payment.amount, payment.currency)} from ${payment.institution?.name ?? 'this account'} arrived. ${payment.package?.name ?? 'The package'} is applied for the recorded period at once.`}
            confirmLabel="Verify"
            tone="primary"
            pending={verify.isPending}
            error={verify.error}
            onConfirm={() =>
              verify.mutate(
                { id: payment.id },
                {
                  onSuccess: () => {
                    setAction(null);
                    notify('Payment verified and the subscription updated.');
                  },
                },
              )
            }
          />
          <ConfirmDialog
            open={action === 'reject'}
            onOpenChange={(open) => !open && setAction(null)}
            title="Reject payment"
            description="The payment is marked rejected and nothing changes on the subscription."
            confirmLabel="Reject"
            reason="required"
            pending={reject.isPending}
            error={reject.error}
            onConfirm={({ reason }) =>
              reject.mutate(
                { id: payment.id, reason },
                {
                  onSuccess: () => {
                    setAction(null);
                    notify('Payment rejected.');
                  },
                },
              )
            }
          />
          <RefundDialog payment={payment} open={action === 'refund'} onOpenChange={(open) => !open && setAction(null)} />
        </>
      ) : null}
    </>
  );
}
