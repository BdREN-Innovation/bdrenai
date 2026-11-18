import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MockRequest } from '@/test/api';
import { API, bundleRow, configApps, mindspearRow, page, synapseDetail, synapseRow } from '@/test/fixtures';
import { renderApp } from '@/test/render';
import { reply } from '@/test/api';

const APPS = { [`GET ${API}/config/apps/`]: { results: configApps } };

const packages = (request: MockRequest) => {
  const kind = request.query.get('kind');
  const rows = [bundleRow, synapseRow, mindspearRow];
  return page(kind ? rows.filter((row) => row.kind === kind) : rows);
};

describe('Configuration · Packages', () => {
  it('groups combined packages first, then one group per app, and filters on the server', async () => {
    const user = userEvent.setup();
    const { api } = renderApp('/configuration', { ...APPS, [`GET ${API}/config/packages/`]: packages });

    const table = await screen.findByRole('table', { name: 'Packages' });
    await within(table).findByText('BdREN AI Suite');
    const groups = within(table).getAllByRole('rowgroup').slice(1);
    expect(groups.map((group) => within(group).getAllByRole('columnheader')[0].textContent)).toEqual([
      'Combined packages',
      'Synapse',
      'Mindspear',
    ]);

    const suite = within(groups[0]).getByRole('row', { name: 'Open BdREN AI Suite' });
    expect(within(suite).getByText('All apps')).toBeInTheDocument();
    expect(within(suite).getByText('৳4,500')).toBeInTheDocument();
    expect(within(suite).getByText('per institution / month')).toBeInTheDocument();
    expect(within(suite).getByText('Recommended')).toBeInTheDocument();
    expect(within(suite).getByText('14 days')).toBeInTheDocument();
    expect(within(suite).getByText('Unlimited')).toBeInTheDocument();

    const standard = within(groups[1]).getByRole('row', { name: 'Open Synapse Standard' });
    expect(within(standard).getByText('৳1,500')).toBeInTheDocument();
    expect(within(standard).getByText('per seat / month')).toBeInTheDocument();
    expect(within(standard).getByText('Hidden')).toBeInTheDocument();
    expect(within(standard).getByText('100 seats')).toBeInTheDocument();
    expect(within(groups[2]).getByText('Free')).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: 'Combined' }));
    await waitFor(() => expect(api.find('GET', `${API}/config/packages/`).at(-1)?.query.get('kind')).toBe('bundle'));
    await waitFor(() => expect(within(table).queryByText('Synapse Standard')).not.toBeInTheDocument());

    await user.selectOptions(screen.getByRole('combobox', { name: 'App' }), 'mindspear');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'archived');
    await waitFor(() => {
      const last = api.find('GET', `${API}/config/packages/`).at(-1)?.query;
      expect(last?.get('app')).toBe('mindspear');
      expect(last?.get('status')).toBe('archived');
      expect(last?.get('kind')).toBe('bundle');
      expect(last?.get('page')).toBe('1');
    });
  });

  it('keeps the tab in the URL', async () => {
    const user = userEvent.setup();
    const { router } = renderApp('/configuration', { ...APPS, [`GET ${API}/config/packages/`]: packages });
    await user.click(await screen.findByRole('tab', { name: 'Apps & features' }));
    await waitFor(() => expect(router.state.location.search).toEqual({ tab: 'apps' }));
    expect(await screen.findByRole('table', { name: 'Synapse features' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New combined package' })).not.toBeInTheDocument();
  });

  it('creates a combined package with All apps and opens it', async () => {
    const user = userEvent.setup();
    const created = { ...synapseDetail, ...bundleRow, id: 'pkg-new', name: 'Campus Suite', limits: [], versions: [] };
    const { api, router } = renderApp('/configuration', {
      ...APPS,
      [`GET ${API}/config/packages/`]: packages,
      [`POST ${API}/config/packages/`]: reply(201, created),
      [`GET ${API}/config/packages/pkg-new/`]: created,
    });

    await user.click(await screen.findByRole('button', { name: 'New combined package' }));
    const dialog = await screen.findByRole('dialog', { name: 'New combined package' });
    await user.type(within(dialog).getByLabelText(/^Name/), 'Campus Suite');
    expect(within(dialog).getByLabelText(/^Slug/)).toHaveValue('campus-suite');

    await user.click(within(dialog).getByRole('button', { name: 'Create package' }));
    expect(within(dialog).getByText('Pick at least two apps for a combined package.')).toBeInTheDocument();
    expect(within(dialog).getByText(/Enter a price above 0/)).toBeInTheDocument();

    await user.click(within(dialog).getByRole('checkbox', { name: 'All apps' }));
    for (const app of configApps) expect(within(dialog).getByRole('checkbox', { name: app.name })).toBeChecked();

    await user.type(within(dialog).getByLabelText(/^Price \(BDT\)/), '4500');
    await user.selectOptions(within(dialog).getByLabelText('Price unit'), 'per_institution');
    expect(within(dialog).getByText('৳4,500 per institution / month')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Add Synapse limit' }));
    await user.type(within(dialog).getByLabelText('Chat messages limit'), '5000');
    await user.click(within(dialog).getByRole('button', { name: 'Create package' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/configuration/packages/pkg-new'));
    expect(api.find('POST', `${API}/config/packages/`)[0].body).toEqual({
      kind: 'bundle',
      name: 'Campus Suite',
      slug: 'campus-suite',
      description: '',
      audience: '',
      is_public: true,
      highlight: false,
      sort_order: 0,
      price: '4500.00',
      currency: 'BDT',
      billing_interval: 'monthly',
      price_unit: 'per_institution',
      trial_days: 0,
      seat_limit: null,
      apps: ['synapse', 'mindspear', 'mail-wizard', 'quigen'],
      limits: [{ feature_id: 'f-chat', limit_value: 5000, limit_period: 'monthly', on_limit: 'block' }],
    });
  });

  it('offers limits only for features of the included apps', async () => {
    const user = userEvent.setup();
    const { api } = renderApp('/configuration', {
      ...APPS,
      [`GET ${API}/config/packages/`]: packages,
      [`POST ${API}/config/packages/`]: reply(201, { ...synapseDetail, id: 'pkg-two' }),
      [`GET ${API}/config/packages/pkg-two/`]: synapseDetail,
    });

    await user.click(await screen.findByRole('button', { name: 'New combined package' }));
    const dialog = await screen.findByRole('dialog', { name: 'New combined package' });
    expect(within(dialog).getByText(/Choose the package’s apps first/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('checkbox', { name: 'Synapse' }));
    await user.click(within(dialog).getByRole('checkbox', { name: 'Mindspear' }));
    expect(within(dialog).getByRole('checkbox', { name: 'All apps' })).toHaveProperty('indeterminate', true);

    expect(within(dialog).getByRole('group', { name: 'Synapse limits' })).toBeInTheDocument();
    expect(within(dialog).getByRole('group', { name: 'Mindspear limits' })).toBeInTheDocument();
    expect(within(dialog).queryByRole('group', { name: 'AI Mail Wizard limits' })).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Add Synapse limit' }));
    const synapse = within(dialog).getByRole('group', { name: 'Synapse limits' });
    const options = within(within(synapse).getByRole('combobox', { name: 'Synapse feature 1' })).getAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual(['Chat messages (messages)', 'OCR pages (pages)']);
    await user.click(within(dialog).getByRole('button', { name: 'Add Synapse limit' }));
    expect(within(dialog).getByRole('button', { name: 'Add Synapse limit' })).toBeDisabled();

    await user.click(within(dialog).getByRole('button', { name: 'Add Mindspear limit' }));
    await user.type(within(dialog).getByLabelText('Quizzes limit'), '50');
    await user.click(within(dialog).getByRole('checkbox', { name: 'Synapse' }));
    await user.click(within(dialog).getByRole('checkbox', { name: 'AI Mail Wizard' }));
    expect(within(dialog).queryByRole('group', { name: 'Synapse limits' })).not.toBeInTheDocument();
    expect(within(dialog).getByRole('group', { name: 'Mindspear limits' })).toBeInTheDocument();

    await user.type(within(dialog).getByLabelText(/^Name/), 'Teaching pair');
    await user.selectOptions(within(dialog).getByLabelText('Billing'), 'free');
    await user.click(within(dialog).getByRole('button', { name: 'Create package' }));
    await waitFor(() => expect(api.find('POST', `${API}/config/packages/`)).toHaveLength(1));
    expect(api.find('POST', `${API}/config/packages/`)[0].body).toMatchObject({
      apps: ['mindspear', 'mail-wizard'],
      price: '0.00',
      billing_interval: 'free',
      limits: [{ feature_id: 'f-quiz', limit_value: 50, limit_period: 'monthly', on_limit: 'block' }],
    });
  });
});

describe('Configuration · Packages · edge cases', () => {
  it('keeps the filters and offers archived packages when none are on sale', async () => {
    const user = userEvent.setup();
    const archived = { ...synapseRow, status: 'archived' as const, price: '1500.50' };
    renderApp('/configuration', {
      ...APPS,
      [`GET ${API}/config/packages/`]: (request: MockRequest) => page(request.query.get('status') === 'archived' ? [archived] : []),
    });

    expect(await screen.findByText('No packages on sale')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Status' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show archived' }));

    const row = await screen.findByRole('row', { name: 'Open Synapse Standard' });
    expect(within(row).getByText('৳1,500.50')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Status' })).toHaveValue('archived');
  });

  it('checks the limit ceiling and shows server limit errors next to their row', async () => {
    const user = userEvent.setup();
    const { api } = renderApp('/configuration', {
      ...APPS,
      [`GET ${API}/config/packages/`]: packages,
      [`POST ${API}/config/packages/`]: reply(400, {
        error: 'feature_not_in_package',
        message: 'Limits can only use features of the included apps.',
        fields: { 'limits.1.feature_id': 'This feature belongs to an app the package does not include.' },
      }),
    });

    await user.click(await screen.findByRole('button', { name: 'New package' }));
    const dialog = await screen.findByRole('dialog', { name: 'New package' });
    await user.type(within(dialog).getByLabelText(/^Name/), 'Synapse Lab');
    await user.type(within(dialog).getByLabelText(/^Price \(BDT\)/), '1500');
    await user.click(within(dialog).getByRole('button', { name: 'Add Synapse limit' }));
    await user.click(within(dialog).getByRole('button', { name: 'Add Synapse limit' }));
    const first = within(dialog).getByLabelText('Chat messages limit');
    await user.type(first, '10000000000000000');
    await user.type(within(dialog).getByLabelText('OCR pages limit'), '20');
    await user.click(within(dialog).getByRole('button', { name: 'Create package' }));

    expect(first).toHaveAttribute('aria-invalid', 'true');
    expect(first).toHaveAccessibleDescription('Enter at most 1,000,000,000,000,000.');
    expect(api.find('POST', `${API}/config/packages/`)).toHaveLength(0);

    await user.clear(first);
    await user.type(first, '5000');
    await user.click(within(dialog).getByRole('button', { name: 'Create package' }));
    const second = within(dialog).getByRole('combobox', { name: 'Synapse feature 2' });
    await waitFor(() => expect(second).toHaveAccessibleDescription('This feature belongs to an app the package does not include.'));
    expect(second).toHaveAttribute('aria-invalid', 'true');
    expect(within(dialog).getByRole('combobox', { name: 'Synapse feature 1' })).not.toHaveAttribute('aria-invalid');
    expect(within(dialog).getByLabelText('OCR pages limit')).not.toHaveAttribute('aria-invalid');
  });
});

describe('Configuration · Package detail', () => {
  const DETAIL = { ...APPS, [`GET ${API}/config/packages/pkg-syn/`]: synapseDetail };

  it('shows current limits and what each version changed', async () => {
    renderApp('/configuration/packages/pkg-syn', DETAIL);
    const limits = await screen.findByRole('region', { name: 'Current limits' });
    expect(within(limits).getByText('2,000 messages per month')).toBeInTheDocument();
    const changes = screen.getByRole('list', { name: 'Changes in version 2' });
    expect(within(changes).getByText('Price: ৳1,200 → ৳1,500')).toBeInTheDocument();
    expect(within(changes).getByText('Chat messages (Synapse): 1,000 messages per month → 2,000 messages per month')).toBeInTheDocument();
    expect(screen.getByText('“More messages for staff”')).toBeInTheDocument();
  });

  it('publishes a new version only with a reason, sending the migration policy', async () => {
    const user = userEvent.setup();
    const preview = {
      changes: [{ field: 'price', from: '1500.00', to: '1800.00' }],
      affected: {
        subscriptions: 2,
        institutions: [
          { slug: 'dhaka-university', name: 'Dhaka University', subscription_id: 'sub-1', status: 'active' },
          { slug: 'buet', name: 'BUET', subscription_id: 'sub-2', status: 'trial' },
        ],
      },
    };
    const { api } = renderApp('/configuration/packages/pkg-syn', {
      ...DETAIL,
      [`POST ${API}/config/packages/pkg-syn/preview/`]: preview,
      [`POST ${API}/config/packages/pkg-syn/versions/`]: reply(201, {
        package: { ...synapseDetail, current_version: 3, price: '1800.00' },
        migrated: 1,
        scheduled: 0,
      }),
    });

    await user.click(await screen.findByRole('button', { name: 'New version' }));
    const dialog = await screen.findByRole('dialog', { name: 'New version of Synapse Standard' });
    const price = within(dialog).getByLabelText(/^Price \(BDT\)/);
    expect(price).toHaveValue('1500');
    expect(within(dialog).queryByLabelText(/^Slug/)).not.toBeInTheDocument();
    await user.clear(price);
    await user.type(price, '1800');
    await user.click(within(dialog).getByRole('button', { name: 'Review changes' }));

    const review = await screen.findByRole('dialog', { name: 'Review changes to Synapse Standard' });
    expect(api.find('POST', `${API}/config/packages/pkg-syn/preview/`)[0].body).toEqual({
      price: '1800.00',
      currency: 'BDT',
      billing_interval: 'monthly',
      price_unit: 'per_seat',
      trial_days: 0,
      seat_limit: 100,
      limits: [{ feature_id: 'f-chat', limit_value: 2000, limit_period: 'monthly', on_limit: 'block' }],
    });
    expect(within(review).getByText('Price: ৳1,500 → ৳1,800')).toBeInTheDocument();
    expect(within(review).getByRole('list', { name: 'Affected institutions' })).toHaveTextContent('Dhaka University');
    expect(within(review).getByText(/only new subscriptions get this one/)).toBeInTheDocument();

    await user.click(within(review).getByRole('radio', { name: 'Selected institutions' }));
    await user.click(within(review).getByRole('button', { name: 'Publish version 3' }));
    expect(within(review).getByText(/Say why this version is needed/)).toBeInTheDocument();
    expect(within(review).getByText(/Tick at least one institution/)).toBeInTheDocument();
    expect(api.find('POST', `${API}/config/packages/pkg-syn/versions/`)).toHaveLength(0);

    await user.click(within(review).getByRole('checkbox', { name: 'Dhaka University' }));
    await user.type(within(review).getByLabelText(/^Reason for this version/), 'Costs went up');
    await user.click(within(review).getByRole('button', { name: 'Publish version 3' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(api.find('POST', `${API}/config/packages/pkg-syn/versions/`)[0].body).toEqual({
      price: '1800.00',
      currency: 'BDT',
      billing_interval: 'monthly',
      price_unit: 'per_seat',
      trial_days: 0,
      seat_limit: 100,
      limits: [{ feature_id: 'f-chat', limit_value: 2000, limit_period: 'monthly', on_limit: 'block' }],
      change_reason: 'Costs went up',
      migration_policy: 'selected_only',
      selected_subscriptions: ['sub-1'],
    });
    expect(await screen.findByText('Version 3 of Synapse Standard published: 1 moved now.')).toBeInTheDocument();
  });

  it('says so when the new version changes nothing', async () => {
    const user = userEvent.setup();
    renderApp('/configuration/packages/pkg-syn', {
      ...DETAIL,
      [`POST ${API}/config/packages/pkg-syn/preview/`]: { changes: [], affected: { subscriptions: 0, institutions: [] } },
    });
    await user.click(await screen.findByRole('button', { name: 'New version' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Review changes' }));
    const review = await screen.findByRole('dialog', { name: 'Review changes to Synapse Standard' });
    expect(within(review).getByText(/Nothing changed/)).toBeInTheDocument();
    expect(within(review).getByRole('button', { name: 'Publish version 3' })).toBeDisabled();
  });

  it('edits presentation in place, sending only what changed', async () => {
    const user = userEvent.setup();
    const { api } = renderApp('/configuration/packages/pkg-syn', {
      ...DETAIL,
      [`PATCH ${API}/config/packages/pkg-syn/`]: { ...synapseDetail, name: 'Synapse Plus', highlight: true },
    });
    await user.click(await screen.findByRole('button', { name: 'Edit details' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit Synapse Standard' });
    const name = within(dialog).getByLabelText(/^Name/);
    await user.clear(name);
    await user.type(name, 'Synapse Plus');
    await user.click(within(dialog).getByRole('checkbox', { name: 'Recommended' }));
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(api.find('PATCH', `${API}/config/packages/pkg-syn/`)[0].body).toEqual({ name: 'Synapse Plus', highlight: true });
    expect(await screen.findByText('Synapse Plus saved.')).toBeInTheDocument();
  });

  it('archives with a required reason', async () => {
    const user = userEvent.setup();
    const { api } = renderApp('/configuration/packages/pkg-syn', {
      ...DETAIL,
      [`POST ${API}/config/packages/pkg-syn/archive/`]: { ...synapseDetail, status: 'archived' },
    });
    await user.click(await screen.findByRole('button', { name: 'Archive' }));
    const dialog = await screen.findByRole('dialog', { name: 'Archive package' });
    const confirm = within(dialog).getByRole('button', { name: 'Archive' });
    expect(confirm).toBeDisabled();
    await user.type(within(dialog).getByLabelText(/Reason/), 'Replaced by Synapse Plus');
    await user.click(confirm);

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(api.find('POST', `${API}/config/packages/pkg-syn/archive/`)[0].body).toEqual({ reason: 'Replaced by Synapse Plus' });
    expect(await screen.findByText('Synapse Standard archived.')).toBeInTheDocument();
  });
});

describe('Configuration · Apps & features', () => {
  it('adds a feature and locks key and unit of one in use', async () => {
    const user = userEvent.setup();
    const { api } = renderApp('/configuration?tab=apps', {
      ...APPS,
      [`POST ${API}/config/apps/synapse/features/`]: reply(201, { ...configApps[0].features[0], id: 'f-new', key: 'image_generations', name: 'Images' }),
      [`PATCH ${API}/config/features/f-chat/`]: { ...configApps[0].features[0], status: 'inactive' },
    });

    const synapse = await screen.findByRole('region', { name: 'Synapse' });
    expect(within(synapse).getByText('1 single package · 1 combined package')).toBeInTheDocument();
    await user.click(within(synapse).getByRole('button', { name: 'Add feature' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add a Synapse feature' });
    await user.type(within(dialog).getByLabelText(/^Name/), 'Images');
    await user.type(within(dialog).getByLabelText(/^Key/), 'Image Generations');
    await user.type(within(dialog).getByLabelText(/^Unit/), 'images');
    await user.click(within(dialog).getByRole('button', { name: 'Add feature' }));
    expect(within(dialog).getByText(/lowercase letters, numbers and underscores/)).toBeInTheDocument();

    await user.clear(within(dialog).getByLabelText(/^Key/));
    await user.type(within(dialog).getByLabelText(/^Key/), 'image_generations');
    await user.selectOptions(within(dialog).getByLabelText('Quota policy'), 'organization_only');
    await user.click(within(dialog).getByRole('button', { name: 'Add feature' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(api.find('POST', `${API}/config/apps/synapse/features/`)[0].body).toEqual({
      key: 'image_generations',
      name: 'Images',
      unit: 'images',
      description: '',
      quota_policy: 'organization_only',
    });

    await user.click(within(synapse).getByRole('button', { name: 'Edit Chat messages' }));
    const edit = await screen.findByRole('dialog', { name: 'Edit Chat messages' });
    expect(within(edit).getByLabelText(/^Key/)).toBeDisabled();
    expect(within(edit).getByLabelText(/^Unit/)).toBeDisabled();
    await user.selectOptions(within(edit).getByLabelText('Status'), 'inactive');
    await user.click(within(edit).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(api.find('PATCH', `${API}/config/features/f-chat/`)).toHaveLength(1));
    expect(api.find('PATCH', `${API}/config/features/f-chat/`)[0].body).toEqual({ status: 'inactive' });
  });

  it('is in the sidebar and the command menu', async () => {
    const user = userEvent.setup();
    const { router } = renderApp('/configuration', { ...APPS, [`GET ${API}/config/packages/`]: packages });
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { name: 'Configuration' })).toHaveAttribute('aria-current', 'page');

    await user.keyboard('{Control>}k{/Control}');
    await user.type(await screen.findByPlaceholderText('Search pages and institutions…'), 'features');
    await user.click(await screen.findByRole('option', { name: /Apps & features/ }));
    await waitFor(() => expect(router.state.location.search).toEqual({ tab: 'apps' }));
  });
});
