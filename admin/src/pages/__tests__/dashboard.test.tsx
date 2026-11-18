import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { API, auditEntry } from '@/test/fixtures';
import { renderApp } from '@/test/render';
import { reply } from '@/test/api';

describe('DashboardPage', () => {
  it('shows KPI tiles, attention items, recent institutions and activity', async () => {
    renderApp('/', {
      [`GET ${API}/dashboard/`]: {
        counts: { institutions: 5, active_institutions: 4, users: 194, active_users: 180, pending_invitations: 12, expired_invitations: 3, pending_requests: 2 },
        attention: [
          { kind: 'seats_near_cap', institution: { slug: 'du', name: 'Dhaka University' }, seats: { used: 95, cap: 100 } },
          { kind: 'expired_invitations', count: 3 },
          { kind: 'pending_requests', institution: { slug: 'buet', name: 'BUET' }, count: 2 },
        ],
        recent_institutions: [{ slug: 'du', name: 'Dhaka University', created_at: '2026-11-01T00:00:00Z', seats: { used: 95, cap: 100 } }],
        recent_activity: [auditEntry],
      },
    });

    expect(await screen.findByText('194')).toBeInTheDocument();
    expect(screen.getByText('180 active')).toBeInTheDocument();
    expect(screen.getByText('3 expired')).toBeInTheDocument();
    expect(screen.getByText(/is close to its seat cap/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Review' })).toHaveAttribute('href', '/admin/invitations?status=expired');
    expect(screen.getByRole('link', { name: 'BUET' })).toHaveAttribute('href', '/admin/institutions/buet');
    expect(screen.getAllByRole('meter', { name: 'Seats' })[0]).toHaveAttribute('aria-valuetext', '95 of 100 seats used');
    expect(screen.getByText('Organization suspend')).toBeInTheDocument();
  });

  it('shows the error with a retry when the dashboard fails', async () => {
    renderApp('/', { [`GET ${API}/dashboard/`]: reply(500, { error: 'server_error', message: 'Database unavailable' }) });
    expect(await screen.findByText('Database unavailable')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
