import { useState } from 'react';
import type { AuditEntry } from '@/api/types';
import { Drawer, Table, TableMessage, Td, Th, Tr } from '@/components/ui';
import { formatDateTime, formatRelative, humanize } from '@/lib/format';

function actorLabel(entry: AuditEntry): string {
  return entry.actor ? entry.actor.name || entry.actor.email : 'System';
}

function reasonOf(entry: AuditEntry): string | null {
  const reason = entry.metadata.reason;
  return typeof reason === 'string' && reason ? reason : null;
}

/** "institution.suspend" reads as "Institution suspend"; the raw code stays in the drawer. */
export function actionLabel(action: string): string {
  return humanize(action);
}

interface AuditTableProps {
  entries: AuditEntry[];
  loading: boolean;
  emptyText?: string;
  label?: string;
}

/** Audit rows; a row opens the full entry, metadata included, in a drawer. */
export function AuditTable({ entries, loading, emptyText = 'No activity recorded yet.', label = 'Audit log' }: AuditTableProps) {
  const [open, setOpen] = useState<AuditEntry | null>(null);
  return (
    <>
      <Table label={label}>
        <thead>
          <tr>
            <Th>When</Th>
            <Th>Action</Th>
            <Th>Actor</Th>
            <Th>Target</Th>
            <Th>Reason</Th>
          </tr>
        </thead>
        <tbody>
          {entries.length === 0 ? (
            <TableMessage colSpan={5}>{loading ? 'Loading…' : emptyText}</TableMessage>
          ) : (
            entries.map((entry) => (
              <Tr key={entry.id} onOpen={() => setOpen(entry)} openLabel={`${actionLabel(entry.action)} by ${actorLabel(entry)}, open details`}>
                <Td className="tabular whitespace-nowrap" title={formatDateTime(entry.created_at)}>
                  {formatRelative(entry.created_at)}
                </Td>
                <Td>
                  <code className="font-mono text-xs">{entry.action}</code>
                </Td>
                <Td>{actorLabel(entry)}</Td>
                <Td>
                  <span className="text-ink-muted">{entry.target_type}</span>{' '}
                  <span className="font-mono text-xs">{entry.target_id.slice(0, 8)}</span>
                </Td>
                <Td className="max-w-64 truncate text-ink-muted">{reasonOf(entry) ?? '—'}</Td>
              </Tr>
            ))
          )}
        </tbody>
      </Table>
      <AuditDrawer entry={open} onClose={() => setOpen(null)} />
    </>
  );
}

export function AuditDrawer({ entry, onClose }: { entry: AuditEntry | null; onClose: () => void }) {
  return (
    <Drawer
      open={entry !== null}
      onOpenChange={(value) => !value && onClose()}
      title={entry ? actionLabel(entry.action) : 'Audit entry'}
      description={entry ? formatDateTime(entry.created_at) : undefined}
    >
      {entry ? (
        <>
          <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-2 text-[13px]">
            <dt className="text-ink-muted">Action</dt>
            <dd className="font-mono text-xs break-all">{entry.action}</dd>
            <dt className="text-ink-muted">Actor</dt>
            <dd>{entry.actor ? `${entry.actor.name || '—'} (${entry.actor.email})` : 'System'}</dd>
            <dt className="text-ink-muted">Target type</dt>
            <dd>{entry.target_type}</dd>
            <dt className="text-ink-muted">Target ID</dt>
            <dd className="font-mono text-xs break-all">{entry.target_id}</dd>
            <dt className="text-ink-muted">IP address</dt>
            <dd className="font-mono text-xs">{entry.ip_address || '—'}</dd>
            <dt className="text-ink-muted">Entry ID</dt>
            <dd className="font-mono text-xs break-all">{entry.id}</dd>
          </dl>
          <div className="flex flex-col gap-1.5">
            <h3 className="text-xs font-semibold text-ink">Metadata</h3>
            <pre className="overflow-x-auto rounded-lg bg-surface-2 p-3 font-mono text-xs text-ink">
              {JSON.stringify(entry.metadata, null, 2)}
            </pre>
          </div>
        </>
      ) : null}
    </Drawer>
  );
}

/** Compact activity list for the dashboard and the user drawer. */
export function ActivityList({ entries, emptyText = 'No activity yet.' }: { entries: AuditEntry[]; emptyText?: string }) {
  if (entries.length === 0) return <p className="text-[13px] text-ink-muted">{emptyText}</p>;
  return (
    <ul className="flex flex-col">
      {entries.map((entry) => (
        <li key={entry.id} className="flex items-baseline justify-between gap-3 border-t border-stroke-muted py-2.5 first:border-t-0 first:pt-0">
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-[13px] font-medium text-ink">{actionLabel(entry.action)}</span>
            <span className="truncate text-xs text-ink-muted">
              {actorLabel(entry)}
              {reasonOf(entry) ? ` · ${reasonOf(entry)}` : ''}
            </span>
          </div>
          <time dateTime={entry.created_at} title={formatDateTime(entry.created_at)} className="tabular shrink-0 text-xs text-ink-muted">
            {formatRelative(entry.created_at)}
          </time>
        </li>
      ))}
    </ul>
  );
}
