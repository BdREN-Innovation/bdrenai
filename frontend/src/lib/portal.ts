import { FormResult, getJson } from "./api";

export type PortalRole = "member" | "admin";
export type MemberRole = PortalRole | "owner" | "billing";
export type MemberStatus = "active" | "suspended" | "pending" | "deprovisioned";
export type InvitationStatus = "pending" | "accepted" | "revoked" | "expired";

/** `cap` null means unlimited. */
export interface Seats {
  used: number;
  cap: number | null;
}

export interface Paged<T> {
  results: T[];
  count: number;
  page: number;
  page_size: number;
}

/** Suspended institutions are listed too, so the menu can still lead to the page that explains it. */
export interface AdminInstitution {
  slug: string;
  name: string;
  status: "active" | "suspended";
  seats: Seats;
  role: MemberRole;
}

export interface InstitutionCounts {
  members: number;
  active: number;
  suspended: number;
  pending_invitations: number;
  expired_invitations: number;
  pending_requests: number;
}

export interface PortalInstitution {
  slug: string;
  name: string;
  seats: Seats;
  counts: InstitutionCounts;
  sign_in_domains: string[];
}

export interface Member {
  membership_id: string;
  user: { id: string; name: string; email: string; status: string };
  role: MemberRole;
  status: MemberStatus;
  joined_at: string | null;
}

export interface PersonRef {
  id: string;
  name: string;
  email?: string;
}

export interface Invitation {
  id: string;
  email: string;
  name: string;
  institution: { slug: string; name: string } | null;
  /** null for an individual (no institution) invitation. */
  role: MemberRole | null;
  status: InvitationStatus;
  source: string;
  invited_by: PersonRef | null;
  expires_at: string;
  created_at: string;
  last_sent_at: string;
  sent_count: number;
  email_status: "queued" | "sending" | "sent" | "failed";
  accepted_by: PersonRef | null;
  accepted_at: string | null;
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
}

export interface AcceptResult {
  institution: { slug: string; name: string } | null;
  role: MemberRole | null;
  redirect: string;
}

export interface ImportRow {
  email: string;
  name: string;
  role: string;
}

export type ImportReason =
  | "invalid_email"
  | "duplicate_in_file"
  | "already_member"
  | "already_invited"
  | "bad_role"
  | "over_cap"
  | "domain_not_allowed";

export interface ImportResult {
  rows: { index: number; email: string; status: "ok" | "error" | "skip"; reason: ImportReason | null }[];
  summary: { ok: number; error: number; skip: number; fits: number; seats: Seats };
  created: number;
  email_failures: number;
  email_queued: number;
}

/** Fields the API adds to a 409 `seat_cap_reached` body. */
interface SeatCapError {
  seats_used?: number;
  seat_cap?: number;
}

export const PORTAL_PATH = "/api/v1/portal/institutions/";
export const INVITATION_PATH = "/api/v1/invitations/";

export function institutionPath(slug: string): string {
  return `${PORTAL_PATH}${encodeURIComponent(slug)}/`;
}

export function membersPagePath(slug: string): string {
  return `/portal/${encodeURIComponent(slug)}/members`;
}

export function query(params: Record<string, string | number>): string {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== "" && v !== undefined) q.set(k, String(v));
  });
  const s = q.toString();
  return s ? `?${s}` : "";
}

export function seatsFull(seats: Seats): boolean {
  return seats.cap !== null && seats.used >= seats.cap;
}

export function seatCapMessage(used: number | undefined, cap: number | undefined): string {
  const count = used !== undefined && cap !== undefined ? `All ${used} / ${cap} seats are in use. ` : "There are no free seats. ";
  return `${count}Remove members who no longer need access, or contact BdREN to upgrade your plan.`;
}

const ERROR_MESSAGES: Record<string, string> = {
  already_member: "This person is already a member of your institution.",
  already_invited: "This email already has a pending invitation. Resend it from the Invitations tab.",
  bad_role: "Choose Member or Admin.",
  last_admin: "Your institution needs at least one active admin, so this change isn't allowed.",
  invitation_not_pending: "This invitation is no longer pending.",
  institution_suspended: "Your institution is suspended. Contact BdREN to restore access.",
  domain_not_allowed: "This email's domain isn't one your institution signs in with.",
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
