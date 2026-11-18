import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loginUrl } from "@/content/site";
import { Header } from "@/components/site/Header";
import { SignIn } from "@/components/site/SignIn";
import { Register } from "@/components/site/Register";
import { Profile } from "@/components/site/Profile";
import { Pricing } from "@/components/pricing/Pricing";
import { Checkout } from "@/components/pricing/Checkout";
import { CatalogProduct } from "@/lib/api";

const SAMPLE_PRODUCTS: CatalogProduct[] = [
  {
    id: "prod-1",
    name: "Mindspear",
    slug: "mindspear",
    description: "AI Research Assistant",
    features: [{ key: "ai_requests", name: "AI Requests", unit: "requests", description: "" }],
    packages: [
      {
        id: "pkg-free",
        name: "Mindspear Starter",
        slug: "starter",
        description: "Free tier",
        price: "0.00",
        currency: "BDT",
        billing_interval: "free",
        trial_days: 0,
        latest_version: 1,
        package_version_id: "ver-1",
        limits: [
          { feature_key: "ai_requests", feature_name: "AI Requests", unit: "requests", limit_value: 500, limit_period: "monthly" },
        ],
      },
      {
        id: "pkg-pro",
        name: "Mindspear Professional",
        slug: "professional",
        description: "Pro tier",
        price: "1500.00",
        currency: "BDT",
        billing_interval: "monthly",
        trial_days: 14,
        latest_version: 2,
        package_version_id: "ver-2",
        limits: [
          { feature_key: "ai_requests", feature_name: "AI Requests", unit: "requests", limit_value: 5000, limit_period: "monthly" },
        ],
      },
    ],
  },
];

const PROFILE = {
  id: "u-1",
  first_name: "Alice",
  last_name: "Rahman",
  name: "Alice Rahman",
  email: "alice@du.ac.bd",
  email_verified: true,
  avatar_url: null,
  member_since: "2026-11-01",
  memberships: [{ organization: "Dhaka University", role: "member", status: "pending" }],
  is_superadmin: false,
  can_edit_name: true,
};

function mockSignedInApi(extra: (url: string, init?: RequestInit) => Response | undefined = () => undefined) {
  const calls: { url: string; method: string; body?: BodyInit | null }[] = [];
  vi.spyOn(global, "fetch").mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, method: init?.method || "GET", body: init?.body });
    const custom = extra(url, init);
    if (custom) return custom;
      if (url.endsWith("/api/v1/auth/profile/billing/")) {
        return new Response(JSON.stringify({ subscriptions: [], payments: [] }), { status: 200 });
      }
      if (url.endsWith("/api/v1/auth/profile/")) {
        return new Response(JSON.stringify(PROFILE), { status: 200 });
      }
      if (url.includes("/api/v1/auth/me/")) {
        return new Response(
          JSON.stringify({
            id: "u-1",
            email: "alice@du.ac.bd",
            email_verified: true,
            name: "Alice",
            active_account_id: "acct-pers",
            accounts: [{ id: "acct-pers", type: "personal" }],
            memberships: [],
            external_identities: [],
          }),
          { status: 200 }
        );
      }
      if (url.includes("/api/v1/accounts/contexts/")) {
        return new Response(
          JSON.stringify({
            active_account_id: "acct-pers",
            contexts: [
              { account_id: "acct-pers", account_type: "personal", organization: null, role: "owner", is_active_context: true },
              {
                account_id: "acct-org",
                account_type: "organization",
                organization: { id: "o1", name: "Dhaka University", slug: "du" },
                role: "admin",
                is_active_context: false,
              },
            ],
          }),
          { status: 200 }
        );
      }
      return new Response(JSON.stringify({ status: "pending_payment_verification", reference: "INV-100" }), { status: 202 });
  });
  return calls;
}

