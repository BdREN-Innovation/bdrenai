import { createContext, useContext } from 'react';
import { Outlet, useParams } from '@tanstack/react-router';
import { Ban, SearchX, ShieldAlert } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { PortalInstitution } from './types';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui';
import { Frame } from '@/components/layout/Shell';
import { Page } from '@/components/layout/Page';
import { usePortalInstitution } from './queries';
import { PortalCommandMenu } from './command';
import { PortalSidebar } from './sidebar';
import { ApiError } from '@/api/client';
import { WEBSITE_URL } from './support';
import { useAccess } from './access';

export interface PortalContextValue {
  institution: PortalInstitution;
  /** The signed-in user, whose own membership the console never offers to change. */
  selfId: string | null;
}

const PortalContext = createContext<PortalContextValue | null>(null);

export function usePortal(): PortalContextValue {
  const portal = useContext(PortalContext);
  if (!portal) throw new Error('usePortal must be used inside PortalShell');
  return portal;
}

const REFUSALS: Record<string, { icon: LucideIcon; title: string; body: string }> = {
  institution_suspended: {
    icon: Ban,
    title: 'This institution is suspended',
    body: 'Institution admin pages are paused while the institution is suspended. Contact BdREN to restore access.',
  },
  institution_inactive: {
    icon: Ban,
    title: 'This institution is no longer active',
    body: "BdREN has closed this institution's account. Contact BdREN if this is a mistake.",
  },
  not_institution_admin: {
    icon: ShieldAlert,
    title: "You don't manage this institution",
    body: 'Only its admins can open these pages. If you should be one, ask an existing admin or contact BdREN.',
  },
  not_found: {
    icon: SearchX,
    title: 'Institution not found',
    body: "Check the link, or choose one of the institutions you manage. You see only institutions where you're an admin.",
  },
};

function Refusal({ name, error }: { name: string; error: ApiError }) {
  const text = REFUSALS[error.code] ?? (error.status === 404 ? REFUSALS.not_found : REFUSALS.not_institution_admin);
  return (
    <Page title={name}>
      <EmptyState
        icon={text.icon}
        title={text.title}
        action={
          <a href={WEBSITE_URL} className="text-[13px] font-semibold text-brand hover:underline">
            Go to the BDREN AI website
          </a>
        }
      >
        <p>{text.body}</p>
      </EmptyState>
    </Page>
  );
}

function Body({ slug, name, selfId }: { slug: string; name: string; selfId: string | null }) {
  const institution = usePortalInstitution(slug);
  if (institution.isPending) return <LoadingState label="Loading your institution…" className="flex-1" />;
  if (institution.isError) {
    const error = institution.error;
    if (error instanceof ApiError && (error.status === 403 || error.status === 404)) return <Refusal name={name} error={error} />;
    return (
      <Page title={name}>
        <ErrorState error={error} onRetry={() => void institution.refetch()} />
      </Page>
    );
  }
  return (
    <PortalContext.Provider value={{ institution: institution.data, selfId }}>
      <Outlet />
    </PortalContext.Provider>
  );
}

/**
 * The institution console for `/portal/$slug/…`: its own sidebar and command menu around the page. The institution
 * (seats, counts, name) loads once here; the server refuses anyone who isn't an admin of this institution.
 */
export function PortalShell() {
  const { slug } = useParams({ from: '/portal/$slug' });
  const { institutions, user } = useAccess();
  const detail = usePortalInstitution(slug);
  const name = detail.data?.name ?? institutions.find((institution) => institution.slug === slug)?.name ?? slug;

  return (
    <Frame
      sidebar={(state) => <PortalSidebar slug={slug} name={name} {...state} />}
      commandMenu={(state) => <PortalCommandMenu slug={slug} {...state} />}
    >
      <Body key={slug} slug={slug} name={name} selfId={user?.id ?? null} />
    </Frame>
  );
}
