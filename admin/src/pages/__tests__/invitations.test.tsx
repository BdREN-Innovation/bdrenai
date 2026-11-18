import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MockRequest } from '@/test/api';
import { API, institutionDetail, invitation, page } from '@/test/fixtures';
import { renderApp } from '@/test/render';
import { reply } from '@/test/api';

const options = (request: MockRequest) =>
  (request.query.get('q') ?? '').toLowerCase().startsWith('dhaka')
    ? { results: [{ slug: 'dhaka-university', name: 'Dhaka University', status: 'active', seats: { used: 95, cap: 100 } }] }
    : { results: [] };

describe('InvitationsPage', () => {
  it('filters by status from the URL and lists invitations', async () => {
    const { api } = renderApp('/invitations?status=expired', {
      [`GET ${API}/invitations/`]: page([{ ...invitation, status: 'expired' }]),
    });
    expect(await screen.findByText('karim@du.ac.bd')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Expired' })).toHaveAttribute('aria-selected', 'true');
    expect(api.find('GET', `${API}/invitations/`)[0].query.get('status')).toBe('expired');
    expect(screen.getByRole('button', { name: 'Resend all expired' })).toBeInTheDocument();
  });

  it('invites an admin into an existing institution picked from the search', async () => {
    const user = userEvent.setup();
    const { api } = renderApp('/invitations', {
      [`GET ${API}/invitations/`]: page([]),
      [`GET ${API}/institutions/options/`]: options,
      [`POST ${API}/invitations/`]: reply(201, { invitation, institution: null, email_sent: true }),
    });

    await user.click(await screen.findByRole('button', { name: 'Invite institution admin' }));
    const dialog = await screen.findByRole('dialog', { name: 'Invite institution admin' });
    await user.type(within(dialog).getByRole('combobox', { name: /Institution/ }), 'Dhaka');
    await user.click(await within(dialog).findByRole('option', { name: /^Dhaka University/ }));
    await user.type(within(dialog).getByLabelText(/^Email/), 'karim@du.ac.bd');
    await user.click(within(dialog).getByRole('button', { name: 'Send invitation' }));

    await waitFor(() => expect(api.find('POST', `${API}/invitations/`)).toHaveLength(1));
    expect(api.find('POST', `${API}/invitations/`)[0].body).toEqual({
      institution: 'dhaka-university',
      email: 'karim@du.ac.bd',
      name: '',
      role: 'admin',
    });
    expect(await screen.findByText('Invitation sent to karim@du.ac.bd.')).toBeInTheDocument();
  });

  it('creates a new institution from the picker in the same dialog', async () => {
    const user = userEvent.setup();
    const { api } = renderApp('/invitations', {
      [`GET ${API}/invitations/`]: page([]),
      [`GET ${API}/institutions/options/`]: options,
      [`POST ${API}/invitations/`]: reply(201, {
        invitation: { ...invitation, email: 'head@iub.edu.bd' },
        institution: { ...institutionDetail, slug: 'independent-university', name: 'Independent University' },
        email_sent: true,
        warning: undefined,
      }),
    });

    await user.click(await screen.findByRole('button', { name: 'Invite institution admin' }));
    const dialog = await screen.findByRole('dialog', { name: 'Invite institution admin' });
    await user.type(within(dialog).getByRole('combobox', { name: /Institution/ }), 'Independent University');
    await user.click(await within(dialog).findByRole('option', { name: '+ Create new institution "Independent University"' }));

    const group = within(dialog).getByRole('group', { name: 'New institution' });
    expect(within(group).getByRole('combobox', { name: /Institution name/ })).toHaveValue('Independent University');
    expect(within(group).getByLabelText(/Slug/)).toHaveValue('independent-university');
    await user.type(within(group).getByLabelText('Seat cap'), '50');
    await user.type(within(dialog).getByLabelText(/^Email/), 'head@iub.edu.bd');
    await user.type(within(dialog).getByLabelText(/^Name/), 'Head of IT');
    await user.click(within(dialog).getByRole('button', { name: 'Create and invite' }));

    await waitFor(() => expect(api.find('POST', `${API}/invitations/`)).toHaveLength(1));
    expect(api.find('POST', `${API}/invitations/`)[0].body).toEqual({
      new_institution: {
        name: 'Independent University',
        slug: 'independent-university',
        type: 'university',
        sector: '',
        timezone: 'Asia/Dhaka',
        contact_email: '',
        sign_in_domains: [],
        seat_cap: 50,
      },
      email: 'head@iub.edu.bd',
      name: 'Head of IT',
      role: 'admin',
    });
    expect(await screen.findByText('Independent University created.')).toBeInTheDocument();
  });

  it('picks an institution with the keyboard once the search settles', async () => {
    const user = userEvent.setup();
    renderApp('/invitations', {
      [`GET ${API}/invitations/`]: page([]),
      [`GET ${API}/institutions/options/`]: options,
    });
    await user.click(await screen.findByRole('button', { name: 'Invite institution admin' }));
    const dialog = await screen.findByRole('dialog', { name: 'Invite institution admin' });
    const combobox = within(dialog).getByRole('combobox', { name: /Institution/ });
    await user.type(combobox, 'dhaka');
    const option = await within(dialog).findByRole('option', { name: /^Dhaka University/ });
    expect(option).toHaveAttribute('aria-selected', 'true');
    expect(combobox).toHaveAttribute('aria-activedescendant', option.id);
    await user.keyboard('{ArrowDown}{Enter}');
    expect(within(dialog).getByText('New institution: dhaka')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Change institution (dhaka)' }));
    expect(within(dialog).getByRole('combobox', { name: /Institution/ })).toBeInTheDocument();
  });

  it('invites an individual user with no institution', async () => {
    const user = userEvent.setup();
    const { api } = renderApp('/invitations', {
      [`GET ${API}/invitations/`]: page([]),
      [`POST ${API}/invitations/`]: reply(201, { invitation: { ...invitation, institution: null, email: 'solo@gmail.com' }, institution: null, email_sent: true }),
    });
    await user.click(await screen.findByRole('button', { name: 'Invite individual user' }));
    const dialog = await screen.findByRole('dialog', { name: 'Invite individual user' });
    await user.type(within(dialog).getByLabelText(/^Email/), 'solo@gmail.com');
    await user.click(within(dialog).getByRole('button', { name: 'Send invitation' }));
    await waitFor(() => expect(api.find('POST', `${API}/invitations/`)[0]?.body).toEqual({ institution: null, email: 'solo@gmail.com', name: '' }));
  });

  it('revokes a pending invitation with a reason', async () => {
    const user = userEvent.setup();
    const { api } = renderApp('/invitations', {
      [`GET ${API}/invitations/`]: page([invitation]),
      [`POST ${API}/invitations/inv-1/revoke/`]: { ...invitation, status: 'revoked' },
    });
    await user.click(await screen.findByRole('button', { name: 'Actions for invitation to karim@du.ac.bd' }));
    await user.click(screen.getByRole('menuitem', { name: 'Revoke' }));
    const dialog = await screen.findByRole('dialog', { name: 'Revoke invitation' });
    await user.type(within(dialog).getByLabelText(/Reason/), 'Wrong person');
    await user.click(within(dialog).getByRole('button', { name: 'Revoke invitation' }));
    await waitFor(() => expect(api.find('POST', `${API}/invitations/inv-1/revoke/`)[0]?.body).toEqual({ reason: 'Wrong person' }));
  });
});
