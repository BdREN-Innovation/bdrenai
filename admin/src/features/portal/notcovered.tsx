import { useEffect, useMemo, useState } from 'react';
import type { Member } from '@/api/types';
import type { CoverOutcome } from './queries';
import type { PortalInstitution, TabCounts } from './types';
import { Button, ConfirmDialog, CoverageChip, ErrorState, Pagination, Table, TableMessage, Td, Th, Tr, useToast } from '@/components/ui';
import { usePortalMembers, useCoverMembers } from './queries';
import { freeSeats, seatCapMessage } from './support';
import { portalErrorMessage } from './errors';
import { NotCoveredPanel } from './panel';
import { formatDate } from '@/lib/format';

const PAGE_SIZE = 25;
const BOX = 'size-4 cursor-pointer accent-brand';

const who = (member: Member) => member.user.name || member.user.email;

function emailNote(added: number, unsent: number): string {
  if (!unsent) return ' and got an email about it.';
  if (unsent === added) return added === 1 ? ", but the email about it didn't go out." : ", but the emails about it didn't go out.";
  return `, but ${unsent} of the emails about it didn't go out.`;
}

/** What happened to an "Add to package" batch, as one sentence, and how loudly to say it. */
function report(members: Member[], { added, unsent, failure }: CoverOutcome): { text: string; tone: 'success' | 'warning' | 'danger' } {
  const done = added.length
    ? `${added.length === 1 ? `${who(added[0])} is` : `${added.length} people are`} on your package now${emailNote(added.length, unsent)}`
    : '';
  if (!failure) return { text: done, tone: unsent ? 'warning' : 'success' };
  const reason = portalErrorMessage(failure.error, 'Try again.');
  const missed = members.length - added.length;
  const lead = missed === 1 ? `We couldn't add ${who(failure.member)}:` : `We couldn't add ${missed} people:`;
  return { text: `${done ? `${done} ` : ''}${lead} ${reason}`, tone: 'danger' };
}

interface NotCoveredTabProps {
  institution: PortalInstitution;
  q: string;
  onTabs: (tabs: TabCounts) => void;
}

/**
 * Affiliated members on the free tier (the Not covered tab). "Add to package" covers the same account, one person or
 * a selection, after the admin confirms.
 */
