export interface NavLink {
  href: string;
  label: string;
}

export const NAV_LINKS: NavLink[] = [
  { href: "/#products", label: "Products" },
  { href: "/pricing", label: "Pricing" },
  { href: "/about", label: "About" },
  { href: "/about#contact", label: "Contact" },
];

export const CONTACT = {
  email: "noc@bdren.edu.bd",
  phone: "[phone number]",
  office: "[BdREN office address]",
  hours: "[Sunday to Thursday, office hours]",
  replyTime: "[one working day]",
};

export const LOGIN_PATH = "/api/v1/auth/login/";

/** Builds the backend login URL; `loginHint` lets ZITADEL skip its own username step. */
export function loginUrl(next = "/", loginHint?: string): string {
  const params = new URLSearchParams({ next });
  const hint = loginHint?.trim();
  if (hint) params.set("login_hint", hint);
  return `${LOGIN_PATH}?${params.toString()}`;
}

/** Keeps a `next` target on this site: only a relative path, never `//host` or `/\host`. */
export function safeNext(value: string | string[] | null | undefined): string {
  const v = Array.isArray(value) ? value[0] : value;
  return v && v.startsWith("/") && !v.startsWith("//") && !v.startsWith("/\\") ? v : "/";
}
