import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MockRequest, Routes } from '@/test/api';
import type { BillingSubscription } from '@/api/types';
import { API, bundleRow, institutionDetail, page, synapseRow } from '@/test/fixtures';
import { bkashPayment, pendingManual, quote, suiteSubscription } from '@/test/billing';
import { renderApp } from '@/test/render';

const SUBS = `${API}/billing/subscriptions/`;

const stopped: BillingSubscription = {
  ...suiteSubscription,
  id: 'sub-2',
  institution: { slug: 'buet', name: 'BUET' },
  auto_renew: false,
};

const downgrading: BillingSubscription = {
  ...suiteSubscription,
  id: 'sub-3',
  institution: { slug: 'ku', name: 'Khulna University' },
  scheduled_package: { id: 'pkg-syn', name: 'Synapse Standard' },
};

const base = (extra: Routes = {}): Routes => ({
  [`GET ${SUBS}`]: (request: MockRequest) => {
    if (request.query.get('scheduled') === '1') return page([downgrading]);
    if (request.query.get('auto_renew') === 'false') return page([stopped]);
    return page([suiteSubscription, stopped, downgrading]);
  },
  [`GET ${API}/config/packages/`]: page([bundleRow, synapseRow]),
  ...extra,
});

describe('SubscriptionsPage', () => {
  it('lists subscriptions and sends each saved view as its query', async () => {
    const user = userEvent.setup();
    const { api, router } = renderApp('/subscriptions', base());
    const table = await screen.findByRole('table', { name: 'Subscriptions' });
    expect(await within(table).findByText('Sylhet Agricultural University')).toBeInTheDocument();
    expect(within(table).getByText('Then Synapse Standard')).toBeInTheDocument();
    expect(within(table).getByText('Renewal stopped')).toBeInTheDocument();
    const last = () => api.find('GET', SUBS).at(-1)?.query;

    await user.click(screen.getByRole('tab', { name: 'Expiring in 30 days' }));
    await waitFor(() => expect(last()?.get('expiring_within')).toBe('30'));
    expect(router.state.location.search).toEqual({ view: 'expiring' });

    await user.click(screen.getByRole('tab', { name: 'Scheduled downgrades' }));
    await waitFor(() => expect(last()?.get('scheduled')).toBe('1'));
    expect(last()?.get('expiring_within')).toBeNull();

    await user.click(screen.getByRole('tab', { name: 'Stopped renewal' }));
    await waitFor(() => expect(last()?.get('auto_renew')).toBe('false'));

    await user.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'active');
    await waitFor(() => expect(last()?.get('status')).toBe('active'));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Package' }), 'pkg-all');
    await waitFor(() => expect(last()?.get('package')).toBe('pkg-all'));
  });

  it('stops and resumes renewal after confirming', async () => {
    const user = userEvent.setup();
    const { api } = renderApp(
      '/subscriptions',
      base({
        [`POST ${SUBS}sub-1/stop-renewal/`]: { ...suiteSubscription, auto_renew: false },
        [`POST ${SUBS}sub-2/resume-renewal/`]: { ...stopped, auto_renew: true },
      }),
    );
    await user.click(await screen.findByRole('button', { name: 'Actions for BdREN AI Suite, Sylhet Agricultural University' }));
    await user.click(screen.getByRole('menuitem', { name: 'Stop renewal' }));
    const stop = await screen.findByRole('dialog', { name: 'Stop renewal' });
    expect(within(stop).getByText(/is not renewed/)).toBeInTheDocument();
    await user.click(within(stop).getByRole('button', { name: 'Stop renewal' }));
    await waitFor(() => expect(api.find('POST', `${SUBS}sub-1/stop-renewal/`)).toHaveLength(1));
    expect(await screen.findByText('Renewal stopped.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Actions for BdREN AI Suite, BUET' }));
    expect(screen.queryByRole('menuitem', { name: 'Stop renewal' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('menuitem', { name: 'Resume renewal' }));
    const resume = await screen.findByRole('dialog', { name: 'Resume renewal' });
    await user.click(within(resume).getByRole('button', { name: 'Resume renewal' }));
    await waitFor(() => expect(api.find('POST', `${SUBS}sub-2/resume-renewal/`)).toHaveLength(1));
  });

  it('cancels a scheduled downgrade', async () => {
    const user = userEvent.setup();
    const { api } = renderApp('/subscriptions', base({ [`POST ${SUBS}sub-3/cancel-scheduled-change/`]: { ...downgrading, scheduled_package: null } }));
    await user.click(await screen.findByRole('button', { name: 'Actions for BdREN AI Suite, Khulna University' }));
    await user.click(screen.getByRole('menuitem', { name: 'Cancel scheduled change' }));
    const dialog = await screen.findByRole('dialog', { name: 'Cancel scheduled change' });
    expect(within(dialog).getByText(/instead of moving to Synapse Standard/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel change' }));
    await waitFor(() => expect(api.find('POST', `${SUBS}sub-3/cancel-scheduled-change/`)).toHaveLength(1));
    expect(await screen.findByText('Scheduled change cancelled.')).toBeInTheDocument();
  });

  it('records a payment for the row institution', async () => {
    const user = userEvent.setup();
    const { api } = renderApp(
      '/subscriptions',
      base({
        [`GET ${API}/institutions/sau/billing/`]: { subscriptions: [suiteSubscription], payments: [] },
        [`GET ${API}/billing/quote/`]: quote,
      }),
    );
    await user.click(await screen.findByRole('button', { name: 'Actions for BdREN AI Suite, Sylhet Agricultural University' }));
    await user.click(screen.getByRole('menuitem', { name: 'Record payment' }));
    const dialog = await screen.findByRole('dialog', { name: 'Record payment' });
    expect(within(dialog).getByText('Sylhet Agricultural University')).toBeInTheDocument();
    await waitFor(() => expect(within(dialog).getByLabelText(/^Amount/)).toHaveValue('4500.00'));
    expect(api.find('GET', `${API}/billing/quote/`).at(-1)?.query.get('institution')).toBe('sau');
  });
});

describe('Institution Billing tab', () => {
  const routes: Routes = {
    [`GET ${API}/institutions/dhaka-university/`]: institutionDetail,
    [`GET ${API}/institutions/dhaka-university/billing/`]: {
      subscriptions: [{ ...suiteSubscription, institution: { slug: 'dhaka-university', name: 'Dhaka University' } }],
      payments: [bkashPayment, pendingManual],
    },
    [`GET ${API}/config/packages/`]: page([bundleRow, synapseRow]),
    [`GET ${API}/billing/quote/`]: quote,
    [`GET ${API}/billing/payments/pay-1/`]: bkashPayment,
  };

  it('shows the institution subscriptions and payments and opens a payment', async () => {
    const user = userEvent.setup();
    renderApp('/institutions/dhaka-university?tab=billing', routes);
    expect(await screen.findByRole('tab', { name: 'Billing' })).toHaveAttribute('aria-selected', 'true');
    const subs = await screen.findByRole('table', { name: 'Subscriptions of Dhaka University' });
    expect(within(subs).getByText('BdREN AI Suite')).toBeInTheDocument();
    const payments = screen.getByRole('table', { name: 'Payments of Dhaka University' });
    expect(within(payments).getByText('SONALI-7781')).toBeInTheDocument();
    await user.click(within(payments).getByRole('row', { name: /BDR-2026-000012/ }));
    expect(await screen.findByRole('dialog', { name: 'Payment BDR-2026-000012' })).toBeInTheDocument();
  });

  it('records a payment with the institution already picked', async () => {
    const user = userEvent.setup();
    const { api } = renderApp('/institutions/dhaka-university?tab=billing', routes);
    const card = await screen.findByRole('region', { name: 'Subscriptions' });
    await user.click(within(card).getByRole('button', { name: 'Record payment' }));
    const dialog = await screen.findByRole('dialog', { name: 'Record payment' });
    expect(within(dialog).getByRole('button', { name: 'Change institution (Dhaka University)' })).toBeInTheDocument();
    await waitFor(() => expect(within(dialog).getByLabelText(/^Amount/)).toHaveValue('4500.00'));
    expect(api.find('GET', `${API}/billing/quote/`).at(-1)?.query.get('institution')).toBe('dhaka-university');
  });
});
