import { Link } from '@tanstack/react-router';
import { Compass } from 'lucide-react';
import { Page } from '@/components/layout/Page';
import { EmptyState } from '@/components/ui';

export function NotFoundPage() {
  return (
    <Page title="Page not found">
      <EmptyState
        icon={Compass}
        title="This page does not exist"
        action={
          <Link to="/" className="text-[13px] font-semibold text-brand hover:underline">
            Go to the dashboard
          </Link>
        }
      />
    </Page>
  );
}
