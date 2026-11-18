import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DU, adminInstitution, institution, nadia, renderPortal } from '@/test/portal';
import { API, PORTAL } from '@/test/fixtures';
import { renderApp } from '@/test/render';
import { reply } from '@/test/api';

const dashboard = {
  slug: 'du', name: 'University of Dhaka', seats: { used: 142, cap: 200 },
  counts: { covered_active: 138, covered_suspended: 2, not_covered: 12, personal_plan: 3, pending_invitations: 4, expired_invitations: 1 },
  product: null, usage: null, packages: [],
};

const emptyPlatformDashboard = {
  counts: { institutions: 0, active_institutions: 0, users: 0, active_users: 0, pending_invitations: 0, expired_invitations: 0, pending_requests: 0 },
  attention: [],
  recent_institutions: [],
  recent_activity: [],
};

describe('access gate', () => {
  it('opens the platform console for a superadmin', async () => {
    const { router } = renderApp('/', { [`GET ${API}/dashboard/`]: emptyPlatformDashboard });
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { name: 'Institutions' })).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Admin panel' })).toBeInTheDocument();
    expect(within(screen.getByRole('navigation', { name: 'Account' })).queryByRole('link', { name: /Manage|Institution console/ })).not.toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');
  });

  it('lets a superadmin who also administers an institution open its console from the user links', async () => {
    const user = userEvent.setup();
    const { router } = renderApp('/', {
      [`GET ${API}/dashboard/`]: emptyPlatformDashboard,
      [`GET ${PORTAL}/`]: [adminInstitution],
      [`GET ${DU}/`]: institution,
      [`GET ${DU}/dashboard/`]: dashboard,
    });
    const account = await screen.findByRole('navigation', { name: 'Account' });
    await user.click(await within(account).findByRole('link', { name: 'Manage University of Dhaka' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/portal/du/dashboard'));
    expect(await screen.findByRole('complementary', { name: 'Institution admin' })).toBeInTheDocument();
    expect(within(screen.getByRole('navigation', { name: 'Account' })).getByRole('link', { name: 'Platform console' })).toHaveAttribute('href', '/admin/');
  });

  it("tells a superadmin when their institutions didn't load, instead of saying they manage none", async () => {
    const user = userEvent.setup();
    let failing = true;
    const { router } = renderApp('/portal', {
      [`GET ${PORTAL}/`]: () => (failing ? reply(500, { error: 'server_error', message: 'Boom' }) : [adminInstitution]),
      [`GET ${DU}/`]: institution,
      [`GET ${DU}/dashboard/`]: dashboard,
    });
    expect(await screen.findByRole('alert')).toHaveTextContent("We couldn't load the institutions you manage.");
    expect(screen.queryByText("You don't manage an institution")).not.toBeInTheDocument();
    failing = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/portal/du/dashboard'));
  });

  it("offers a retry in the platform sidebar when a superadmin's institutions didn't load", async () => {
    const user = userEvent.setup();
    let failing = true;
    renderApp('/', {
      [`GET ${API}/dashboard/`]: emptyPlatformDashboard,
      [`GET ${PORTAL}/`]: () => (failing ? reply(500, { error: 'server_error', message: 'Boom' }) : [adminInstitution]),
    });
    const account = await screen.findByRole('navigation', { name: 'Account' });
    const retry = await within(account).findByRole('button', { name: "Couldn't load your institutions. Retry" });
    failing = false;
    await user.click(retry);
    expect(await within(account).findByRole('link', { name: 'Manage University of Dhaka' })).toBeInTheDocument();
    expect(within(account).queryByRole('button', { name: /Retry/ })).not.toBeInTheDocument();
  });

  it("won't open the institution console without knowing who is signed in", async () => {
    const user = userEvent.setup();
    let failing = true;
    renderPortal('/portal/du/members', {
      [`GET /api/v1/auth/profile/`]: () => (failing ? reply(500, { error: 'server_error', message: 'Boom' }) : nadia),
    });
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByRole('complementary', { name: 'Institution admin' })).not.toBeInTheDocument();
    failing = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    const sidebar = await screen.findByRole('complementary', { name: 'Institution admin' });
    expect(within(sidebar).getByText('nadia@du.ac.bd')).toBeInTheDocument();
    await screen.findByText('Rahim Uddin');
    expect(within(screen.getByText('Nadia Islam', { selector: 'main *' }).closest('tr') as HTMLElement).getByText('You')).toBeInTheDocument();
  });

  it('sends an institution admin to their institution console', async () => {
    const { router } = renderPortal('/', { [`GET ${DU}/dashboard/`]: dashboard });
    await waitFor(() => expect(router.state.location.pathname).toBe('/portal/du/dashboard'));
    const sidebar = await screen.findByRole('complementary', { name: 'Institution admin' });
    expect(within(sidebar).getByText('University of Dhaka')).toBeInTheDocument();
    const nav = within(sidebar).getByRole('navigation', { name: 'Main' });
    expect(within(nav).getAllByRole('link').map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
      ['Dashboard', '/admin/portal/du/dashboard'],
      ['Usage', '/admin/portal/du/usage'],
      ['Members', '/admin/portal/du/members'],
      ['Email domains', '/admin/portal/du/domains'],
      ['Help', '/admin/portal/du/help'],
    ]);
    expect(within(nav).getByRole('link', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page');
    const account = within(sidebar).getByRole('navigation', { name: 'Account' });
    expect(within(account).getByRole('link', { name: 'BDREN AI website' })).toHaveAttribute('href', '/');
    expect(within(account).queryByRole('link', { name: 'Platform console' })).not.toBeInTheDocument();
    expect(within(sidebar).getByText('nadia@du.ac.bd')).toBeInTheDocument();
  });

  it('keeps an institution admin away from platform pages', async () => {
    const { router, api } = renderPortal('/institutions', { [`GET ${DU}/dashboard/`]: dashboard });
    await waitFor(() => expect(router.state.location.pathname).toBe('/portal/du/dashboard'));
    expect(screen.queryByRole('link', { name: 'Institutions' })).not.toBeInTheDocument();
    expect(screen.queryByRole('complementary', { name: 'Admin panel' })).not.toBeInTheDocument();
    expect(api.calls.filter((call) => call.path.startsWith(API) && call.path !== `${API}/session/`)).toEqual([]);
  });

  it('opens the institution console on the index of /portal/<slug>', async () => {
    const { router } = renderPortal('/portal/du', { [`GET ${DU}/dashboard/`]: dashboard });
    await waitFor(() => expect(router.state.location.pathname).toBe('/portal/du/dashboard'));
  });

  it('lets someone who manages several institutions choose one', async () => {
    const user = userEvent.setup();
    const other = { ...adminInstitution, slug: 'buet', name: 'BUET', status: 'suspended' as const, role: 'owner' as const };
    const { router } = renderPortal('/portal', {
      [`GET ${PORTAL}/`]: [adminInstitution, other],
      [`GET ${PORTAL}/buet/`]: reply(403, { error: 'institution_suspended', message: 'Suspended' }),
    });
    const list = await screen.findByRole('list', { name: 'Institutions you manage' });
    expect(within(list).getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual(['/admin/portal/du/dashboard', '/admin/portal/buet/dashboard']);
    await user.click(within(list).getByRole('link', { name: /BUET/ }));
    expect(await screen.findByRole('heading', { level: 2, name: 'This institution is suspended' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/portal/buet/dashboard');
    expect(within(screen.getByRole('navigation', { name: 'Account' })).getByRole('link', { name: 'Switch institution' })).toHaveAttribute('href', '/admin/portal');
  });

  it('explains an institution the user does not manage', async () => {
    renderPortal('/portal/other/members', { [`GET ${PORTAL}/other/`]: reply(404, { error: 'not_found', message: 'Not found' }) });
    expect(await screen.findByRole('heading', { level: 2, name: 'Institution not found' })).toBeInTheDocument();
  });

  it('shows a no-access page with a way back to the website for anyone else', async () => {
    renderApp('/', {
      [`GET ${API}/session/`]: reply(403, { error: 'not_superadmin', message: 'Forbidden' }),
      [`GET ${PORTAL}/`]: [],
    });
    expect(await screen.findByRole('heading', { name: "You don't have access to the admin console" })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to the BDREN AI website' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument();
  });

  it('sends a signed-out visitor to sign in', async () => {
    const here = 'http://localhost/admin/portal/du/members';
    const assigned: string[] = [];
    vi.stubGlobal('location', {
      get href() {
        return here;
      },
      set href(value: string) {
        assigned.push(value);
      },
    });
    renderApp('/portal/du/members', {
      [`GET ${API}/session/`]: reply(401, { error: 'not_authenticated' }),
      [`GET ${PORTAL}/`]: reply(401, { error: 'not_authenticated' }),
      [`GET /api/v1/auth/profile/`]: reply(401, { error: 'not_authenticated' }),
    });
    expect(await screen.findByText('Redirecting to sign in…')).toBeInTheDocument();
    expect(new Set(assigned)).toEqual(new Set([`/api/v1/auth/login/?next=${encodeURIComponent(here)}`]));
    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument();
  });
});
