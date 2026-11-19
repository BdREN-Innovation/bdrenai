import { ChartColumn } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Page } from '@/components/layout/Page';
import { EmptyState } from '@/components/ui';

export type SoonArea = 'usage';

const AREAS: Record<SoonArea, { title: string; icon: LucideIcon; phase: string; body: string }> = {
  usage: {
    title: 'Usage',
    icon: ChartColumn,
    phase: 'Phase 4',
    body: 'Usage across every app, institution and day: tokens and requests, active users, cost, and the change against the previous period, with drill-down to each institution.',
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
