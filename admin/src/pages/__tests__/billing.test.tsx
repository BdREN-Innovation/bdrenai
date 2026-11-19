import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MockRequest, Routes } from '@/test/api';
import { API, bundleRow, mindspearRow, page, synapseRow } from '@/test/fixtures';
import { bkashPayment, pendingManual, quote, sau, suiteSubscription, summary } from '@/test/billing';
import { renderApp } from '@/test/render';
import { reply } from '@/test/api';

const PAYMENTS = `${API}/billing/payments/`;
const QUOTE = `${API}/billing/quote/`;
const MANUAL = `${API}/billing/payments/manual/`;

const base = (extra: Routes = {}): Routes => ({
  [`GET ${API}/billing/summary/`]: summary,
  [`GET ${PAYMENTS}`]: page([bkashPayment, pendingManual]),
  [`GET ${API}/config/packages/`]: page([bundleRow, synapseRow, mindspearRow]),
  [`GET ${PAYMENTS}pay-1/`]: bkashPayment,
  [`GET ${PAYMENTS}pay-2/`]: pendingManual,
  [`GET ${API}/institutions/options/`]: (request: MockRequest) => ({
    results: request.query.get('q') ? [{ slug: sau.slug, name: sau.name, status: 'active', seats: { used: 40, cap: 100 } }] : [],
  }),
  [`GET ${API}/institutions/sau/billing/`]: { subscriptions: [suiteSubscription], payments: [bkashPayment] },
  [`GET ${QUOTE}`]: quote,
  ...extra,
});

const lastList = (api: { find: (method: string, path: string) => MockRequest[] }) => api.find('GET', PAYMENTS).at(-1)?.query;

