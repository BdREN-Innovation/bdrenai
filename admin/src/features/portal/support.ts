import type { Seats } from '@/api/types';

/** BDREN support (the NOC), as on the website's contact page. */
export const SUPPORT_EMAIL = 'noc@bdren.edu.bd';

/** The public BDREN AI website; nginx serves it on the same origin, Vite dev may point elsewhere. */
export const WEBSITE_URL = import.meta.env.VITE_WEBSITE_URL || '/';

/** A `mailto:` link to BDREN support with the subject and body filled in. */
export function supportMailto(subject: string, body: string): string {
  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/** "Report to BDREN support" for someone who may be in the wrong institution: only BdREN can move them. */
export function wrongInstitutionMailto(
  institution: { name: string; slug: string },
  person: { membership_id: string; user: { name: string; email: string } },
): string {
  const who = person.user.name ? `${person.user.name} <${person.user.email}>` : person.user.email;
  return supportMailto(
    `Wrong institution: ${person.user.email}`,
    `Institution: ${institution.name} (${institution.slug})\nPerson: ${who}\nMembership id: ${person.membership_id}\n\nWhat is wrong: \n`,
  );
}

export function domainRequestMailto(institution: { name: string; slug: string }): string {
  return supportMailto(
    `Email domain request for ${institution.name}`,
    `Institution: ${institution.name} (${institution.slug})\nDomain to add: \nWhy: \n`,
  );
}

export const REMOVAL_CONSEQUENCE =
  'Loses the institution package and institution knowledge; keeps their account and data and can continue as a free user or buy a personal package.';

export function seatsFull(seats: Seats): boolean {
  return seats.cap !== null && seats.used >= seats.cap;
}

export function freeSeats(seats: Seats): number | null {
  return seats.cap === null ? null : Math.max(0, seats.cap - seats.used);
}

export function seatCapMessage(used: number | undefined, cap: number | null | undefined): string {
  const count =
    used !== undefined && cap !== undefined && cap !== null ? `All ${used} / ${cap} seats are in use. ` : 'There are no free seats. ';
  return `${count}Remove members who no longer need access, or contact BdREN to upgrade your plan.`;
}
