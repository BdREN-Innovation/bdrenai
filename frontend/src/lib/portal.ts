import { ADMIN_CONSOLE_URL, FormResult, getJson } from "./api";

/**
 * What the website still needs of the institution admin console: invitation acceptance (`/invite/<token>`), and
 * links from the profile menu and page into the console, which lives in the admin SPA (`<ADMIN_CONSOLE_URL>portal/`).
 */

export type MemberRole = "member" | "admin" | "owner" | "billing";
export type InvitationStatus = "pending" | "accepted" | "revoked" | "expired";

/** `cap` null means unlimited. */
export interface Seats {
  used: number;
  cap: number | null;
}

/** Suspended institutions are listed too, so the menu can still lead to the console page that explains it. */
export interface AdminInstitution {
  slug: string;
  name: string;
  status: "active" | "suspended";
  seats: Seats;
  role: MemberRole;
}

export interface InvitationPreview {
  status: InvitationStatus;
  email_masked: string;
  /** Only when the signed-in user's email matches the invitation. */
  email: string | null;
  institution: { name: string } | null;
  role: MemberRole | null;
  invited_by_name: string;
  expires_at: string;
  signed_in: boolean;
  email_matches: boolean;
  /** The matching signed-in user pays for a personal plan: accepting stops it renewing (needs their consent). */
  ends_personal_plan: boolean;
  /** When that personal plan runs out (null if it never expires or `ends_personal_plan` is false). */
  personal_plan_ends_at: string | null;
}

export interface AcceptResult {
  institution: { slug: string; name: string } | null;
  role: MemberRole | null;
  /** `/profile`, or `/admin/portal/<slug>/members` for an institution admin. */
  redirect: string;
  /** Accepting set the person's paid personal plan not to renew. */
  renewal_stopped: boolean;
}

/** Fields the API adds to a 409 `seat_cap_reached` body. */
interface SeatCapError {
  seats_used?: number;
  seat_cap?: number;
}

export const PORTAL_PATH = "/api/v1/portal/institutions/";
export const INVITATION_PATH = "/api/v1/invitations/";

export type ConsolePage = "dashboard" | "usage" | "members" | "domains";

const ADMIN_PREFIX = "/admin/";
const CONSOLE_BASE = ADMIN_CONSOLE_URL.endsWith("/") ? ADMIN_CONSOLE_URL : `${ADMIN_CONSOLE_URL}/`;

/** A page of the institution admin console in the admin app, e.g. `/admin/portal/du/members`. */
export function consolePageUrl(slug: string, page: ConsolePage): string {
  return `${CONSOLE_BASE}portal/${encodeURIComponent(slug)}/${page}`;
}

export function membersConsoleUrl(slug: string): string {
  return consolePageUrl(slug, "members");
}

/**
 * Where a server-given site path leads: paths under `/admin/` belong to the admin app, which local development serves
 * from another origin (NEXT_PUBLIC_ADMIN_URL); anything else stays on this site. Expects a `safeNext`-checked path.
 */
export function siteUrl(path: string): string {
  return path.startsWith(ADMIN_PREFIX) ? `${CONSOLE_BASE}${path.slice(ADMIN_PREFIX.length)}` : path;
}

export function seatCapMessage(used: number | undefined, cap: number | undefined): string {
  const count = used !== undefined && cap !== undefined ? `All ${used} / ${cap} seats are in use. ` : "There are no free seats. ";
  return `${count}Remove members who no longer need access, or contact BdREN to upgrade your plan.`;
}

const ERROR_MESSAGES: Record<string, string> = {
  invitation_not_pending: "This invitation is no longer pending.",
  institution_suspended: "Your institution is suspended. Contact BdREN to restore access.",
  member_of_other_institution: "You already belong to another institution. Contact BdREN support to move.",
  throttled: "Too many requests were sent just now. Wait a minute and try again.",
  network: "We couldn't reach the server. Check your connection and try again.",
};

/** Turns an API error body into one sentence for the person using the page. */
export function errorMessage(res: FormResult<object>, fallback: string): string {
  const { error, message } = res.data;
  if (error === "seat_cap_reached") {
    const body = res.data as SeatCapError;
    return seatCapMessage(body.seats_used, body.seat_cap);
  }
  if (error && ERROR_MESSAGES[error]) return ERROR_MESSAGES[error];
  return message || fallback;
}

/** Institutions the signed-in user administers; empty when signed out or on any error. */
export async function fetchAdminInstitutions(): Promise<AdminInstitution[]> {
  const res = await getJson<AdminInstitution[]>(PORTAL_PATH);
  return res.ok && Array.isArray(res.data) ? res.data : [];
}

export function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export const ROLE_LABELS: Record<MemberRole, string> = {
  member: "Member",
  admin: "Admin",
  owner: "Owner",
  billing: "Billing",
};
