import { useState } from 'react';
import { ArrowDownRight, CalendarX } from 'lucide-react';
import type { ReactNode } from 'react';
import type { BillingSubscription, Seats } from '@/api/types';
import type { DowngradeOption, Offer } from '../types';
import { Button, Card, Chip, ConfirmDialog, Dialog, Notice, StatusChip, useToast } from '@/components/ui';
import { LIVE_STATUSES, lastDayText, periodText, renewOfferFor } from './rules';
import { useCancelDowngrade, useScheduleDowngrade } from '../queries';
import { dayOf, formatDay } from '@/features/billing/labels';
import { formatMoney, formatNumber } from '@/lib/format';
import { billingErrorMessage } from './errors';
import { supportMailto } from '../support';

const PER: Record<DowngradeOption['billing_interval'], string> = { monthly: 'month', yearly: 'year' };

export const priceText = (option: DowngradeOption) => `${formatMoney(option.amount, option.currency)} / ${PER[option.billing_interval]}`;

const tooManySeats = (option: DowngradeOption, seats: Seats) => option.seat_limit !== null && seats.used > option.seat_limit;

interface DowngradeDialogProps {
  slug: string;
  subscription: BillingSubscription;
  option: DowngradeOption;
  seats: Seats;
  onClose: () => void;
}

function DowngradeDialog({ slug, subscription, option, seats, onClose }: DowngradeDialogProps) {
  const notify = useToast();
  const schedule = useScheduleDowngrade(slug);
  const blocked = tooManySeats(option, seats);
  const submit = () => {
    if (blocked || schedule.isPending) return;
    schedule.mutate(option.package.id, {
      onSuccess: () => {
        onClose();
        notify(`${option.package.name} is scheduled for the next renewal.`);
      },
    });
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={`Switch to ${option.package.name} at the next renewal`}
      description={`Your institution keeps ${subscription.package.name} ${keepsUntil(subscription.expires_at)}. From the next renewal it moves to ${option.package.name} at ${priceText(option)}. Nothing is charged now, and you can cancel the switch until then.`}
      onSubmit={submit}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={schedule.isPending} disabled={blocked}>
            Schedule switch
          </Button>
        </>
      }
    >
      {blocked && option.seat_limit !== null ? (
        <Notice tone="warning">
          Your institution uses {formatNumber(seats.used)} seats; {option.package.name} allows {formatNumber(option.seat_limit)}. Remove members until
          no more than {formatNumber(option.seat_limit)} seats are in use, then schedule the switch.
        </Notice>
      ) : null}
      {schedule.error ? <Notice tone="danger">{billingErrorMessage(schedule.error, 'downgrade', option.package.name)}</Notice> : null}
    </Dialog>
  );
}

interface Institution {
  slug: string;
  name: string;
}

/** What the admin can do about a package's period, given what `GET billing/` offers to pay for. */
interface Options {
  renewable: boolean;
  canChoose: boolean;
  bkashEnabled: boolean;
}

const keepsUntil = (end: string | null) => (end ? `until its current period ends on ${lastDayText(end)}` : 'for the rest of its current period');

function ContactLink({ institution, subscription, subject, children }: { institution: Institution; subscription: BillingSubscription; subject: string; children: ReactNode }) {
  const href = supportMailto(
    `${subject}: ${subscription.package.name} for ${institution.name}`,
    `Institution: ${institution.name} (${institution.slug})\nPackage: ${subscription.package.name}\n`,
  );
  return (
    <a href={href} className="font-semibold text-brand hover:underline">
      {children}
    </a>
  );
}

function PeriodNote({ institution, subscription, options }: { institution: Institution; subscription: BillingSubscription; options: Options }) {
  const end = subscription.expires_at;
  if (!LIVE_STATUSES.has(subscription.status)) {
    const ended = end ? `It ended on ${lastDayText(end)}.` : 'It has ended.';
    if (options.renewable) return <>{ended} Renew it below to restore access.</>;
    if (options.canChoose) return <>{ended} Choose a package below to restore access.</>;
    return (
      <>
        {ended}{' '}
        <ContactLink institution={institution} subscription={subscription} subject="Restart package">
          Contact BdREN to restart this package
        </ContactLink>
        .
      </>
    );
  }
  const ends = end ? `It ends on ${lastDayText(end)}` : 'It has no end date';
  if (!subscription.auto_renew) {
    if (options.renewable && options.bkashEnabled) return <>{ends}. Renewal is stopped; paying the renewal below turns it back on.</>;
    return (
      <>
        {ends} and won&apos;t be renewed.{' '}
        <ContactLink institution={institution} subscription={subscription} subject="Resume renewal">
          Contact BdREN to resume renewal
        </ContactLink>
        .
      </>
    );
  }
  if (!end) return <>It has no end date.</>;
  return <>Renew by {lastDayText(end)} to keep access; each period is paid separately.</>;
}

function currentPeriod(subscription: BillingSubscription): string {
  const label = LIVE_STATUSES.has(subscription.status) ? 'Current period' : 'Last period';
  const { starts_at: start, expires_at: end } = subscription;
  return end ? `${label} ${periodText(start, end)}.` : `${label} from ${formatDay(dayOf(start))}.`;
}

