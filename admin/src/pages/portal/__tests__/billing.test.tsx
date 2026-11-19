import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PortalBilling, PortalPayment } from '@/features/portal/types';
import type { Routes } from '@/test/api';
import {
  DU,
  adminInstitution,
  bankPayment,
  billing,
  cancelledPayment,
  emptyBilling,
  expiredSubscription,
  failedPayment,
  mindspearSubscription,
  newOffer,
  paidPayment,
  pendingPayment,
  renderPortal,
  renewCheckoutPayment,
  standardSubscription,
  toasts,
} from '@/test/portal';
import { POLL_DELAYS, browser } from '@/features/portal/billing/rules';
import { PORTAL } from '@/test/fixtures';
import { reply } from '@/test/api';

const BILLING = `${DU}/billing/`;
const CHECKOUT = `${DU}/billing/checkout/`;
const DOWNGRADE = `${DU}/billing/downgrade/`;
const BKASH_URL = 'https://sandbox.payment.bkash.com/?paymentId=TR0011vAVyXMV1795060527293&hash=abc&mode=0011';

const renderBilling = (path = '/portal/du/billing', routes: Routes = {}) => renderPortal(path, { [`GET ${BILLING}`]: billing, ...routes });

const withPayments = (...payments: PortalPayment[]): PortalBilling => ({ ...billing, payments: [...payments, ...billing.payments] });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-19T06:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Billing navigation', () => {
  it('shows Billing under Institution for owners and admins', async () => {
    renderPortal('/portal/du/dashboard', { [`GET ${PORTAL}/`]: [{ ...adminInstitution, role: 'owner' }], [`GET ${BILLING}`]: billing });
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { name: 'Billing' })).toHaveAttribute('href', '/admin/portal/du/billing');
    expect(within(nav).getByText('Institution').parentElement).toHaveTextContent('Billing');
  });

  it('hides Billing from a role the billing API refuses', async () => {
    renderPortal('/portal/du/dashboard', { [`GET ${PORTAL}/`]: [{ ...adminInstitution, role: 'member' }], [`GET ${BILLING}`]: billing });
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { name: 'Email domains' })).toBeInTheDocument();
    expect(within(nav).queryByRole('link', { name: 'Billing' })).not.toBeInTheDocument();
  });
});

