import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Ban, RotateCcw, ShieldCheck } from 'lucide-react';
import type { Role, UserListItem, UserStatus } from '@/api/types';
import type { PickedInstitution } from '@/features/invitations/picker';
import {
  Button,
  Chip,
  ConfirmDialog,
  Drawer,
  ErrorState,
  LoadingState,
  Pagination,
  SearchInput,
  Select,
  StatusChip,
  Table,
  TableMessage,
  Tabs,
  Td,
  Th,
  Tr,
  useToast,
} from '@/components/ui';
import { formatDate, formatDateTime, formatNumber, formatRelative } from '@/lib/format';
import { InstitutionPicker } from '@/features/invitations/picker';
import { useUpdateUser, useUser, useUsers } from '@/api/queries';
import { ActivityList } from '@/features/audit';
import { Page } from '@/components/layout/Page';
import { ROLES, ROLE_LABEL } from '@/lib/labels';

const PAGE_SIZE = 25;

const STATUS_TABS: { value: '' | UserStatus; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'suspended', label: 'Suspended' },
  { value: 'deactivated', label: 'Deactivated' },
];

function UserDrawer({ userId, onClose }: { userId: string | null; onClose: () => void }) {
  const notify = useToast();
  const user = useUser(userId);
  const update = useUpdateUser();
  const [confirming, setConfirming] = useState(false);
  const data = user.data;
  const suspending = data?.status === 'active';

  return (
    <Drawer
      open={userId !== null}
      onOpenChange={(open) => !open && onClose()}
      title={data ? data.name || data.email : 'User'}
      description={data?.email}
      footer={
        data && data.status !== 'deactivated' ? (
          <Button variant={suspending ? 'danger' : 'primary'} icon={suspending ? Ban : RotateCcw} onClick={() => setConfirming(true)}>
            {suspending ? 'Suspend account' : 'Reactivate account'}
          </Button>
        ) : undefined
      }
    >
      {user.isPending ? <LoadingState /> : null}
      {user.isError ? <ErrorState error={user.error} onRetry={() => void user.refetch()} /> : null}
      {data ? (
        <>
          <div className="flex flex-wrap gap-2">
            <StatusChip status={data.status} />
            {data.is_superadmin ? <Chip tone="brand" icon={ShieldCheck}>Superadmin</Chip> : null}
            <Chip tone={data.email_verified ? 'success' : 'warning'}>{data.email_verified ? 'Email verified' : 'Email not verified'}</Chip>
          </div>
          <dl className="grid grid-cols-[7.5rem_1fr] gap-x-3 gap-y-2 text-[13px]">
            <dt className="text-ink-muted">Created</dt>
            <dd>{formatDate(data.created_at)}</dd>
            <dt className="text-ink-muted">Last sign-in</dt>
            <dd title={formatDateTime(data.last_login_at)}>{formatRelative(data.last_login_at)}</dd>
            <dt className="text-ink-muted">ZITADEL subject</dt>
            <dd className="font-mono text-xs break-all">{data.zitadel_subject || '—'}</dd>
            <dt className="text-ink-muted">Issuer</dt>
            <dd className="text-xs break-all">{data.issuer || '—'}</dd>
            <dt className="text-ink-muted">User ID</dt>
            <dd className="font-mono text-xs break-all">{data.id}</dd>
          </dl>
          <section aria-labelledby="user-memberships" className="flex flex-col gap-2">
            <h3 id="user-memberships" className="text-[13px] font-semibold text-ink">
              Memberships
            </h3>
            {data.memberships.length === 0 ? (
              <p className="text-[13px] text-ink-muted">Personal account, no institution.</p>
            ) : (
              <ul className="flex flex-col rounded-lg border border-stroke">
                {data.memberships.map((membership) => (
                  <li key={membership.membership_id} className="flex items-center gap-2 border-t border-stroke-muted px-3 py-2 first:border-t-0">
                    <Link
                      to="/institutions/$slug"
                      params={{ slug: membership.institution.slug }}
                      search={{ tab: 'members' }}
                      className="flex-1 truncate text-[13px] font-semibold text-brand hover:underline"
                    >
                      {membership.institution.name}
                    </Link>
                    <span className="text-xs text-ink-muted">{ROLE_LABEL[membership.role]}</span>
                    <StatusChip status={membership.status} />
                  </li>
                ))}
              </ul>
            )}
          </section>
          {data.external_identities.length > 0 ? (
            <section aria-labelledby="user-identities" className="flex flex-col gap-2">
              <h3 id="user-identities" className="text-[13px] font-semibold text-ink">
                Linked identities
              </h3>
              <ul className="flex flex-col rounded-lg border border-stroke">
                {data.external_identities.map((identity) => (
                  <li key={`${identity.issuer}|${identity.subject}`} className="flex flex-col gap-0.5 border-t border-stroke-muted px-3 py-2 first:border-t-0">
                    <span className="text-[13px] font-semibold text-ink">{identity.provider_type}</span>
                    <span className="text-xs break-all text-ink-muted">{identity.issuer}</span>
                    <span className="font-mono text-xs break-all text-ink-muted">{identity.subject}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          <section aria-labelledby="user-activity" className="flex flex-col gap-2">
            <h3 id="user-activity" className="text-[13px] font-semibold text-ink">
              Recent activity
            </h3>
            <ActivityList entries={data.recent_activity} />
          </section>
          <ConfirmDialog
            open={confirming}
            onOpenChange={(open) => {
              setConfirming(open);
              if (!open) update.reset();
            }}
            title={suspending ? 'Suspend account' : 'Reactivate account'}
            description={
              suspending
                ? `${data.email} will be signed out everywhere and cannot sign in to any app until reactivated.`
                : `${data.email} can sign in again.`
            }
            confirmLabel={suspending ? 'Suspend' : 'Reactivate'}
            tone={suspending ? 'danger' : 'primary'}
            reason="required"
            pending={update.isPending}
            error={update.error}
            onConfirm={({ reason }) =>
              update.mutate(
                { id: data.id, body: { status: suspending ? 'suspended' : 'active', reason } },
                {
                  onSuccess: () => {
                    setConfirming(false);
                    notify(`${data.email} ${suspending ? 'suspended' : 'reactivated'}.`);
                  },
                },
              )
            }
          />
        </>
      ) : null}
    </Drawer>
  );
}

function membershipSummary(user: UserListItem): string {
  if (user.memberships.length === 0) return 'Personal account';
  const [first, ...rest] = user.memberships;
  return rest.length > 0 ? `${first.institution.name} +${rest.length}` : first.institution.name;
}

export function UsersPage() {
  const [status, setStatus] = useState<'' | UserStatus>('');
  const [q, setQ] = useState('');
  const [institution, setInstitution] = useState<PickedInstitution | null>(null);
  const [role, setRole] = useState<'' | Role>('');
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  const institutionSlug = institution?.kind === 'existing' ? institution.institution.slug : undefined;
  const list = useUsers({ status: status || undefined, q, institution: institutionSlug, role: role || undefined, page, page_size: PAGE_SIZE });
  const results = list.data?.results ?? [];
  const resetPage = () => setPage(1);

  return (
    <Page title="Users" subtitle={list.data ? `${formatNumber(list.data.count)} accounts` : undefined}>
      <Tabs
        label="Account status"
        items={STATUS_TABS}
        value={status}
        onChange={(value) => {
          setStatus(value);
          resetPage();
        }}
      />
      <div className="flex flex-wrap items-end gap-3">
        <SearchInput label="Search name or email" value={q} onChange={(value) => { setQ(value); resetPage(); }} />
        <div className="w-72">
          <InstitutionPicker label="Institution" value={institution} onChange={(value) => { setInstitution(value); resetPage(); }} />
        </div>
        <Select aria-label="Role" inline value={role} onChange={(event) => { setRole(event.target.value as '' | Role); resetPage(); }}>
          <option value="">All roles</option>
          {ROLES.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </div>
      {list.isError ? <ErrorState error={list.error} onRetry={() => void list.refetch()} /> : null}
      <div>
        <Table label="Users">
          <thead>
            <tr>
              <Th>User</Th>
              <Th>Status</Th>
              <Th>Institutions</Th>
              <Th>Last sign-in</Th>
              <Th>Created</Th>
            </tr>
          </thead>
          <tbody>
            {results.length === 0 ? (
              <TableMessage colSpan={5}>{list.isPending ? 'Loading…' : 'No users match these filters.'}</TableMessage>
            ) : (
              results.map((user) => (
                <Tr key={user.id} onOpen={() => setOpenId(user.id)} openLabel={`Open ${user.name || user.email}`}>
                  <Td>
                    <div className="flex items-center gap-2">
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate font-medium">{user.name || '—'}</span>
                        <span className="truncate text-xs text-ink-muted">{user.email}</span>
                      </div>
                      {user.is_superadmin ? <Chip tone="brand">Superadmin</Chip> : null}
                    </div>
                  </Td>
                  <Td>
                    <StatusChip status={user.status} />
                  </Td>
                  <Td className="max-w-64 truncate">{membershipSummary(user)}</Td>
                  <Td className="tabular whitespace-nowrap" title={formatDateTime(user.last_login_at)}>
                    {formatRelative(user.last_login_at)}
                  </Td>
                  <Td className="tabular whitespace-nowrap">{formatDate(user.created_at)}</Td>
                </Tr>
              ))
            )}
          </tbody>
        </Table>
        {list.data ? <Pagination page={page} pageSize={PAGE_SIZE} count={list.data.count} onPage={setPage} noun="users" /> : null}
      </div>
      <UserDrawer userId={openId} onClose={() => setOpenId(null)} />
    </Page>
  );
}
