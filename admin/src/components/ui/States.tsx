import { CircleAlert, LoaderCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { errorMessage } from '@/api/client';
import { Button } from './Button';
import { cn } from '@/lib/cn';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon: Icon, title, children, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center gap-3 px-6 py-12 text-center', className)}>
      <span aria-hidden="true" className="flex size-12 items-center justify-center rounded-xl bg-brand-tint text-brand-ink">
        <Icon size={22} />
      </span>
      <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
      {children ? <div className="max-w-md text-[13px] text-ink-muted">{children}</div> : null}
      {action}
    </div>
  );
}

export function LoadingState({ label = 'Loading…', className }: { label?: string; className?: string }) {
  return (
    <div role="status" className={cn('flex items-center justify-center gap-2 py-12 text-[13px] text-ink-muted', className)}>
      <LoaderCircle aria-hidden="true" size={16} className="animate-spin" />
      {label}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex items-start gap-3 rounded-lg bg-danger-bg p-3 text-[13px] text-danger-fg">
      <CircleAlert aria-hidden="true" size={16} className="mt-0.5 shrink-0" />
      <div className="flex flex-1 flex-col gap-2">
        <span className="font-semibold">{errorMessage(error)}</span>
        {onRetry ? (
          <Button size="sm" variant="danger" onClick={onRetry} className="self-start">
            Try again
          </Button>
        ) : null}
      </div>
    </div>
  );
}

interface NoticeProps {
  tone?: 'warning' | 'info' | 'danger';
  /** False when the caller keeps the notice inside its own always-mounted live region, so it isn't announced twice. */
  announce?: boolean;
  children: ReactNode;
}

export function Notice({ tone = 'warning', announce = true, children }: NoticeProps) {
  const tones = {
    warning: 'bg-warning-bg text-warning-fg',
    info: 'bg-info-bg text-info-fg',
    danger: 'bg-danger-bg text-danger-fg',
  };
  return (
    <div role={announce ? (tone === 'danger' ? 'alert' : 'status') : undefined} className={cn('flex items-start gap-2 rounded-lg p-3 text-[13px] font-medium', tones[tone])}>
      <CircleAlert aria-hidden="true" size={16} className="mt-0.5 shrink-0" />
      <div>{children}</div>
    </div>
  );
}
