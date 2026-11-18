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
