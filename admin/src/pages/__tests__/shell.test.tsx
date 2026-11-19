import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { API, institutionItem } from '@/test/fixtures';
import { renderApp } from '@/test/render';
import { reply } from '@/test/api';

const emptyDashboard = {
  counts: { institutions: 0, active_institutions: 0, users: 0, active_users: 0, pending_invitations: 0, expired_invitations: 0, pending_requests: 0 },
  attention: [],
  recent_institutions: [],
  recent_activity: [],
};

describe('app shell', () => {
  it('shows the access-denied page with sign-out for a signed-in non-superadmin', async () => {
    renderApp('/', { [`GET ${API}/session/`]: reply(403, { error: 'not_superadmin', message: 'Forbidden' }) });
    expect(await screen.findByRole('heading', { name: /don't have access/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument();
  });

  it('renders grouped navigation with later-phase pages marked as coming soon', async () => {
    renderApp('/', { [`GET ${API}/dashboard/`]: emptyDashboard });
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { name: 'Institutions' })).toHaveAttribute('href', '/admin/institutions');
    expect(within(nav).getByRole('link', { name: 'Usage (coming soon)' })).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'Billing' })).toHaveAttribute('href', '/admin/billing');
    expect(within(nav).getByRole('link', { name: 'Subscriptions' })).toHaveAttribute('href', '/admin/subscriptions');
    expect(within(nav).getByRole('link', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page');
  });

  it('explains a soon page and which phase brings it', async () => {
    renderApp('/usage');
    expect(await screen.findByRole('heading', { name: 'Usage is coming in Phase 4' })).toBeInTheDocument();
  });

  it('opens the command menu with the keyboard and jumps to an institution found on the server', async () => {
    const user = userEvent.setup();
    const { api, router } = renderApp('/', {
      [`GET ${API}/dashboard/`]: emptyDashboard,
      [`GET ${API}/institutions/options/`]: { results: [{ slug: institutionItem.slug, name: institutionItem.name, status: 'active', seats: institutionItem.seats }] },
      [`GET ${API}/institutions/dhaka-university/`]: reply(404, { error: 'not_found' }),
    });
    await screen.findByRole('navigation', { name: 'Main' });

    await user.keyboard('{Control>}k{/Control}');
    const input = await screen.findByPlaceholderText('Search pages and institutions…');
    await user.type(input, 'dhaka');
    await waitFor(() => expect(api.find('GET', `${API}/institutions/options/`).some((call) => call.query.get('q') === 'dhaka')).toBe(true));
    await user.click(await screen.findByRole('option', { name: /Dhaka University/ }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/institutions/dhaka-university'));
  });
});