describe('BillingPage', () => {
  it('shows the summary with change against the previous period, the bKash mode and the payments', async () => {
    renderApp('/billing', base());
    const table = await screen.findByRole('table', { name: 'Payments' });
    expect(await within(table).findByText('DKI20PX90K')).toBeInTheDocument();
    expect(within(table).getAllByText('৳4,500')[0]).toBeInTheDocument();
    expect(await screen.findByText('৳13,500')).toBeInTheDocument();
    expect(screen.getByText('+50% vs previous period')).toBeInTheDocument();
    expect(screen.getByText('bKash: Sandbox')).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { name: 'Billing' })).toHaveAttribute('aria-current', 'page');
  });

  it('sends the tab, filters, search and range with the list query and keeps the tab in the URL', async () => {
    const user = userEvent.setup();
    const { api, router } = renderApp('/billing', base());
    await screen.findByRole('table', { name: 'Payments' });
    const first = lastList(api);
    expect(first?.get('tab')).toBeNull();
    expect(first?.get('from')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(first?.get('to')).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    await user.click(screen.getByRole('tab', { name: 'Awaiting action' }));
    await waitFor(() => expect(lastList(api)?.get('tab')).toBe('attention'));
    expect(router.state.location.search).toEqual({ tab: 'attention' });

    await user.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'pending');
    await waitFor(() => expect(lastList(api)?.get('status')).toBe('pending'));

    await user.selectOptions(screen.getByRole('combobox', { name: 'Package' }), 'pkg-all');
    await waitFor(() => expect(lastList(api)?.get('package')).toBe('pkg-all'));

    await user.type(screen.getByRole('searchbox', { name: /Search receipt/ }), 'SONALI');
    await waitFor(() => expect(lastList(api)?.get('q')).toBe('SONALI'));

    await user.type(screen.getByRole('combobox', { name: 'Institution' }), 'Sylhet');
    await user.click(await screen.findByRole('option', { name: /^Sylhet Agricultural University/ }));
    await waitFor(() => expect(lastList(api)?.get('institution')).toBe('sau'));

    await user.selectOptions(screen.getByRole('combobox', { name: 'Period' }), 'custom');
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-11-01' } });
    await waitFor(() => expect(lastList(api)?.get('from')).toBe('2026-11-01'));
    expect(api.find('GET', `${API}/billing/summary/`).at(-1)?.query.get('from')).toBe('2026-11-01');
    const query = lastList(api);
    expect(query?.get('tab')).toBe('attention');
    expect(query?.get('status')).toBe('pending');
  });

  it('opens the payment drawer with bKash ids, refunds and a receipt link', async () => {
    const user = userEvent.setup();
    renderApp('/billing', base());
    const table = await screen.findByRole('table', { name: 'Payments' });
    await user.click(await within(table).findByRole('row', { name: /BDR-2026-000012/ }));
    const drawer = await screen.findByRole('dialog', { name: 'Payment BDR-2026-000012' });
    expect(await within(drawer).findByText('TR0011wEp5MBG1794997089896')).toBeInTheDocument();
    expect(within(drawer).getByText('********378')).toBeInTheDocument();
    const refunds = within(drawer).getByRole('list', { name: 'Refunds' });
    expect(within(refunds).getByText('Charged for unused seats')).toBeInTheDocument();
    const receipt = within(drawer).getByRole('link', { name: /Receipt/ });
    expect(receipt).toHaveAttribute('href', `${PAYMENTS}pay-1/receipt/`);
    expect(receipt).toHaveAttribute('target', '_blank');
    expect(within(drawer).queryByRole('button', { name: 'Verify' })).not.toBeInTheDocument();
  });

  it('verifies a pending manual payment', async () => {
    const user = userEvent.setup();
    const { api } = renderApp('/billing', base({ [`POST ${PAYMENTS}pay-2/verify/`]: { ...pendingManual, status: 'completed' } }));
    const table = await screen.findByRole('table', { name: 'Payments' });
    await user.click(await within(table).findByRole('row', { name: /SAU Accounts|৳9,000/ }));
    const drawer = await screen.findByRole('dialog', { name: 'Payment' });
    expect(await within(drawer).findByRole('link', { name: 'Download attachment' })).toHaveAttribute('href', `${PAYMENTS}pay-2/attachment/`);
    await user.click(within(drawer).getByRole('button', { name: 'Verify' }));
    const confirm = await screen.findByRole('dialog', { name: 'Verify payment' });
    await user.click(within(confirm).getByRole('button', { name: 'Verify' }));
    await waitFor(() => expect(api.find('POST', `${PAYMENTS}pay-2/verify/`)[0]?.body).toEqual({}));
    expect(await screen.findByText('Payment verified and the subscription updated.')).toBeInTheDocument();
  });

  it('rejects a pending manual payment only with a reason', async () => {
    const user = userEvent.setup();
    const { api } = renderApp('/billing', base({ [`POST ${PAYMENTS}pay-2/reject/`]: { ...pendingManual, status: 'rejected' } }));
    const table = await screen.findByRole('table', { name: 'Payments' });
    await user.click(await within(table).findByRole('row', { name: /৳9,000/ }));
    const drawer = await screen.findByRole('dialog', { name: 'Payment' });
    await user.click(await within(drawer).findByRole('button', { name: 'Reject' }));
    const confirm = await screen.findByRole('dialog', { name: 'Reject payment' });
    const button = within(confirm).getByRole('button', { name: 'Reject' });
    expect(button).toBeDisabled();
    await user.type(within(confirm).getByLabelText(/Reason/), 'Slip does not match the bank statement');
    await user.click(button);
    await waitFor(() =>
      expect(api.find('POST', `${PAYMENTS}pay-2/reject/`)[0]?.body).toEqual({ reason: 'Slip does not match the bank statement' }),
    );
  });

  it('refunds at most what is left, with a reason and the end-subscription choice', async () => {
    const user = userEvent.setup();
    const { api } = renderApp('/billing', base({ [`POST ${PAYMENTS}pay-1/refund/`]: { ...bkashPayment, status: 'refunded' } }));
    const table = await screen.findByRole('table', { name: 'Payments' });
    await user.click(await within(table).findByRole('row', { name: /BDR-2026-000012/ }));
    const drawer = await screen.findByRole('dialog', { name: 'Payment BDR-2026-000012' });
    await user.click(await within(drawer).findByRole('button', { name: 'Refund' }));
    const dialog = await screen.findByRole('dialog', { name: 'Refund payment' });
    const amount = within(dialog).getByLabelText(/Amount/);
    expect(amount).toHaveValue('3500');

    await user.clear(amount);
    await user.type(amount, '4000');
    await user.click(within(dialog).getByRole('button', { name: 'Refund' }));
    expect(await within(dialog).findByText('At most ৳3,500 is left to refund.')).toBeInTheDocument();
    expect(within(dialog).getByText('Say why the money is returned.')).toBeInTheDocument();
    expect(api.find('POST', `${PAYMENTS}pay-1/refund/`)).toHaveLength(0);

    await user.clear(amount);
    await user.type(amount, '500');
    await user.type(within(dialog).getByLabelText(/Reason/), 'Institution closed a faculty');
    await user.click(within(dialog).getByLabelText('End the subscription this payment paid for'));
    await user.click(within(dialog).getByRole('button', { name: 'Refund' }));
    await waitFor(() =>
      expect(api.find('POST', `${PAYMENTS}pay-1/refund/`)[0]?.body).toEqual({
        amount: '500.00',
        reason: 'Institution closed a faculty',
        end_subscription: true,
      }),
    );
    expect(await screen.findByText('৳500 refunded.')).toBeInTheDocument();
  });
});