describe("BdREN AI website", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("shows sign-in to visitors and a two-item profile menu to signed-in users", async () => {
    vi.spyOn(global, "fetch").mockRejectedValue(new Error("Unauthorized"));
    const { unmount } = render(<Header />);
    expect(screen.getByText("Sign in with BdREN")).toHaveAttribute("href", "/sign-in");
    unmount();

    mockSignedInApi();
    render(<Header />);
    const toggle = await screen.findByRole("button", { name: "Profile menu for Alice Rahman" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    fireEvent.click(toggle);
    const items = screen.getAllByRole("menuitem");
    expect(items.map((i) => i.textContent?.trim())).toEqual(["My profile", "Log out"]);
    expect(items[0]).toHaveAttribute("href", "/profile");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("adds the admin panel to the profile menu for superadmins only", async () => {
    mockSignedInApi((url) =>
      url.endsWith("/api/v1/auth/profile/")
        ? new Response(JSON.stringify({ ...PROFILE, is_superadmin: true }), { status: 200 })
        : undefined
    );
    render(<Header />);
    fireEvent.click(await screen.findByRole("button", { name: "Profile menu for Alice Rahman" }));
    const items = screen.getAllByRole("menuitem");
    expect(items.map((i) => i.textContent?.trim())).toEqual(["My profile", "Admin panel", "Log out"]);
    expect(items[1]).toHaveAttribute("href", "/admin/");
  });

  it("leads with the Suite and switches to single-product packages", () => {
    render(<Pricing />);
    expect(screen.getByRole("button", { name: /BdREN AI Suite/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("heading", { level: 3, name: "Suite Pro" })).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Included in the Suite" })).toHaveTextContent("QuiGen");

    fireEvent.click(screen.getByRole("button", { name: /A single product/ }));
    fireEvent.click(screen.getByRole("button", { name: "AI Mail Wizard" }));
    expect(screen.getByText("Get Mail Wizard")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Compare AI Mail Wizard plans" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 3, name: "Suite Pro" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "See the BdREN AI Suite" }));
    expect(screen.getByRole("heading", { level: 3, name: "Suite Pro" })).toBeInTheDocument();
  });

  it("lists live catalog packages and asks visitors to sign in to subscribe", () => {
    vi.spyOn(global, "fetch").mockRejectedValue(new Error("Unauthorized"));
    render(<Checkout initialProducts={SAMPLE_PRODUCTS} />);
    expect(screen.getByText("Mindspear Professional")).toBeInTheDocument();
    expect(screen.getByText(/BDT 1500.00/)).toBeInTheDocument();
    expect(screen.getAllByText("Sign in to Subscribe")[0]).toHaveAttribute(
      "href",
      "/sign-in?next=%2Fpricing%23subscribe"
    );
  });

  it("validates the payment reference for paid packages", async () => {
    mockSignedInApi();
    render(<Checkout initialProducts={SAMPLE_PRODUCTS} />);
    fireEvent.click(await screen.findByText("Select Mindspear Professional"));
    fireEvent.click(screen.getByText("Confirm Subscription"));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Payment reference is required for paid packages.")
    );
  });

  it("passes the typed email to the IdP as a login hint", () => {
    expect(loginUrl("/pricing", " alice@du.ac.bd ")).toBe(
      "/api/v1/auth/login/?next=%2Fpricing&login_hint=alice%40du.ac.bd"
    );
    expect(loginUrl()).toBe("/api/v1/auth/login/?next=%2F");
    render(<SignIn />);
    expect(screen.getByLabelText("Email or username")).toHaveAttribute("autocomplete", "username");
    expect(screen.getByText("Sign in with a passkey")).toHaveAttribute("href", "/api/v1/auth/login/?next=%2F");
    expect(screen.getByText("Create an account")).toHaveAttribute("href", "/register");
  });
});

describe("Create account", () => {
  const ORG_ID = "6f1c2a9e-0000-4000-8000-000000000001";

  function mockSignupApi(register: () => Response) {
    const calls: { url: string; body?: unknown }[] = [];
    vi.spyOn(global, "fetch").mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url.endsWith("/api/v1/auth/institutions/")) {
        return new Response(
          JSON.stringify({ institutions: [{ id: ORG_ID, name: "University of Dhaka" }], signup_enabled: true }),
          { status: 200 }
        );
      }
      if (url.endsWith("/api/v1/auth/register/")) return register();
      if (url.endsWith("/api/v1/auth/register/verify/")) {
        return new Response(JSON.stringify({ status: "verified", email: "rahim@du.ac.bd" }), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    });
    return calls;
  }

  async function fillForm() {
    await screen.findByRole("option", { name: "University of Dhaka" });
    fireEvent.change(screen.getByLabelText("First name"), { target: { value: "Rahim" } });
    fireEvent.change(screen.getByLabelText("Last name"), { target: { value: "Uddin" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "rahim@du.ac.bd" } });
    fireEvent.change(screen.getByLabelText("Institution"), { target: { value: ORG_ID } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "Str0ng!pass" } });
  }

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps Create account off until the form is valid, then signs up and confirms the email", async () => {
    const calls = mockSignupApi(
      () => new Response(JSON.stringify({ status: "verification_sent", email: "rahim@du.ac.bd" }), { status: 201 })
    );
    render(<Register />);
    await fillForm();
    const create = screen.getByRole("button", { name: "Create account" });
    expect(create).toBeDisabled();
    expect(screen.getByRole("list", { name: "Password rules" })).not.toHaveTextContent("(not yet)");

    fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "Str0ng!pas" } });
    expect(screen.getByText("The passwords don't match.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "Str0ng!pass" } });
    fireEvent.click(screen.getByRole("checkbox"));
    expect(create).toBeEnabled();

    fireEvent.click(create);
    await screen.findByRole("heading", { name: "Check your email" });
    expect(calls.find((c) => c.url.endsWith("/register/"))?.body).toMatchObject({
      first_name: "Rahim",
      email: "rahim@du.ac.bd",
      institution: ORG_ID,
      confirm_password: "Str0ng!pass",
      accepted_terms: true,
    });

    fireEvent.change(screen.getByLabelText("Code"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm email" }));
    await screen.findByRole("heading", { name: "Welcome, Rahim" });
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/api/v1/auth/login/?next=%2F&login_hint=rahim%40du.ac.bd"
    );
  });

  it("shows the server's message on the email field when the address is taken", async () => {
    mockSignupApi(
      () =>
        new Response(
          JSON.stringify({ error: "email_taken", fields: { email: "An account with this email already exists." } }),
          { status: 409 }
        )
    );
    render(<Register />);
    await fillForm();
    fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "Str0ng!pass" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByText("An account with this email already exists.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Create your account" })).toBeInTheDocument();
  });

  it("falls back to ZITADEL's own sign-up when website sign-up is off", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ institutions: [], signup_enabled: false }), { status: 200 })
    );
    render(<Register />);
    expect(await screen.findByText("Continue to BdREN sign-in")).toHaveAttribute("href", "/api/v1/auth/login/?next=%2F");
  });
});

