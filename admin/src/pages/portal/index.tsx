import { Link, Navigate } from '@tanstack/react-router';
import { Building2, ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { EmptyState, ErrorState, LoadingState, StatusChip } from '@/components/ui';
import { WEBSITE_URL } from '@/features/portal/support';
import { useAccess } from '@/features/portal/access';
import { ROLE_LABEL } from '@/lib/labels';
import { formatSeats } from '@/lib/format';

function Frame({ children }: { children: ReactNode }) {
  return (
    <main id="main" className="flex min-h-screen items-start justify-center bg-ground p-6 sm:pt-[12vh]">
      <div className="w-full max-w-lg rounded-xl border border-stroke bg-surface">{children}</div>
    </main>
  );
}

/** `/portal`: straight to the one institution the user manages, or a choice when there are several. */
export function PortalHomePage() {
  const { session, institutions, institutionsPending, institutionsError, retryInstitutions } = useAccess();

  if (institutionsPending) return <LoadingState label="Loading your institutions…" className="min-h-screen" />;
  if (institutionsError && institutions.length === 0) {
    return (
      <Frame>
        <div className="p-5">
          <ErrorState error={new Error("We couldn't load the institutions you manage.")} onRetry={retryInstitutions} />
        </div>
      </Frame>
    );
  }
  if (institutions.length === 1) {
    return <Navigate to="/portal/$slug/dashboard" params={{ slug: institutions[0].slug }} replace />;
  }
  if (institutions.length === 0) {
    return (
      <Frame>
        <EmptyState
          icon={Building2}
          title="You don't manage an institution"
          action={
            session ? (
              <Link to="/" className="text-[13px] font-semibold text-brand hover:underline">
                Go to the platform console
              </Link>
            ) : (
              <a href={WEBSITE_URL} className="text-[13px] font-semibold text-brand hover:underline">
                Go to the BDREN AI website
              </a>
            )
          }
        >
          <p>The institution console opens for the owners and admins of an institution on BDREN AI.</p>
        </EmptyState>
      </Frame>
    );
  }

  return (
    <Frame>
      <div className="flex flex-col gap-1 border-b border-stroke-muted px-5 py-4">
        <h1 className="text-[15px] font-semibold text-ink">Choose an institution</h1>
        <p className="text-[13px] text-ink-muted">You manage more than one institution. Pick the one to open.</p>
      </div>
      <ul aria-label="Institutions you manage" className="flex flex-col p-2">
        {institutions.map((institution) => (
          <li key={institution.slug}>
            <Link
              to="/portal/$slug/dashboard"
              params={{ slug: institution.slug }}
              className="flex min-h-14 items-center gap-3 rounded-lg px-3 py-2 hover:bg-hover"
            >
              <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-tint text-brand-ink">
                <Building2 size={18} />
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-semibold text-ink">{institution.name}</span>
                <span className="truncate text-xs text-ink-muted">
                  {ROLE_LABEL[institution.role]} · {formatSeats(institution.seats)}
                </span>
              </span>
              {institution.status === 'suspended' ? <StatusChip status="suspended" /> : null}
              <ChevronRight aria-hidden="true" size={16} className="shrink-0 text-ink-muted" />
            </Link>
          </li>
        ))}
      </ul>
    </Frame>
  );
}
