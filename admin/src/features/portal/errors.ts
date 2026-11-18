import { ApiError } from '@/api/client';
import { seatCapMessage } from './support';

const ERROR_TEXT: Record<string, string> = {
  already_member: 'This person is already a member of your institution.',
  already_invited: 'This email already has a pending invitation. Resend it from the Invited tab.',
  bad_role: 'Choose Member or Admin.',
  last_admin: "Your institution needs at least one active admin, so this change isn't allowed.",
  invitation_not_pending: 'This invitation is no longer pending.',
  institution_suspended: 'Your institution is suspended. Contact BdREN to restore access.',
  already_covered: "This person is already on your institution's package.",
  needs_consent_invitation:
    'This person pays for a personal plan. Send them an invitation instead: they join the package when they accept it.',
  not_coverable: "This person's membership changed meanwhile. Reload the page and try again.",
  not_covered: "This person isn't on your institution's package, so there is nothing to change.",
  personal_plan_member: "This person pays for a personal plan, so you can't change their membership.",
  membership_removed: 'This person is no longer a member.',
  cannot_change_self: "You can't change your own membership here. Ask another admin.",
  cannot_change_owner: "The institution's owner can't be changed here. Contact BdREN.",
  member_of_other_institution: 'This person belongs to another institution. Contact BdREN support to move them.',
  throttled: 'Too many emails were sent just now. Wait a minute and try again.',
};

/** One sentence an institution admin can act on, for an error from the portal API. */
export function portalErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof ApiError)) return error instanceof TypeError ? "We couldn't reach the server. Check your connection and try again." : fallback;
  if (error.code === 'seat_cap_reached') return seatCapMessage(error.body.seats_used, error.body.seat_cap);
  return ERROR_TEXT[error.code] ?? error.body.message ?? fallback;
}
