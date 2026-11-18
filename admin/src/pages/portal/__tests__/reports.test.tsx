import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DashboardData, UsageDay, UsageReport, UsageSummary } from '@/features/portal/types';
import type { MockRequest } from '@/test/api';
import { DU, renderPortal } from '@/test/portal';
import { reply } from '@/test/api';

const SUMMARY: UsageSummary = {
  start_day: '2026-11-12',
  end_day: '2026-11-18',
  quantity: 4600,
  requests: 70,
  members_with_usage: 12,
  features_used: 3,
  previous: { start_day: '2026-11-05', end_day: '2026-11-11', quantity: 4000, requests: 80, members_with_usage: 10, features_used: 3 },
  change: { quantity: 15, requests: -12.5, members_with_usage: 20, features_used: null },
};

function days(start: string, n: number): UsageDay[] {
  const first = new Date(`${start}T00:00:00Z`).getTime();
  return Array.from({ length: n }, (_, i) => ({
    day: new Date(first + i * 86_400_000).toISOString().slice(0, 10),
    quantity: (i + 1) * 100,
    requests: i + 1,
    quantity_avg_7d: (i + 1) * 50,
  }));
}

const RAHIM = { user: { id: 'u-1', name: 'Rahim Uddin', email: 'rahim@du.ac.bd' }, membership_id: 'm-1', coverage: 'institution', label: 'covered', quantity: 3200, requests: 40, last_used: '2026-11-18' } as const;
const LEFT = { user: { id: 'u-9', name: 'Old Member', email: 'old@du.ac.bd' }, membership_id: null, coverage: null, label: null, quantity: 50, requests: 1, last_used: '2026-10-30' } as const;

const DASHBOARD: DashboardData = {
  slug: 'du',
  name: 'University of Dhaka',
  seats: { used: 42, cap: 100 },
  counts: { covered_active: 38, covered_suspended: 1, not_covered: 12, personal_plan: 2, pending_invitations: 3, expired_invitations: 1 },
  product: null,
  usage: { range: { start: '2026-11-12', end: '2026-11-18', days: 7, timezone: 'Asia/Dhaka' }, summary: SUMMARY, by_day: days('2026-11-12', 7), top_members: [RAHIM] },
  packages: [
    {
      subscription_id: 's1', product: { slug: 'synapse', name: 'Synapse' }, package: { name: 'Campus', version: 2 }, status: 'active',
      billing_interval: 'yearly', starts_at: '2026-01-01T00:00:00Z', expires_at: '2026-12-01T00:00:00Z', auto_renew: false, days_left: 12, expires_soon: true,
    },
    {
      subscription_id: 's2', product: { slug: 'mindspear', name: 'Mindspear' }, package: { name: 'Campus', version: 1 }, status: 'active',
      billing_interval: 'yearly', starts_at: '2026-01-01T00:00:00Z', expires_at: '2027-06-01T00:00:00Z', auto_renew: true, days_left: 195, expires_soon: false,
    },
  ],
};

function usageReport(start: string, end: string): UsageReport {
  const n = Math.round((Date.parse(end) - Date.parse(start)) / 86_400_000) + 1;
  return {
    range: { start, end, days: n, timezone: 'Asia/Dhaka' },
    product: null,
    summary: { ...SUMMARY, start_day: start, end_day: end },
    by_product: [
      { product_id: 'p1', product_slug: 'synapse', product_name: 'Synapse', quantity: 4400, requests: 60 },
      { product_id: 'p2', product_slug: 'mindspear', product_name: 'Mindspear', quantity: 200, requests: 10 },
    ],
    by_day: days(start, n),
    by_feature: [
      { product_id: 'p1', feature_id: 'f1', product_slug: 'synapse', feature_key: 'tokens', feature_name: 'Tokens', unit: 'tokens', quantity: 4400, requests: 60, share: 0.9565 },
      { product_id: 'p2', feature_id: 'f2', product_slug: 'mindspear', feature_key: 'quizzes', feature_name: 'Quizzes', unit: 'count', quantity: 200, requests: 10, share: 0.0435 },
    ],
    members: { results: [RAHIM, LEFT], total: 120, limit: 50, offset: 0 },
  };
}

