import { useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { Ban, Building2, ExternalLink, Mail, Plus, RotateCcw, Trash2 } from 'lucide-react';
import type { InstitutionListItem, InstitutionRef, InstitutionStatus } from '@/api/types';
import type { StatusRequest } from '@/features/institutions/status';
import {
  Button,
  EmptyState,
  ErrorState,
  Menu,
  Pagination,
  SearchInput,
  SeatMeter,
  Select,
  StatusChip,
  Table,
  TableMessage,
  Td,
  Th,
  Tr,
} from '@/components/ui';
import { InstitutionStatusDialog } from '@/features/institutions/status';
import { CreateInstitutionDialog } from '@/features/institutions/create';
import { InviteAdminDialog } from '@/features/invitations/invite';
import { formatDate, formatNumber } from '@/lib/format';
import { useInstitutions } from '@/api/queries';
import { Page } from '@/components/layout/Page';
import { TYPE_LABEL } from '@/lib/labels';

const PAGE_SIZE = 25;

const STATUS_FILTERS: { value: '' | InstitutionStatus; label: string }[] = [
  { value: '', label: 'Active and suspended' },
  { value: 'active', label: 'Active' },
  { value: 'suspended', label: 'Suspended' },
  { value: 'deactivated', label: 'Removed' },
];

function rowActions(
  institution: InstitutionListItem,
  open: () => void,
  invite: (institution: InstitutionRef) => void,
  setStatus: (request: StatusRequest) => void,
) {
  const ref = { slug: institution.slug, name: institution.name };
  const removed = institution.status === 'deactivated';
  return [
    { label: 'Open', icon: ExternalLink, onSelect: open },
    { label: 'Invite admin', icon: Mail, onSelect: () => invite(ref), disabled: removed },
    institution.status === 'active'
      ? { label: 'Suspend', icon: Ban, danger: true, onSelect: () => setStatus({ institution: ref, action: 'suspend' }) }
      : { label: 'Reactivate', icon: RotateCcw, onSelect: () => setStatus({ institution: ref, action: 'reactivate' }) },
    { label: 'Remove', icon: Trash2, danger: true, disabled: removed, onSelect: () => setStatus({ institution: ref, action: 'deactivate' }) },
  ];
}

export function InstitutionsPage() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'' | InstitutionStatus>('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [inviting, setInviting] = useState<InstitutionRef | null>(null);
  const [statusRequest, setStatusRequest] = useState<StatusRequest | null>(null);
  const list = useInstitutions({ q, status: status || undefined, page, page_size: PAGE_SIZE });
  const results = list.data?.results ?? [];
  const filtered = q !== '' || status !== '';

  const open = (slug: string) => void navigate({ to: '/institutions/$slug', params: { slug } });

  return (
    <Page
      title="Institutions"
      subtitle={list.data ? `${formatNumber(list.data.count)} institutions` : undefined}
      actions={
        <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>
          Create institution
        </Button>
      }
    >
      <div className="flex flex-wrap items-center gap-3">
        <SearchInput
          label="Search institutions"
          value={q}
          onChange={(value) => {
            setQ(value);
            setPage(1);
          }}
        />
        <Select
          aria-label="Status"
          inline
          value={status}
          onChange={(event) => {
            setStatus(event.target.value as '' | InstitutionStatus);
            setPage(1);
          }}
        >
          {STATUS_FILTERS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </div>

      {list.isError ? <ErrorState error={list.error} onRetry={() => void list.refetch()} /> : null}

      {!list.isPending && results.length === 0 && !filtered ? (
        <div className="rounded-xl border border-stroke bg-surface">
          <EmptyState
            icon={Building2}
            title="No institutions yet"
            action={
              <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>
                Create institution
              </Button>
            }
          >
            Create the first institution, or invite an institution admin from Invitations and create it there.
          </EmptyState>
        </div>
      ) : (
        <div>
          <Table label="Institutions">
            <thead>
              <tr>
                <Th>Institution</Th>
                <Th>Status</Th>
                <Th>Seats</Th>
                <Th>Members</Th>
                <Th>Admins</Th>
                <Th>Waiting</Th>
                <Th>Created</Th>
                <Th className="w-12">
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {results.length === 0 ? (
                <TableMessage colSpan={8}>{list.isPending ? 'Loading…' : 'No institutions match these filters.'}</TableMessage>
              ) : (
                results.map((institution) => (
                  <Tr key={institution.id} onOpen={() => open(institution.slug)} openLabel={`Open ${institution.name}`}>
                    <Td>
                      <div className="flex flex-col">
                        <Link to="/institutions/$slug" params={{ slug: institution.slug }} className="font-semibold text-ink hover:text-brand">
                          {institution.name}
                        </Link>
                        <span className="text-xs text-ink-muted">
                          {TYPE_LABEL[institution.type]} · {institution.slug}
                        </span>
                      </div>
                    </Td>
                    <Td>
                      <StatusChip status={institution.status} />
                    </Td>
                    <Td>
                      <SeatMeter seats={institution.seats} compact />
                    </Td>
                    <Td className="tabular">{formatNumber(institution.members_count)}</Td>
                    <Td className="max-w-56">
                      {institution.admins.length === 0 ? (
                        <span className="text-ink-muted">None yet</span>
                      ) : (
                        <span className="block truncate" title={institution.admins.map((admin) => admin.email).join(', ')}>
                          {institution.admins.map((admin) => admin.name || admin.email).join(', ')}
                        </span>
                      )}
                    </Td>
                    <Td className="text-xs whitespace-nowrap text-ink-muted">
                      {formatNumber(institution.pending_invitations)} invites · {formatNumber(institution.pending_requests)} requests
                    </Td>
                    <Td className="tabular whitespace-nowrap">{formatDate(institution.created_at)}</Td>
                    <Td className="text-right">
                      <Menu
                        label={`Actions for ${institution.name}`}
                        actions={rowActions(institution, () => open(institution.slug), setInviting, setStatusRequest)}
                      />
                    </Td>
                  </Tr>
                ))
              )}
            </tbody>
          </Table>
          {list.data ? (
            <Pagination page={page} pageSize={PAGE_SIZE} count={list.data.count} onPage={setPage} noun="institutions" />
          ) : null}
        </div>
      )}

      <CreateInstitutionDialog open={creating} onOpenChange={setCreating} />
      <InviteAdminDialog open={inviting !== null} onOpenChange={(value) => !value && setInviting(null)} institution={inviting ?? undefined} />
      <InstitutionStatusDialog request={statusRequest} onClose={() => setStatusRequest(null)} />
    </Page>
  );
}