describe('Record payment', () => {
  const openDialog = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(await screen.findByRole('button', { name: 'Record payment' }));
    const dialog = await screen.findByRole('dialog', { name: 'Record payment' });
    await user.type(within(dialog).getByRole('combobox', { name: /Institution/ }), 'Sylhet');
    await user.click(await within(dialog).findByRole('option', { name: /^Sylhet Agricultural University/ }));
    return dialog;
  };

  it('fetches the quote, prefills amount and start, and saves the exact body', async () => {
    const user = userEvent.setup();
    const { api } = renderApp('/billing', base({ [`POST ${MANUAL}`]: reply(201, { ...pendingManual, status: 'completed', receipt_number: 'BDR-2026-000013' }) }));
    const dialog = await openDialog(user);

    const current = await within(dialog).findByRole('list', { name: 'Current subscriptions' });
    expect(within(current).getByText('BdREN AI Suite')).toBeInTheDocument();
    expect(within(dialog).getByRole('radio', { name: 'Renew' })).toBeChecked();
    await waitFor(() => expect(within(dialog).getByLabelText(/^Amount/)).toHaveValue('4500.00'));
    const quoteCall = api.find('GET', QUOTE).at(-1)?.query;
    expect(Object.fromEntries(quoteCall ?? [])).toEqual({ institution: 'sau', package: 'pkg-all', kind: 'renew', periods: '1' });
    expect(within(dialog).getByLabelText(/^Start date/)).toHaveValue('2026-11-18');
    expect(within(dialog).getByRole('status', { name: 'Preview' })).toHaveTextContent(
      'Sylhet Agricultural University → BdREN AI Suite, 18 Nov 2026 – 17 Dec 2026, ৳4,500',
    );

    await user.selectOptions(within(dialog).getByLabelText(/^Method/), 'cheque');
    await user.type(within(dialog).getByLabelText(/^Reference/), 'CHQ-0091');
    await user.type(within(dialog).getByLabelText(/^Payer name/), 'SAU Accounts');
    const date = within(dialog).getByLabelText(/^Payment date/);
    await user.clear(date);
    await user.type(date, '2026-11-17');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(api.find('POST', MANUAL)[0]?.body).toEqual({
        institution: 'sau',
        package: 'pkg-all',
        kind: 'renew',
        periods: 1,
        period_start: null,
        amount: '4500.00',
        method: 'cheque',
        reference: 'CHQ-0091',
        payer_name: 'SAU Accounts',
        payment_date: '2026-11-17',
        notes: '',
        pending: false,
      }),
    );
    expect(await screen.findByText('Payment recorded, receipt BDR-2026-000013.')).toBeInTheDocument();
  });

  it('asks for notes when the amount differs from the quote and can save as pending', async () => {
    const user = userEvent.setup();
    const { api } = renderApp('/billing', base({ [`POST ${MANUAL}`]: reply(201, pendingManual) }));
    const dialog = await openDialog(user);
    const amount = within(dialog).getByLabelText(/^Amount/);
    await waitFor(() => expect(amount).toHaveValue('4500.00'));

    await user.clear(within(dialog).getByLabelText(/^Periods/));
    await user.type(within(dialog).getByLabelText(/^Periods/), '2');
    await waitFor(() => expect(api.find('GET', QUOTE).at(-1)?.query.get('periods')).toBe('2'));

    await user.clear(amount);
    await user.type(amount, '4000');
    expect(within(dialog).getByText('Required: the amount differs from the quote.')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Save as pending' }));
    expect(await within(dialog).findByText('The amount differs from the quote (৳4,500). Say why.')).toBeInTheDocument();
    expect(api.find('POST', MANUAL)).toHaveLength(0);

    await user.type(within(dialog).getByLabelText(/^Notes/), 'Discount agreed for late renewal');
    await user.click(within(dialog).getByRole('button', { name: 'Save as pending' }));

    await waitFor(() => expect(api.find('POST', MANUAL)).toHaveLength(1));
    expect(api.find('POST', MANUAL)[0].body).toMatchObject({
      amount: '4000.00',
      periods: 2,
      notes: 'Discount agreed for late renewal',
      method: 'bank_transfer',
      pending: true,
    });
    expect(await screen.findByText(/Payment saved as pending/)).toBeInTheDocument();
  });

  it('shows server field errors beside their fields', async () => {
    const user = userEvent.setup();
    renderApp(
      '/billing',
      base({
        [`POST ${MANUAL}`]: reply(400, { error: 'validation_error', message: 'Invalid', fields: { reference: 'A cheque needs its number.' } }),
      }),
    );
    const dialog = await openDialog(user);
    await waitFor(() => expect(within(dialog).getByLabelText(/^Amount/)).toHaveValue('4500.00'));
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    const reference = within(dialog).getByLabelText(/^Reference/);
    await waitFor(() => expect(reference).toHaveAttribute('aria-invalid', 'true'));
    expect(within(dialog).getByText('A cheque needs its number.')).toBeInTheDocument();
  });

  it('shows why a package cannot be bought when the quote is refused', async () => {
    const user = userEvent.setup();
    renderApp(
      '/billing',
      base({ [`GET ${QUOTE}`]: reply(409, { error: 'covered_by_bundle', message: 'Covered by bundle' }) }),
    );
    const dialog = await openDialog(user);
    expect(
      await within(dialog).findByText('The institution already gets this app from a combined package. Renew or upgrade that package instead.'),
    ).toBeInTheDocument();
  });
});
