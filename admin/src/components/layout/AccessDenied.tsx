import { ShieldAlert } from 'lucide-react';
import { Button, EmptyState } from '@/components/ui';
import { logout } from '@/api/client';

export function AccessDenied({ message }: { message?: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-ground p-6">
      <div className="w-full max-w-md rounded-xl border border-stroke bg-surface">
        <EmptyState
          icon={ShieldAlert}
          title="You don't have access to the admin panel"
          action={
            <Button variant="primary" onClick={() => void logout()}>
              Sign out
            </Button>
          }
        >
          <p>
            {message ?? 'This panel is only for BDREN AI platform superadmins.'} Sign out and sign in with a superadmin
            account, or ask an existing superadmin to add you under Admins &amp; roles.
          </p>
        </EmptyState>
      </div>
    </main>
  );
}
