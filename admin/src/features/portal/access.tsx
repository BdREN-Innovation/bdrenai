import { createContext, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';
import type { Session } from '@/api/types';
import type { AdminInstitution, Profile } from './types';
import { ErrorState, LoadingState } from '@/components/ui';
import { AccessDenied } from '@/components/layout/AccessDenied';
import { usePortalInstitutions, useProfile } from './queries';
import { useSession } from '@/api/queries';
import { ApiError } from '@/api/client';
import { initials } from '@/lib/format';

export interface ConsoleUser {
  id: string;
  name: string;
  email: string;
  initials: string;
}

/** Who is signed in and which consoles they may open. Navigation only: every API call is still checked on the server. */
export interface Access {
  /** The superadmin session; null for someone who only administers institutions. */
  session: Session | null;
  /** Institutions the user administers (also filled for a superadmin who administers one). */
  institutions: AdminInstitution[];
  /** True until the institution list has loaded (a superadmin's console opens before it arrives). */
  institutionsPending: boolean;
  /** Why the institution list didn't load, or null: it must not read as "you manage none". */
  institutionsError: Error | null;
  retryInstitutions: () => void;
  user: ConsoleUser | null;
}

const AccessContext = createContext<Access | null>(null);

export function useAccess(): Access {
  const access = useContext(AccessContext);
  if (!access) throw new Error('useAccess must be used inside AccessGate');
  return access;
}

const hasStatus = (error: unknown, status: number) => error instanceof ApiError && error.status === status;

function userFrom(source: Session['user'] | Profile | undefined): ConsoleUser | null {
  if (!source) return null;
  return { id: source.id, name: source.name, email: source.email, initials: initials(source.name, source.email) };
}

function Frame({ children }: { children: ReactNode }) {
  return <main className="mx-auto max-w-lg p-6">{children}</main>;
}

/**
 * Root of the app. A superadmin session opens the platform console; otherwise (403) the institutions the user
 * administers open the institution console, and nobody else gets past the no-access page. 401 anywhere goes to sign-in.
 */
export function AccessGate({ children }: { children: ReactNode }) {
  const session = useSession();
  const institutions = usePortalInstitutions();
  const profile = useProfile();
  const platform = session.data ?? null;
  const administered = institutions.data;
  const person = platform?.user ?? profile.data;

  const institutionsPending = institutions.isPending;
  const institutionsError = institutions.error;
  const refetchInstitutions = institutions.refetch;
  const access = useMemo<Access>(
    () => ({
      session: platform,
      institutions: administered ?? [],
      institutionsPending,
      institutionsError,
      retryInstitutions: () => void refetchInstitutions(),
      user: userFrom(person),
    }),
    [platform, administered, institutionsPending, institutionsError, refetchInstitutions, person],
  );

  if ([session.error, institutions.error, profile.error].some((error) => hasStatus(error, 401))) {
    return <LoadingState label="Redirecting to sign in…" className="min-h-screen" />;
  }
  if (session.isPending) return <LoadingState label="Checking your session…" className="min-h-screen" />;
  if (session.isError && !hasStatus(session.error, 403)) {
    return (
      <Frame>
        <ErrorState error={session.error} onRetry={() => void session.refetch()} />
      </Frame>
    );
  }
  if (!platform) {
    if (institutions.isPending || profile.isPending) return <LoadingState label="Checking your access…" className="min-h-screen" />;
    if (institutions.isError) {
      return (
        <Frame>
          <ErrorState error={institutions.error} onRetry={() => void institutions.refetch()} />
        </Frame>
      );
    }
    if (profile.isError) {
      return (
        <Frame>
          <ErrorState error={profile.error} onRetry={() => void profile.refetch()} />
        </Frame>
      );
    }
    if (access.institutions.length === 0) return <AccessDenied />;
  }

  return (
    <AccessContext.Provider value={access}>{children}</AccessContext.Provider>
  );
}
