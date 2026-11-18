import { useState } from 'react';
import { Ban, CircleCheck, RotateCcw, Shield, ShieldOff, UserMinus } from 'lucide-react';
import type { InstitutionDetail, Member, MemberLabel, MembershipStatus, Role } from '@/api/types';
import type { ActionTarget, MembershipAction } from '@/features/members/actions';
import type { MenuAction } from '@/components/ui';
import { CoverageChip, ErrorState, Menu, Pagination, SearchInput, Select, StatusChip, Table, TableMessage, Td, Th } from '@/components/ui';
import { MembershipActionDialog } from '@/features/members/actions';
import { MEMBER_LABELS, ROLES, ROLE_LABEL } from '@/lib/labels';
import { useMembers } from '@/api/queries';
import { formatDate } from '@/lib/format';

const PAGE_SIZE = 25;

const STATUS_FILTERS: { value: '' | MembershipStatus; label: string }[] = [
  { value: '', label: 'All statuses' },
  { value: 'active', label: 'Active' },
  { value: 'pending', label: 'Sign-up requests' },
  { value: 'suspended', label: 'Suspended' },
  { value: 'deprovisioned', label: 'Removed' },
];

/** Only covered members can be made admin or suspended (the server refuses it for anyone else). */
function activeActions(member: Member, base: ActionTarget, act: (action: MembershipAction) => void): MenuAction[] {
  const covered = member.coverage === 'institution';
  const isAdmin = member.role === 'admin' || member.role === 'owner';
  const role: MenuAction | null = isAdmin
    ? { label: 'Make member', icon: ShieldOff, onSelect: () => act({ kind: 'role', role: 'member', ...base }) }
    : covered
      ? { label: 'Make admin', icon: Shield, onSelect: () => act({ kind: 'role', role: 'admin', ...base }) }
      : null;
  const suspend: MenuAction | null = covered ? { label: 'Suspend', icon: Ban, danger: true, onSelect: () => act({ kind: 'suspend', ...base }) } : null;
  return [role, suspend].filter((action): action is MenuAction => action !== null);
}

function memberActions(member: Member, institution: string, act: (action: MembershipAction) => void): MenuAction[] {
  const base = { membershipId: member.membership_id, name: member.user.name || member.user.email, institution };
  const byStatus: Record<MembershipStatus, MenuAction[]> = {
    pending: [{ label: 'Approve request', icon: CircleCheck, onSelect: () => act({ kind: 'approve', ...base }) }],
    active: activeActions(member, base, act),
    suspended: [{ label: 'Reactivate', icon: RotateCcw, onSelect: () => act({ kind: 'activate', ...base }) }],
    deprovisioned: [],
  };
  const actions = byStatus[member.status];
  return member.status === 'deprovisioned'
    ? actions
    : [...actions, { label: 'Take out of institution', icon: UserMinus, danger: true, onSelect: () => act({ kind: 'remove', ...base }) }];
}

export function Members({ institution }: { institution: InstitutionDetail }) {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'' | MembershipStatus>('');
  const [role, setRole] = useState<'' | Role>('');
  const [label, setLabel] = useState<'' | MemberLabel>('');
  const [page, setPage] = useState(1);
  const [action, setAction] = useState<MembershipAction | null>(null);
  const list = useMembers(institution.slug, { q, status: status || undefined, role: role || undefined, label: label || undefined, page, page_size: PAGE_SIZE });
  const results = list.data?.results ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <SearchInput label="Search members" value={q} onChange={(value) => { setQ(value); setPage(1); }} />
        <Select aria-label="Status" inline value={status} onChange={(event) => { setStatus(event.target.value as '' | MembershipStatus); setPage(1); }}>
          {STATUS_FILTERS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
        <Select aria-label="Role" inline value={role} onChange={(event) => { setRole(event.target.value as '' | Role); setPage(1); }}>
          <option value="">All roles</option>
          {ROLES.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
        <Select aria-label="Coverage" inline value={label} onChange={(event) => { setLabel(event.target.value as '' | MemberLabel); setPage(1); }}>
          <option value="">All coverage</option>
          {MEMBER_LABELS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </div>
      {list.isError ? <ErrorState error={list.error} onRetry={() => void list.refetch()} /> : null}
      <div>
        <Table label={`Members of ${institution.name}`}>
          <thead>
            <tr>
              <Th>Member</Th>
              <Th>Role</Th>
              <Th>Status</Th>
              <Th>Coverage</Th>
              <Th>Account</Th>
              <Th>Joined</Th>
              <Th className="w-12">
                <span className="sr-only">Actions</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {results.length === 0 ? (
              <TableMessage colSpan={7}>{list.isPending ? 'Loading…' : 'No members match these filters.'}</TableMessage>
            ) : (
              results.map((member) => {
                const actions = memberActions(member, institution.name, setAction);
                return (
                  <tr key={member.membership_id}>
                    <Td>
                      <div className="flex flex-col">
                        <span className="font-medium">{member.user.name || '—'}</span>
                        <span className="text-xs text-ink-muted">{member.user.email}</span>
                      </div>
                    </Td>
                    <Td>{ROLE_LABEL[member.role]}</Td>
                    <Td>
                      <StatusChip status={member.status} />
                    </Td>
                    <Td>{member.label ? <CoverageChip label={member.label} /> : <span className="text-ink-muted">—</span>}</Td>
                    <Td>{member.user.status === 'active' ? <span className="text-ink-muted">Active</span> : <StatusChip status={member.user.status} />}</Td>
                    <Td className="tabular whitespace-nowrap">{formatDate(member.joined_at)}</Td>
                    <Td className="text-right">
                      {actions.length > 0 ? <Menu label={`Actions for ${member.user.name || member.user.email}`} actions={actions} /> : null}
                    </Td>
                  </tr>
                );
              })
            )}
          </tbody>
        </Table>
        {list.data ? <Pagination page={page} pageSize={PAGE_SIZE} count={list.data.count} onPage={setPage} noun="members" /> : null}
      </div>
      <MembershipActionDialog action={action} onClose={() => setAction(null)} />
    </div>
  );
}
