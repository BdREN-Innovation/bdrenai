import { Ban, BadgeCheck, CircleCheck, CircleDashed, CircleX, Clock, Mail, MailCheck, TriangleAlert, UserRound } from 'lucide-react';
import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import type { MemberLabel } from '@/api/types';
import { cn } from '@/lib/cn';
import { humanize } from '@/lib/format';
import { MEMBER_LABEL } from '@/lib/labels';

export type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'brand';

const TONES: Record<Tone, string> = {
  success: 'bg-success-bg text-success-fg',
  warning: 'bg-warning-bg text-warning-fg',
  danger: 'bg-danger-bg text-danger-fg',
  info: 'bg-info-bg text-info-fg',
  neutral: 'bg-neutral-bg text-neutral-fg',
  brand: 'bg-brand-tint text-brand-ink',
};

export function Chip({ tone = 'neutral', icon: Icon, children, className }: { tone?: Tone; icon?: LucideIcon; children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex h-6 shrink-0 items-center gap-1 rounded-full px-2 text-xs font-semibold whitespace-nowrap',
        TONES[tone],
        className,
      )}
    >
      {Icon ? <Icon aria-hidden="true" size={12} /> : null}
      {children}
    </span>
  );
}

const STATUS: Record<string, { tone: Tone; icon: LucideIcon }> = {
  active: { tone: 'success', icon: CircleCheck },
  accepted: { tone: 'success', icon: MailCheck },
  pending: { tone: 'warning', icon: Clock },
  suspended: { tone: 'danger', icon: Ban },
  expired: { tone: 'neutral', icon: TriangleAlert },
  revoked: { tone: 'neutral', icon: CircleX },
  deactivated: { tone: 'neutral', icon: CircleX },
  deprovisioned: { tone: 'neutral', icon: CircleX },
};

const STATUS_LABEL: Record<string, string> = {
  deactivated: 'Removed',
  deprovisioned: 'Removed',
};

/** Status is always a word and an icon beside the colour, never colour alone. */
export function StatusChip({ status }: { status: string }) {
  const style = STATUS[status] ?? { tone: 'neutral' as const, icon: CircleDashed };
  return (
    <Chip tone={style.tone} icon={style.icon}>
      {STATUS_LABEL[status] ?? humanize(status)}
    </Chip>
  );
}

const COVERAGE: Record<MemberLabel, { tone: Tone; icon: LucideIcon }> = {
  covered: { tone: 'success', icon: BadgeCheck },
  invited: { tone: 'info', icon: Mail },
  not_covered: { tone: 'neutral', icon: CircleDashed },
  personal_plan: { tone: 'brand', icon: UserRound },
};

/** Whether the institution's package covers the member: Covered, Invited, Not covered or Personal plan. */
export function CoverageChip({ label }: { label: MemberLabel }) {
  const style = COVERAGE[label];
  return (
    <Chip tone={style.tone} icon={style.icon}>
      {MEMBER_LABEL[label]}
    </Chip>
  );
}