describe("My profile", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("shows details, keeps the email read-only and saves a new name", async () => {
    const calls = mockSignedInApi((url, init) =>
      url.endsWith("/api/v1/auth/profile/") && init?.method === "PATCH"
        ? new Response(JSON.stringify({ ...PROFILE, first_name: "Alia", name: "Alia Rahman" }), { status: 200 })
        : undefined
    );
    render(<Profile />);
    expect(await screen.findByRole("heading", { name: "Alice Rahman" })).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toHaveAttribute("readonly");
    expect(screen.getByText(/Your email can't be changed/)).toBeInTheDocument();
    expect(screen.getByText("Waiting for approval")).toBeInTheDocument();

    const save = screen.getByRole("button", { name: "Save changes" });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText("First name"), { target: { value: "Alia" } });
    fireEvent.click(save);
    expect(await screen.findByText("Your details are saved.")).toBeInTheDocument();
    const sent = calls.find((c) => c.method === "PATCH");
    expect(JSON.parse(String(sent?.body))).toEqual({ first_name: "Alia", last_name: "Rahman" });
    expect(screen.getByRole("heading", { name: "Alia Rahman" })).toBeInTheDocument();
  });

  it("uploads a photo and rejects unsupported files before sending", async () => {
    const calls = mockSignedInApi((url, init) =>
      url.endsWith("/profile/avatar/") && init?.method === "POST"
        ? new Response(JSON.stringify({ avatar_url: "/api/v1/auth/profile/avatar/?v=1" }), { status: 200 })
        : undefined
    );
    render(<Profile />);
    const input = await screen.findByLabelText("Upload a profile photo");

    fireEvent.change(input, { target: { files: [new File(["<svg/>"], "x.svg", { type: "image/svg+xml" })] } });
    expect(await screen.findByText("Use a PNG, JPEG or WebP image.")).toBeInTheDocument();
    expect(calls.some((c) => c.url.endsWith("/avatar/"))).toBe(false);

    fireEvent.change(input, { target: { files: [new File(["png"], "me.png", { type: "image/png" })] } });
    expect(await screen.findByRole("button", { name: "Remove" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Change photo" })).toBeInTheDocument();
    expect(calls.find((c) => c.url.endsWith("/avatar/"))?.body).toBeInstanceOf(FormData);
  });

  it("lists plans and payments in billing, with an empty state", async () => {
    mockSignedInApi((url) =>
      url.endsWith("/profile/billing/")
        ? new Response(
            JSON.stringify({
              subscriptions: [
                {
                  id: "s1", account: "Personal", product: "Synapse", package: "Pro", version: 2, status: "active",
                  billing_interval: "monthly", price: "1500.00", currency: "BDT", starts_at: "2026-11-01", expires_at: "2026-12-01",
                },
              ],
              payments: [],
            }),
            { status: 200 }
          )
        : undefined
    );
    render(<Profile />);
    expect(await screen.findByText("Synapse · Pro")).toBeInTheDocument();
    expect(screen.getByText("BDT 1,500.00")).toBeInTheDocument();
    expect(screen.getByText("No payments yet.")).toBeInTheDocument();
  });

  it("asks signed-out visitors to sign in", async () => {
    vi.spyOn(global, "fetch").mockRejectedValue(new Error("Unauthorized"));
    render(<Profile />);
    expect(await screen.findByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/api/v1/auth/login/?next=%2Fprofile"
    );
  });
});