describe('Billing page', () => {
  it('shows the current package with its period and renewal', async () => {
    renderBilling();
    const packages = await screen.findByRole('region', { name: 'Your packages' });
    expect(within(packages).getByRole('heading', { name: 'Synapse Standard' })).toBeInTheDocument();
    expect(packages).toHaveTextContent('Current period 1 Nov 2026 – 30 Nov 2026.');
    expect(packages).toHaveTextContent('Renew by 30 Nov 2026 to keep access');
    expect(within(packages).getByText('Active')).toBeInTheDocument();
  });

  it('says paying the renewal turns a stopped renewal back on, and offers no switch', async () => {
    const stopped = { ...standardSubscription, auto_renew: false };
    renderBilling('/portal/du/billing', { [`GET ${BILLING}`]: { ...billing, subscriptions: [stopped], downgrades: [] } });
    const packages = await screen.findByRole('region', { name: 'Your packages' });
    expect(within(packages).getByText('Renewal stopped')).toBeInTheDocument();
    expect(packages).toHaveTextContent('It ends on 30 Nov 2026. Renewal is stopped; paying the renewal below turns it back on.');
    expect(packages).not.toHaveTextContent('Contact BdREN');
    expect(within(packages).queryByRole('button', { name: /Switch to/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pay with bKash: Renewal of Synapse Standard, ৳3,000' })).toBeInTheDocument();
  });

  it.each([
    ['no renewal is offered', { offers: [] }],
    ['bKash is off', { bkash_enabled: false }],
  ])('sends a stopped renewal to BdREN when %s', async (_, change) => {
    const stopped = { ...standardSubscription, auto_renew: false };
    renderBilling('/portal/du/billing', { [`GET ${BILLING}`]: { ...billing, subscriptions: [stopped], downgrades: [], ...change } });
    const packages = await screen.findByRole('region', { name: 'Your packages' });
    expect(packages).toHaveTextContent("It ends on 30 Nov 2026 and won't be renewed.");
    expect(packages).not.toHaveTextContent('turns it back on');
    const contact = within(packages).getByRole('link', { name: 'Contact BdREN to resume renewal' });
    expect(contact.getAttribute('href')).toMatch(/^mailto:noc@bdren\.edu\.bd\?subject=Resume%20renewal%3A%20Synapse%20Standard/);
  });

  it('sends an ended package to BdREN when nothing on the page restarts it', async () => {
    renderBilling('/portal/du/billing', {
      [`GET ${BILLING}`]: { ...billing, subscriptions: [mindspearSubscription, expiredSubscription], offers: [], downgrades: [] },
    });
    const packages = await screen.findByRole('region', { name: 'Your packages' });
    const ended = within(packages).getAllByRole('listitem').find((row) => row.textContent?.includes('Expired')) as HTMLElement;
    expect(ended).toHaveTextContent('Last period 1 Sept 2026 – 30 Sept 2026. It ended on 30 Sept 2026.');
    expect(ended).not.toHaveTextContent('Renew it');
    expect(within(ended).getByRole('link', { name: 'Contact BdREN to restart this package' }).getAttribute('href')).toMatch(
      /^mailto:noc@bdren\.edu\.bd\?subject=Restart%20package%3A%20Synapse%20Standard/,
    );
  });

  it('points an ended package to the packages it can choose when nothing is live', async () => {
    renderBilling('/portal/du/billing', { [`GET ${BILLING}`]: { ...emptyBilling, subscriptions: [expiredSubscription] } });
    const packages = await screen.findByRole('region', { name: 'Your packages' });
    expect(packages).toHaveTextContent('It ended on 30 Sept 2026. Choose a package below to restore access.');
    expect(packages).not.toHaveTextContent('Renew it');
    expect(within(packages).queryByRole('link', { name: /Contact BdREN/ })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Choose a package' })).toHaveTextContent(newOffer.package.name);
  });

  it('groups offers by kind, each with its quote and what happens to the current period', async () => {
    renderBilling();
    const offers = await screen.findByRole('region', { name: 'Pay for a package' });
    const renew = within(offers).getByRole('region', { name: 'Renew' });
    expect(within(renew).getByRole('heading', { name: 'Synapse Standard' })).toBeInTheDocument();
    expect(renew).toHaveTextContent('৳3,000');
    expect(renew).toHaveTextContent('1 Dec 2026 – 30 Dec 2026');
    expect(renew).toHaveTextContent('The next period runs 1 Dec 2026 – 30 Dec 2026, straight after the current one ends. Nothing changes until then.');
    const upgrade = within(offers).getByRole('region', { name: 'Upgrade' });
    expect(within(upgrade).getByRole('heading', { name: 'BdREN AI Suite' })).toBeInTheDocument();
    expect(upgrade).toHaveTextContent('Synapse, Mindspear');
    expect(upgrade).toHaveTextContent('৳4,500');
    expect(upgrade).toHaveTextContent(
      'You pay the full price. A new period starts when the payment completes (19 Nov 2026 – 18 Dec 2026 if you pay today), and your current Synapse Standard period ends then.',
    );
    expect(within(offers).queryByRole('region', { name: 'Choose a package' })).not.toBeInTheDocument();
  });

  it('offers first packages when nothing is active', async () => {
    renderBilling('/portal/du/billing', { [`GET ${BILLING}`]: emptyBilling });
    const offers = await screen.findByRole('region', { name: 'Pay for a package' });
    const fresh = within(offers).getByRole('region', { name: 'Choose a package' });
    expect(fresh).toHaveTextContent('Synapse Basic');
    expect(fresh).toHaveTextContent('The period starts when the payment completes: 19 Nov 2026 – 18 Dec 2026 if you pay today.');
    expect(screen.getByRole('region', { name: 'Your packages' })).toHaveTextContent('Your institution has no package yet.');
    expect(screen.getByRole('table', { name: 'Payments' })).toHaveTextContent('No payments yet.');
  });

  it('lists payments with trxID, status, receipt and attachment links', async () => {
    renderBilling();
    const table = await screen.findByRole('table', { name: 'Payments' });
    const paid = within(table).getByText('DKJ70PXGQR').closest('tr') as HTMLElement;
    expect(paid).toHaveTextContent('1 Nov 2026');
    expect(paid).toHaveTextContent('৳3,000');
    expect(paid).toHaveTextContent('bKash');
    expect(within(paid).getByText('Completed')).toBeInTheDocument();
    const receipt = within(paid).getByRole('link', { name: /Receipt BDR-2026-000031/ });
    expect(receipt).toHaveAttribute('href', `${DU}/billing/payments/pay-done/receipt/`);
    expect(receipt).toHaveAttribute('target', '_blank');
    expect(within(paid).queryByRole('link', { name: /Attachment/ })).not.toBeInTheDocument();

    const failed = within(table).getByText('Failed').closest('tr') as HTMLElement;
    expect(failed).toHaveTextContent('bKash: Insufficient balance');
    expect(within(failed).queryByRole('link')).not.toBeInTheDocument();

    const bank = within(table).getByText('SONALI-7781').closest('tr') as HTMLElement;
    expect(bank).toHaveTextContent('Bank transfer');
    expect(within(bank).getByRole('link', { name: /Receipt BDR-2026-000007/ })).toHaveAttribute('href', `${DU}/billing/payments/pay-bank/receipt/`);
    expect(within(bank).getByRole('link', { name: /Attachment/ })).toHaveAttribute('href', `${DU}/billing/payments/pay-bank/attachment/`);
  });

  it('explains how to pay when bKash is unavailable and hides Pay with bKash', async () => {
    renderBilling('/portal/du/billing', { [`GET ${BILLING}`]: { ...billing, bkash_enabled: false } });
    const link = await screen.findByRole('link', { name: 'Contact BdREN to pay' });
    expect(link.getAttribute('href')).toMatch(/^mailto:noc@bdren\.edu\.bd\?subject=Payment%20for%20University%20of%20Dhaka/);
    expect(link.closest('[role="status"]')).toHaveTextContent("Paying by bKash isn't available right now.");
    expect(screen.getByRole('region', { name: 'Renew' })).toHaveTextContent('৳3,000');
    expect(screen.queryByRole('button', { name: /Pay with bKash/ })).not.toBeInTheDocument();
  });

  it('shows an error with a retry when billing fails to load', async () => {
    renderBilling('/portal/du/billing', { [`GET ${BILLING}`]: reply(500, { error: 'server_error', message: 'Billing is down.' }) });
    expect(await screen.findByRole('alert')).toHaveTextContent('Billing is down.');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});

describe('Payment result banner', () => {
  it('shows a received payment with its receipt and clears the params', async () => {
    const { router } = renderBilling('/portal/du/billing?payment=pay-done&result=success');
    const banner = await screen.findByRole('status', { name: 'Payment result' });
    await waitFor(() => expect(banner).toHaveTextContent('Payment received, receipt BDR-2026-000031'));
    expect(within(banner).getByRole('link', { name: /View receipt/ })).toHaveAttribute('href', `${DU}/billing/payments/pay-done/receipt/`);
    await waitFor(() => expect(router.state.location.search).toEqual({}));
    expect(router.state.location.pathname).toBe('/portal/du/billing');
    expect(screen.getByRole('status', { name: 'Payment result' })).toHaveTextContent('Payment received');
  });

  it("shows a failed payment's reason", async () => {
    renderBilling('/portal/du/billing?payment=pay-failed&result=failed');
    const banner = await screen.findByRole('alert', { name: 'Payment result' });
    expect(banner).toHaveTextContent('Payment failed');
    await waitFor(() => expect(banner).toHaveTextContent('bKash: Insufficient balance'));
  });

  it('says a cancelled payment charged nothing, and can be dismissed', async () => {
    const user = userEvent.setup();
    const { router } = renderBilling('/portal/du/billing?payment=pay-cancelled&result=cancelled', { [`GET ${BILLING}`]: withPayments(cancelledPayment) });
    const banner = await screen.findByRole('status', { name: 'Payment result' });
    await waitFor(() => expect(banner).toHaveTextContent('Payment cancelled, nothing was charged'));
    await waitFor(() => expect(router.state.location.search).toEqual({}));
    await user.click(within(banner).getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('status', { name: 'Payment result' })).not.toBeInTheDocument();
  });

  it("shows the payment's own status, not a result edited into the address", async () => {
    renderBilling('/portal/du/billing?payment=pay-failed&result=success');
    const banner = await screen.findByRole('alert', { name: 'Payment result' });
    expect(banner).toHaveTextContent('Payment failed');
    expect(banner).toHaveTextContent('bKash: Insufficient balance');
    expect(banner).not.toHaveTextContent('Payment received');
    expect(within(banner).queryByRole('link', { name: /View receipt/ })).not.toBeInTheDocument();
  });

  it.each([
    ['no payment is named', '/portal/du/billing?result=success'],
    ['the payment is not found', '/portal/du/billing?payment=pay-elsewhere&result=success'],
    ['a pending result names no payment', '/portal/du/billing?result=pending'],
  ])('claims nothing when %s', async (_, path) => {
    renderBilling(path);
    await screen.findByRole('region', { name: 'Your packages' });
    const banner = screen.getByRole('status', { name: 'Payment result' });
    await waitFor(() => expect(banner).toHaveTextContent("We couldn't find this payment"));
    expect(banner).toHaveTextContent('Check Payments below');
    expect(banner).not.toHaveTextContent('Payment received');
    expect(banner).not.toHaveTextContent('Checking with bKash');
  });

  it('ignores an unknown result', async () => {
    renderBilling('/portal/du/billing?payment=pay-done&result=maybe');
    await screen.findByRole('region', { name: 'Your packages' });
    expect(screen.queryByRole('status', { name: 'Payment result' })).not.toBeInTheDocument();
  });
});

describe('Pending payment confirmation', () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.setSystemTime(new Date('2026-11-19T06:00:00Z'));
  });

  it('polls until the payment is confirmed, then shows the receipt', async () => {
    let reads = 0;
    const confirmed = { ...pendingPayment, status: 'completed' as const, receipt_number: 'BDR-2026-000032' };
    const { api } = renderBilling('/portal/du/billing?payment=pay-pending&result=pending', {
      [`GET ${BILLING}`]: () => {
        reads += 1;
        return withPayments(reads >= 3 ? confirmed : pendingPayment);
      },
    });
    const banner = await screen.findByRole('status', { name: 'Payment result' });
    expect(banner).toHaveTextContent('Payment is being confirmed');
    await act(() => vi.advanceTimersByTimeAsync(POLL_DELAYS[0]));
    await act(() => vi.advanceTimersByTimeAsync(POLL_DELAYS[1]));
    await waitFor(() => expect(screen.getByRole('status', { name: 'Payment result' })).toHaveTextContent('Payment received, receipt BDR-2026-000032'));
    const after = api.find('GET', BILLING).length;
    await act(() => vi.advanceTimersByTimeAsync(POLL_DELAYS.reduce((sum, delay) => sum + delay, 0)));
    expect(api.find('GET', BILLING)).toHaveLength(after);
  });

  it('stops polling after the last wait and says it is still being confirmed', async () => {
    const { api } = renderBilling('/portal/du/billing?payment=pay-pending&result=pending', { [`GET ${BILLING}`]: withPayments(pendingPayment) });
    const banner = await screen.findByRole('status', { name: 'Payment result' });
    for (const delay of POLL_DELAYS) {
      await act(() => vi.advanceTimersByTimeAsync(delay));
    }
    await waitFor(() => expect(banner).toHaveTextContent("bKash hasn't confirmed it yet."));
    expect(banner).toHaveTextContent('Payment is being confirmed');
    expect(api.find('GET', BILLING)).toHaveLength(1 + POLL_DELAYS.length);
    await act(() => vi.advanceTimersByTimeAsync(120_000));
    expect(api.find('GET', BILLING)).toHaveLength(1 + POLL_DELAYS.length);
  });

  it('shows a payment that failed meanwhile', async () => {
    renderBilling('/portal/du/billing?payment=pay-pending&result=pending', {
      [`GET ${BILLING}`]: withPayments({ ...pendingPayment, status: 'failed', failure_reason: 'bKash: Transaction failed' }),
    });
    const banner = await screen.findByRole('alert', { name: 'Payment result' });
    expect(banner).toHaveTextContent('bKash: Transaction failed');
  });
});

async function openRenewCheckout() {
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Pay with bKash: Renewal of Synapse Standard, ৳3,000' }));
  const dialog = await screen.findByRole('dialog', { name: 'Pay ৳3,000 with bKash' });
  return { user, dialog };
}

describe('Checkout', () => {
  it('summarises the quote, starts the payment once and goes to bKash', async () => {
    const open = vi.spyOn(browser, 'open').mockImplementation(() => undefined);
    const { api } = renderBilling('/portal/du/billing', { [`POST ${CHECKOUT}`]: reply(201, { payment: renewCheckoutPayment, redirect_url: BKASH_URL }) });
    const { dialog } = await openRenewCheckout();
    expect(dialog).toHaveTextContent('Synapse Standard');
    expect(dialog).toHaveTextContent('Renewal');
    expect(dialog).toHaveTextContent('1 Dec 2026 – 30 Dec 2026');
    expect(dialog).toHaveTextContent('straight after the current one ends');
    const pay = within(dialog).getByRole('button', { name: 'Continue to bKash' });
    fireEvent.click(pay);
    fireEvent.click(pay);
    fireEvent.submit(pay.closest('form') as HTMLFormElement);
    await waitFor(() => expect(open).toHaveBeenCalledWith(BKASH_URL));
    expect(api.find('POST', CHECKOUT)).toHaveLength(1);
    expect(api.find('POST', CHECKOUT)[0].body).toEqual({ package: 'pkg-standard', kind: 'renew' });
    expect(within(dialog).getByRole('button', { name: 'Opening bKash…' })).toBeDisabled();
  });

  it('asks again before bKash when the payment charges something else than the confirmed quote', async () => {
    const open = vi.spyOn(browser, 'open').mockImplementation(() => undefined);
    const repriced = { ...renewCheckoutPayment, amount: '3500.00', period_end: '2027-01-01T06:00:00Z' };
    const { api } = renderBilling('/portal/du/billing', { [`POST ${CHECKOUT}`]: reply(201, { payment: repriced, redirect_url: BKASH_URL }) });
    const { user, dialog } = await openRenewCheckout();
    const reads = api.find('GET', BILLING).length;
    await user.click(within(dialog).getByRole('button', { name: 'Continue to bKash' }));
    const notice = await within(dialog).findByText(/The price or period changed after this page loaded/);
    expect(notice).toHaveTextContent('This payment is ৳3,500 for 1 Dec 2026 – 31 Dec 2026, not the ৳3,000 for 1 Dec 2026 – 30 Dec 2026 shown before.');
    expect(open).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Pay ৳3,500 with bKash' })).toBe(dialog);
    expect(within(dialog).getByLabelText('Payment summary')).toHaveTextContent('৳3,500');
    await waitFor(() => expect(api.find('GET', BILLING).length).toBeGreaterThan(reads));
    await user.click(within(dialog).getByRole('button', { name: 'Continue to bKash' }));
    expect(open).toHaveBeenCalledWith(BKASH_URL);
    expect(api.find('POST', CHECKOUT)).toHaveLength(1);
  });

  it("can't be closed while the payment is being opened", async () => {
    const open = vi.spyOn(browser, 'open').mockImplementation(() => undefined);
    let answer: (value: unknown) => void = () => undefined;
    const held = new Promise((resolve) => {
      answer = resolve;
    });
    renderBilling('/portal/du/billing', { [`POST ${CHECKOUT}`]: () => held });
    const { user, dialog } = await openRenewCheckout();
    await user.click(within(dialog).getByRole('button', { name: 'Continue to bKash' }));
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled());
    expect(within(dialog).getByRole('button', { name: 'Close' })).toBeDisabled();
    await user.keyboard('{Escape}');
    expect(screen.getByRole('dialog', { name: 'Pay ৳3,000 with bKash' })).toBeInTheDocument();
    await act(async () => answer(reply(201, { payment: renewCheckoutPayment, redirect_url: BKASH_URL })));
    await waitFor(() => expect(open).toHaveBeenCalledWith(BKASH_URL));
    expect(screen.getByRole('dialog', { name: 'Pay ৳3,000 with bKash' })).toBeInTheDocument();
  });

  it.each([
    ['http://sandbox.payment.bkash.com/?paymentId=1'],
    ['https://bkash.com.evil.example/pay'],
    ['https://evil.example/?next=bkash.com'],
    ['javascript:alert(1)'],
  ])('does not follow an unexpected redirect %s', async (url) => {
    const open = vi.spyOn(browser, 'open').mockImplementation(() => undefined);
    renderBilling('/portal/du/billing', { [`POST ${CHECKOUT}`]: reply(201, { payment: pendingPayment, redirect_url: url }) });
    const { user, dialog } = await openRenewCheckout();
    await user.click(within(dialog).getByRole('button', { name: 'Continue to bKash' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent("we don't recognise, so we didn't open it");
    expect(open).not.toHaveBeenCalled();
    expect(within(dialog).getByRole('button', { name: 'Continue to bKash' })).toBeDisabled();
  });

  it.each([
    [503, 'bkash_unavailable', {}, "Paying with bKash isn't available right now. Contact BdREN to pay another way."],
    [400, 'package_not_offered', {}, "This package isn't offered to your institution for this payment any more."],
    [400, 'package_unavailable', {}, "This package can't be bought now."],
    [400, 'free_package', {}, 'This package is free, so there is nothing to pay.'],
    [409, 'covered_by_bundle', {}, 'Your institution already gets this app from its combined package.'],
    [409, 'seats_exceed_package', { seats: { used: 142, cap: 100 } }, 'Your institution uses 142 seats; Synapse Standard allows 100.'],
    [409, 'renewal_stopped', {}, 'This package is set not to renew'],
    [403, 'institution_suspended', {}, 'Your institution is suspended. Contact BdREN to restore access.'],
    [502, 'bkash_error', {}, "bKash couldn't start the payment. Nothing was charged; try again in a few minutes."],
    [404, 'not_found', {}, 'This package no longer exists.'],
    [400, 'invalid', {}, 'The request was incomplete.'],
    [409, 'no_account', {}, 'Your institution has no billing account yet.'],
    [418, 'something_new', { message: 'The server said something new.' }, 'The server said something new.'],
  ])('explains %s %s and stays on the page', async (status, code, extra, text) => {
    const open = vi.spyOn(browser, 'open').mockImplementation(() => undefined);
    const { api } = renderBilling('/portal/du/billing', { [`POST ${CHECKOUT}`]: reply(status, { error: code, message: 'Server text', ...extra }) });
    const { user, dialog } = await openRenewCheckout();
    await user.click(within(dialog).getByRole('button', { name: 'Continue to bKash' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(text);
    expect(open).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Continue to bKash' }));
    await waitFor(() => expect(api.find('POST', CHECKOUT)).toHaveLength(2));
  });

  it('points to the bKash payment already in progress', async () => {
    vi.spyOn(browser, 'open').mockImplementation(() => undefined);
    renderBilling('/portal/du/billing', {
      [`GET ${BILLING}`]: withPayments(pendingPayment),
      [`POST ${CHECKOUT}`]: reply(409, { error: 'checkout_in_progress', message: 'Server text', payment: pendingPayment }),
    });
    const { user, dialog } = await openRenewCheckout();
    await user.click(within(dialog).getByRole('button', { name: 'Continue to bKash' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/A bKash payment of ৳4,500 for BdREN AI Suite was started at 19 Nov 2026/);
    await user.click(within(dialog).getByRole('button', { name: 'See the pending payment' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(document.getElementById('payment-pay-pending')).toHaveFocus());
  });

  it('continues the payment already in progress on bKash when the API returns its page', async () => {
    const open = vi.spyOn(browser, 'open').mockImplementation(() => undefined);
    const page = 'https://sandbox.payment.bkash.com/?paymentId=TR0011pending';
    const { api } = renderBilling('/portal/du/billing', {
      [`GET ${BILLING}`]: withPayments(pendingPayment),
      [`POST ${CHECKOUT}`]: reply(409, { error: 'checkout_in_progress', payment: pendingPayment, redirect_url: page }),
    });
    const { user, dialog } = await openRenewCheckout();
    await user.click(within(dialog).getByRole('button', { name: 'Continue to bKash' }));
    const alert = await within(dialog).findByRole('alert');
    expect(alert).toHaveTextContent('Continue it on bKash');
    expect(within(dialog).getAllByRole('button', { name: 'Continue to bKash' })).toHaveLength(1);
    expect(within(dialog).getByRole('button', { name: 'Not now' })).toBeInTheDocument();
    await user.click(within(alert).getByRole('button', { name: 'Continue to bKash' }));
    expect(open).toHaveBeenCalledWith(page);
    expect(api.find('POST', CHECKOUT)).toHaveLength(1);
  });

  it.each([
    ['no page', null],
    ['an http page', 'http://sandbox.payment.bkash.com/?paymentId=x'],
    ['another host', 'https://bkash.com.evil.example/pay'],
  ])('offers no resume button when the API returns %s', async (_label, redirect) => {
    const open = vi.spyOn(browser, 'open').mockImplementation(() => undefined);
    renderBilling('/portal/du/billing', {
      [`GET ${BILLING}`]: withPayments(pendingPayment),
      [`POST ${CHECKOUT}`]: reply(409, { error: 'checkout_in_progress', payment: pendingPayment, redirect_url: redirect }),
    });
    const { user, dialog } = await openRenewCheckout();
    await user.click(within(dialog).getByRole('button', { name: 'Continue to bKash' }));
    const alert = await within(dialog).findByRole('alert');
    expect(alert).toHaveTextContent('bKash no longer accepts it; wait 10 minutes and try again.');
    expect(within(alert).queryByRole('button', { name: 'Continue to bKash' })).not.toBeInTheDocument();
    expect(within(alert).getByRole('button', { name: 'See the pending payment' })).toBeInTheDocument();
    expect(open).not.toHaveBeenCalled();
  });
});

describe('Scheduled downgrades', () => {
  it('schedules a cheaper package for the next renewal', async () => {
    const user = userEvent.setup();
    const { api } = renderBilling('/portal/du/billing', {
      [`POST ${DOWNGRADE}`]: { subscription: { ...standardSubscription, scheduled_package: { id: 'pkg-basic', name: 'Synapse Basic' } } },
    });
    await user.click(await screen.findByRole('button', { name: 'Switch to Synapse Basic at next renewal (৳1,000 / month)' }));
    const dialog = await screen.findByRole('dialog', { name: 'Switch to Synapse Basic at the next renewal' });
    expect(dialog).toHaveTextContent('keeps Synapse Standard until its current period ends on 30 Nov 2026');
    expect(dialog).toHaveTextContent('Nothing is charged now');
    const reads = api.find('GET', BILLING).length;
    await user.click(within(dialog).getByRole('button', { name: 'Schedule switch' }));
    await waitFor(() => expect(toasts().getByText('Synapse Basic is scheduled for the next renewal.')).toBeInTheDocument());
    expect(api.find('POST', DOWNGRADE)[0].body).toEqual({ package: 'pkg-basic' });
    await waitFor(() => expect(api.find('GET', BILLING).length).toBeGreaterThan(reads));
  });

  it('warns when the institution uses more seats than the cheaper package allows', async () => {
    const user = userEvent.setup();
    renderBilling();
    const packages = await screen.findByRole('region', { name: 'Your packages' });
    expect(packages).toHaveTextContent('Allows 100 seats; you use 142.');
    await user.click(within(packages).getByRole('button', { name: 'Switch to Synapse Lite at next renewal (৳500 / month)' }));
    const dialog = await screen.findByRole('dialog', { name: 'Switch to Synapse Lite at the next renewal' });
    expect(dialog).toHaveTextContent('Your institution uses 142 seats; Synapse Lite allows 100.');
    expect(within(dialog).getByRole('button', { name: 'Schedule switch' })).toBeDisabled();
  });

  it.each([
    [409, 'nothing_to_downgrade', {}, 'Your institution has no active package for these apps'],
    [400, 'package_not_offered', {}, "This package can't replace your current one: it must cover the same apps and cost less per period."],
    [409, 'seats_exceed_package', { seats: { used: 150, cap: 120 } }, 'Your institution uses 150 seats; Synapse Basic allows 120.'],
    [409, 'renewal_stopped', {}, "This package is set not to renew, so its next renewal can't be changed."],
    [400, 'free_package', {}, 'This package is free'],
    [400, 'package_unavailable', {}, "This package can't be bought now."],
    [404, 'not_found', {}, 'This package no longer exists.'],
  ])('explains a refused switch: %s %s', async (status, code, extra, text) => {
    const user = userEvent.setup();
    renderBilling('/portal/du/billing', { [`POST ${DOWNGRADE}`]: reply(status, { error: code, message: 'Server text', ...extra }) });
    await user.click(await screen.findByRole('button', { name: /Switch to Synapse Basic/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Switch to Synapse Basic at the next renewal' });
    await user.click(within(dialog).getByRole('button', { name: 'Schedule switch' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(text);
  });

  it('shows a scheduled switch and cancels it', async () => {
    const user = userEvent.setup();
    const scheduled = { ...standardSubscription, scheduled_package: { id: 'pkg-basic', name: 'Synapse Basic' } };
    const { api } = renderBilling('/portal/du/billing', {
      [`GET ${BILLING}`]: { ...billing, subscriptions: [scheduled] },
      [`DELETE ${DOWNGRADE}`]: { subscription: standardSubscription },
    });
    const packages = await screen.findByRole('region', { name: 'Your packages' });
    expect(within(packages).getByText('Switches to Synapse Basic at renewal')).toBeInTheDocument();
    expect(packages).toHaveTextContent('From the next renewal on 1 Dec 2026, your institution moves to Synapse Basic.');
    expect(within(packages).queryByRole('button', { name: /Switch to Synapse Basic/ })).not.toBeInTheDocument();
    await user.click(within(packages).getByRole('button', { name: 'Cancel change' }));
    const dialog = await screen.findByRole('dialog', { name: 'Cancel the scheduled switch' });
    expect(dialog).toHaveTextContent('Synapse Standard stays on at the next renewal instead of switching to Synapse Basic.');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel the switch' }));
    await waitFor(() => expect(toasts().getByText('The scheduled switch is cancelled.')).toBeInTheDocument());
    expect(api.find('DELETE', DOWNGRADE)[0].query.get('subscription')).toBe('sub-du');
  });

  it('explains when there is no scheduled switch to cancel', async () => {
    const user = userEvent.setup();
    const scheduled = { ...standardSubscription, scheduled_package: { id: 'pkg-basic', name: 'Synapse Basic' } };
    renderBilling('/portal/du/billing', {
      [`GET ${BILLING}`]: { ...billing, subscriptions: [scheduled] },
      [`DELETE ${DOWNGRADE}`]: reply(409, { error: 'no_scheduled_change', message: 'No change is scheduled.' }),
    });
    await user.click(await screen.findByRole('button', { name: 'Cancel change' }));
    const dialog = await screen.findByRole('dialog', { name: 'Cancel the scheduled switch' });
    await user.click(within(dialog).getByRole('button', { name: 'Cancel the switch' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('No switch is scheduled any more, so there is nothing to cancel.');
  });
});

describe('Receipts in history', () => {
  it('offers no receipt for a pending payment', async () => {
    renderBilling('/portal/du/billing', { [`GET ${BILLING}`]: withPayments(pendingPayment) });
    const row = (await screen.findByText('Pending')).closest('tr') as HTMLElement;
    expect(within(row).queryByRole('link')).not.toBeInTheDocument();
    expect([paidPayment, failedPayment, bankPayment].every((payment) => document.getElementById(`payment-${payment.id}`))).toBe(true);
  });
});