const usage = (request: MockRequest) => usageReport(request.query.get('start') ?? '2026-10-20', request.query.get('end') ?? '2026-11-18');

const DOMAINS = { domains: [{ domain: 'du.ac.bd', confirmed_members: 37 }, { domain: 'bracu.ac.bd', confirmed_members: 0 }], confirmed_members: 39, other_domains: 2 };

describe('Dashboard page', () => {
  it("shows seats, covered members and this week's usage against last week", async () => {
    renderPortal('/portal/du/dashboard', { [`GET ${DU}/dashboard/`]: DASHBOARD });
    const seats = await screen.findByRole('group', { name: 'Seats in use' });
    expect(seats).toHaveTextContent('42 / 100');
    expect(seats).toHaveTextContent('58 free');
    expect(screen.getByRole('group', { name: 'Covered members' })).toHaveTextContent('and 1 suspended');
    const week = screen.getByRole('group', { name: 'Usage this week' });
    expect(week).toHaveTextContent('4,600');
    expect(week).toHaveTextContent('up 15% vs the previous 7 days');
    expect(screen.getByRole('group', { name: 'Requests this week' })).toHaveTextContent('down 12.5% vs the previous 7 days');
    const top = screen.getByRole('region', { name: 'Most active members' });
    expect(within(top).getByText('Rahim Uddin')).toBeInTheDocument();
    expect(within(top).getByText('3,200')).toBeInTheDocument();
    expect(within(top).getByRole('link', { name: 'All usage' })).toHaveAttribute('href', '/admin/portal/du/usage');
  });

  it('points to people waiting for the package and to invitations to follow up', async () => {
    renderPortal('/portal/du/dashboard', { [`GET ${DU}/dashboard/`]: DASHBOARD });
    const follow = await screen.findByRole('region', { name: 'To follow up' });
    expect(follow).toHaveTextContent("12 people signed up but aren't on your package yet");
    expect(within(follow).getByRole('link', { name: 'Review' })).toHaveAttribute('href', '/admin/portal/du/members?tab=not_covered');
    expect(within(follow).getByRole('link', { name: 'See invitations' })).toHaveAttribute('href', '/admin/portal/du/members?tab=invited');
    expect(follow).toHaveTextContent('1 invitation expired unused');
    expect(within(follow).getByRole('link', { name: 'Resend' })).toHaveAttribute('href', '/admin/portal/du/members?tab=invited&status=expired');
    expect(follow).toHaveTextContent('2 members pay for a personal plan');
  });

  it('warns about a package that ends soon without renewing', async () => {
    renderPortal('/portal/du/dashboard', { [`GET ${DU}/dashboard/`]: DASHBOARD });
    const packages = await screen.findByRole('region', { name: 'Packages' });
    const synapse = within(packages).getByText('Synapse').closest('li') as HTMLElement;
    expect(within(synapse).getByText('Ends in 12 days (1 Dec 2026)')).toHaveClass('text-danger-fg');
    const mindspear = within(packages).getByText('Mindspear').closest('li') as HTMLElement;
    expect(within(mindspear).getByText(/Renews in 195 days/)).not.toHaveClass('text-danger-fg');
  });

  it('narrows the usage figures to one app', async () => {
    const user = userEvent.setup();
    const { api } = renderPortal('/portal/du/dashboard', { [`GET ${DU}/dashboard/`]: DASHBOARD });
    const app = await screen.findByRole('combobox', { name: 'App' });
    await waitFor(() => expect(within(app).getAllByRole('option').map((o) => o.textContent)).toEqual(['All apps', 'Mindspear', 'Synapse']));
    await user.selectOptions(app, 'synapse');
    await waitFor(() => expect(api.find('GET', `${DU}/dashboard/`).some((call) => call.query.get('product') === 'synapse')).toBe(true));
  });

  it('explains when the institution has no usage yet', async () => {
    renderPortal('/portal/du/dashboard', { [`GET ${DU}/dashboard/`]: { ...DASHBOARD, usage: null, packages: [] } });
    expect(await screen.findByText(/Usage appears here once your institution has a package/)).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Usage this week' })).not.toBeInTheDocument();
    expect(screen.getByText(/Your institution has no active package/)).toBeInTheDocument();
  });
});

