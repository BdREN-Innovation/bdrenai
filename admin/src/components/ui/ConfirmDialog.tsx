import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Field, Input, Textarea } from './Field';
import { Dialog } from './Dialog';
import { Button } from './Button';
import { ErrorState } from './States';

export interface ConfirmValues {
  reason: string;
}

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  confirmLabel: string;
  tone?: 'danger' | 'primary';
  /** When set, the confirm button stays disabled until this exact text is typed. */
  typedConfirmation?: string;
  reason?: 'required' | 'optional' | 'none';
  pending?: boolean;
  error?: unknown;
  onConfirm: (values: ConfirmValues) => void;
  children?: ReactNode;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  tone = 'danger',
  typedConfirmation,
  reason = 'none',
  pending = false,
  error,
  onConfirm,
  children,
}: ConfirmDialogProps) {
  const [typed, setTyped] = useState('');
  const [reasonText, setReasonText] = useState('');

  useEffect(() => {
    if (!open) return;
    setTyped('');
    setReasonText('');
  }, [open]);

  const typedOk = typedConfirmation === undefined || typed === typedConfirmation;
  const reasonOk = reason !== 'required' || reasonText.trim().length > 0;
  const canConfirm = typedOk && reasonOk && !pending;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      onSubmit={() => canConfirm && onConfirm({ reason: reasonText.trim() })}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" variant={tone === 'danger' ? 'danger' : 'primary'} disabled={!canConfirm} loading={pending}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
      {reason !== 'none' ? (
        <Field label="Reason" required={reason === 'required'} hint="Saved in the audit log.">
          {(props) => (
            <Textarea {...props} value={reasonText} onChange={(event) => setReasonText(event.target.value)} rows={3} />
          )}
        </Field>
      ) : null}
      {typedConfirmation !== undefined ? (
        <Field
          label={`Type "${typedConfirmation}" to confirm`}
          required
        >
          {(props) => (
            <Input
              {...props}
              value={typed}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => setTyped(event.target.value)}
            />
          )}
        </Field>
      ) : null}
      {error ? <ErrorState error={error} /> : null}
    </Dialog>
  );
}
