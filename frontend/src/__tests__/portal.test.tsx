import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Members } from "@/components/portal/Members";
import { Header } from "@/components/site/Header";
import { rowsFromCsv } from "@/lib/csv";
import { Invitation, Member, PortalInstitution } from "@/lib/portal";
import { Call, Route, json, mockApi } from "./net";

const BASE = "/api/v1/portal/institutions/du/";

const INSTITUTION: PortalInstitution = {
  slug: "du",
  name: "University of Dhaka",
  seats: { used: 142, cap: 200 },
  counts: { members: 140, active: 138, suspended: 2, pending_invitations: 4, expired_invitations: 1, pending_requests: 1 },
  sign_in_domains: ["du.ac.bd"],
};

const MEMBERS: Member[] = [
  { membership_id: "m-self", user: { id: "u-self", name: "Nadia Islam", email: "nadia@du.ac.bd", status: "active" }, role: "admin", status: "active", joined_at: "2026-10-01T00:00:00Z" },
  { membership_id: "m-owner", user: { id: "u-owner", name: "Karim Owner", email: "karim@du.ac.bd", status: "active" }, role: "owner", status: "active", joined_at: "2026-09-01T00:00:00Z" },
  { membership_id: "m-1", user: { id: "u-1", name: "Rahim Uddin", email: "rahim@du.ac.bd", status: "active" }, role: "member", status: "active", joined_at: "2026-11-02T00:00:00Z" },
  { membership_id: "m-2", user: { id: "u-2", name: "Sadia Khan", email: "sadia@du.ac.bd", status: "active" }, role: "member", status: "pending", joined_at: null },
];

const INVITATIONS: Invitation[] = [
  {
    id: "inv-1", email: "tanvir@du.ac.bd", name: "Tanvir", institution: { slug: "du", name: "University of Dhaka" }, role: "member",
    status: "pending", source: "portal", invited_by: { id: "u-self", name: "Nadia Islam" }, expires_at: "2026-11-25T00:00:00Z",
    created_at: "2026-11-18T00:00:00Z", last_sent_at: "2026-11-18T00:00:00Z", sent_count: 1, email_status: "sent", accepted_by: null, accepted_at: null,
  },
];

const page = <T,>(results: T[]) => ({ results, count: results.length, page: 1, page_size: 25 });

function portal(extra: Route = () => undefined, institution: PortalInstitution = INSTITUTION): Call[] {
  return mockApi((url, method, body) => {
    const custom = extra(url, method, body);
    if (custom) return custom;
    if (url === "/api/v1/csrf/") return json({ ok: true });
    if (url === "/api/v1/auth/profile/") return json({ id: "u-self", name: "Nadia Islam", email: "nadia@du.ac.bd" });
    if (url === BASE) return json(institution);
    if (url.startsWith(`${BASE}members/?`)) return json(page(MEMBERS));
    if (url.startsWith(`${BASE}invitations/?`)) return json(page(INVITATIONS));
    return undefined;
  });
}

