import type { ApiErrorBody, DomainConflict } from './types';

export const API_ROOT = '/api/v1';
export const SUPERADMIN_ROOT = `${API_ROOT}/superadmin`;

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: Record<string, string>;
  readonly body: ApiErrorBody;

  constructor(status: number, body: ApiErrorBody) {
    super(body.message || body.error || `Request failed (${status})`);
    this.name = 'ApiError';
    this.status = status;
    this.code = body.error;
    this.fields = body.fields ?? {};
    this.body = body;
  }
}

export function loginUrl(next: string): string {
  return `${API_ROOT}/auth/login/?next=${encodeURIComponent(next)}`;
}

export function redirectToLogin(): void {
  window.location.href = loginUrl(window.location.href);
}

export function readCookie(name: string): string | null {
  const prefix = `${name}=`;
  const match = document.cookie.split('; ').find((part) => part.startsWith(prefix));
  return match ? decodeURIComponent(match.slice(prefix.length)) : null;
}

let csrfRequest: Promise<void> | null = null;

/** Django sets `csrftoken` on GET /api/v1/csrf/; fetch it once, then read the cookie on every unsafe call. */
async function csrfToken(): Promise<string> {
  const existing = readCookie('csrftoken');
  if (existing) return existing;
  csrfRequest ??= fetch(`${API_ROOT}/csrf/`, { credentials: 'include' }).then(() => undefined);
  try {
    await csrfRequest;
  } finally {
    csrfRequest = null;
  }
  return readCookie('csrftoken') ?? '';
}

export type Query = Record<string, string | number | boolean | null | undefined>;

export function withQuery(path: string, query?: Query): string {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  const search = params.toString();
  return search ? `${path}?${search}` : path;
}

async function parseError(response: Response): Promise<ApiErrorBody> {
  try {
    const body = (await response.json()) as Partial<ApiErrorBody>;
    return { ...body, error: body.error ?? `http_${response.status}` } as ApiErrorBody;
  } catch {
    return { error: `http_${response.status}`, message: response.statusText || undefined };
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  query?: Query;
  body?: unknown;
  signal?: AbortSignal;
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (UNSAFE_METHODS.has(method)) headers['X-CSRFToken'] = await csrfToken();

  const response = await fetch(withQuery(path, options.query), {
    method,
    headers,
    credentials: 'include',
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal,
  });

  if (response.status === 401) {
    redirectToLogin();
    throw new ApiError(401, await parseError(response));
  }
  if (!response.ok) throw new ApiError(response.status, await parseError(response));
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export const superadmin = {
  get: <T>(path: string, query?: Query, signal?: AbortSignal) =>
    request<T>(`${SUPERADMIN_ROOT}/${path}`, { query, signal }),
  post: <T>(path: string, body: unknown = {}) =>
    request<T>(`${SUPERADMIN_ROOT}/${path}`, { method: 'POST', body }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(`${SUPERADMIN_ROOT}/${path}`, { method: 'PATCH', body }),
  delete: <T>(path: string) => request<T>(`${SUPERADMIN_ROOT}/${path}`, { method: 'DELETE' }),
};

export async function logout(): Promise<void> {
  const result = await request<{ redirect: string | null }>(`${API_ROOT}/auth/logout/`, {
    method: 'POST',
  });
  window.location.href = result?.redirect || '/';
}

const ERROR_TEXT: Record<string, string> = {
  slug_taken: 'That slug is already used by another institution.',
  already_member: 'This person is already an active member of the institution.',
  already_invited: 'This email already has a pending invitation. Use Resend instead.',
  institution_inactive: 'This institution has been removed, so it cannot take new invitations.',
  invitation_not_pending: 'Only pending or expired invitations can be changed.',
  confirm_mismatch: 'The confirmation text does not match the institution name.',
  last_admin: 'This would leave the institution without an active owner or admin.',
  cannot_suspend_self: 'You cannot suspend your own account.',
  ambiguous_email: 'More than one account uses that email. Add the user by ID instead.',
  not_superadmin: 'Your account does not have superadmin access.',
  key_taken: 'This app already has a feature with that key.',
  feature_in_use: 'A package uses this feature, so its key and unit cannot change. You can set it inactive instead.',
  feature_not_in_package: 'A limit uses a feature of an app that is not in this package.',
  use_new_version: 'Price, apps and limits change only through a new version.',
  no_changes: 'Nothing changed, so there is no new version to publish.',
  member_of_other_institution:
    'This person already belongs to another institution. A person can belong to one institution only; remove them from the other institution first.',
  domain_taken: 'A sign-in domain can belong to one institution only, and another institution already lists this one.',
  not_coverable: 'Only an active member who is not on the package yet can be added to it.',
  personal_plan_consent_required: 'This person has a personal plan. Send them an invitation so they can agree to switch.',
  not_covered: 'This member is not on the institution package.',
  personal_plan_member: 'This member pays for a personal plan, so the institution cannot change their membership.',
  renewal_stopped: 'This subscription is set not to renew, so it cannot be renewed.',
};

function domainTakenMessage(conflicts: DomainConflict[]): string {
  const taken = conflicts.map(({ domain, institution }) => `${domain} already belongs to ${institution.name}`).join('; ');
  return `${taken}. A sign-in domain can belong to one institution only.`;
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'seat_cap_reached') {
      const { seats_used: used, seat_cap: cap } = error.body;
      return used !== undefined && cap !== undefined && cap !== null
        ? `Seat cap reached: ${used} of ${cap} seats are in use. Raise the cap or free seats first.`
        : 'Seat cap reached. Raise the cap or free seats first.';
    }
    if (error.code === 'domain_taken' && error.body.conflicts?.length) return domainTakenMessage(error.body.conflicts);
    return ERROR_TEXT[error.code] ?? error.message;
  }
  if (error instanceof Error) return error.message;
  return 'Something went wrong.';
}

/** Server field errors keyed by field name; `prefix` strips a nesting such as `new_institution.`. */
export function fieldErrors(error: unknown, prefix = ''): Record<string, string> {
  if (!(error instanceof ApiError)) return {};
  return Object.fromEntries(
    Object.entries(error.fields).map(([key, value]) => [prefix && key.startsWith(prefix) ? key.slice(prefix.length) : key, value]),
  );
}
