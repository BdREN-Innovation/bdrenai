import { useEffect, useState } from 'react';
import { Ban, RotateCcw, Shield, ShieldOff, UserMinus } from 'lucide-react';
import type { Member } from '@/api/types';
import type { MenuAction } from '@/components/ui';
import type { MemberChange } from './queries';
import type { TabCounts } from './types';
import { Chip, ConfirmDialog, ErrorState, Menu, Pagination, Select, StatusChip, Table, TableMessage, Td, Th, Tr, useToast } from '@/components/ui';
import { usePortalMembers, useRemoveMember, useUpdateMember } from './queries';
import { REMOVAL_CONSEQUENCE } from './support';
import { portalErrorMessage } from './errors';
import { CoveredPanel } from './panel';
import { ROLE_LABEL } from '@/lib/labels';
import { formatDate } from '@/lib/format';

const PAGE_SIZE = 25;
const STATUSES = ['active', 'suspended'] as const;
const ROLES = ['owner', 'admin', 'member'] as const;

/** The option `value` names, or '' for "all". */
function pick<T extends string>(values: readonly T[], value: string): T | '' {
  return values.find((item) => item === value) ?? '';
}

type Confirm = 'suspend' | 'remove';
type Action = { label: string; icon: MenuAction['icon']; danger?: boolean } & ({ change: MemberChange } | { confirm: Confirm });

function actionsFor(member: Member): Action[] {
  const remove: Action = { label: 'Remove', icon: UserMinus, danger: true, confirm: 'remove' };
  if (member.status === 'suspended') return [{ label: 'Activate', icon: RotateCcw, change: { status: 'active' } }, remove];
  const role: Action =
    member.role === 'admin'
      ? { label: 'Make member', icon: ShieldOff, change: { role: 'member' } }
      : { label: 'Make admin', icon: Shield, change: { role: 'admin' } };
  return [role, { label: 'Suspend', icon: Ban, danger: true, confirm: 'suspend' }, remove];
}

const who = (member: Member) => member.user.name || member.user.email;

const CONFIRM_COPY: Record<Confirm, { title: (name: string) => string; body: string; action: string }> = {
  suspend: {
    title: (name) => `Suspend ${name}?`,
    body: "They lose access to your institution's package until you activate them again. They keep their seat meanwhile.",
    action: 'Suspend',
  },
  remove: {
    title: (name) => `Remove ${name} from your package?`,
    body: `${REMOVAL_CONSEQUENCE} Their seat is freed.`,
    action: 'Remove',
  },
};

interface CoveredTabProps {
  slug: string;
  selfId: string | null;
  q: string;
  onTabs: (tabs: TabCounts) => void;
}

