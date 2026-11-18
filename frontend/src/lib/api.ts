export interface ProductLimit {
  feature_key: string;
  feature_name: string;
  unit: string;
  limit_value: number;
  limit_period: string;
}

export interface CatalogPackage {
  id: string;
  name: string;
  slug: string;
  description: string;
  price: string;
  currency: string;
  billing_interval: string;
  trial_days: number;
  latest_version: number | null;
  package_version_id: string | null;
  limits: ProductLimit[];
}

export interface CatalogProduct {
  id: string;
  name: string;
  slug: string;
  description: string;
  features: { key: string; name: string; unit: string; description: string }[];
  packages: CatalogPackage[];
}

export interface UserProfile {
  id: string;
  email: string;
  email_verified: boolean;
  name: string;
  active_account_id: string;
  accounts: { id: string; type: string }[];
  memberships: { organization_id: string; organization_slug: string; role: string; status: string }[];
  external_identities: { id: string; issuer: string; subject: string; provider_type: string }[];
}

export interface AccountContextItem {
  account_id: string;
  account_type: "personal" | "organization";
  organization: { id: string; name: string; slug: string } | null;
  role: string;
  is_active_context: boolean;
}

function getCsrfToken(): string {
  if (typeof document === "undefined") return "";
  const match = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : "";
}

export async function apiFetch<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string> | undefined),
  };
  if (options.method && options.method !== "GET") {
    const csrf = getCsrfToken();
    if (csrf) headers["X-CSRFToken"] = csrf;
  }
  const res = await fetch(path, {
    ...options,
    credentials: "include",
    headers,
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({ error: `HTTP_${res.status}` }));
    throw new Error(errBody.detail || errBody.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export interface FormResult<T> {
  ok: boolean;
  status: number;
  data: T & { error?: string; fields?: Record<string, string> };
}

/**
 * Sends JSON (or a FormData upload) and returns the body whatever the status, so forms can show
 * per-field errors.
 */
export async function postForm<T = object>(
  path: string,
  body: object | FormData,
  method: "POST" | "PATCH" | "DELETE" = "POST"
): Promise<FormResult<T>> {
  const isUpload = body instanceof FormData;
  const headers: Record<string, string> = { "X-CSRFToken": getCsrfToken() };
  if (!isUpload) headers["Content-Type"] = "application/json";
  try {
    const res = await fetch(path, {
      method,
      credentials: "include",
      headers,
      body: isUpload ? body : JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({ error: `HTTP_${res.status}` }));
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: { error: "network" } as FormResult<T>["data"] };
  }
}

export interface Institution {
  id: string;
  name: string;
}

export interface MyProfile {
  id: string;
  first_name: string;
  last_name: string;
  name: string;
  email: string;
  email_verified: boolean;
  avatar_url: string | null;
  member_since: string;
  memberships: { organization: string; role: string; status: string }[];
  is_admin: boolean;
  can_edit_name: boolean;
}

export interface BillingSummary {
  subscriptions: {
    id: string;
    account: string;
    product: string;
    package: string;
    version: number;
    status: string;
    billing_interval: string;
    price: string;
    currency: string;
    starts_at: string;
    expires_at: string | null;
  }[];
  payments: {
    id: string;
    account: string;
    amount: string;
    currency: string;
    reference: string;
    status: string;
    created_at: string;
  }[];
}

export const PROFILE_PATH = "/api/v1/auth/profile/";

/** Fired when the signed-in user's profile changes, so the header updates without a reload. */
export const PROFILE_EVENT = "bdren:profile";

export function announceProfile(user: MyProfile): void {
  window.dispatchEvent(new CustomEvent<MyProfile>(PROFILE_EVENT, { detail: user }));
}

/**
 * Full sign-out: ends the BDREN (Django) session, then sends the browser to ZITADEL's
 * end-session endpoint so the central SSO session ends too. ZITADEL redirects back to
 * /api/v1/auth/logged-out/, which returns the user to the landing page.
 */
export async function logout(): Promise<void> {
  let redirect: string | null = null;
  try {
    const res = await apiFetch<{ redirect: string | null }>("/api/v1/auth/logout/", { method: "POST" });
    redirect = res.redirect;
  } catch {
    // Session already gone or CSRF cookie missing: fall through to the landing page.
  }
  window.location.href = redirect || "/";
}
