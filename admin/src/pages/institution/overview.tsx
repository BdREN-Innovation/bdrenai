import { useState } from 'react';
import { Pencil, ShieldOff } from 'lucide-react';
import type { InstitutionDetail } from '@/api/types';
import type { MembershipAction } from '@/features/members/actions';
import { Button, Card, Chip, IconButton, Notice, SeatMeter } from '@/components/ui';
import { MembershipActionDialog } from '@/features/members/actions';
import { formatDate, formatNumber } from '@/lib/format';
import { ROLE_LABEL, SECTOR_LABEL, TYPE_LABEL } from '@/lib/labels';

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="tabular text-2xl leading-none font-bold tracking-tight text-ink">{formatNumber(value)}</span>
      <span className="text-xs text-ink-muted">{label}</span>
    </div>
  );
}

export function Overview({ institution, onEdit }: { institution: InstitutionDetail; onEdit: () => void }) {
  const [action, setAction] = useState<MembershipAction | null>(null);
  const { seats, counts } = institution;
  const overCap = seats.cap !== null && seats.used > seats.cap;

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
      <div className="flex flex-col gap-5 xl:col-span-2">
        {institution.status === 'suspended' ? (
          <Notice>This institution is suspended. Its members cannot use any app until it is reactivated.</Notice>
        ) : null}
        {institution.status === 'deactivated' ? (
          <Notice>This institution has been removed. Its records are kept; reactivate it to restore access.</Notice>
        ) : null}
        {overCap ? <Notice tone="danger">More seats are in use than the cap allows. New invites and approvals are blocked.</Notice> : null}
        <Card
          title="Seats"
          description="Covered members (active or suspended) plus pending invitations, across every app."
          action={<Button size="sm" icon={Pencil} onClick={onEdit}>Change cap</Button>}
        >
          <SeatMeter seats={seats} />
          {institution.seat_cap_reason ? (
            <p className="text-xs text-ink-muted">Last cap change: {institution.seat_cap_reason}</p>
          ) : null}
          <div className="grid grid-cols-2 gap-5 border-t border-stroke-muted pt-4 sm:grid-cols-3">
            <Stat label="Covered, active" value={counts.active} />
            <Stat label="Covered, suspended" value={counts.suspended} />
            <Stat label="Covered members" value={counts.members} />
            <Stat label="Not covered" value={counts.not_covered} />
            <Stat label="Personal plan" value={counts.personal_plan} />
            <Stat label="Pending invitations" value={counts.pending_invitations} />
            <Stat label="Expired invitations" value={counts.expired_invitations} />
            <Stat label="Sign-up requests" value={counts.pending_requests} />
          </div>
        </Card>
        <Card title="Administrators" description="Active owners and admins. They manage members from the institution portal.">
          {institution.admins.length === 0 ? (
            <p className="text-[13px] text-ink-muted">No active administrators. Invite one with “Invite admin”.</p>
          ) : (
            <ul className="flex flex-col">
              {institution.admins.map((admin) => (
                <li key={admin.membership_id} className="flex items-center gap-3 border-t border-stroke-muted py-2.5 first:border-t-0 first:pt-0">
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-[13px] font-semibold text-ink">{admin.name || admin.email}</span>
                    <span className="truncate text-xs text-ink-muted">{admin.email}</span>
                  </div>
                  <Chip tone="brand">{ROLE_LABEL[admin.role]}</Chip>
                  <IconButton
                    icon={ShieldOff}
                    size="sm"
                    label={`Revoke admin role from ${admin.name || admin.email}`}
                    onClick={() => setAction({ kind: 'revoke_admin', membershipId: admin.membership_id, name: admin.name || admin.email })}
                  />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <Card title="Details" action={<Button size="sm" icon={Pencil} onClick={onEdit}>Edit details</Button>}>
        <dl className="grid grid-cols-[7.5rem_1fr] gap-x-3 gap-y-2.5 text-[13px]">
          <dt className="text-ink-muted">Type</dt>
          <dd>{TYPE_LABEL[institution.type]}</dd>
          <dt className="text-ink-muted">Sector</dt>
          <dd>{institution.sector ? SECTOR_LABEL[institution.sector] : 'Not set'}</dd>
          <dt className="text-ink-muted">Slug</dt>
          <dd className="font-mono text-xs break-all">{institution.slug}</dd>
          <dt className="text-ink-muted">Timezone</dt>
          <dd>{institution.timezone}</dd>
          <dt className="text-ink-muted">Contact</dt>
          <dd className="break-all">{institution.contact_email || '—'}</dd>
          <dt className="text-ink-muted">Sign-in domains</dt>
          <dd>
            {institution.sign_in_domains.length === 0 ? (
              'None; sign-ups join only by invitation'
            ) : (
              <span className="flex flex-wrap gap-1">
                {institution.sign_in_domains.map((domain) => (
                  <Chip key={domain}>{domain}</Chip>
                ))}
              </span>
            )}
          </dd>
          <dt className="text-ink-muted">Created</dt>
          <dd>{formatDate(institution.created_at)}</dd>
          <dt className="text-ink-muted">Updated</dt>
          <dd>{formatDate(institution.updated_at)}</dd>
          <dt className="text-ink-muted">ID</dt>
          <dd className="font-mono text-xs break-all">{institution.id}</dd>
        </dl>
      </Card>
      <MembershipActionDialog action={action} onClose={() => setAction(null)} />
    </div>
  );
}
