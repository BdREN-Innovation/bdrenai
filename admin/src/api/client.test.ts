import { describe, expect, it, vi } from 'vitest';
import { ApiError, errorMessage, request, superadmin } from './client';
import { mockApi, reply } from '@/test/api';

describe('request', () => {
  it('fetches the CSRF cookie once and sends it on unsafe methods', async () => {
    const api = mockApi({
      'GET /api/v1/csrf/': () => {
        document.cookie = 'csrftoken=fresh-token; path=/';
        return { ok: true };
      },
      'POST /api/v1/superadmin/institutions/': reply(201, { ok: true }),
    });

    await superadmin.post('institutions/', { name: 'X' });

    const post = api.find('POST', '/api/v1/superadmin/institutions/')[0];
    expect(api.find('GET', '/api/v1/csrf/')).toHaveLength(1);
    expect(post.headers['X-CSRFToken']).toBe('fresh-token');
    expect(post.body).toEqual({ name: 'X' });
  });

  it('does not send a CSRF header on GET and drops empty query values', async () => {
    const api = mockApi({ 'GET /api/v1/superadmin/users/': { results: [] } });
    await superadmin.get('users/', { q: '', page: 2, status: undefined });
    const call = api.calls[0];
    expect(call.headers['X-CSRFToken']).toBeUndefined();
    expect(call.query.toString()).toBe('page=2');
  });

  it('sends the browser to sign in on 401', async () => {
    const location = { href: 'http://localhost/admin/users' };
    vi.stubGlobal('location', location);
    mockApi({ 'GET /api/v1/superadmin/session/': reply(401, { error: 'not_authenticated' }) });

    await expect(request('/api/v1/superadmin/session/')).rejects.toBeInstanceOf(ApiError);
    expect(location.href).toBe(`/api/v1/auth/login/?next=${encodeURIComponent('http://localhost/admin/users')}`);
  });

  it('turns error bodies into ApiError with code, fields and readable text', async () => {
    mockApi({
      'POST /api/v1/superadmin/invitations/': reply(409, { error: 'seat_cap_reached', message: 'Full', seats_used: 100, seat_cap: 100 }),
    });
    document.cookie = 'csrftoken=t; path=/';
    const error = await superadmin.post('invitations/', {}).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe('seat_cap_reached');
    expect(errorMessage(error)).toBe('Seat cap reached: 100 of 100 seats are in use. Raise the cap or free seats first.');
  });

  it('names the institution that already holds a sign-in domain', () => {
    const error = new ApiError(409, {
      error: 'domain_taken',
      message: 'A sign-in domain can belong to one institution only.',
      fields: { sign_in_domains: 'du.ac.bd belongs to Dhaka University.' },
      conflicts: [{ domain: 'du.ac.bd', institution: { slug: 'dhaka-university', name: 'Dhaka University' } }],
    });
    expect(errorMessage(error)).toBe('du.ac.bd already belongs to Dhaka University. A sign-in domain can belong to one institution only.');
    expect(error.fields.sign_in_domains).toBe('du.ac.bd belongs to Dhaka University.');
  });

  it('explains that a person can belong to one institution only', () => {
    const error = new ApiError(409, { error: 'member_of_other_institution', message: 'Member elsewhere' });
    expect(errorMessage(error)).toMatch(/already belongs to another institution/);
  });
});
