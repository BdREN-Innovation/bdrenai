import { useRef, useState } from 'react';
import { CreditCard } from 'lucide-react';
import type { ReactNode } from 'react';
import type { BillingSubscription } from '@/api/types';
import type { Offer, PortalPayment } from '../types';
import { KIND_TEXT, OFFER_GROUPS, browser, chargedQuote, isBkashUrl, matchesQuote, periodText, replacedBy, timing } from './rules';
import { Button, Card, Dialog, Notice } from '@/components/ui';
import { useCheckout } from '../queries';
import { billingErrorMessage } from './errors';
import { ApiError } from '@/api/client';
import { formatMoney } from '@/lib/format';

const UNSAFE_REDIRECT =
  "bKash sent back a payment page address we don't recognise, so we didn't open it. Nothing was charged. Contact BdREN.";

function Detail({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 py-2">
      <dt className="text-ink-muted">{term}</dt>
      <dd className="text-right font-medium text-ink">{children}</dd>
    </div>
  );
}

interface CheckoutDialogProps {
  slug: string;
  offer: Offer;
  current: string | undefined;
  onClose: () => void;
  onShowPayment: (id: string) => void;
}

/** A payment the server opened at a different charge than the quote the admin confirmed, held for a second confirmation. */
interface Changed {
  payment: PortalPayment;
  url: string;
}

/**
 * Confirms the quote, opens the bKash payment once (however often it is clicked) and leaves for bKash's page. When the
 * server charges something else than the confirmed quote, it shows the new charge and asks again before leaving. It
 * can't be closed while the payment is being opened or bKash's page is loading.
 */
function CheckoutDialog({ slug, offer, current, onClose, onShowPayment }: CheckoutDialogProps) {
  const checkout = useCheckout(slug);
  const sent = useRef(false);
  const [leaving, setLeaving] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [changed, setChanged] = useState<Changed | null>(null);
  const shown: Offer = changed ? { ...offer, quote: chargedQuote(changed.payment, offer.quote) } : offer;
  const { quote } = shown;
  const amount = formatMoney(quote.amount, quote.currency);

  const leave = (url: string) => {
    setLeaving(true);
    browser.open(url);
  };

  const pay = () => {
    if (changed) {
      if (!leaving) leave(changed.url);
      return;
    }
    if (sent.current) return;
    sent.current = true;
    checkout.mutate(
      { package: offer.package.id, kind: offer.kind },
      {
        onSuccess: (result) => {
          if (!isBkashUrl(result.redirect_url)) {
            setBlocked(true);
            return;
          }
          if (!matchesQuote(result.payment, offer.quote)) {
            setChanged({ payment: result.payment, url: result.redirect_url });
            return;
          }
          leave(result.redirect_url);
        },
        onError: () => {
          sent.current = false;
        },
      },
    );
  };

  const error = checkout.error;
  const started = error instanceof ApiError && error.code === 'checkout_in_progress' ? error.body.payment : undefined;
  const busy = checkout.isPending || leaving;

  return (
    <Dialog
      open
      locked={busy}
      onOpenChange={(open) => !open && onClose()}
      title={`Pay ${amount} with bKash`}
      description="Check what you are paying for. bKash's own page then asks for your bKash number, the code it texts you and your PIN."
      onSubmit={pay}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={busy} disabled={blocked}>
            {leaving ? 'Opening bKash…' : 'Continue to bKash'}
          </Button>
        </>
      }
    >
      {changed ? (
        <Notice tone="warning">
          The price or period changed after this page loaded. This payment is {amount} for {periodText(quote.period_start, quote.period_end)}, not the{' '}
          {formatMoney(offer.quote.amount, offer.quote.currency)} for {periodText(offer.quote.period_start, offer.quote.period_end)} shown before. Continue
          to bKash to pay {amount}. If you cancel, you can start another payment in about 10 minutes.
        </Notice>
      ) : null}
      <dl aria-label="Payment summary" className="flex flex-col divide-y divide-stroke-muted text-[13px]">
        <Detail term="Package">{offer.package.name}</Detail>
        <Detail term="Apps">{offer.package.apps.map((app) => app.name).join(', ') || '—'}</Detail>
        <Detail term="Payment for">{KIND_TEXT[offer.kind]}</Detail>
        <Detail term="Amount">{amount}</Detail>
        <Detail term="Period">{periodText(quote.period_start, quote.period_end)}</Detail>
      </dl>
      <p className="text-[13px] text-ink-muted">{timing(shown, current)}</p>
      {blocked ? <Notice tone="danger">{UNSAFE_REDIRECT}</Notice> : null}
      {error ? (
        <Notice tone="danger">
          <p>{billingErrorMessage(error, 'checkout', offer.package.name)}</p>
          {started ? (
            <Button size="sm" variant="secondary" className="mt-2" onClick={() => onShowPayment(started.id)}>
              See the pending payment
            </Button>
          ) : null}
        </Notice>
      ) : null}
    </Dialog>
  );
}

