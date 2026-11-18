import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { API, auditEntry, page, session } from '@/test/fixtures';
import { renderApp } from '@/test/render';
import { reply } from '@/test/api';

const admins = {
  results: [
    { user: { ...session.user, status: 'active' }, granted_at: '2026-10-01T00:00:00Z' },
    { user: { id: 'u-9', name: 'Second Admin', email: 'second@bdren.ai', status: 'active' }, granted_at: '2026-11-01T00:00:00Z' },
  ],
};

describe('AdminsPage', () => {
  it('does not let you remove yourself, and removes another admin after typing their email', async () => {
    const user = userEvent.setup();
    const { api } = renderApp('/admins', {
      [`GET ${API}/admins/`]: admins,
      [`DELETE ${API}/admins/u-9/`]: reply(204),
    });
    expect(await screen.findByRole('button', { name: 'You cannot remove yourself' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Remove second@bdren.ai as superadmin' }));
    const dialog = await screen.findByRole('dialog', { name: 'Remove superadmin' });
    await user.type(within(dialog).getByLabelText(/to confirm/), 'second@bdren.ai');
    await user.click(within(dialog).getByRole('button', { name: 'Remove superadmin' }));
    await waitFor(() => expect(api.find('DELETE', `${API}/admins/u-9/`)).toHaveLength(1));
  });

  it('adds a superadmin by email and explains an ambiguous match', async () => {
    const user = userEvent.setup();
    const { api } = renderApp('/admins', {
      [`GET ${API}/admins/`]: admins,
      [`POST ${API}/admins/`]: reply(409, { error: 'ambiguous_email', message: 'Ambiguous' }),
    });
    await user.click(await screen.findByRole('button', { name: 'Add superadmin' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add superadmin' });
    await user.type(within(dialog).getByLabelText(/Email/), 'dup@bdren.ai');
    await user.click(within(dialog).getByRole('button', { name: 'Add superadmin' }));
    expect(await within(dialog).findByText(/More than one account uses that email/)).toBeInTheDocument();
    expect(api.find('POST', `${API}/admins/`)[0].body).toEqual({ email: 'dup@bdren.ai' });
  });
});

describe('AuditPage', () => {
  it('filters by fixed action, target type and role lists and shows roles instead of people', async () => {
    const user = userEvent.setup();
    const { api } = renderApp('/audit', {
      [`GET ${API}/audit/`]: page([auditEntry]),
      [`GET ${API}/audit/filters/`]: {
        actions: ['invitation.created', 'organization.suspend'],
        target_types: ['Invitation', 'organization'],
        roles: [
          { value: 'superadmin', label: 'Superadmin' },
          { value: 'institution_admin', label: 'Institution admin' },
          { value: 'user', label: 'User' },
          { value: 'system', label: 'System' },
        ],
      },
    });
    expect(screen.queryByLabelText('Target ID')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Actor user ID')).not.toBeInTheDocument();
    const action = await screen.findByRole('combobox', { name: 'Action' });
    await waitFor(() => expect(within(action).getByRole('option', { name: 'Organization suspend' })).toBeInTheDocument());
    await user.selectOptions(action, 'organization.suspend');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Target type' }), 'organization');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Role' }), 'institution_admin');
    await waitFor(() => {
      const query = api.find('GET', `${API}/audit/`).at(-1)?.query;
      expect([query?.get('action'), query?.get('target_type'), query?.get('role')]).toEqual([
        'organization.suspend', 'organization', 'institution_admin',
      ]);
    });

    expect(screen.getByRole('columnheader', { name: 'Role' })).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Actor' })).not.toBeInTheDocument();
    const row = await screen.findByRole('row', { name: /Organization suspend by Superadmin/ });
    await user.click(row);
    const drawer = await screen.findByRole('dialog', { name: 'Organization suspend' });
    expect(within(drawer).getByText(/"organization_id": "org-1"/)).toBeInTheDocument();
    expect(within(drawer).getByText('Superadmin')).toBeInTheDocument();
  });
});
