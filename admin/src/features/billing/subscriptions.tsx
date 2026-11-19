import { useState } from 'react';
import { CalendarX, CirclePause, CirclePlay, Plus } from 'lucide-react';
import type { BillingSubscription, InstitutionRef } from '@/api/types';
import type { SubscriptionAction } from '@/api/queries';
import type { MenuAction } from '@/components/ui';
import { Chip, ConfirmDialog, Menu, StatusChip, Table, TableMessage, Td, Th, useToast } from '@/components/ui';
import { useSubscriptionAction } from '@/api/queries';
import { formatDate } from '@/lib/format';
import { METHOD_LABEL } from './labels';

const CURRENT = new Set(['active', 'trial', 'past_due']);

interface Pending {
  subscription: BillingSubscription;
  action: SubscriptionAction;
}

const who = (sub: BillingSubscription) => sub.institution?.name ?? 'Personal account';

const CONFIRM: Record<SubscriptionAction, (sub: BillingSubscription) => { title: string; description: string; label: string; danger: boolean; done: string }> = {
  'cancel-scheduled-change': (sub) => ({
    title: 'Cancel scheduled change',
    description: `${who(sub)} stays on ${sub.package.name} at the next renewal instead of moving to ${sub.scheduled_package?.name ?? 'the scheduled package'}.`,
    label: 'Cancel change',
    danger: false,
    done: 'Scheduled change cancelled.',
  }),
  'stop-renewal': (sub) => ({
    title: 'Stop renewal',
    description: `${sub.package.name} for ${who(sub)} ends on ${formatDate(sub.expires_at)} and is not renewed. Members keep access until then.`,
    label: 'Stop renewal',
    danger: true,
    done: 'Renewal stopped.',
  }),
  'resume-renewal': (sub) => ({
    title: 'Resume renewal',
    description: `${sub.package.name} for ${who(sub)} can be renewed again when its period ends on ${formatDate(sub.expires_at)}.`,
    label: 'Resume renewal',
    danger: false,
    done: 'Renewal resumed.',
  }),
};

function rowActions(sub: BillingSubscription, ask: (pending: Pending) => void, record?: (institution: InstitutionRef) => void): MenuAction[] {
  const current = CURRENT.has(sub.status);
  const institution = sub.institution;
  const actions: MenuAction[] = [];
  if (record && institution) actions.push({ label: 'Record payment', icon: Plus, onSelect: () => record(institution) });
  if (sub.scheduled_package) {
    actions.push({ label: 'Cancel scheduled change', icon: CalendarX, onSelect: () => ask({ subscription: sub, action: 'cancel-scheduled-change' }) });
  }
  if (current && sub.auto_renew) {
    actions.push({ label: 'Stop renewal', icon: CirclePause, danger: true, onSelect: () => ask({ subscription: sub, action: 'stop-renewal' }) });
  }
  if (current && !sub.auto_renew) {
    actions.push({ label: 'Resume renewal', icon: CirclePlay, onSelect: () => ask({ subscription: sub, action: 'resume-renewal' }) });
  }
  return actions;
}

interface SubscriptionTableProps {
  label: string;
  subscriptions: BillingSubscription[];
  loading: boolean;
  emptyText: string;
  showInstitution?: boolean;
  onRecordPayment?: (institution: InstitutionRef) => void;
}

export function SubscriptionTable({ label, subscriptions, loading, emptyText, showInstitution = true, onRecordPayment }: SubscriptionTableProps) {
  const notify = useToast();
  const mutation = useSubscriptionAction();
  const [pending, setPending] = useState<Pending | null>(null);
  const confirm = pending ? CONFIRM[pending.action](pending.subscription) : null;
  const columns = showInstitution ? 8 : 7;

  const ask = (next: Pending) => {
    mutation.reset();
    setPending(next);
  };

  return (
    <>
      <Table label={label}>
        <thead>
          <tr>
            {showInstitution ? <Th>Institution</Th> : null}
            <Th>Package</Th>
            <Th>Status</Th>
            <Th>Started</Th>
            <Th>Ends</Th>
            <Th>Renewal</Th>
            <Th>Last payment</Th>
            <Th className="w-12">
              <span className="sr-only">Actions</span>
            </Th>
          </tr>
        </thead>
        <tbody>
          {subscriptions.length === 0 ? (
            <TableMessage colSpan={columns}>{loading ? 'Loading…' : emptyText}</TableMessage>
          ) : (
            subscriptions.map((sub) => {
              const actions = rowActions(sub, ask, onRecordPayment);
              return (
                <tr key={sub.id}>
                  {showInstitution ? <Td className="max-w-56 truncate font-semibold">{who(sub)}</Td> : null}
                  <Td className="max-w-64">
                    <span className="block truncate font-medium">
                      {sub.package.name} <span className="text-xs text-ink-muted">v{sub.version}</span>
                    </span>
                    <span className="block truncate text-xs text-ink-muted">{sub.apps.map((app) => app.name).join(', ')}</span>
                  </Td>
                  <Td>
                    <StatusChip status={sub.status} />
                  </Td>
                  <Td className="tabular whitespace-nowrap">{formatDate(sub.starts_at)}</Td>
                  <Td className="tabular whitespace-nowrap">{formatDate(sub.expires_at)}</Td>
                  <Td>
                    <div className="flex flex-col items-start gap-1">
                      {sub.auto_renew ? <Chip tone="success">Renews</Chip> : <Chip tone="warning">Renewal stopped</Chip>}
                      {sub.scheduled_package ? <Chip tone="info">Then {sub.scheduled_package.name}</Chip> : null}
                    </div>
                  </Td>
                  <Td className="text-xs whitespace-nowrap text-ink-muted">
                    {sub.last_payment ? `${METHOD_LABEL[sub.last_payment.method]} · ${formatDate(sub.last_payment.completed_at)}` : '—'}
                  </Td>
                  <Td className="text-right">
                    {actions.length > 0 ? <Menu label={`Actions for ${sub.package.name}, ${who(sub)}`} actions={actions} /> : null}
                  </Td>
                </tr>
              );
            })
          )}
        </tbody>
      </Table>
      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => !open && setPending(null)}
        title={confirm?.title ?? ''}
        description={confirm?.description}
        confirmLabel={confirm?.label ?? ''}
        tone={confirm?.danger ? 'danger' : 'primary'}
        pending={mutation.isPending}
        error={mutation.error}
        onConfirm={() => {
          if (!pending || !confirm) return;
          mutation.mutate(
            { id: pending.subscription.id, action: pending.action },
            {
              onSuccess: () => {
                setPending(null);
                notify(confirm.done);
              },
            },
          );
        }}
      />
    </>
  );
}
