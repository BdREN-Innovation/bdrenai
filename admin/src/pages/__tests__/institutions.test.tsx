import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MockRequest } from '@/test/api';
import { API, institutionDetail, institutionItem, page } from '@/test/fixtures';
import { renderApp } from '@/test/render';
import { reply } from '@/test/api';

const list = (request: MockRequest) =>
  request.query.get('q') === 'nothing' ? page([]) : page([institutionItem, { ...institutionItem, id: 'org-2', slug: 'buet', name: 'BUET', seats: { used: 3, cap: null }, admins: [] }]);

describe('InstitutionsPage', () => {
  it('lists institutions and searches on the server', async () => {
    const user = userEvent.setup();
    const { api } = renderApp('/institutions', { [`GET ${API}/institutions/`]: list });

    await screen.findByText('Rahim Uddin');
    const table = screen.getByRole('table', { name: 'Institutions' });
    expect(within(table).getByRole('link', { name: 'Dhaka University' })).toHaveAttribute('href', '/admin/institutions/dhaka-university');
    expect(within(table).getByText('None yet')).toBeInTheDocument();
    expect(within(table).getByText('3 · no cap')).toBeInTheDocument();

    await user.type(screen.getByRole('searchbox', { name: 'Search institutions' }), 'nothing');
    expect(await screen.findByText('No institutions match these filters.')).toBeInTheDocument();
    expect(api.find('GET', `${API}/institutions/`).at(-1)?.query.get('q')).toBe('nothing');
  });

  it('removes an institution only after its exact name is typed', async () => {
    const user = userEvent.setup();
    const { api } = renderApp('/institutions', {
      [`GET ${API}/institutions/`]: list,
      [`POST ${API}/institutions/dhaka-university/deactivate/`]: { ...institutionDetail, status: 'deactivated' },
    });

    await user.click(await screen.findByRole('button', { name: 'Actions for Dhaka University' }));
    await user.click(screen.getByRole('menuitem', { name: 'Remove' }));
    const dialog = await screen.findByRole('dialog', { name: 'Remove institution' });
    const confirm = within(dialog).getByRole('button', { name: 'Remove institution' });

    await user.type(within(dialog).getByLabelText(/Reason/), 'Contract ended');
    await user.type(within(dialog).getByLabelText(/Type "Dhaka University" to confirm/), 'Dhaka');
    expect(confirm).toBeDisabled();
    await user.type(within(dialog).getByLabelText(/Type "Dhaka University" to confirm/), ' University');
    expect(confirm).toBeEnabled();
    await user.click(confirm);

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(api.find('POST', `${API}/institutions/dhaka-university/deactivate/`)[0].body).toEqual({
      reason: 'Contract ended',
      confirm: 'Dhaka University',
    });
    expect(await screen.findByText('Dhaka University removed.')).toBeInTheDocument();
  });

  it('creates an institution with an initial admin and opens it', async () => {
    const user = userEvent.setup();
    const { api, router } = renderApp('/institutions', {
      [`GET ${API}/institutions/`]: page([]),
      [`POST ${API}/institutions/`]: reply(201, {
        institution: { ...institutionDetail, slug: 'north-south-university', name: 'North South University' },
        invitation: { id: 'inv-9', email: 'admin@nsu.edu' },
        email_sent: false,
      }),
      [`GET ${API}/institutions/north-south-university/`]: { ...institutionDetail, slug: 'north-south-university', name: 'North South University' },
    });

    await user.click((await screen.findAllByRole('button', { name: 'Create institution' }))[0]);
    const dialog = await screen.findByRole('dialog', { name: 'Create institution' });
    await user.type(within(dialog).getByRole('combobox', { name: /Institution name/ }), 'North South University');
    expect(within(dialog).getByLabelText(/Slug/)).toHaveValue('north-south-university');
    await user.type(within(dialog).getByLabelText('Sign-in domains'), 'nsu.edu');
    await user.type(within(dialog).getByLabelText('Seat cap'), '0');
    await user.click(within(dialog).getByRole('button', { name: 'Create institution' }));
    expect(within(dialog).getByText(/whole number of at least 1/)).toBeInTheDocument();
    expect(api.find('POST', `${API}/institutions/`)).toHaveLength(0);

    await user.clear(within(dialog).getByLabelText('Seat cap'));
    await user.type(within(dialog).getByLabelText('Seat cap'), '200');
    await user.type(within(dialog).getByLabelText('Admin email'), 'admin@nsu.edu');
    await user.type(within(dialog).getByLabelText('Admin name'), 'NSU Admin');
    await user.click(within(dialog).getByRole('button', { name: 'Create institution' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/institutions/north-south-university'));
    expect(api.find('POST', `${API}/institutions/`)[0].body).toEqual({
      name: 'North South University',
      slug: 'north-south-university',
      type: 'university',
      sector: '',
      timezone: 'Asia/Dhaka',
      contact_email: '',
      sign_in_domains: ['nsu.edu'],
      seat_cap: 200,
      admin: { email: 'admin@nsu.edu', name: 'NSU Admin' },
    });
    expect(await screen.findByText(/could not be sent/)).toBeInTheDocument();
  });

  it('fills the form from a BdREN member picked in the name search', async () => {
    const user = userEvent.setup();
    const buet = {
      name: 'Bangladesh University of Engineering & Technology',
      short_name: 'BUET',
      sector: 'public',
      suggested_slug: 'buet',
      offices: [],
    };
    const { api } = renderApp('/institutions', {
      [`GET ${API}/institutions/`]: page([]),
      [`GET ${API}/institutions/directory/`]: (request: MockRequest) => ({ results: request.query.get('q') ? [buet] : [] }),
      [`POST ${API}/institutions/`]: reply(201, { institution: { ...institutionDetail, slug: 'buet' }, invitation: null, email_sent: false }),
    });
    await user.click((await screen.findAllByRole('button', { name: 'Create institution' }))[0]);
    const dialog = await screen.findByRole('dialog', { name: 'Create institution' });
    await user.type(within(dialog).getByRole('combobox', { name: /Institution name/ }), 'bue');
    await user.click(await within(dialog).findByRole('option', { name: /Bangladesh University of Engineering/ }));
    expect(within(dialog).getByRole('combobox', { name: /Institution name/ })).toHaveValue(buet.name);
    expect(within(dialog).getByLabelText(/Slug/)).toHaveValue('buet');
    expect(within(dialog).getByLabelText('Sector')).toHaveValue('public');
    await user.click(within(dialog).getByRole('button', { name: 'Create institution' }));
    await waitFor(() => expect(api.find('POST', `${API}/institutions/`)).toHaveLength(1));
    expect(api.find('POST', `${API}/institutions/`)[0].body).toMatchObject({
      name: buet.name,
      slug: 'buet',
      type: 'university',
      sector: 'public',
    });
  });

  it('shows a slug conflict from the server next to the slug field', async () => {
    const user = userEvent.setup();
    renderApp('/institutions', {
      [`GET ${API}/institutions/`]: page([institutionItem]),
      [`POST ${API}/institutions/`]: reply(409, { error: 'slug_taken', message: 'Slug taken', fields: { slug: 'Already used.' } }),
    });
    await user.click(await screen.findByRole('button', { name: 'Create institution' }));
    const dialog = await screen.findByRole('dialog', { name: 'Create institution' });
    await user.type(within(dialog).getByRole('combobox', { name: /Institution name/ }), 'Dhaka University');
    await user.click(within(dialog).getByRole('button', { name: 'Create institution' }));
    expect(await within(dialog).findByText('Already used.')).toBeInTheDocument();
    expect(within(dialog).getByRole('alert')).toHaveTextContent('That slug is already used by another institution.');
  });
});