describe("Members page", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps keyboard focus inside a dialog and makes the page behind it inert", async () => {
    portal();
    const { container } = render(<Members slug="du" />);
    const rahim = (await screen.findByText("Rahim Uddin")).closest("tr") as HTMLElement;
    const opener = within(rahim).getByRole("button", { name: "Remove" });
    opener.focus();
    fireEvent.click(opener);

    const dialog = screen.getByRole("dialog", { name: "Remove Rahim Uddin?" });
    expect(container).toHaveAttribute("inert");
    expect(container.contains(dialog)).toBe(false);
    const cancel = within(dialog).getByRole("button", { name: "Cancel" });
    const remove = within(dialog).getByRole("button", { name: "Remove" });
    expect(cancel).toHaveFocus();

    remove.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(cancel).toHaveFocus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(remove).toHaveFocus();
    opener.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(cancel).toHaveFocus();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(container).not.toHaveAttribute("inert");
    expect(opener).toHaveFocus();
  });

  it("shows the answer for the current filter even when an earlier request answers last", async () => {
    let answerSlow: (r: Response) => void = () => undefined;
    const slow = new Promise<Response>((resolve) => {
      answerSlow = resolve;
    });
    const suspended: Member = { ...MEMBERS[2], membership_id: "m-3", user: { ...MEMBERS[2].user, id: "u-3", name: "Suspended Person" }, status: "suspended" };
    const route = (url: string): Response | Promise<Response> | undefined => {
      if (url.includes("status=pending")) return slow;
      if (url.includes("status=suspended")) return json(page([suspended]));
      return undefined;
    };
    portal();
    const answer = vi.mocked(fetch).getMockImplementation();
    vi.mocked(fetch).mockImplementation(async (input, init) => route(String(input)) ?? answer!(input, init));
    render(<Members slug="du" />);
    await screen.findByText("Rahim Uddin");

    const status = screen.getByRole("combobox", { name: "Status" });
    fireEvent.change(status, { target: { value: "pending" } });
    fireEvent.change(status, { target: { value: "suspended" } });
    expect(await screen.findByText("Suspended Person")).toBeInTheDocument();

    answerSlow(json(page([MEMBERS[3]])));
    await slow;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.getByText("Suspended Person")).toBeInTheDocument();
    expect(screen.queryByText("Sadia Khan")).not.toBeInTheDocument();
  });

  it("asks signed-out visitors to sign in and comes back to the page", async () => {
    mockApi((url) => (url === BASE ? json({ error: "not_authenticated" }, 401) : undefined));
    render(<Members slug="du" />);
    expect(screen.getByText("Loading members…")).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/api/v1/auth/login/?next=%2Fportal%2Fdu%2Fmembers"
    );
  });

  it("treats DRF's 403 for an anonymous visitor as signed out", async () => {
    mockApi((url) =>
      url === BASE || url === "/api/v1/auth/profile/"
        ? json({ detail: "Authentication credentials were not provided." }, 403)
        : undefined
    );
    render(<Members slug="du" />);
    expect(await screen.findByRole("heading", { name: "Sign in to manage members" })).toBeInTheDocument();
  });

  it("tells non-admins kindly that they can't manage the institution", async () => {
    portal((url) => (url === BASE ? json({ error: "forbidden", message: "Forbidden" }, 403) : undefined));
    render(<Members slug="du" />);
    expect(await screen.findByRole("heading", { name: "You don't manage this institution" })).toBeInTheDocument();
  });

  it("explains a suspended institution", async () => {
    portal((url) => (url === BASE ? json({ error: "institution_suspended", message: "Suspended" }, 403) : undefined));
    render(<Members slug="du" />);
    expect(await screen.findByRole("heading", { name: "This institution is suspended" })).toBeInTheDocument();
  });

  it("shows the seat meter, members and the right row actions", async () => {
    portal();
    render(<Members slug="du" />);
    expect(await screen.findByText("142 / 200 seats")).toBeInTheDocument();
    expect(screen.getByText("58 free", { exact: false })).toBeInTheDocument();
    expect(screen.getByText(/1 person is waiting/)).toBeInTheDocument();

    const self = (await screen.findByText("Nadia Islam")).closest("tr") as HTMLElement;
    expect(within(self).getByText("You")).toBeInTheDocument();
    expect(within(self).queryByRole("button")).not.toBeInTheDocument();
    const owner = screen.getByText("Karim Owner").closest("tr") as HTMLElement;
    expect(within(owner).queryByRole("button")).not.toBeInTheDocument();

    const rahim = screen.getByText("Rahim Uddin").closest("tr") as HTMLElement;
    expect(within(rahim).getAllByRole("button").map((b) => b.textContent)).toEqual(["Make admin", "Suspend", "Remove"]);
    const sadia = screen.getByText("Sadia Khan").closest("tr") as HTMLElement;
    expect(within(sadia).getAllByRole("button").map((b) => b.textContent)).toEqual(["Approve", "Remove"]);
  });

  it("shows unlimited seats when there is no cap", async () => {
    portal(undefined, { ...INSTITUTION, seats: { used: 12, cap: null } });
    render(<Members slug="du" />);
    expect(await screen.findByText("12 seats in use")).toBeInTheDocument();
    expect(screen.getByText("Unlimited seats")).toBeInTheDocument();
  });

  it("changes a role, approves a request and removes a member after confirming", async () => {
    const calls = portal((url, method) => {
      if (url.startsWith(`${BASE}members/m-`) && (method === "PATCH" || method === "POST")) return json({ ok: true });
      return undefined;
    });
    render(<Members slug="du" />);
    const rahim = (await screen.findByText("Rahim Uddin")).closest("tr") as HTMLElement;

    fireEvent.click(within(rahim).getByRole("button", { name: "Make admin" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Rahim Uddin is now an admin.");
    expect(calls.find((c) => c.method === "PATCH")).toMatchObject({ url: `${BASE}members/m-1/`, body: { role: "admin" } });

    const sadia = screen.getByText("Sadia Khan").closest("tr") as HTMLElement;
    fireEvent.click(within(sadia).getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Sadia Khan is approved."));
    expect(calls.filter((c) => c.method === "PATCH")[1]).toMatchObject({ url: `${BASE}members/m-2/`, body: { status: "active" } });

    fireEvent.click(within(rahim).getByRole("button", { name: "Remove" }));
    const dialog = screen.getByRole("dialog", { name: "Remove Rahim Uddin?" });
    expect(calls.some((c) => c.url.endsWith("/remove/"))).toBe(false);
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Rahim Uddin is removed."));
    expect(calls.find((c) => c.url.endsWith("/remove/"))).toMatchObject({ url: `${BASE}members/m-1/remove/`, method: "POST" });
  });

  it("explains the seat cap when approving would go over it", async () => {
    portal((url, method) =>
      method === "PATCH" ? json({ error: "seat_cap_reached", message: "Seat cap reached", seats_used: 200, seat_cap: 200 }, 409) : undefined
    );
    render(<Members slug="du" />);
    const sadia = (await screen.findByText("Sadia Khan")).closest("tr") as HTMLElement;
    fireEvent.click(within(sadia).getByRole("button", { name: "Approve" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "All 200 / 200 seats are in use. Remove members who no longer need access, or contact BdREN to upgrade your plan."
    );
  });

  it("filters and searches members on the server", async () => {
    const calls = portal();
    render(<Members slug="du" />);
    await screen.findByText("Rahim Uddin");
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "pending" } });
    fireEvent.change(screen.getByLabelText("Role"), { target: { value: "admin" } });
    fireEvent.change(screen.getByLabelText("Name or email"), { target: { value: " rahim " } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() =>
      expect(calls.map((c) => c.url)).toContain(`${BASE}members/?q=rahim&status=pending&role=admin&page=1&page_size=25`)
    );
  });

  it("invites a member and shows the seat-cap conflict clearly", async () => {
    let full = false;
    const calls = portal((url, method) => {
      if (url !== `${BASE}invitations/` || method !== "POST") return undefined;
      if (full) return json({ error: "seat_cap_reached", message: "Seat cap reached", seats_used: 200, seat_cap: 200 }, 409);
      return json({ invitation: { ...INVITATIONS[0], email: "new@du.ac.bd" }, email_sent: true }, 201);
    });
    render(<Members slug="du" />);
    fireEvent.click(await screen.findByRole("button", { name: "Invite member" }));
    const dialog = screen.getByRole("dialog", { name: "Invite member" });
    const send = within(dialog).getByRole("button", { name: "Send invitation" });
    expect(send).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText("Email"), { target: { value: "new@du.ac.bd" } });
    fireEvent.change(within(dialog).getByLabelText(/Name/), { target: { value: "New Person" } });
    fireEvent.change(within(dialog).getByLabelText("Role"), { target: { value: "admin" } });
    fireEvent.click(send);
    expect(await screen.findByRole("status")).toHaveTextContent("Invitation sent to new@du.ac.bd.");
    expect(calls.find((c) => c.method === "POST" && c.url === `${BASE}invitations/`)?.body).toEqual({
      email: "new@du.ac.bd",
      name: "New Person",
      role: "admin",
    });

    full = true;
    fireEvent.click(screen.getByRole("button", { name: "Invite member" }));
    const again = screen.getByRole("dialog", { name: "Invite member" });
    fireEvent.change(within(again).getByLabelText("Email"), { target: { value: "late@du.ac.bd" } });
    fireEvent.click(within(again).getByRole("button", { name: "Send invitation" }));
    expect(await within(again).findByRole("alert")).toHaveTextContent("contact BdREN to upgrade your plan");
  });

  it("blocks invites and imports when every seat is taken", async () => {
    portal(undefined, { ...INSTITUTION, seats: { used: 200, cap: 200 } });
    render(<Members slug="du" />);
    expect(await screen.findByText("200 / 200 seats")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Invite member" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Import CSV" })).toBeDisabled();
    expect(screen.getByText(/All 200 \/ 200 seats are in use/)).toBeInTheDocument();
  });

  it("previews a CSV import with per-row reasons, then sends the rows that fit", async () => {
    const calls = portal((url, method, body) => {
      if (url !== `${BASE}import/` || method !== "POST") return undefined;
      const dryRun = (body as { dry_run: boolean }).dry_run;
      return json({
        rows: [
          { index: 0, email: "a@du.ac.bd", status: "ok" },
          { index: 1, email: "not-an-email", status: "error", reason: "invalid_email" },
          { index: 2, email: "rahim@du.ac.bd", status: "skip", reason: "already_member" },
        ],
        summary: { ok: 1, error: 1, skip: 1, fits: 1, seats: { used: 142, cap: 200 } },
        created: dryRun ? 0 : 1,
        email_failures: 0,
      });
    });
    render(<Members slug="du" />);
    fireEvent.click(await screen.findByRole("button", { name: "Import CSV" }));
    const dialog = screen.getByRole("dialog", { name: "Import members from CSV" });
    fireEvent.change(within(dialog).getByLabelText("Or paste rows"), {
      target: { value: "email,name,role\na@du.ac.bd,A Person,\nnot-an-email,B,member\nrahim@du.ac.bd,Rahim,admin\n" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Preview" }));

    expect(await within(dialog).findByText("1 of 3 fit")).toBeInTheDocument();
    expect(within(dialog).getByText("Not a valid email")).toBeInTheDocument();
    expect(within(dialog).getByText("Already a member")).toBeInTheDocument();
    const preview = calls.find((c) => c.url === `${BASE}import/`);
    expect(preview?.body).toEqual({
      dry_run: true,
      rows: [
        { email: "a@du.ac.bd", name: "A Person", role: "member" },
        { email: "not-an-email", name: "B", role: "member" },
        { email: "rahim@du.ac.bd", name: "Rahim", role: "admin" },
      ],
    });

    fireEvent.click(within(dialog).getByRole("button", { name: "Send 1 invitation" }));
    expect(await screen.findByRole("status")).toHaveTextContent("1 invitation created.");
    expect(calls.filter((c) => c.url === `${BASE}import/`)[1].body).toMatchObject({ dry_run: false });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("lists invitations by status and resends or revokes them", async () => {
    const calls = portal((url, method) => {
      if (url.endsWith("/inv-1/resend/") && method === "POST") return json({ invitation: INVITATIONS[0], email_sent: true });
      if (url.endsWith("/inv-1/revoke/") && method === "POST") return json({ invitation: { ...INVITATIONS[0], status: "revoked" } });
      return undefined;
    });
    render(<Members slug="du" />);
    fireEvent.click(await screen.findByRole("tab", { name: "Invitations (4 pending)" }));
    const row = (await screen.findByText("tanvir@du.ac.bd")).closest("tr") as HTMLElement;
    expect(calls.map((c) => c.url)).toContain(`${BASE}invitations/?status=pending&page=1&page_size=25`);

    fireEvent.change(screen.getByLabelText("Invitation status"), { target: { value: "expired" } });
    await waitFor(() => expect(calls.map((c) => c.url)).toContain(`${BASE}invitations/?status=expired&page=1&page_size=25`));

    fireEvent.click(within(row).getByRole("button", { name: "Resend" }));
    expect(await screen.findByRole("status")).toHaveTextContent("A new invitation link went to tanvir@du.ac.bd.");

    fireEvent.click(within(screen.getByText("tanvir@du.ac.bd").closest("tr") as HTMLElement).getByRole("button", { name: "Revoke" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Revoke" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("The invitation to tanvir@du.ac.bd is revoked."));
  });
});

describe("Profile menu for institution admins", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("links to Members for each institution the user administers", async () => {
    mockApi((url) => {
      if (url === "/api/v1/auth/profile/") {
        return json({ id: "u-self", name: "Nadia Islam", email: "nadia@du.ac.bd", avatar_url: null });
      }
      if (url === "/api/v1/portal/institutions/") {
        return json([{ slug: "du", name: "University of Dhaka", status: "active", seats: { used: 1, cap: 5 }, role: "admin" }]);
      }
      return undefined;
    });
    render(<Header />);
    fireEvent.click(await screen.findByRole("button", { name: "Profile menu for Nadia Islam" }));
    const link = await screen.findByRole("menuitem", { name: /Manage members/ });
    expect(link).toHaveAttribute("href", "/portal/du/members");
    expect(link).toHaveTextContent("University of Dhaka");
  });
});

describe("CSV rows", () => {
  it("reads quoted fields and works without a header", () => {
    expect(rowsFromCsv('x@du.ac.bd,"Uddin, Rahim",Admin\r\n\r\ny@du.ac.bd')).toEqual([
      { email: "x@du.ac.bd", name: "Uddin, Rahim", role: "admin" },
      { email: "y@du.ac.bd", name: "", role: "member" },
    ]);
    expect(rowsFromCsv("﻿Name,Email\nRahim,r@du.ac.bd")).toEqual([{ email: "r@du.ac.bd", name: "Rahim", role: "member" }]);
  });
});
