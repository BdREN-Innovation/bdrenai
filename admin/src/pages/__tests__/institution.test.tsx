import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Member } from '@/api/types';
import type { MockRequest } from '@/test/api';
import { API, auditEntry, institutionDetail, page } from '@/test/fixtures';
import { renderApp } from '@/test/render';
import { reply } from '@/test/api';

const DETAIL = `GET ${API}/institutions/dhaka-university/`;

const pendingMember: Member = {
  membership_id: 'm-7',
  user: { id: 'u-7', name: 'Nadia Islam', email: 'nadia@du.ac.bd', status: 'active' },
  role: 'member',
  status: 'pending',
  joined_at: null,
};

describe('InstitutionDetailPage', () => {
  it('shows seats, counts, admins and details on the overview', async () => {
    renderApp('/institutions/dhaka-university', { [DETAIL]: institutionDetail });
    expect(await screen.findByRole('heading', { level: 1, name: 'Dhaka University' })).toBeInTheDocument();
    expect(screen.getByRole('meter', { name: 'Seats' })).toHaveAttribute('aria-valuetext', '95 of 100 seats used');
    expect(screen.getByText('Last cap change: Initial package')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Revoke admin role from Rahim Uddin' })).toBeInTheDocument();
    expect(screen.getByText('du.ac.bd')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
  });

  it('shows not found for an unknown slug', async () => {
    renderApp('/institutions/nope', { [`GET ${API}/institutions/nope/`]: reply(404, { error: 'not_found' }) });
    expect(await screen.findByRole('heading', { name: 'Institution not found' })).toBeInTheDocument();
  });

  it('requires a reason when the seat cap changes and sends only changed fields', async () => {
    const user = userEvent.setup();
    const { api } = renderApp('/institutions/dhaka-university', {
      [DETAIL]: institutionDetail,
      [`PATCH ${API}/institutions/dhaka-university/`]: { ...institutionDetail, seats: { used: 95, cap: 90 }, warning: 'over_cap' },
    });
    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit Dhaka University' });
    await user.clear(within(dialog).getByLabelText('Seat cap'));
    await user.type(within(dialog).getByLabelText('Seat cap'), '90');
    expect(within(dialog).getByText(/below the 95 seats in use/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    expect(within(dialog).getByText('Give a reason for changing the seat cap.')).toBeInTheDocument();
    expect(api.find('PATCH', `${API}/institutions/dhaka-university/`)).toHaveLength(0);

    await user.type(within(dialog).getByLabelText(/Reason/), 'Package downgrade');
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(api.find('PATCH', `${API}/institutions/dhaka-university/`)[0]?.body).toEqual({ seat_cap: 90, reason: 'Package downgrade' }),
    );
    expect(await screen.findByText(/New invites are blocked until seats are freed/)).toBeInTheDocument();
  });

  it('approves a pending sign-up request from the members tab', async () => {
    const user = userEvent.setup();
    const { api } = renderApp('/institutions/dhaka-university?tab=members', {
      [DETAIL]: institutionDetail,
      [`GET ${API}/institutions/dhaka-university/members/`]: page([pendingMember]),
      [`PATCH ${API}/memberships/m-7/`]: { ...pendingMember, status: 'active' },
    });
    await user.click(await screen.findByRole('button', { name: 'Actions for Nadia Islam' }));
    await user.click(screen.getByRole('menuitem', { name: 'Approve request' }));
    const dialog = await screen.findByRole('dialog', { name: 'Approve sign-up request' });
    await user.click(within(dialog).getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(api.find('PATCH', `${API}/memberships/m-7/`)[0]?.body).toEqual({ status: 'active' }));
  });

  it('offers to force a change that would leave no admin', async () => {
    const user = userEvent.setup();
    const { api } = renderApp('/institutions/dhaka-university', {
      [DETAIL]: institutionDetail,
      [`PATCH ${API}/memberships/m-1/`]: (request: MockRequest) =>
        (request.body as { force?: boolean }).force ? { ok: true } : reply(409, { error: 'last_admin', message: 'Last admin' }),
    });
    await user.click(await screen.findByRole('button', { name: 'Revoke admin role from Rahim Uddin' }));
    const dialog = await screen.findByRole('dialog', { name: 'Revoke admin role' });
    await user.click(within(dialog).getByRole('button', { name: 'Revoke' }));
    await user.click(await within(dialog).findByRole('checkbox', { name: /Do it anyway/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Revoke anyway' }));
    await waitFor(() => expect(api.find('PATCH', `${API}/memberships/m-1/`)).toHaveLength(2));
    expect(api.find('PATCH', `${API}/memberships/m-1/`)[1].body).toEqual({ role: 'member', force: true });
  });

  it('previews a pasted CSV with a dry run, then imports the rows that fit', async () => {
    const user = userEvent.setup();
    const { api } = renderApp('/institutions/dhaka-university?tab=import', {
      [DETAIL]: institutionDetail,
      [`POST ${API}/institutions/dhaka-university/import/`]: (request: MockRequest) => {
        const dryRun = (request.body as { dry_run: boolean }).dry_run;
        return {
          rows: [
            { index: 0, email: 'a@du.ac.bd', status: 'ok' },
            { index: 1, email: 'bad', status: 'error', reason: 'invalid_email' },
          ],
          summary: { ok: 1, error: 1, skip: 0, fits: 1, seats: { used: 95, cap: 100 } },
          created: dryRun ? 0 : 1,
          email_failures: 0,
        };
      },
    });

    const textarea = await screen.findByLabelText('CSV rows');
    await user.click(textarea);
    await user.paste('email,name\na@du.ac.bd,Anika\nbad,Bad Row');
    await user.click(screen.getByRole('button', { name: 'Preview import' }));

    expect(await screen.findByRole('heading', { name: 'Check the import' })).toBeInTheDocument();
    expect(screen.getByText('Invalid email')).toBeInTheDocument();
    expect(api.find('POST', `${API}/institutions/dhaka-university/import/`)[0].body).toEqual({
      rows: [
        { email: 'a@du.ac.bd', name: 'Anika', role: 'member' },
        { email: 'bad', name: 'Bad Row', role: 'member' },
      ],
      dry_run: true,
    });

    await user.click(screen.getByRole('button', { name: 'Invite 1 person' }));
    expect(await screen.findByRole('heading', { name: 'Import finished' })).toBeInTheDocument();
    expect(api.find('POST', `${API}/institutions/dhaka-university/import/`)[1].body).toMatchObject({ dry_run: false });
  });

  it('lists history entries and opens one with its metadata', async () => {
    const user = userEvent.setup();
    renderApp('/institutions/dhaka-university?tab=history', {
      [DETAIL]: institutionDetail,
      [`GET ${API}/institutions/dhaka-university/history/`]: page([auditEntry]),
    });
    await user.click(await screen.findByRole('row', { name: /Organization suspend by Boss Admin/ }));
    const drawer = await screen.findByRole('dialog', { name: 'Organization suspend' });
    expect(within(drawer).getByText(/"reason": "Unpaid invoice"/)).toBeInTheDocument();
    expect(within(drawer).getByText('10.0.0.5')).toBeInTheDocument();
  });
});
