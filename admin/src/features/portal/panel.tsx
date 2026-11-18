import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import type { Member } from '@/api/types';
import type { PortalInstitution } from './types';
import { Button, CoverageChip, Drawer, LoadingState, StatusChip, Table, Td, Th } from '@/components/ui';
import { REMOVAL_CONSEQUENCE, wrongInstitutionMailto } from './support';
import { formatAmount, formatDay } from './period';
import { useMemberUsage } from './queries';
import { PORTAL_PATHS } from './tabs';
import { formatDate } from '@/lib/format';
import { ROLE_LABEL } from '@/lib/labels';

export interface PanelAction {
  label: string;
  run: () => void;
}

function Facts({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] items-center gap-x-6 gap-y-2 text-[13px]">
      {items.map(([term, value]) => (
        <div key={term} className="contents">
          <dt className="text-ink-muted">{term}</dt>
          <dd className="text-ink">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Heading({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h3 id={id} className="text-[13px] font-semibold text-ink">
      {children}
    </h3>
  );
}

function UsageSection({ slug, membershipId }: { slug: string; membershipId: string }) {
  const usage = useMemberUsage(slug, membershipId);
  const data = usage.data;
  return (
    <section aria-labelledby="panel-usage" className="flex flex-col gap-2">
      <Heading id="panel-usage">Usage in the last 30 days</Heading>
      {usage.isPending ? <LoadingState label="Loading usage…" className="py-4" /> : null}
      {usage.isError ? (
        <p role="alert" className="text-[13px] font-medium text-danger-fg">
          We couldn&apos;t load their usage.
        </p>
      ) : null}
      {data && !data.total ? (
        <p className="text-[13px] text-ink-muted">
          {data.complete
            ? "No usage on your institution's package in the last 30 days."
            : "Their usage isn't among the busiest members; see the Usage page."}
        </p>
      ) : null}
      {data?.total ? (
        <>
          <p className="text-[13px]">
            <span className="tabular text-xl font-bold text-ink">{formatAmount(data.total.quantity)}</span>{' '}
            <span className="text-ink-muted">
              usage · {formatAmount(data.total.requests)} requests · last used {formatDay(data.total.last_used, true)}
            </span>
          </p>
          <Table label="Usage by app">
            <thead>
              <tr>
                <Th>App</Th>
                <Th>Usage</Th>
                <Th>Requests</Th>
              </tr>
            </thead>
            <tbody>
              {data.apps.map((app) => (
                <tr key={app.product.slug}>
                  <Td className="font-medium">{app.product.name}</Td>
                  <Td className="tabular">{formatAmount(app.quantity)}</Td>
                  <Td className="tabular">{formatAmount(app.requests)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </>
      ) : null}
      <Link to={PORTAL_PATHS.usage} params={{ slug }} className="self-start text-[13px] font-semibold text-brand hover:underline">
        Open the Usage page
      </Link>
    </section>
  );
}

/** Right-hand panel for a covered member: who they are, their usage per app, and what the admin can do. */
export function CoveredPanel({ slug, member, locked, actions, onClose }: {
  slug: string;
  member: Member | null;
  /** Why the admin can't change this member (themself, or the owner), or null. */
  locked: string | null;
  actions: PanelAction[];
  onClose: () => void;
}) {
  return (
    <Drawer open={member !== null} onOpenChange={(open) => !open && onClose()} title={member ? member.user.name || member.user.email : ''} description={member?.user.email}>
      {member ? (
        <>
          <Facts
            items={[
              ['Package', <CoverageChip key="c" label="covered" />],
              ['Status', <StatusChip key="s" status={member.status} />],
              ['Role', ROLE_LABEL[member.role]],
              ['Joined', formatDate(member.joined_at)],
            ]}
          />
          <UsageSection slug={slug} membershipId={member.membership_id} />
          <section aria-labelledby="panel-manage" className="flex flex-col gap-3">
            <Heading id="panel-manage">Manage</Heading>
            {locked ? (
              <p className="text-[13px] text-ink-muted">{locked}</p>
            ) : (
              <>
                <div className="flex flex-wrap gap-2">
                  {actions.map((action) => (
                    <Button key={action.label} onClick={action.run}>
                      {action.label}
                    </Button>
                  ))}
                </div>
                <p className="text-xs text-ink-muted">
                  <span className="font-semibold text-ink">If you remove them:</span> {REMOVAL_CONSEQUENCE}
                </p>
              </>
            )}
          </section>
        </>
      ) : null}
    </Drawer>
  );
}

/** Right-hand panel for a member who isn't on the package: who they are, Add to package, and the support link. */
export function NotCoveredPanel({ institution, member, busy, full, onAdd, onClose }: {
  institution: PortalInstitution;
  member: Member | null;
  /** An add is already running. */
  busy: boolean;
  /** Why no one can be added (every seat is taken), or null. */
  full: string | null;
  onAdd: () => void;
  onClose: () => void;
}) {
  return (
    <Drawer open={member !== null} onOpenChange={(open) => !open && onClose()} title={member ? member.user.name || member.user.email : ''} description={member?.user.email}>
      {member ? (
        <>
          <Facts
            items={[
              ['Package', <CoverageChip key="c" label={member.label ?? 'not_covered'} />],
              ['Joined', formatDate(member.joined_at)],
            ]}
          />
          <p className="text-[13px] text-ink-muted">
            {member.label === 'invited'
              ? 'They have an invitation waiting. Adding them now puts them on your package at once and cancels the invitation.'
              : "They are on the BDREN free tier. Adding them gives them your institution's package and knowledge right away, uses a seat, and emails them."}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" disabled={busy || full !== null} onClick={onAdd}>
              Add to package
            </Button>
            <a
              href={wrongInstitutionMailto(institution, member)}
              className="inline-flex h-10 items-center rounded-lg border border-stroke bg-surface px-4 text-sm font-semibold text-ink hover:bg-hover"
            >
              Report to BDREN support
            </a>
          </div>
          {full ? <p className="text-[13px] font-medium text-danger-fg">{full}</p> : null}
          <p className="text-xs text-ink-muted">Not part of {institution.name}? Only BdREN support can move them.</p>
        </>
      ) : null}
    </Drawer>
  );
}