export function NotCoveredTab({ institution, q, onTabs }: NotCoveredTabProps) {
  const notify = useToast();
  const { slug, seats } = institution;
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [adding, setAdding] = useState<Member[] | null>(null);
  const [open, setOpen] = useState<Member | null>(null);
  const cover = useCoverMembers(slug);
  const list = usePortalMembers<Member>(slug, { tab: 'not_covered', q, page, page_size: PAGE_SIZE });

  useEffect(() => {
    if (list.data) onTabs(list.data.tabs);
  }, [list.data, onTabs]);

  useEffect(() => {
    setPage(1);
  }, [q]);

  useEffect(() => {
    setSelected(new Set());
  }, [list.data]);

  const rows = useMemo(() => list.data?.results ?? [], [list.data]);
  const free = freeSeats(seats);
  const picked = rows.filter((member) => selected.has(member.membership_id));
  const allPicked = rows.length > 0 && picked.length === rows.length;
  const tooMany = (n: number) => free !== null && n > free;

  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const add = (members: Member[]) =>
    cover.mutate(members, {
      onSuccess: (outcome) => {
        setAdding(null);
        const { text, tone } = report(members, outcome);
        notify(text, tone);
      },
    });

  const confirmTitle = adding ? (adding.length === 1 ? `Add ${who(adding[0])} to your package?` : `Add ${adding.length} people to your package?`) : '';
  const confirmBody = adding
    ? `${adding.length === 1 ? 'They get' : 'Each gets'} your institution's package and knowledge right away, on the same account, and an email tells them. ${
        adding.length === 1 ? 'This uses a seat.' : `This uses ${adding.length} seats.`
      }`
    : '';

  return (
    <div className="flex flex-col gap-3">
      <p className="max-w-3xl text-[13px] text-ink-muted">
        These people belong to your institution but aren&apos;t on its package: people who signed up with an email on one of its domains, and
        members who were taken off the package. They use the BDREN free tier until you add them to your package.
      </p>

      {picked.length > 0 ? (
        <div role="region" aria-label="Selected people" className="flex flex-wrap items-center gap-3 rounded-xl border border-stroke bg-surface px-4 py-3">
          <span className="text-[13px] font-semibold text-ink">{picked.length} selected</span>
          <Button variant="primary" size="sm" disabled={cover.isPending || tooMany(picked.length)} onClick={() => setAdding(picked)}>
            Add {picked.length} to package
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
            Clear selection
          </Button>
          {tooMany(picked.length) ? (
            <p role="alert" className="basis-full text-[13px] font-medium text-danger-fg">
              Only {free} {free === 1 ? 'seat is' : 'seats are'} free. Select fewer people, or contact BdREN to upgrade your plan.
            </p>
          ) : null}
        </div>
      ) : null}

      {list.isError ? <ErrorState error={new Error("We couldn't load these members.")} onRetry={() => void list.refetch()} /> : null}
      <div>
        <Table label={`Members not on your package, ${list.data?.count ?? 0} in all`}>
          <thead>
            <tr>
              <Th className="w-12">
                <input
                  type="checkbox"
                  aria-label="Select everyone on this page"
                  checked={allPicked}
                  disabled={rows.length === 0}
                  onChange={() => setSelected(allPicked ? new Set() : new Set(rows.map((member) => member.membership_id)))}
                  className={BOX}
                />
              </Th>
              <Th>Member</Th>
              <Th>Package</Th>
              <Th>Joined</Th>
              <Th>
                <span className="sr-only">Actions</span>
              </Th>
            </tr>
          </thead>
          <tbody aria-busy={list.isFetching}>
            {list.isPending ? <TableMessage colSpan={5}>Loading members…</TableMessage> : null}
            {list.data && rows.length === 0 ? (
              <TableMessage colSpan={5}>{q ? 'Nobody here matches your search.' : 'Nobody is waiting to be added to your package.'}</TableMessage>
            ) : null}
            {rows.map((member) => (
              <Tr key={member.membership_id} onOpen={() => setOpen(member)} openLabel={`Details for ${who(member)}`}>
                <Td>
                  <input
                    type="checkbox"
                    aria-label={`Select ${who(member)}`}
                    checked={selected.has(member.membership_id)}
                    onChange={() => toggle(member.membership_id)}
                    className={BOX}
                  />
                </Td>
                <Td>
                  <span className="block font-medium">{member.user.name || '—'}</span>
                  <span className="block text-xs text-ink-muted">{member.user.email}</span>
                </Td>
                <Td>
                  <CoverageChip label={member.label ?? 'not_covered'} />
                </Td>
                <Td>{formatDate(member.joined_at)}</Td>
                <Td className="text-right">
                  <Button size="sm" disabled={cover.isPending || tooMany(1)} onClick={() => setAdding([member])}>
                    Add to package
                  </Button>
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
        {tooMany(1) && rows.length > 0 ? <p className="pt-3 text-[13px] font-medium text-danger-fg">{seatCapMessage(seats.used, seats.cap)}</p> : null}
        {list.data ? <Pagination page={list.data.page} pageSize={list.data.page_size} count={list.data.count} onPage={setPage} noun="people" /> : null}
      </div>

      <NotCoveredPanel
        institution={institution}
        member={open}
        busy={cover.isPending}
        full={tooMany(1) ? seatCapMessage(seats.used, seats.cap) : null}
        onAdd={() => {
          if (open && !cover.isPending && !tooMany(1)) setAdding([open]);
          setOpen(null);
        }}
        onClose={() => setOpen(null)}
      />
      <ConfirmDialog
        open={adding !== null}
        onOpenChange={(next) => !next && setAdding(null)}
        title={confirmTitle}
        description={confirmBody}
        confirmLabel="Add to package"
        tone="primary"
        pending={cover.isPending}
        onConfirm={() => adding && add(adding)}
      />
    </div>
  );
}
