import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Invite } from "@/components/site/Invite";
import { Register } from "@/components/site/Register";
import { safeNext } from "@/content/site";
import { InvitationPreview } from "@/lib/portal";
import { json, mockApi } from "./net";

const TOKEN = "tok_abc-123";
const PREVIEW = `/api/v1/invitations/${TOKEN}/`;

const INVITE: InvitationPreview = {
  status: "pending",
  email_masked: "r***@du.ac.bd",
  email: null,
  institution: { name: "University of Dhaka" },
  role: "admin",
  invited_by_name: "Nadia Islam",
  expires_at: "2026-11-25T07:00:00Z",
  signed_in: false,
  email_matches: false,
};

function serve(invite: Partial<InvitationPreview>, accept?: () => Response) {
  return mockApi((url, method) => {
    if (url === PREVIEW) return json({ ...INVITE, ...invite });
    if (url === `${PREVIEW}accept/` && method === "POST" && accept) return accept();
    if (url === "/api/v1/csrf/") return json({ ok: true });
    return undefined;
  });
}

describe("Invitation page", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("shows a loading state, then the invitation with sign-in and create-account for visitors", async () => {
    serve({});
    render(<Invite token={TOKEN} />);
    expect(screen.getByText("Loading your invitation…")).toBeInTheDocument();

    expect(await screen.findByRole("heading", { name: "Join University of Dhaka on BdREN AI" })).toBeInTheDocument();
    expect(screen.getByText("Admin")).toBeInTheDocument();
    expect(screen.getByText("Nadia Islam")).toBeInTheDocument();
    expect(screen.getByText("25 Nov 2026")).toBeInTheDocument();
    expect(screen.getAllByText("r***@du.ac.bd").length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/api/v1/auth/login/?next=%2Finvite%2Ftok_abc-123"
    );
    expect(screen.getByRole("link", { name: "Create account" })).toHaveAttribute(
      "href",
      "/register?next=%2Finvite%2Ftok_abc-123"
    );
  });

  it("accepts for the matching signed-in user and links on to the Members page", async () => {
    const calls = serve({ signed_in: true, email_matches: true, email: "rahim@du.ac.bd" }, () =>
      json({ institution: { slug: "du", name: "University of Dhaka" }, role: "admin", redirect: "/portal/du/members" })
    );
    render(<Invite token={TOKEN} />);
    expect(await screen.findByText("rahim@du.ac.bd")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Accept invitation" }));

    expect(await screen.findByRole("heading", { name: "You've joined University of Dhaka" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Continue" })).toHaveAttribute("href", "/portal/du/members");
    const accept = calls.find((c) => c.url.endsWith("/accept/"));
    expect(accept?.method).toBe("POST");
    expect(calls.some((c) => c.url === "/api/v1/csrf/")).toBe(true);
  });

  it("keeps the redirect on this site", async () => {
    serve({ signed_in: true, email_matches: true }, () =>
      json({ institution: null, role: "member", redirect: "//evil.example/steal" })
    );
    render(<Invite token={TOKEN} />);
    fireEvent.click(await screen.findByRole("button", { name: "Accept invitation" }));
    expect(await screen.findByRole("link", { name: "Continue" })).toHaveAttribute("href", "/");
    expect(safeNext("/\\evil.example")).toBe("/");
  });

  it("explains an unverified email when accepting fails", async () => {
    serve({ signed_in: true, email_matches: true }, () =>
      json({ error: "email_unverified", message: "Email not verified." }, 403)
    );
    render(<Invite token={TOKEN} />);
    fireEvent.click(await screen.findByRole("button", { name: "Accept invitation" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Confirm your email address with BdREN first");
  });

  it("offers sign-out when signed in with a different email", async () => {
    serve({ signed_in: true, email_matches: false });
    render(<Invite token={TOKEN} />);
    expect(await screen.findByRole("heading", { name: "This invitation is for another email" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Accept invitation" })).not.toBeInTheDocument();
  });

  it.each([
    ["expired", "This invitation has expired", "Ask Nadia Islam to send a new invitation."],
    ["revoked", "This invitation was withdrawn", "Nadia Islam cancelled it."],
    ["accepted", "This invitation has already been accepted", "Sign in to use your account."],
  ] as const)("says clearly when the invitation is %s", async (status, heading, text) => {
    serve({ status });
    render(<Invite token={TOKEN} />);
    expect(await screen.findByRole("heading", { name: heading })).toBeInTheDocument();
    expect(screen.getByText(text, { exact: false })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Accept invitation" })).not.toBeInTheDocument();
  });

  it("shows an individual invitation without a role", async () => {
    serve({ institution: null, role: null });
    render(<Invite token={TOKEN} />);
    expect(await screen.findByRole("heading", { name: "Join BdREN AI" })).toBeInTheDocument();
    expect(screen.getByText("Personal account")).toBeInTheDocument();
    expect(screen.queryByText("Role")).not.toBeInTheDocument();
  });

  it("treats an unknown token as an invalid link", async () => {
    mockApi(() => undefined);
    render(<Invite token="nope" />);
    expect(await screen.findByRole("heading", { name: "This invitation link isn't valid" })).toBeInTheDocument();
  });
});

describe("Create account from an invitation", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("prefills the email and signs in back to the invitation after confirming", async () => {
    mockApi((url) => {
      if (url.endsWith("/api/v1/auth/institutions/")) return json({ institutions: [], signup_enabled: true });
      if (url.endsWith("/api/v1/auth/register/")) return json({ status: "verification_sent", email: "rahim@du.ac.bd" }, 201);
      if (url.endsWith("/api/v1/auth/register/verify/")) return json({ status: "verified" });
      return undefined;
    });
    render(<Register initialEmail="rahim@du.ac.bd" next={`/invite/${TOKEN}`} />);
    expect(screen.getByLabelText("Email")).toHaveValue("rahim@du.ac.bd");

    fireEvent.change(screen.getByLabelText("First name"), { target: { value: "Rahim" } });
    fireEvent.change(screen.getByLabelText("Last name"), { target: { value: "Uddin" } });
    fireEvent.change(screen.getByLabelText("Institution"), { target: { value: "none" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "Str0ng!pass" } });
    fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "Str0ng!pass" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    fireEvent.change(await screen.findByLabelText("Code"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm email" }));

    expect(await screen.findByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/api/v1/auth/login/?next=%2Finvite%2Ftok_abc-123&login_hint=rahim%40du.ac.bd"
    );
  });
});
