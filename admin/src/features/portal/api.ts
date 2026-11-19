import { API_ROOT, request, withQuery } from '@/api/client';
import type { Query } from '@/api/client';
import type { UsageParams } from './types';

export const PORTAL_ROOT = `${API_ROOT}/portal/institutions/`;
export const PROFILE_PATH = `${API_ROOT}/auth/profile/`;
export const CATALOG_PATH = `${API_ROOT}/catalog/products/`;

export function institutionPath(slug: string): string {
  return `${PORTAL_ROOT}${encodeURIComponent(slug)}/`;
}

/** The usage CSV download for the same range and app as the page shows. */
export function usageExportUrl(slug: string, params: UsageParams): string {
  return withQuery(`${institutionPath(slug)}usage/export.csv`, { ...params });
}

/** A payment's printable receipt or bank slip, served only to this institution's admins. */
export function paymentFileUrl(slug: string, id: string, file: 'receipt' | 'attachment'): string {
  return `${institutionPath(slug)}billing/payments/${encodeURIComponent(id)}/${file}/`;
}

/** Calls under `/api/v1/portal/institutions/<slug>/`; writes carry the CSRF token like every other mutation. */
export function portalApi(slug: string) {
  const base = institutionPath(slug);
  return {
    get: <T>(path: string, query?: Query, signal?: AbortSignal) => request<T>(`${base}${path}`, { query, signal }),
    post: <T>(path: string, body: unknown = {}) => request<T>(`${base}${path}`, { method: 'POST', body }),
    patch: <T>(path: string, body: unknown) => request<T>(`${base}${path}`, { method: 'PATCH', body }),
    delete: <T>(path: string, query?: Query) => request<T>(`${base}${path}`, { method: 'DELETE', query }),
  };
}
