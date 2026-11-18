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
  coverage: 'none',
  label: null,
  joined_at: null,
};

const coveredMember: Member = {
  membership_id: 'm-8',
  user: { id: 'u-8', name: 'Farhan Hossain', email: 'farhan@du.ac.bd', status: 'active' },
  role: 'member',
  status: 'active',
  coverage: 'institution',
  label: 'covered',
  joined_at: '2026-10-05T00:00:00Z',
};

const personalPlanMember: Member = {
  ...coveredMember,
  membership_id: 'm-9',
  user: { id: 'u-9', name: 'Tania Akter', email: 'tania@gmail.com', status: 'active' },
  coverage: 'none',
  label: 'personal_plan',
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
    expect(screen.getByText('Not covered').previousElementSibling).toHaveTextContent('3');
    expect(screen.getByText('Personal plan').previousElementSibling).toHaveTextContent('1');
  });

  it('shows each member\'s coverage and filters by it', async () => {
    const user = userEvent.setup();
    const { api } = renderApp('/institutions/dhaka-university?tab=members', {
      [DETAIL]: institutionDetail,
      [`GET ${API}/institutions/dhaka-university/members/`]: page([coveredMember, personalPlanMember, pendingMember]),
    });
    const table = await screen.findByRole('table', { name: 'Members of Dhaka University' });
    const coveredRow = (await within(table).findByText('Farhan Hossain')).closest('tr') as HTMLElement;
    expect(within(coveredRow).getByText('Covered')).toBeInTheDocument();
    const personalRow = within(table).getByText('Tania Akter').closest('tr') as HTMLElement;
    expect(within(personalRow).getByText('Personal plan')).toBeInTheDocument();

    await user.selectOptions(screen.getByRole('combobox', { name: 'Coverage' }), 'not_covered');
    await waitFor(() =>
      expect(api.find('GET', `${API}/institutions/dhaka-university/members/`).at(-1)?.query.get('label')).toBe('not_covered'),
    );
  });

  it('offers suspend and make admin only to members on the package', async () => {
    const user = userEvent.setup();
    const notCovered: Member = { ...coveredMember, membership_id: 'm-10', user: { ...coveredMember.user, id: 'u-10', name: 'Rina Das' }, coverage: 'none', label: 'not_covered' };
    renderApp('/institutions/dhaka-university?tab=members', {
      [DETAIL]: institutionDetail,
      [`GET ${API}/institutions/dhaka-university/members/`]: page([coveredMember, notCovered]),
    });
    await user.click(await screen.findByRole('button', { name: 'Actions for Farhan Hossain' }));
    expect(screen.getByRole('menuitem', { name: 'Suspend' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Make admin' })).toBeInTheDocument();
    await user.keyboard('{Escape}');

    await user.click(screen.getByRole('button', { name: 'Actions for Rina Das' }));
    expect(screen.queryByRole('menuitem', { name: 'Suspend' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Make admin' })).not.toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Take out of institution' })).toBeInTheDocument();
  });

  it('takes a member out of the institution, saying what that means', async () => {
    const user = userEvent.setup();
    const { api } = renderApp('/institutions/dhaka-university?tab=members', {
      [DETAIL]: institutionDetail,
      [`GET ${API}/institutions/dhaka-university/members/`]: page([coveredMember]),
      [`POST ${API}/memberships/m-8/remove/`]: { ...coveredMember, status: 'deprovisioned', label: null },
    });
    await user.click(await screen.findByRole('button', { name: 'Actions for Farhan Hossain' }));
    await user.click(screen.getByRole('menuitem', { name: 'Take out of institution' }));
    const dialog = await screen.findByRole('dialog', { name: 'Take out of institution' });
    expect(within(dialog).getByText(/stops belonging to Dhaka University/)).toBeInTheDocument();
    expect(within(dialog).getByText(/can join another institution/)).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText(/Reason/), 'Wrong institution');
    await user.click(within(dialog).getByRole('button', { name: 'Take out' }));
    await waitFor(() => expect(api.find('POST', `${API}/memberships/m-8/remove/`)[0]?.body).toEqual({ reason: 'Wrong institution' }));
    expect(await screen.findByText('Farhan Hossain is no longer part of Dhaka University.')).toBeInTheDocument();
  });

  it('shows a sign-in domain held by another institution when editing', async () => {
    const user = userEvent.setup();
    renderApp('/institutions/dhaka-university', {
      [DETAIL]: institutionDetail,
      [`PATCH ${API}/institutions/dhaka-university/`]: reply(409, {
        error: 'domain_taken',
        message: 'A sign-in domain can belong to one institution only.',
        fields: { sign_in_domains: 'buet.ac.bd belongs to BUET.' },
        conflicts: [{ domain: 'buet.ac.bd', institution: { slug: 'buet', name: 'BUET' } }],
      }),
    });
    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit Dhaka University' });
    const domains = within(dialog).getByLabelText(/Sign-in domains/);
    await user.clear(domains);
    await user.type(domains, 'du.ac.bd, buet.ac.bd');
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    expect(await within(dialog).findByText('buet.ac.bd belongs to BUET.')).toBeInTheDocument();
    expect(within(dialog).getByRole('alert')).toHaveTextContent('buet.ac.bd already belongs to BUET.');
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
            { index: 0, email: 'a@du.ac.bd', status: 'ok', action: 'invite' },
            { index: 1, email: 'bad', status: 'error', reason: 'invalid_email', action: null },
            { index: 2, email: 'n@du.ac.bd', status: 'ok', action: 'cover' },
            { index: 3, email: 'x@nsu.edu.bd', status: 'skip', reason: 'member_of_other_institution', action: null },
          ],
          summary: { ok: 2, error: 1, skip: 1, fits: 2, actions: { invite: 1, cover: 1, consent_invite: 0 }, seats: { used: 95, cap: 100 } },
          created: dryRun ? 0 : 1,
          covered: dryRun ? 0 : 1,
          email_failures: 0,
        };
      },
    });

    const textarea = await screen.findByLabelText('CSV rows');
    await user.click(textarea);
    await user.paste('email,name\na@du.ac.bd,Anika\nbad,Bad Row\nn@du.ac.bd,Nusrat\nx@nsu.edu.bd,Other');
    await user.click(screen.getByRole('button', { name: 'Preview import' }));

    expect(await screen.findByRole('heading', { name: 'Check the import' })).toBeInTheDocument();
    expect(screen.getByText('Invalid email')).toBeInTheDocument();
    expect(screen.getByText('Add to package now')).toBeInTheDocument();
    expect(screen.getByText('Belongs to another institution')).toBeInTheDocument();
    expect(api.find('POST', `${API}/institutions/dhaka-university/import/`)[0].body).toEqual({
      rows: [
        { email: 'a@du.ac.bd', name: 'Anika', role: 'member' },
        { email: 'bad', name: 'Bad Row', role: 'member' },
        { email: 'n@du.ac.bd', name: 'Nusrat', role: 'member' },
        { email: 'x@nsu.edu.bd', name: 'Other', role: 'member' },
      ],
      dry_run: true,
    });

    await user.click(screen.getByRole('button', { name: 'Import 2 people' }));
    expect(await screen.findByRole('heading', { name: 'Import finished' })).toBeInTheDocument();
    expect(screen.getAllByText(/1 invitations created, 1 existing members added to the package\./).length).toBeGreaterThan(0);
    expect(api.find('POST', `${API}/institutions/dhaka-university/import/`)[1].body).toMatchObject({ dry_run: false });
  });

  it('marks the ready rows that will not fit under the seat cap in the preview', async () => {
    const user = userEvent.setup();
    renderApp('/institutions/dhaka-university?tab=import', {
      [DETAIL]: institutionDetail,
      [`POST ${API}/institutions/dhaka-university/import/`]: {
        rows: [
          { index: 0, email: 'a@du.ac.bd', status: 'ok', reason: null, action: 'invite' },
          { index: 1, email: 'b@du.ac.bd', status: 'ok', reason: 'over_cap', action: 'invite' },
        ],
        summary: { ok: 2, error: 0, skip: 0, fits: 1, actions: { invite: 2, cover: 0, consent_invite: 0 }, seats: { used: 99, cap: 100 } },
        created: 0,
        covered: 0,
        email_failures: 0,
        email_queued: 0,
      },
    });
    await user.click(await screen.findByLabelText('CSV rows'));
    await user.paste('a@du.ac.bd\nb@du.ac.bd');
    await user.click(screen.getByRole('button', { name: 'Preview import' }));
    const table = await screen.findByRole('table', { name: 'Import rows' });
    const over = within(table).getByText('b@du.ac.bd').closest('tr') as HTMLElement;
    expect(within(over).getByText("Won't fit")).toBeInTheDocument();
    expect(within(over).getByText('Over the seat cap')).toBeInTheDocument();
    expect(within(over).queryByText('Invite')).not.toBeInTheDocument();
    const fits = within(table).getByText('a@du.ac.bd').closest('tr') as HTMLElement;
    expect(within(fits).getByText('Ready')).toBeInTheDocument();
    expect(screen.getByText(/rows marked “Won't fit” below will not be imported/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import 1 person' })).toBeEnabled();
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
