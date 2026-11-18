import { Link } from '@tanstack/react-router';
import { AtSign, MailPlus } from 'lucide-react';
import { EmptyState, ErrorState, LoadingState, Table, Td, Th } from '@/components/ui';
import { domainRequestMailto } from '@/features/portal/support';
import { usePortalDomains } from '@/features/portal/queries';
import { formatAmount } from '@/features/portal/period';
import { PORTAL_PATHS } from '@/features/portal/tabs';
import { usePortal } from '@/features/portal/shell';
import { Page } from '@/components/layout/Page';

const people = (n: number) => `${formatAmount(n)} ${n === 1 ? 'member' : 'members'}`;

/** The institution's sign-in email domains (read-only) and how many members each confirms. */
export function PortalDomainsPage() {
  const { institution } = usePortal();
  const domains = usePortalDomains(institution.slug);
  const data = domains.data;

  return (
    <Page
      title="Email domains"
      subtitle={institution.name}
      actions={
        <a
          href={domainRequestMailto(institution)}
          className="inline-flex h-10 items-center gap-2 rounded-lg border border-stroke bg-surface px-4 text-sm font-semibold text-ink hover:bg-hover"
        >
          <MailPlus aria-hidden="true" size={16} />
          Request a domain
        </a>
      }
    >
      <p className="max-w-3xl text-[13px] text-ink-muted">
        People who sign up with an email on one of these domains and choose {institution.name} join it as members. They start on the BDREN
        free tier until you add them to your package. People on any other domain join only when you invite them. BdREN manages this list.
      </p>
      {domains.isPending ? <LoadingState label="Loading email domains…" /> : null}
      {domains.isError ? <ErrorState error={new Error("We couldn't load email domains.")} onRetry={() => void domains.refetch()} /> : null}
      {data && data.domains.length === 0 ? (
        <div className="rounded-xl border border-stroke bg-surface">
          <EmptyState icon={AtSign} title="No email domains yet">
            Your institution has no email domains yet, so people join only by invitation. Use Request a domain to add one.
          </EmptyState>
        </div>
      ) : null}
      {data && data.domains.length > 0 ? (
        <Table label="Email domains and their confirmed members">
          <thead>
            <tr>
              <Th>Domain</Th>
              <Th>Confirmed members</Th>
            </tr>
          </thead>
          <tbody>
            {data.domains.map((domain) => (
              <tr key={domain.domain}>
                <th scope="row" className="border-t border-stroke-muted px-4 py-2.5 text-left align-middle font-medium text-ink">
                  <span className="block">{domain.domain}</span>
                  <span className="block text-xs font-normal text-ink-muted">and its subdomains, such as cse.{domain.domain}</span>
                </th>
                <Td className="tabular">{formatAmount(domain.confirmed_members)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : null}
      {data ? (
        <p className="text-[13px] text-ink-muted">
          {people(data.confirmed_members)} in all.{' '}
          {data.other_domains > 0
            ? `${people(data.other_domains)} ${data.other_domains === 1 ? 'uses' : 'use'} another email domain and joined by invitation. `
            : null}
          <Link to={PORTAL_PATHS.members} params={{ slug: institution.slug }} className="font-semibold text-brand hover:underline">
            See members
          </Link>
        </p>
      ) : null}
    </Page>
  );
}