/** Members on the institution's package (the Covered tab): filters, row actions and the side panel. */
export function CoveredTab({ slug, selfId, q, onTabs }: CoveredTabProps) {
  const notify = useToast();
  const [status, setStatus] = useState<'' | (typeof STATUSES)[number]>('');
  const [role, setRole] = useState<'' | (typeof ROLES)[number]>('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<Member | null>(null);
  const [confirm, setConfirm] = useState<{ member: Member; kind: Confirm } | null>(null);
  const update = useUpdateMember(slug);
  const remove = useRemoveMember(slug);
  const list = usePortalMembers<Member>(slug, { tab: 'covered', q, status: status || undefined, role: role || undefined, page, page_size: PAGE_SIZE });
  const results = list.data?.results ?? [];

  useEffect(() => {
    if (list.data) onTabs(list.data.tabs);
  }, [list.data, onTabs]);

  useEffect(() => {
    setPage(1);
  }, [q]);

  const lockReason = (member: Member) =>
    member.user.id === selfId
      ? "You can't change your own membership. Ask another admin."
      : member.role === 'owner'
        ? "The owner can't be changed here. Contact BdREN."
        : null;

  const change = (member: Member, body: MemberChange) => {
    const done = body.role ? `${who(member)} is now ${body.role === 'admin' ? 'an admin' : 'a member'}.` : `${who(member)} is active again.`;
    update.mutate(
      { id: member.membership_id, body },
      {
        onSuccess: () => notify(done),
        onError: (error) => notify(portalErrorMessage(error, `We couldn't update ${who(member)}. Try again.`), 'danger'),
      },
    );
  };

  const choose = (member: Member, action: Action) => {
    setOpen(null);
    if ('confirm' in action) {
      update.reset();
      remove.reset();
      setConfirm({ member, kind: action.confirm });
      return;
    }
    change(member, action.change);
  };

  const confirmed = () => {
    if (!confirm) return;
    const { member, kind } = confirm;
    const onSuccess = (text: string) => () => {
      notify(text);
      setConfirm(null);
    };
    if (kind === 'suspend') {
      update.mutate({ id: member.membership_id, body: { status: 'suspended' } }, { onSuccess: onSuccess(`${who(member)} is suspended.`) });
      return;
    }
    remove.mutate(member.membership_id, {
      onSuccess: onSuccess(`${who(member)} is off your package. They moved to Not covered and their seat is free.`),
    });
  };

  const pendingConfirm = confirm?.kind === 'remove' ? remove : update;
  const copy = confirm ? CONFIRM_COPY[confirm.kind] : null;
  const filtered = Boolean(q || status || role);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          inline
          aria-label="Status"
          value={status}
          onChange={(event) => {
            setStatus(pick(STATUSES, event.target.value));
            setPage(1);
          }}
        >
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
        </Select>
        <Select
          inline
          aria-label="Role"
          value={role}
          onChange={(event) => {
            setRole(pick(ROLES, event.target.value));
            setPage(1);
          }}
        >
          <option value="">All roles</option>
          <option value="owner">Owner</option>
          <option value="admin">Admin</option>
          <option value="member">Member</option>
        </Select>
      </div>
      {list.isError ? <ErrorState error={new Error("We couldn't load members.")} onRetry={() => void list.refetch()} /> : null}
      <div>
        <Table label={`Covered members, ${list.data?.count ?? 0} in all`}>
          <thead>
            <tr>
              <Th>Member</Th>
              <Th>Role</Th>
              <Th>Status</Th>
              <Th>Joined</Th>
              <Th className="w-12">
                <span className="sr-only">Actions</span>
              </Th>
            </tr>
          </thead>
          <tbody aria-busy={list.isFetching}>
            {list.isPending ? <TableMessage colSpan={5}>Loading members…</TableMessage> : null}
            {list.data && results.length === 0 ? (
              <TableMessage colSpan={5}>
                {filtered ? 'No members match these filters.' : 'Nobody is on your package yet. Invite members, or add people from the Not covered tab.'}
              </TableMessage>
            ) : null}
            {results.map((member) => {
              const locked = lockReason(member);
              return (
                <Tr key={member.membership_id} onOpen={() => setOpen(member)} openLabel={`Details for ${who(member)}`}>
                  <Td>
                    <span className="block font-medium">{member.user.name || '—'}</span>
                    <span className="block text-xs text-ink-muted">{member.user.email}</span>
                  </Td>
                  <Td>{ROLE_LABEL[member.role]}</Td>
                  <Td>
                    <StatusChip status={member.status} />
                  </Td>
                  <Td>{formatDate(member.joined_at)}</Td>
                  <Td className="text-right">
                    {locked ? (
                      <Chip>{member.user.id === selfId ? 'You' : 'Owner'}</Chip>
                    ) : (
                      <Menu
                        label={`Actions for ${who(member)}`}
                        actions={actionsFor(member).map((action) => ({
                          label: action.label,
                          icon: action.icon,
                          danger: action.danger,
                          disabled: update.isPending && update.variables?.id === member.membership_id,
                          onSelect: () => choose(member, action),
                        }))}
                      />
                    )}
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
        {list.data ? <Pagination page={list.data.page} pageSize={list.data.page_size} count={list.data.count} onPage={setPage} noun="members" /> : null}
      </div>

      <CoveredPanel
        slug={slug}
        member={open}
        locked={open ? lockReason(open) : null}
        actions={open ? actionsFor(open).map((action) => ({ label: action.label, run: () => choose(open, action) })) : []}
        onClose={() => setOpen(null)}
      />
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(next) => !next && setConfirm(null)}
        title={confirm && copy ? copy.title(who(confirm.member)) : ''}
        description={copy?.body}
        confirmLabel={copy?.action ?? ''}
        pending={pendingConfirm.isPending}
        error={pendingConfirm.isError ? new Error(portalErrorMessage(pendingConfirm.error, 'Something went wrong. Try again.')) : undefined}
        onConfirm={confirmed}
      />
    </div>
  );
}
