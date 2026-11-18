import { useCallback, useState } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { FileUp, UserPlus } from 'lucide-react';
import type { InvitationFilter, MembersTab } from '@/features/portal/tabs';
import type { PortalInstitution, TabCounts } from '@/features/portal/types';
import { MEMBERS_TABS, PORTAL_PATHS, filterFromSearch, searchFromFilter } from '@/features/portal/tabs';
import { Button, SearchInput, Tabs } from '@/components/ui';
import { seatCapMessage, seatsFull } from '@/features/portal/support';
import { InvitationsTab } from '@/features/portal/invitations';
import { NotCoveredTab } from '@/features/portal/notcovered';
import { PersonalPlanTab } from '@/features/portal/personal';
import { ImportDialog } from '@/features/portal/import';
import { InviteDialog } from '@/features/portal/invite';
import { SeatSummary } from '@/features/portal/seats';
import { CoveredTab } from '@/features/portal/covered';
import { usePortal } from '@/features/portal/shell';
import { Page } from '@/components/layout/Page';

function initialCounts(institution: PortalInstitution): TabCounts {
  const { counts } = institution;
  return { covered: counts.active + counts.suspended, not_covered: counts.not_covered, personal_plan: counts.personal_plan };
}

/**
 * Institution-admin Members page: seats, the Covered / Invited / Not covered / Personal plan tabs (`?tab=`), invite,
 * CSV import and Add to package.
 */
export function PortalMembersPage() {
  const { institution, selfId } = usePortal();
  const { slug } = institution;
  const search = useSearch({ from: '/portal/$slug/members' });
  const navigate = useNavigate({ from: PORTAL_PATHS.members });
  const tab: MembersTab = search.tab ?? 'covered';
  const status = filterFromSearch(search.status);
  const [dialog, setDialog] = useState<'invite' | 'import' | null>(null);
  const [q, setQ] = useState('');
  const query = q.trim();
  const [tabs, setTabs] = useState<TabCounts | null>(null);
  const onTabs = useCallback((next: TabCounts) => setTabs(next), []);
  const counts: Record<MembersTab, number> = { ...(tabs ?? initialCounts(institution)), invited: institution.counts.pending_invitations };
  const full = seatsFull(institution.seats);

  const selectTab = (next: MembersTab) =>
    void navigate({ search: next === 'covered' ? {} : { tab: next, ...(next === 'invited' ? { status: search.status } : {}) }, replace: true });
  const selectStatus = (next: InvitationFilter) => void navigate({ search: { tab: 'invited', status: searchFromFilter(next) }, replace: true });

  return (
    <Page
      title="Members"
      subtitle={institution.name}
      actions={
        <>
          <Button icon={FileUp} disabled={full} onClick={() => setDialog('import')}>
            Import CSV
          </Button>
          <Button variant="primary" icon={UserPlus} disabled={full} onClick={() => setDialog('invite')}>
            Invite member
          </Button>
        </>
      }
    >
      <div className="flex flex-wrap items-end justify-between gap-4">
        <SearchInput label="Name or email" placeholder="Search by name or email" value={q} onChange={setQ} className="max-w-sm" />
        <SeatSummary seats={institution.seats} />
      </div>
      {full ? <p className="text-[13px] font-medium text-danger-fg">{seatCapMessage(institution.seats.used, institution.seats.cap)}</p> : null}

      <Tabs
        label="Members by package"
        items={MEMBERS_TABS.map((item) => ({ value: item.value, label: item.label, count: counts[item.value] }))}
        value={tab}
        onChange={selectTab}
      >
        {tab === 'covered' ? <CoveredTab slug={slug} selfId={selfId} q={query} onTabs={onTabs} /> : null}
        {tab === 'invited' ? <InvitationsTab slug={slug} q={query} status={status} onStatus={selectStatus} /> : null}
        {tab === 'not_covered' ? <NotCoveredTab institution={institution} q={query} onTabs={onTabs} /> : null}
        {tab === 'personal_plan' ? <PersonalPlanTab institution={institution} q={query} onTabs={onTabs} /> : null}
      </Tabs>

      <InviteDialog slug={slug} institution={institution.name} open={dialog === 'invite'} onOpenChange={(open) => setDialog(open ? 'invite' : null)} />
      <ImportDialog slug={slug} open={dialog === 'import'} onOpenChange={(open) => setDialog(open ? 'import' : null)} />
    </Page>
  );
}