function OfferCard({ offer, current, canPay, onPay }: { offer: Offer; current: string | undefined; canPay: boolean; onPay: () => void }) {
  const { quote } = offer;
  const amount = formatMoney(quote.amount, quote.currency);
  return (
    <li className="flex flex-col gap-3 rounded-lg border border-stroke p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h4 className="text-[14px] font-semibold text-ink">{offer.package.name}</h4>
          <p className="text-xs text-ink-muted">{offer.package.apps.map((app) => app.name).join(', ')}</p>
        </div>
        <div className="flex flex-col items-end gap-0.5">
          <span className="tabular text-lg font-bold text-ink">{amount}</span>
          <span className="tabular text-xs text-ink-muted">
            {quote.periods > 1 ? `${quote.periods} periods · ` : ''}
            {periodText(quote.period_start, quote.period_end)}
          </span>
        </div>
      </div>
      <p className="text-[13px] text-ink-muted">{timing(offer, current)}</p>
      {canPay ? (
        <Button variant="primary" size="sm" icon={CreditCard} className="self-start" onClick={onPay} aria-label={`Pay with bKash: ${KIND_TEXT[offer.kind]} of ${offer.package.name}, ${amount}`}>
          Pay with bKash
        </Button>
      ) : null}
    </li>
  );
}

interface OffersProps {
  slug: string;
  offers: Offer[];
  subscriptions: BillingSubscription[];
  bkashEnabled: boolean;
  onShowPayment: (id: string) => void;
}

/** What the institution can pay for now, grouped as renewals, upgrades and first packages, each with its quote. */
export function Offers({ slug, offers, subscriptions, bkashEnabled, onShowPayment }: OffersProps) {
  const [chosen, setChosen] = useState<Offer | null>(null);
  const currentOf = (offer: Offer) => (offer.kind === 'upgrade' ? replacedBy(offer, subscriptions)?.package.name : undefined);
  const groups = OFFER_GROUPS.map((group) => ({ ...group, offers: offers.filter((offer) => offer.kind === group.kind) })).filter(
    (group) => group.offers.length > 0,
  );

  return (
    <Card title="Pay for a package" description={bkashEnabled ? 'Prices are per period. You pay by bKash; the period starts as each option says.' : 'Prices are per period.'}>
      {groups.length === 0 ? (
        <p className="text-[13px] text-ink-muted">There is nothing to pay for right now. Contact BdREN if you need a different package.</p>
      ) : (
        groups.map((group) => (
          <section key={group.kind} aria-labelledby={`offers-${group.kind}`} className="flex flex-col gap-3">
            <div className="flex flex-col gap-0.5">
              <h3 id={`offers-${group.kind}`} className="text-[13px] font-semibold text-ink">
                {group.title}
              </h3>
              <p className="text-xs text-ink-muted">{group.description}</p>
            </div>
            <ul className="grid grid-cols-1 gap-3 xl:grid-cols-2">
              {group.offers.map((offer) => (
                <OfferCard
                  key={`${offer.kind}-${offer.package.id}`}
                  offer={offer}
                  current={currentOf(offer)}
                  canPay={bkashEnabled}
                  onPay={() => setChosen(offer)}
                />
              ))}
            </ul>
          </section>
        ))
      )}
      {chosen ? (
        <CheckoutDialog
          key={`${chosen.kind}-${chosen.package.id}`}
          slug={slug}
          offer={chosen}
          current={currentOf(chosen)}
          onClose={() => setChosen(null)}
          onShowPayment={(id) => {
            setChosen(null);
            onShowPayment(id);
          }}
        />
      ) : null}
    </Card>
  );
}
