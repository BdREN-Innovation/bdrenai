import { useEffect, useState } from 'react';
import type { PersonalPlanMember, PortalInstitution, TabCounts } from './types';
import { CoverageChip, ErrorState, Pagination, Table, TableMessage, Td, Th } from '@/components/ui';
import { wrongInstitutionMailto } from './support';
import { usePortalMembers } from './queries';
import { formatDate } from '@/lib/format';

const PAGE_SIZE = 25;

/** Members who pay for their own plan (R2): read-only, with no usage, and a way to tell BdREN about a wrong institution. */
export function PersonalPlanTab({ institution, q, onTabs }: { institution: PortalInstitution; q: string; onTabs: (tabs: TabCounts) => void }) {
  const [page, setPage] = useState(1);
  const list = usePortalMembers<PersonalPlanMember>(institution.slug, { tab: 'personal_plan', q, page, page_size: PAGE_SIZE });
  const rows = list.data?.results ?? [];

  useEffect(() => {
    if (list.data) onTabs(list.data.tabs);
  }, [list.data, onTabs]);

  useEffect(() => {
    setPage(1);
  }, [q]);

  return (
    <div className="flex flex-col gap-3">
      <p className="max-w-3xl text-[13px] text-ink-muted">
        These members pay for their own personal plan, so they don&apos;t use your seats. You can see who they are but not their usage, and you
        can&apos;t change their membership. To bring one onto your package, invite them: once they accept, they are covered and their personal
        plan stops renewing.
      </p>
      {list.isError ? <ErrorState error={new Error("We couldn't load these members.")} onRetry={() => void list.refetch()} /> : null}
      <div>
        <Table label={`Members on a personal plan, ${list.data?.count ?? 0} in all`}>
          <thead>
            <tr>
              <Th>Member</Th>
              <Th>Plan</Th>
              <Th>Joined</Th>
              <Th>
                <span className="sr-only">Support</span>
              </Th>
            </tr>
          </thead>
          <tbody aria-busy={list.isFetching}>
            {list.isPending ? <TableMessage colSpan={4}>Loading members…</TableMessage> : null}
            {list.data && rows.length === 0 ? (
              <TableMessage colSpan={4}>{q ? 'Nobody here matches your search.' : 'No member of your institution pays for a personal plan.'}</TableMessage>
            ) : null}
            {rows.map((member) => (
              <tr key={member.membership_id}>
                <Td>
                  <span className="block font-medium">{member.user.name || '—'}</span>
                  <span className="block text-xs text-ink-muted">{member.user.email}</span>
                </Td>
                <Td>
                  <CoverageChip label="personal_plan" />
                  {member.label === 'invited' ? <span className="mt-1 block text-xs text-ink-muted">Invitation waiting for their consent</span> : null}
                </Td>
                <Td>{formatDate(member.joined_at)}</Td>
                <Td className="text-right">
                  <a
                    href={wrongInstitutionMailto(institution, member)}
                    aria-label={`Report ${member.user.name || member.user.email} to BDREN support`}
                    className="text-[13px] font-semibold text-brand hover:underline"
                  >
                    Report to BDREN support
                  </a>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
        {list.data ? <Pagination page={list.data.page} pageSize={list.data.page_size} count={list.data.count} onPage={setPage} noun="members" /> : null}
      </div>
    </div>
  );
}