describe('Usage page', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-18T06:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const usageCalls = (calls: MockRequest[]) => calls.filter((call) => call.path === `${DU}/usage/`).map((call) => call.query.toString());

  it('loads the last 30 days and switches between presets', async () => {
    const user = userEvent.setup();
    const { api } = renderPortal('/portal/du/usage', { [`GET ${DU}/usage/`]: usage });
    await screen.findByRole('group', { name: 'Usage' });
    expect(usageCalls(api.calls)).toEqual(['start=2026-10-20&end=2026-11-18&limit=50&offset=0']);
    expect(screen.getByRole('button', { name: '30 days' })).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByRole('button', { name: '7 days' }));
    await waitFor(() => expect(usageCalls(api.calls)).toContain('start=2026-11-12&end=2026-11-18&limit=50&offset=0'));
    expect(screen.getByRole('button', { name: '7 days' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'This month' }));
    await waitFor(() => expect(usageCalls(api.calls)).toContain('start=2026-11-01&end=2026-11-18&limit=50&offset=0'));
    await user.click(screen.getByRole('button', { name: 'Last month' }));
    await waitFor(() => expect(usageCalls(api.calls)).toContain('start=2026-10-01&end=2026-10-31&limit=50&offset=0'));
    await waitFor(() => expect(screen.getByRole('group', { name: 'Usage' })).toHaveTextContent('vs the previous 31 days'));
  });

  it('checks a custom period before loading it and keeps the CSV export in step', async () => {
    const user = userEvent.setup();
    const { api } = renderPortal('/portal/du/usage', { [`GET ${DU}/usage/`]: usage });
    await screen.findByRole('group', { name: 'Usage' });
    await user.click(screen.getByRole('button', { name: 'Custom' }));
    const form = screen.getByRole('form', { name: 'Custom period' });
    await user.clear(within(form).getByLabelText('From'));
    await user.type(within(form).getByLabelText('From'), '2026-11-10');
    await user.clear(within(form).getByLabelText('To'));
    await user.type(within(form).getByLabelText('To'), '2026-11-01');
    await user.click(within(form).getByRole('button', { name: 'Apply' }));
    expect(within(form).getByRole('alert')).toHaveTextContent('The start date must not be after the end date.');
    expect(usageCalls(api.calls)).toHaveLength(1);

    await user.clear(within(form).getByLabelText('To'));
    await user.type(within(form).getByLabelText('To'), '2026-11-15');
    await user.click(within(form).getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(usageCalls(api.calls)).toContain('start=2026-11-10&end=2026-11-15&limit=50&offset=0'));
    expect(screen.getByRole('link', { name: 'Export CSV' })).toHaveAttribute('href', `${DU}/usage/export.csv?start=2026-11-10&end=2026-11-15`);
  });

  it('switches app, keeps the export link in step and pages through members', async () => {
    const user = userEvent.setup();
    const { api } = renderPortal('/portal/du/usage', { [`GET ${DU}/usage/`]: usage });
    await screen.findByRole('group', { name: 'Usage' });
    expect(screen.getByRole('link', { name: 'Export CSV' })).toHaveAttribute('href', `${DU}/usage/export.csv?start=2026-10-20&end=2026-11-18`);
    await user.selectOptions(screen.getByRole('combobox', { name: 'App' }), 'mindspear');
    await waitFor(() => expect(usageCalls(api.calls)).toContain('start=2026-10-20&end=2026-11-18&product=mindspear&limit=50&offset=0'));
    expect(screen.getByRole('link', { name: 'Export CSV' })).toHaveAttribute('href', `${DU}/usage/export.csv?start=2026-10-20&end=2026-11-18&product=mindspear`);

    await screen.findByText('Page 1 of 3');
    await user.click(screen.getByRole('button', { name: 'Next page' }));
    await waitFor(() => expect(usageCalls(api.calls)).toContain('start=2026-10-20&end=2026-11-18&product=mindspear&limit=50&offset=50'));
  });

  it('shows features with their share and members with their standing', async () => {
    renderPortal('/portal/du/usage', { [`GET ${DU}/usage/`]: usage });
    const features = await screen.findByRole('table', { name: 'Usage by feature' });
    const tokens = within(features).getByText('Tokens').closest('tr') as HTMLElement;
    expect(tokens).toHaveTextContent('Synapse');
    expect(tokens).toHaveTextContent('95.7%');
    const members = screen.getByRole('table', { name: 'Usage by member, 120 in all' });
    expect(within(within(members).getByText('Rahim Uddin').closest('tr') as HTMLElement).getByText('Covered')).toBeInTheDocument();
    expect(within(within(members).getByText('Old Member').closest('tr') as HTMLElement).getByText('Left the institution')).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Usage by day' })).toBeInTheDocument();
    expect(screen.getByText(/never usage by people on a personal plan/)).toBeInTheDocument();
  });

  it('explains an institution without a usage account', async () => {
    renderPortal('/portal/du/usage', { [`GET ${DU}/usage/`]: reply(404, { error: 'no_usage_account', message: 'No account' }) });
    expect(await screen.findByText(/Your institution has no usage account yet/)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('offers a retry when usage fails to load', async () => {
    const user = userEvent.setup();
    let fail = true;
    renderPortal('/portal/du/usage', { [`GET ${DU}/usage/`]: (request: MockRequest) => (fail ? reply(500, { error: 'server_error' }) : usage(request)) });
    expect(await screen.findByRole('alert')).toHaveTextContent("We couldn't load usage.");
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('group', { name: 'Usage' })).toHaveTextContent('4,600');
  });
});

