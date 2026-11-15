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
