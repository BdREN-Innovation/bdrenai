import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { UserDetail } from '@/api/types';
import { API, auditEntry, page, user as listedUser } from '@/test/fixtures';
import { renderApp } from '@/test/render';
import { reply } from '@/test/api';

const detail: UserDetail = {
  ...listedUser,
  zitadel_subject: '298374982374',
  issuer: 'https://id.bdren.ai',
  external_identities: [],
  recent_activity: [auditEntry],
};

describe('UsersPage', () => {
  it('filters by status tab and opens a user in the drawer', async () => {
    const user = userEvent.setup();
    const { api } = renderApp('/users', {
      [`GET ${API}/users/`]: page([listedUser]),
      [`GET ${API}/users/u-2/`]: detail,
    });

    await user.click(await screen.findByRole('tab', { name: 'Suspended' }));
    await waitFor(() => expect(api.find('GET', `${API}/users/`).at(-1)?.query.get('status')).toBe('suspended'));

    await user.click(await screen.findByRole('row', { name: 'Open Rahim Uddin' }));
    const drawer = await screen.findByRole('dialog', { name: 'Rahim Uddin' });
    expect(await within(drawer).findByText('298374982374')).toBeInTheDocument();
    expect(within(drawer).getByRole('link', { name: 'Dhaka University' })).toHaveAttribute('href', '/admin/institutions/dhaka-university?tab=members');
    expect(within(drawer).getByText('Organization suspend')).toBeInTheDocument();
    const institution = within(drawer).getByRole('region', { name: 'Institution' });
    expect(within(institution).getByText('Covered')).toBeInTheDocument();
    expect(within(drawer).queryByRole('region', { name: 'Earlier institutions' })).not.toBeInTheDocument();
  });

  it('shows the one current institution with its coverage, and earlier ones apart', async () => {
    const user = userEvent.setup();
    const moved = {
      ...listedUser,
      memberships: [
        { membership_id: 'm-old', institution: { slug: 'buet', name: 'BUET' }, role: 'member' as const, status: 'deprovisioned' as const, coverage: 'institution' as const, label: null },
        { ...listedUser.memberships[0], role: 'member' as const, coverage: 'none' as const, label: 'not_covered' as const },
      ],
    };
    renderApp('/users', {
      [`GET ${API}/users/`]: page([moved]),
      [`GET ${API}/users/u-2/`]: { ...detail, ...moved },
    });
    const row = await screen.findByRole('row', { name: 'Open Rahim Uddin' });
    expect(within(row).getByText('Dhaka University')).toBeInTheDocument();
    expect(within(row).getByText('Not covered')).toBeInTheDocument();
    expect(within(row).queryByText('BUET')).not.toBeInTheDocument();

    await user.click(row);
    const drawer = await screen.findByRole('dialog', { name: 'Rahim Uddin' });
    const current = await within(drawer).findByRole('region', { name: 'Institution' });
    expect(within(current).getByRole('link', { name: 'Dhaka University' })).toBeInTheDocument();
    expect(within(current).getByText('Not covered')).toBeInTheDocument();
    const earlier = within(drawer).getByRole('region', { name: 'Earlier institutions' });
    expect(within(earlier).getByRole('link', { name: 'BUET' })).toBeInTheDocument();
    expect(within(earlier).getByText('Removed')).toBeInTheDocument();
  });

  it('shows a personal-plan member as Personal plan, as the institution Members tab does', async () => {
    const user = userEvent.setup();
    const paying = {
      ...listedUser,
      memberships: [{ ...listedUser.memberships[0], role: 'member' as const, coverage: 'none' as const, label: 'personal_plan' as const }],
    };
    renderApp('/users', {
      [`GET ${API}/users/`]: page([paying]),
      [`GET ${API}/users/u-2/`]: { ...detail, ...paying },
    });
    const row = await screen.findByRole('row', { name: 'Open Rahim Uddin' });
    expect(within(row).getByText('Personal plan')).toBeInTheDocument();
    expect(within(row).queryByText('Not covered')).not.toBeInTheDocument();
    await user.click(row);
    const current = await within(await screen.findByRole('dialog', { name: 'Rahim Uddin' })).findByRole('region', { name: 'Institution' });
    expect(within(current).getByText('Personal plan')).toBeInTheDocument();
  });

  it('opens a row with the keyboard and suspends the account with a reason', async () => {
    const user = userEvent.setup();
    const { api } = renderApp('/users', {
      [`GET ${API}/users/`]: page([listedUser]),
      [`GET ${API}/users/u-2/`]: detail,
      [`PATCH ${API}/users/u-2/`]: { ...detail, status: 'suspended' },
    });
    (await screen.findByRole('row', { name: 'Open Rahim Uddin' })).focus();
    await user.keyboard('{Enter}');
    const drawer = await screen.findByRole('dialog', { name: 'Rahim Uddin' });
    await user.click(await within(drawer).findByRole('button', { name: 'Suspend account' }));
    const confirm = await screen.findByRole('dialog', { name: 'Suspend account' });
    expect(within(confirm).getByRole('button', { name: 'Suspend' })).toBeDisabled();
    await user.type(within(confirm).getByLabelText(/Reason/), 'Compromised account');
    await user.click(within(confirm).getByRole('button', { name: 'Suspend' }));
    await waitFor(() =>
      expect(api.find('PATCH', `${API}/users/u-2/`)[0]?.body).toEqual({ status: 'suspended', reason: 'Compromised account' }),
    );
  });

  it('shows why a self-suspension was refused', async () => {
    const user = userEvent.setup();
    renderApp('/users', {
      [`GET ${API}/users/`]: page([listedUser]),
      [`GET ${API}/users/u-2/`]: detail,
      [`PATCH ${API}/users/u-2/`]: reply(409, { error: 'cannot_suspend_self', message: 'no' }),
    });
    await user.click(await screen.findByRole('row', { name: 'Open Rahim Uddin' }));
    await user.click(await screen.findByRole('button', { name: 'Suspend account' }));
    const confirm = await screen.findByRole('dialog', { name: 'Suspend account' });
    await user.type(within(confirm).getByLabelText(/Reason/), 'test');
    await user.click(within(confirm).getByRole('button', { name: 'Suspend' }));
    expect(await within(confirm).findByText('You cannot suspend your own account.')).toBeInTheDocument();
  });
});