describe('Email domains page', () => {
  it('lists the domains read-only with their confirmed members', async () => {
    renderPortal('/portal/du/domains', { [`GET ${DU}/domains/`]: DOMAINS });
    const table = await screen.findByRole('table', { name: 'Email domains and their confirmed members' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.map((row) => within(row).getByRole('rowheader').firstChild?.textContent)).toEqual(['du.ac.bd', 'bracu.ac.bd']);
    expect(rows[0]).toHaveTextContent('37');
    expect(within(table).queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText(/2 members use another email domain and joined by invitation/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'See members' })).toHaveAttribute('href', '/admin/portal/du/members');
  });

  it('asks BDREN support for a new domain by email', async () => {
    renderPortal('/portal/du/domains', { [`GET ${DU}/domains/`]: DOMAINS });
    const link = await screen.findByRole('link', { name: 'Request a domain' });
    const href = link.getAttribute('href') ?? '';
    expect(href.startsWith('mailto:noc@bdren.edu.bd?subject=')).toBe(true);
    expect(decodeURIComponent(href)).toContain('Email domain request for University of Dhaka');
  });

  it('explains an institution with no domains', async () => {
    renderPortal('/portal/du/domains', { [`GET ${DU}/domains/`]: { domains: [], confirmed_members: 1, other_domains: 1 } });
    expect(await screen.findByText(/no email domains yet/)).toBeInTheDocument();
  });
});

describe('Help page', () => {
  it('gives the BDREN support email', async () => {
    renderPortal('/portal/du/help');
    const link = await screen.findByRole('link', { name: 'noc@bdren.edu.bd' });
    expect(link.getAttribute('href')?.startsWith('mailto:noc@bdren.edu.bd?subject=')).toBe(true);
  });
});
