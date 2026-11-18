import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Member } from '@/api/types';
import type { MockRequest } from '@/test/api';
import { DU, institution, invitations, members, membersPage, notCovered, renderPortal, toasts } from '@/test/portal';
import { reply } from '@/test/api';

const covered = { coverage: 'institution', label: 'covered' } as const;
const row = (text: string) => within(screen.getByRole('main')).getByText(text).closest('tr') as HTMLElement;
const tab = (label: string, count: number) => new RegExp(`^${label}\\s*${count}$`);
const membersCalls = (calls: MockRequest[]) => calls.filter((call) => call.path === `${DU}/members/`).map((call) => call.query.toString());
const invitationCalls = (calls: MockRequest[]) => calls.filter((call) => call.path === `${DU}/invitations/` && call.method === 'GET').map((call) => call.query.toString());

async function menuItems(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByRole('button', { name: `Actions for ${name}` }));
  const items = within(screen.getByRole('menu')).getAllByRole('menuitem').map((item) => item.textContent);
  await user.keyboard('{Escape}');
  return items;
}

describe('Members page: Covered', () => {
  it('shows the seats, members and the right row actions', async () => {
    const user = userEvent.setup();
    renderPortal('/portal/du/members');
    expect(await screen.findByText('142 / 200 seats')).toBeInTheDocument();
    expect(screen.getByText(/58 free/)).toBeInTheDocument();
    await screen.findByText('Rahim Uddin');
    expect(within(row('Nadia Islam')).getByText('You')).toBeInTheDocument();
    expect(within(row('Nadia Islam')).queryByRole('button')).not.toBeInTheDocument();
    expect(within(row('Karim Owner')).getByText('Owner', { selector: 'span' })).toBeInTheDocument();
    expect(within(row('Karim Owner')).queryByRole('button')).not.toBeInTheDocument();
    expect(await menuItems(user, 'Rahim Uddin')).toEqual(['Make admin', 'Suspend', 'Remove']);
    expect(await menuItems(user, 'Sadia Khan')).toEqual(['Activate', 'Remove']);
  });

  it('shows unlimited seats when there is no cap', async () => {
    renderPortal('/portal/du/members', { [`GET ${DU}/`]: { ...institution, seats: { used: 12, cap: null } } });
    expect(await screen.findByText('12 seats in use')).toBeInTheDocument();
    expect(screen.getByText('Unlimited seats')).toBeInTheDocument();
  });

  it('changes a role, reactivates a member and removes one from the package after confirming', async () => {
    const user = userEvent.setup();
    const { api } = renderPortal('/portal/du/members', {
      [`PATCH ${DU}/members/m-1/`]: { ...members[2], role: 'admin' },
      [`PATCH ${DU}/members/m-2/`]: { ...members[3], status: 'active' },
      [`POST ${DU}/members/m-1/remove/`]: { ...members[2], coverage: 'none', label: 'not_covered' },
    });
    await screen.findByText('Rahim Uddin');

    await user.click(screen.getByRole('button', { name: 'Actions for Rahim Uddin' }));
    await user.click(screen.getByRole('menuitem', { name: 'Make admin' }));
    await waitFor(() => expect(toasts().getByText('Rahim Uddin is now an admin.')).toBeInTheDocument());
    expect(api.find('PATCH', `${DU}/members/m-1/`)[0]).toMatchObject({ body: { role: 'admin' }, headers: { 'X-CSRFToken': 'test-csrf' } });

    await user.click(screen.getByRole('button', { name: 'Actions for Sadia Khan' }));
    await user.click(screen.getByRole('menuitem', { name: 'Activate' }));
    await waitFor(() => expect(toasts().getByText('Sadia Khan is active again.')).toBeInTheDocument());
    expect(api.find('PATCH', `${DU}/members/m-2/`)[0].body).toEqual({ status: 'active' });

    await user.click(screen.getByRole('button', { name: 'Actions for Rahim Uddin' }));
    await user.click(screen.getByRole('menuitem', { name: 'Remove' }));
    const dialog = await screen.findByRole('dialog', { name: 'Remove Rahim Uddin from your package?' });
    expect(dialog).toHaveTextContent('Loses the institution package and institution knowledge; keeps their account and data');
    expect(api.find('POST', `${DU}/members/m-1/remove/`)).toHaveLength(0);
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(toasts().getByText(/Rahim Uddin is off your package\./)).toBeInTheDocument());
    expect(api.find('POST', `${DU}/members/m-1/remove/`)).toHaveLength(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('keeps the confirmation open with the reason when the server refuses', async () => {
    const user = userEvent.setup();
    renderPortal('/portal/du/members', { [`PATCH ${DU}/members/m-1/`]: reply(409, { error: 'last_admin', message: 'Last admin' }) });
    await screen.findByText('Rahim Uddin');
    await user.click(screen.getByRole('button', { name: 'Actions for Rahim Uddin' }));
    await user.click(screen.getByRole('menuitem', { name: 'Suspend' }));
    const dialog = await screen.findByRole('dialog', { name: 'Suspend Rahim Uddin?' });
    await user.click(within(dialog).getByRole('button', { name: 'Suspend' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Your institution needs at least one active admin');
  });

  it('filters and searches members on the server', async () => {
    const user = userEvent.setup();
    const { api } = renderPortal('/portal/du/members');
    await screen.findByText('Rahim Uddin');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'suspended');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Role' }), 'admin');
    await user.type(screen.getByRole('searchbox', { name: 'Name or email' }), ' rahim ');
    await waitFor(() => expect(membersCalls(api.calls)).toContain('tab=covered&q=rahim&status=suspended&role=admin&page=1&page_size=25'));
  });

  it("shows a covered member's usage per app and what removal means in the side panel", async () => {
    const user = userEvent.setup();
    const report = (quantity: number) => ({
      range: { start: '2026-10-20', end: '2026-11-18', days: 30, timezone: 'Asia/Dhaka' },
      product: null,
      summary: {},
      by_product: ['synapse', 'mindspear'].map((slug) => ({ product_id: `p-${slug}`, product_slug: slug, product_name: slug === 'synapse' ? 'Synapse' : 'Mindspear', quantity: 1, requests: 1 })),
      by_day: [],
      by_feature: [],
      members: {
        results: [{ user: { id: 'u-1', name: 'Rahim Uddin', email: 'rahim@du.ac.bd' }, membership_id: 'm-1', coverage: 'institution', label: 'covered', quantity, requests: 4, last_used: '2026-11-17' }],
        total: 1,
        limit: 200,
        offset: 0,
      },
    });
    const quantities: Record<string, number> = { '': 1500, synapse: 1200, mindspear: 300 };
    const { api } = renderPortal('/portal/du/members', { [`GET ${DU}/usage/`]: (request: MockRequest) => report(quantities[request.query.get('product') ?? '']) });
    await screen.findByText('Rahim Uddin');
    await user.click(screen.getByRole('row', { name: 'Details for Rahim Uddin' }));
    const panel = await screen.findByRole('dialog', { name: 'Rahim Uddin' });
    expect(panel).toHaveTextContent(
      'Loses the institution package and institution knowledge; keeps their account and data and can continue as a free user or buy a personal package.',
    );
    const apps = await within(panel).findByRole('table', { name: 'Usage by app' });
    expect(within(apps).getAllByRole('row').slice(1).map((r) => r.textContent)).toEqual(['Synapse1,2004', 'Mindspear3004']);
    expect(within(panel).getByText('1,500')).toBeInTheDocument();
    expect(api.find('GET', `${DU}/usage/`).map((call) => call.query.toString())).toEqual([
      'limit=200&offset=0',
      'product=synapse&limit=200&offset=0',
      'product=mindspear&limit=200&offset=0',
    ]);

    await user.click(within(panel).getByRole('button', { name: 'Suspend' }));
    expect(await screen.findByRole('dialog', { name: 'Suspend Rahim Uddin?' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Rahim Uddin' })).not.toBeInTheDocument();
  });

  it('tells the admin that their own membership is locked in the side panel', async () => {
    const user = userEvent.setup();
    renderPortal('/portal/du/members', { [`GET ${DU}/usage/`]: reply(404, { error: 'no_usage_account' }) });
    await screen.findByText('Rahim Uddin');
    await user.click(screen.getByRole('row', { name: 'Details for Nadia Islam' }));
    const panel = await screen.findByRole('dialog', { name: 'Nadia Islam' });
    expect(panel).toHaveTextContent("You can't change your own membership.");
    expect(within(panel).queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
    expect(await within(panel).findByText("We couldn't load their usage.")).toBeInTheDocument();
  });
});

describe('Members page: invite and import', () => {
  it('invites a member and shows the seat-cap conflict clearly', async () => {
    const user = userEvent.setup();
    let full = false;
    const { api } = renderPortal('/portal/du/members', {
      [`POST ${DU}/invitations/`]: () =>
        full
          ? reply(409, { error: 'seat_cap_reached', message: 'Seat cap reached', seats_used: 200, seat_cap: 200 })
          : reply(201, { outcome: 'invited', invitation: { ...invitations[0], email: 'new@gmail.com' }, member: null, email_sent: true }),
    });
    await user.click(await screen.findByRole('button', { name: 'Invite member' }));
    const dialog = await screen.findByRole('dialog', { name: 'Invite member' });
    expect(dialog).toHaveTextContent('Any email address works.');
    const send = within(dialog).getByRole('button', { name: 'Send invitation' });
    expect(send).toBeDisabled();
    await user.type(within(dialog).getByLabelText(/Email/), 'new@gmail.com');
    await user.type(within(dialog).getByLabelText('Name'), 'New Person');
    await user.selectOptions(within(dialog).getByLabelText('Role'), 'admin');
    await user.click(send);
    await waitFor(() => expect(toasts().getByText('Invitation sent to new@gmail.com.')).toBeInTheDocument());
    expect(api.find('POST', `${DU}/invitations/`)[0].body).toEqual({ email: 'new@gmail.com', name: 'New Person', role: 'admin' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    full = true;
    await user.click(screen.getByRole('button', { name: 'Invite member' }));
    const again = await screen.findByRole('dialog', { name: 'Invite member' });
    await user.type(within(again).getByLabelText(/Email/), 'late@du.ac.bd');
    await user.click(within(again).getByRole('button', { name: 'Send invitation' }));
    expect(await within(again).findByRole('alert')).toHaveTextContent('contact BdREN to upgrade your plan');
  });

  it('says when an invite went straight onto the package, and when its email did not go out', async () => {
    const user = userEvent.setup();
    let sent = true;
    renderPortal('/portal/du/members', {
      [`POST ${DU}/invitations/`]: () => reply(201, { outcome: 'covered', invitation: null, member: { ...notCovered[0], ...covered }, email_sent: sent }),
    });
    await user.click(await screen.findByRole('button', { name: 'Invite member' }));
    await user.type(within(await screen.findByRole('dialog')).getByLabelText(/Email/), 'farhana@du.ac.bd');
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Send invitation' }));
    await waitFor(() =>
      expect(toasts().getByText('farhana@du.ac.bd already had an account with your institution, so they are on your package now. We emailed them.')).toBeInTheDocument(),
    );

    sent = false;
    await user.click(screen.getByRole('button', { name: 'Invite member' }));
    await user.type(within(await screen.findByRole('dialog')).getByLabelText(/Email/), 'farhana@du.ac.bd');
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Send invitation' }));
    await waitFor(() => expect(toasts().getByText(/they are on your package now\. The email telling them didn't go out\./)).toBeInTheDocument());
  });

  it('blocks invites and imports when every seat is taken', async () => {
    renderPortal('/portal/du/members', { [`GET ${DU}/`]: { ...institution, seats: { used: 200, cap: 200 } } });
    expect(await screen.findByText('200 / 200 seats')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Invite member' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Import CSV' })).toBeDisabled();
    expect(screen.getByText(/All 200 \/ 200 seats are in use/)).toBeInTheDocument();
  });

  it('previews a CSV import with per-row reasons, then sends the rows that fit', async () => {
    const user = userEvent.setup();
    const { api } = renderPortal('/portal/du/members', {
      [`POST ${DU}/import/`]: (request: MockRequest) => {
        const dryRun = (request.body as { dry_run: boolean }).dry_run;
        return {
          rows: [
            { index: 0, email: 'a@du.ac.bd', status: 'ok', reason: null, action: 'invite' },
            { index: 1, email: 'not-an-email', status: 'error', reason: 'invalid_email', action: null },
            { index: 2, email: 'rahim@du.ac.bd', status: 'skip', reason: 'already_member', action: null },
          ],
          summary: { ok: 1, error: 1, skip: 1, fits: 1, actions: { invite: 1, cover: 0, consent_invite: 0 }, seats: { used: 142, cap: 200 } },
          created: dryRun ? 0 : 1,
          covered: 0,
          email_failures: 0,
          email_queued: 0,
        };
      },
    });
    await user.click(await screen.findByRole('button', { name: 'Import CSV' }));
    const dialog = await screen.findByRole('dialog', { name: 'Import members from CSV' });
    await user.click(within(dialog).getByLabelText(/Or paste rows/));
    await user.paste('email,name,role\na@du.ac.bd,A Person,\nnot-an-email,B,member\nrahim@du.ac.bd,Rahim,admin\n');
    await user.click(within(dialog).getByRole('button', { name: 'Preview' }));

    expect(await within(dialog).findByText('1 of 3 fit')).toBeInTheDocument();
    expect(within(dialog).getByText('Not a valid email')).toBeInTheDocument();
    expect(within(dialog).getByText('Already on your package')).toBeInTheDocument();
    expect(within(dialog).getByText('Will be invited')).toBeInTheDocument();
    expect(api.find('POST', `${DU}/import/`)[0].body).toEqual({
      dry_run: true,
      rows: [
        { email: 'a@du.ac.bd', name: 'A Person', role: 'member' },
        { email: 'not-an-email', name: 'B', role: 'member' },
        { email: 'rahim@du.ac.bd', name: 'Rahim', role: 'admin' },
      ],
    });

    await user.click(within(dialog).getByRole('button', { name: 'Import 1 row' }));
    await waitFor(() => expect(toasts().getByText('1 invitation created.')).toBeInTheDocument());
    expect(api.find('POST', `${DU}/import/`)[1].body).toMatchObject({ dry_run: false });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it("marks the rows of an import preview that won't fit in the seats", async () => {
    const user = userEvent.setup();
    renderPortal('/portal/du/members', {
      [`POST ${DU}/import/`]: {
        rows: [
          { index: 0, email: 'a@du.ac.bd', status: 'ok', reason: null, action: 'invite' },
          { index: 1, email: 'b@du.ac.bd', status: 'ok', reason: 'over_cap', action: 'invite' },
        ],
        summary: { ok: 2, error: 0, skip: 0, fits: 1, actions: { invite: 2, cover: 0, consent_invite: 0 }, seats: { used: 199, cap: 200 } },
        created: 0,
        covered: 0,
        email_failures: 0,
        email_queued: 0,
      },
    });
    await user.click(await screen.findByRole('button', { name: 'Import CSV' }));
    const dialog = await screen.findByRole('dialog', { name: 'Import members from CSV' });
    await user.click(within(dialog).getByLabelText(/Or paste rows/));
    await user.paste('a@du.ac.bd\nb@du.ac.bd\n');
    await user.click(within(dialog).getByRole('button', { name: 'Preview' }));
    expect(await within(dialog).findByText('1 of 2 fit')).toBeInTheDocument();
    expect(within(dialog).getByRole('alert')).toHaveTextContent("1 ready row won't fit in your seats");
    const over = within(dialog).getByText('b@du.ac.bd').closest('tr') as HTMLElement;
    expect(within(over).getByText("Won't be imported")).toHaveClass('text-danger-fg');
    expect(within(over).getByText('No seat left for this row')).toBeInTheDocument();
    const fits = within(dialog).getByText('a@du.ac.bd').closest('tr') as HTMLElement;
    expect(within(fits).getByText('Will be invited')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Import 1 row' })).toBeEnabled();
  });

  it("locks the rows while they're being checked, so the preview always matches the text", async () => {
    const user = userEvent.setup();
    renderPortal('/portal/du/members', {
      [`POST ${DU}/import/`]: {
        rows: [{ index: 0, email: 'a@du.ac.bd', status: 'ok', reason: null, action: 'invite' }],
        summary: { ok: 1, error: 0, skip: 0, fits: 1, actions: { invite: 1, cover: 0, consent_invite: 0 }, seats: { used: 142, cap: 200 } },
        created: 0,
        covered: 0,
        email_failures: 0,
        email_queued: 0,
      },
    });
    const answered = globalThis.fetch;
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/import/')) await gate;
      return answered(input, init);
    });
    await user.click(await screen.findByRole('button', { name: 'Import CSV' }));
    const dialog = await screen.findByRole('dialog', { name: 'Import members from CSV' });
    const rows = within(dialog).getByLabelText(/Or paste rows/);
    await user.click(rows);
    await user.paste('a@du.ac.bd\n');
    await user.click(within(dialog).getByRole('button', { name: 'Preview' }));
    await waitFor(() => expect(rows).toBeDisabled());
    expect(within(dialog).getByLabelText('CSV file')).toBeDisabled();
    release();
    expect(await within(dialog).findByText('1 of 1 fit')).toBeInTheDocument();
    expect(rows).toBeEnabled();
    expect(rows).toHaveValue('a@du.ac.bd\n');
  });

  it('clears a failed check once the rows change', async () => {
    const user = userEvent.setup();
    renderPortal('/portal/du/members', { [`POST ${DU}/import/`]: reply(500, { error: 'server_error', message: 'Boom' }) });
    await user.click(await screen.findByRole('button', { name: 'Import CSV' }));
    const dialog = await screen.findByRole('dialog', { name: 'Import members from CSV' });
    const rows = within(dialog).getByLabelText(/Or paste rows/);
    await user.click(rows);
    await user.paste('a@du.ac.bd\n');
    await user.click(within(dialog).getByRole('button', { name: 'Preview' }));
    expect(await within(dialog).findByRole('alert')).toBeInTheDocument();
    await user.type(rows, 'b@du.ac.bd');
    expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('Members page: tabs', () => {
  it('shows each tab with its count, loads that tab and puts it in the address', async () => {
    const user = userEvent.setup();
    const { api, router } = renderPortal('/portal/du/members', {
      [`GET ${DU}/members/`]: (request: MockRequest) =>
        request.query.get('tab') === 'not_covered' ? membersPage(notCovered, { covered: 140, not_covered: 2, personal_plan: 3 }) : membersPage(members),
    });
    await screen.findByText('Rahim Uddin');
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Covered140', 'Invited4', 'Not covered12', 'Personal plan3']);
    expect(screen.getByRole('tab', { name: tab('Covered', 140) })).toHaveAttribute('aria-selected', 'true');

    await user.click(screen.getByRole('tab', { name: tab('Not covered', 12) }));
    expect(await screen.findByText('Farhana Akter')).toBeInTheDocument();
    expect(membersCalls(api.calls)).toContain('tab=not_covered&page=1&page_size=25');
    expect(await screen.findByRole('tab', { name: tab('Not covered', 2) })).toHaveAttribute('aria-selected', 'true');
    expect(router.state.location.search).toEqual({ tab: 'not_covered' });
    expect(within(row('Imran Hossain')).getByText('Invited')).toBeInTheDocument();
  });

  it('opens on the tab named in the link and searches every tab with one box', async () => {
    const user = userEvent.setup();
    const { api } = renderPortal('/portal/du/members?tab=personal_plan');
    expect(await screen.findByText('Tania Rahman')).toBeInTheDocument();
    await user.type(screen.getByRole('searchbox', { name: 'Name or email' }), 'tania');
    await waitFor(() => expect(membersCalls(api.calls)).toContain('tab=personal_plan&q=tania&page=1&page_size=25'));
    await user.click(screen.getByRole('tab', { name: /^Covered/ }));
    await waitFor(() => expect(membersCalls(api.calls)).toContain('tab=covered&q=tania&page=1&page_size=25'));
  });

  it('keeps personal-plan rows read-only, with an explanation and a support link', async () => {
    renderPortal('/portal/du/members?tab=personal_plan');
    await screen.findByText('Tania Rahman');
    const tania = row('Tania Rahman');
    expect(within(tania).queryByRole('button')).not.toBeInTheDocument();
    expect(within(tania).queryByRole('checkbox')).not.toBeInTheDocument();
    expect(within(tania).getByText('Personal plan')).toBeInTheDocument();
    expect(tania).not.toHaveTextContent(/usage/i);
    const report = within(tania).getByRole('link', { name: 'Report Tania Rahman to BDREN support' });
    const href = report.getAttribute('href') ?? '';
    expect(href.startsWith('mailto:noc@bdren.edu.bd?subject=')).toBe(true);
    expect(decodeURIComponent(href)).toContain('Membership id: m-paid-1');
    expect(screen.getByText(/you\s+can't change their membership/)).toBeInTheDocument();
  });

  it('opens the Invited tab on the status named in the link', async () => {
    const { api } = renderPortal('/portal/du/members?tab=invited&status=expired');
    expect(await screen.findByText('tanvir@du.ac.bd')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Invitation status' })).toHaveValue('expired');
    expect(invitationCalls(api.calls)).toEqual(['status=expired&page=1&page_size=25']);
  });

  it('lists invitations by status and resends or revokes them', async () => {
    const user = userEvent.setup();
    const { api, router } = renderPortal('/portal/du/members', {
      [`POST ${DU}/invitations/inv-1/resend/`]: { invitation: invitations[0], email_sent: true },
      [`POST ${DU}/invitations/inv-1/revoke/`]: { invitation: { ...invitations[0], status: 'revoked' } },
    });
    await user.click(await screen.findByRole('tab', { name: tab('Invited', 4) }));
    await screen.findByText('tanvir@du.ac.bd');
    expect(invitationCalls(api.calls)).toContain('status=pending&page=1&page_size=25');

    await user.selectOptions(screen.getByRole('combobox', { name: 'Invitation status' }), 'expired');
    await waitFor(() => expect(invitationCalls(api.calls)).toContain('status=expired&page=1&page_size=25'));
    expect(router.state.location.search).toEqual({ tab: 'invited', status: 'expired' });
    await user.selectOptions(screen.getByRole('combobox', { name: 'Invitation status' }), '');
    await waitFor(() => expect(invitationCalls(api.calls)).toContain('page=1&page_size=25'));

    await user.click(within(row('tanvir@du.ac.bd')).getByRole('button', { name: 'Resend' }));
    await waitFor(() => expect(toasts().getByText('A new invitation link went to tanvir@du.ac.bd. The old link no longer works.')).toBeInTheDocument());

    await user.click(within(row('tanvir@du.ac.bd')).getByRole('button', { name: 'Revoke' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Revoke' }));
    await waitFor(() => expect(toasts().getByText('The invitation to tanvir@du.ac.bd is revoked.')).toBeInTheDocument());
  });
});

describe('Members page: Not covered', () => {
  it('adds a not-covered member to the package after confirming', async () => {
    const user = userEvent.setup();
    const { api } = renderPortal('/portal/du/members?tab=not_covered', {
      [`POST ${DU}/members/m-free-1/cover/`]: { member: { ...notCovered[0], ...covered }, email_sent: true },
    });
    await screen.findByText('Farhana Akter');
    await user.click(within(row('Farhana Akter')).getByRole('button', { name: 'Add to package' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add Farhana Akter to your package?' });
    expect(dialog).toHaveTextContent('This uses a seat.');
    expect(api.find('POST', `${DU}/members/m-free-1/cover/`)).toHaveLength(0);
    await user.click(within(dialog).getByRole('button', { name: 'Add to package' }));
    await waitFor(() => expect(toasts().getByText('Farhana Akter is on your package now and got an email about it.')).toBeInTheDocument());
    expect(api.find('POST', `${DU}/members/m-free-1/cover/`)[0].body).toEqual({});
  });

  it('adds a selection in bulk and stops at the seat cap', async () => {
    const user = userEvent.setup();
    const { api } = renderPortal('/portal/du/members?tab=not_covered', {
      [`POST ${DU}/members/m-free-1/cover/`]: { member: { ...notCovered[0], ...covered }, email_sent: true },
      [`POST ${DU}/members/m-free-2/cover/`]: reply(409, { error: 'seat_cap_reached', message: 'No seats', seats_used: 200, seat_cap: 200 }),
    });
    await screen.findByText('Farhana Akter');
    await user.click(screen.getByRole('checkbox', { name: 'Select everyone on this page' }));
    expect(screen.getByRole('checkbox', { name: 'Select Imran Hossain' })).toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Add 2 to package' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add 2 people to your package?' });
    expect(dialog).toHaveTextContent('This uses 2 seats.');
    await user.click(within(dialog).getByRole('button', { name: 'Add to package' }));
    const message = await waitFor(() => toasts().getByText(/Farhana Akter is on your package now/));
    expect(message).toHaveTextContent("We couldn't add Imran Hossain: All 200 / 200 seats are in use.");
    expect(api.calls.filter((call) => call.path.endsWith('/cover/')).map((call) => call.path)).toEqual([
      `${DU}/members/m-free-1/cover/`,
      `${DU}/members/m-free-2/cover/`,
    ]);
  });

  it("won't add more people than there are free seats", async () => {
    const user = userEvent.setup();
    renderPortal('/portal/du/members?tab=not_covered', { [`GET ${DU}/`]: { ...institution, seats: { used: 199, cap: 200 } } });
    await screen.findByText('Farhana Akter');
    await user.click(screen.getByRole('checkbox', { name: 'Select Farhana Akter' }));
    expect(screen.getByRole('button', { name: 'Add 1 to package' })).toBeEnabled();
    await user.click(screen.getByRole('checkbox', { name: 'Select Imran Hossain' }));
    expect(screen.getByRole('button', { name: 'Add 2 to package' })).toBeDisabled();
    expect(within(screen.getByRole('region', { name: 'Selected people' })).getByRole('alert')).toHaveTextContent('Only 1 seat is free.');
  });

  it("says when someone was added to the package but the email about it didn't go out", async () => {
    const user = userEvent.setup();
    renderPortal('/portal/du/members?tab=not_covered', {
      [`POST ${DU}/members/m-free-1/cover/`]: { member: { ...notCovered[0], ...covered }, email_sent: false },
    });
    await screen.findByText('Farhana Akter');
    await user.click(within(row('Farhana Akter')).getByRole('button', { name: 'Add to package' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Add to package' }));
    const message = await waitFor(() => toasts().getByText(/Farhana Akter is on your package now/));
    expect(message).toHaveTextContent("Farhana Akter is on your package now, but the email about it didn't go out.");
    expect(message).not.toHaveTextContent('got an email');
  });

  it('describes the Not covered tab without claiming everyone signed up with a matching email', async () => {
    renderPortal('/portal/du/members?tab=not_covered', { [`GET ${DU}/members/`]: membersPage<Member>([]) });
    expect(await screen.findByText('Nobody is waiting to be added to your package.')).toBeInTheDocument();
    expect(screen.getByText(/members who were taken off the package/)).toBeInTheDocument();
  });

  it('explains a personal-plan conflict when adding someone who now pays for a plan', async () => {
    const user = userEvent.setup();
    renderPortal('/portal/du/members?tab=not_covered', {
      [`POST ${DU}/members/m-free-1/cover/`]: reply(409, { error: 'needs_consent_invitation', message: 'Consent needed' }),
    });
    await screen.findByText('Farhana Akter');
    await user.click(within(row('Farhana Akter')).getByRole('button', { name: 'Add to package' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Add to package' }));
    await waitFor(() => expect(toasts().getByText(/Send them an invitation instead/)).toBeInTheDocument());
  });

  it('offers Add to package and the support link in the side panel', async () => {
    const user = userEvent.setup();
    renderPortal('/portal/du/members?tab=not_covered');
    await screen.findByText('Imran Hossain');
    await user.click(screen.getByRole('row', { name: 'Details for Imran Hossain' }));
    const panel = await screen.findByRole('dialog', { name: 'Imran Hossain' });
    expect(panel).toHaveTextContent('They have an invitation waiting.');
    expect(within(panel).getByRole('link', { name: 'Report to BDREN support' }).getAttribute('href')).toContain('mailto:noc@bdren.edu.bd');
    await user.click(within(panel).getByRole('button', { name: 'Add to package' }));
    expect(await screen.findByRole('dialog', { name: 'Add Imran Hossain to your package?' })).toBeInTheDocument();
  });

  it("won't offer Add to package in the side panel when every seat is taken", async () => {
    const user = userEvent.setup();
    const { api } = renderPortal('/portal/du/members?tab=not_covered', { [`GET ${DU}/`]: { ...institution, seats: { used: 200, cap: 200 } } });
    await screen.findByText('Imran Hossain');
    await user.click(screen.getByRole('row', { name: 'Details for Imran Hossain' }));
    const panel = await screen.findByRole('dialog', { name: 'Imran Hossain' });
    expect(within(panel).getByRole('button', { name: 'Add to package' })).toBeDisabled();
    expect(panel).toHaveTextContent('All 200 / 200 seats are in use.');
    await user.click(within(panel).getByRole('button', { name: 'Add to package' }));
    expect(screen.queryByRole('dialog', { name: 'Add Imran Hossain to your package?' })).not.toBeInTheDocument();
    expect(api.calls.filter((call) => call.path.endsWith('/cover/'))).toEqual([]);
  });
});
