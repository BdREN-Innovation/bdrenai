import { ShieldAlert } from 'lucide-react';
import { Button, EmptyState } from '@/components/ui';
import { WEBSITE_URL } from '@/features/portal/support';
import { logout } from '@/api/client';

/** For a signed-in account that is neither a platform superadmin nor an institution admin. */
export function AccessDenied({ message }: { message?: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-ground p-6">
      <div className="w-full max-w-md rounded-xl border border-stroke bg-surface">
        <EmptyState
          icon={ShieldAlert}
          title="You don't have access to the admin console"
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <a
                href={WEBSITE_URL}
                className="inline-flex h-10 items-center rounded-lg border border-stroke bg-surface px-4 text-sm font-semibold text-ink hover:bg-hover"
              >
                Go to the BDREN AI website
              </a>
              <Button variant="primary" onClick={() => void logout()}>
                Sign out
              </Button>
            </div>
          }
        >
          <p>
            {message ??
              'This console is for BDREN AI platform superadmins and for the admins of an institution on BDREN AI.'}{' '}
            If you manage an institution, ask its owner or BdREN to make you an admin. To use the platform console, sign
            in with a superadmin account or ask an existing superadmin to add you under Admins &amp; roles.
          </p>
        </EmptyState>
      </div>
    </main>
  );
}