function Renewal({ subscription }: { subscription: BillingSubscription }) {
  if (!subscription.auto_renew) return <Chip tone="warning">Renewal stopped</Chip>;
  if (subscription.scheduled_package) return <Chip tone="info">Switches to {subscription.scheduled_package.name} at renewal</Chip>;
  return null;
}

interface PackageRowProps {
  institution: Institution;
  subscription: BillingSubscription;
  billing: Options;
  options: DowngradeOption[];
  seats: Seats;
  onSwitch: (option: DowngradeOption) => void;
  onCancelSwitch: () => void;
}

function PackageRow({ institution, subscription, billing, options, seats, onSwitch, onCancelSwitch }: PackageRowProps) {
  const scheduled = subscription.scheduled_package;
  const renewal = subscription.expires_at ? `the next renewal on ${formatDay(dayOf(subscription.expires_at))}` : 'the next renewal';
  return (
    <li className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h3 className="text-[14px] font-semibold text-ink">{subscription.package.name}</h3>
          <p className="text-xs text-ink-muted">{subscription.apps.map((app) => app.name).join(', ')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusChip status={subscription.status} />
          <Renewal subscription={subscription} />
        </div>
      </div>
      <p className="tabular text-[13px] text-ink">
        {currentPeriod(subscription)}{' '}
        <span className="text-ink-muted">
          <PeriodNote institution={institution} subscription={subscription} options={billing} />
        </span>
      </p>
      {scheduled ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-info-bg px-3 py-2 text-[13px] text-info-fg">
          <span>
            From {renewal}, your institution moves to {scheduled.name}.
          </span>
          <Button size="sm" variant="secondary" icon={CalendarX} onClick={onCancelSwitch}>
            Cancel change
          </Button>
        </div>
      ) : null}
      {options.length > 0 ? (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-ink-muted">Need less? Switch to a cheaper package at the next renewal; nothing is charged now.</p>
          <ul className="flex flex-wrap gap-2">
            {options.map((option) => (
              <li key={option.package.id}>
                <Button size="sm" variant="secondary" icon={ArrowDownRight} onClick={() => onSwitch(option)}>
                  Switch to {option.package.name} at next renewal ({priceText(option)})
                </Button>
                {tooManySeats(option, seats) && option.seat_limit !== null ? (
                  <p className="mt-1 text-xs text-warning-fg">
                    Allows {formatNumber(option.seat_limit)} seats; you use {formatNumber(seats.used)}.
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </li>
  );
}

interface CurrentPackagesProps {
  institution: Institution;
  subscriptions: BillingSubscription[];
  downgrades: DowngradeOption[];
  offers: Offer[];
  bkashEnabled: boolean;
  seats: Seats;
}

/**
 * The institution's packages: period, renewal, a scheduled switch (cancellable) and cheaper packages to switch to. Each
 * package's note points only to what `offers` lets the admin pay for, and to BdREN otherwise.
 */
export function CurrentPackages({ institution, subscriptions, downgrades, offers, bkashEnabled, seats }: CurrentPackagesProps) {
  const slug = institution.slug;
  const canChoose = offers.some((offer) => offer.kind === 'new');
  const notify = useToast();
  const cancel = useCancelDowngrade(slug);
  const [switching, setSwitching] = useState<{ subscription: BillingSubscription; option: DowngradeOption } | null>(null);
  const [cancelling, setCancelling] = useState<BillingSubscription | null>(null);

  return (
    <Card title="Your packages" description="Packages paid for by your institution. Covered members get these apps.">
      {subscriptions.length === 0 ? (
        <p className="text-[13px] text-ink-muted">Your institution has no package yet. Choose one below.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-stroke-muted">
          {subscriptions.map((subscription) => (
            <PackageRow
              key={subscription.id}
              institution={institution}
              subscription={subscription}
              billing={{ renewable: renewOfferFor(subscription, offers) !== undefined, canChoose, bkashEnabled }}
              seats={seats}
              options={downgrades.filter((option) => option.subscription_id === subscription.id && option.package.id !== subscription.scheduled_package?.id)}
              onSwitch={(option) => setSwitching({ subscription, option })}
              onCancelSwitch={() => {
                cancel.reset();
                setCancelling(subscription);
              }}
            />
          ))}
        </ul>
      )}
      {switching ? (
        <DowngradeDialog
          key={`${switching.subscription.id}-${switching.option.package.id}`}
          slug={slug}
          subscription={switching.subscription}
          option={switching.option}
          seats={seats}
          onClose={() => setSwitching(null)}
        />
      ) : null}
      <ConfirmDialog
        open={cancelling !== null}
        onOpenChange={(open) => !open && setCancelling(null)}
        title="Cancel the scheduled switch"
        description={
          cancelling
            ? `${cancelling.package.name} stays on at the next renewal instead of switching to ${cancelling.scheduled_package?.name ?? 'the scheduled package'}.`
            : undefined
        }
        confirmLabel="Cancel the switch"
        tone="primary"
        pending={cancel.isPending}
        error={cancel.error ? new Error(billingErrorMessage(cancel.error, 'cancel')) : undefined}
        onConfirm={() => {
          if (!cancelling || cancel.isPending) return;
          cancel.mutate(cancelling.id, {
            onSuccess: () => {
              setCancelling(null);
              notify('The scheduled switch is cancelled.');
            },
          });
        }}
      />
    </Card>
  );
}
