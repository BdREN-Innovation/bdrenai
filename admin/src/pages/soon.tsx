import { ChartColumn, CreditCard, Repeat } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Page } from '@/components/layout/Page';
import { EmptyState } from '@/components/ui';

export type SoonArea = 'usage' | 'billing' | 'subscriptions';

const AREAS: Record<SoonArea, { title: string; icon: LucideIcon; phase: string; body: string }> = {
  usage: {
    title: 'Usage',
    icon: ChartColumn,
    phase: 'Phase 4',
    body: 'Usage across every app, institution and day: tokens and requests, active users, cost, and the change against the previous period, with drill-down to each institution.',
  },
  billing: {
    title: 'Billing',
    icon: CreditCard,
    phase: 'Phases 2 and 3',
    body: 'Payments by bKash and manual transfer: collected this period, pending and failed payments, refunds, receipts, and Record payment to activate or extend a subscription.',
  },
  subscriptions: {
    title: 'Subscriptions',
    icon: Repeat,
    phase: 'Phase 2',
    body: 'Every institution’s package per app, its period and renewal date, scheduled downgrades, and actions to change, extend, suspend or cancel.',
  },
};

export function SoonPage({ area }: { area: SoonArea }) {
  const { title, icon, phase, body } = AREAS[area];
  return (
    <Page title={title}>
      <div className="rounded-xl border border-stroke bg-surface">
        <EmptyState icon={icon} title={`${title} is coming in ${phase}`}>
          <p>{body}</p>
        </EmptyState>
      </div>
    </Page>
  );
}
