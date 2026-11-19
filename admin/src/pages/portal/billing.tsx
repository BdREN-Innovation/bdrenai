import { useEffect, useState } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import type { Returned } from '@/features/portal/billing/banner';
import type { PortalInstitution } from '@/features/portal/types';
import { ErrorState, LoadingState, Notice } from '@/components/ui';
import { CurrentPackages } from '@/features/portal/billing/packages';
import { PaymentHistory } from '@/features/portal/billing/payments';
import { PaymentBanner } from '@/features/portal/billing/banner';
import { paymentAnchor } from '@/features/portal/billing/rules';
import { Offers } from '@/features/portal/billing/offers';
import { usePortalBilling } from '@/features/portal/queries';
import { SUPPORT_EMAIL, supportMailto } from '@/features/portal/support';
import { PORTAL_PATHS } from '@/features/portal/tabs';
import { usePortal } from '@/features/portal/shell';
import { Page } from '@/components/layout/Page';

function BkashUnavailable({ institution }: { institution: PortalInstitution }) {
  const mailto = supportMailto(
    `Payment for ${institution.name}`,
    `Institution: ${institution.name} (${institution.slug})\nPackage to pay for: \nHow we would like to pay (bank transfer, cheque, other): \n`,
  );
  return (
    <Notice tone="info">
      Paying by bKash isn&apos;t available right now.{' '}
      <a href={mailto} className="font-semibold underline">
        Contact BdREN to pay
      </a>{' '}
      ({SUPPORT_EMAIL}) by bank transfer, cheque or another way. BdREN records the payment and your package updates; the receipt appears below.
    </Notice>
  );
}

/** Moves focus to a payment's row in the history (after a dialog closes and hands focus back). */
function showPayment(id: string) {
  window.setTimeout(() => {
    const row = document.getElementById(paymentAnchor(id));
    row?.scrollIntoView({ block: 'center' });
    row?.focus();
  }, 50);
}

/**
 * Institution console Billing: packages and their periods, what can be paid for now (bKash), scheduled switches, and
 * payments with receipts. bKash's callback lands here with `?payment=&result=`; the banner keeps that result after the
 * params are cleared, so a reload doesn't show it again.
 */
export function PortalBillingPage() {
  const { institution } = usePortal();
  const slug = institution.slug;
  const search = useSearch({ from: '/portal/$slug/billing' });
  const navigate = useNavigate();
  const [returned, setReturned] = useState<Returned | null>(() => (search.result ? { payment: search.payment } : null));
  const billing = usePortalBilling(slug);
  const hasParams = search.payment !== undefined || search.result !== undefined;

  useEffect(() => {
    if (hasParams) void navigate({ to: PORTAL_PATHS.billing, params: { slug }, search: {}, replace: true });
  }, [hasParams, navigate, slug]);

  return (
    <Page title="Billing" subtitle={institution.name}>
      {returned ? <PaymentBanner slug={slug} returned={returned} billing={billing} onDismiss={() => setReturned(null)} /> : null}
      {billing.isPending ? <LoadingState label="Loading billing…" /> : null}
      {billing.isError ? <ErrorState error={billing.error} onRetry={() => void billing.refetch()} /> : null}
      {billing.data ? (
        <>
          {billing.data.bkash_enabled ? null : <BkashUnavailable institution={institution} />}
          <CurrentPackages
            institution={institution}
            subscriptions={billing.data.subscriptions}
            downgrades={billing.data.downgrades}
            offers={billing.data.offers}
            bkashEnabled={billing.data.bkash_enabled}
            seats={institution.seats}
          />
          <Offers
            slug={slug}
            offers={billing.data.offers}
            subscriptions={billing.data.subscriptions}
            bkashEnabled={billing.data.bkash_enabled}
            onShowPayment={showPayment}
          />
          <PaymentHistory slug={slug} payments={billing.data.payments} />
        </>
      ) : null}
    </Page>
  );
}
