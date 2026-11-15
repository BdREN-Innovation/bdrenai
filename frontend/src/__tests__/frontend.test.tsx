import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LandingPortal } from "@/components/LandingPortal";
import { AdminDashboard, AdminSummaryData } from "@/components/AdminDashboard";
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

describe("BDREN Public Landing Portal & Subscription Checkout", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders public product catalog and pricing for unauthenticated visitors", async () => {
    vi.spyOn(global, "fetch").mockRejectedValue(new Error("Unauthorized"));
    render(<LandingPortal initialProducts={SAMPLE_PRODUCTS} />);
    expect(screen.getByText(/Mindspear Starter/i)).toBeInTheDocument();
    expect(screen.getByText(/Mindspear Professional/i)).toBeInTheDocument();
    expect(screen.getByText(/BDT 1500.00/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Sign in to Subscribe/i).length).toBeGreaterThan(0);
  });

  it("displays authenticated user, account context switcher, and validates paid package checkout", async () => {
    vi.spyOn(global, "fetch").mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
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

    render(<LandingPortal initialProducts={SAMPLE_PRODUCTS} />);
    await waitFor(() => expect(screen.getByTestId("authenticated-user")).toHaveTextContent("alice@du.ac.bd"));
    expect(screen.getByLabelText("Account Context Switcher")).toBeInTheDocument();

    // Open paid package checkout modal and submit without payment reference -> validation error
    fireEvent.click(screen.getByText("Select Mindspear Professional"));
    fireEvent.click(screen.getByText("Confirm Subscription"));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Payment reference is required for paid packages.")
    );
  });
});

describe("BDREN Admin Dashboard RBAC, Product & Package Versioning", () => {
  const baseSummary: AdminSummaryData = {
    roles: ["product_manager"],
    metrics: {
      total_users: 42,
      active_organizations: 5,
      active_subscriptions: 18,
      total_products: 2,
      completed_revenue_bdt: "75000.00",
      pending_payments: 1,
    },
    recent_events: [
      {
        id: "ev-1",
        action: "package.version_published",
        target_type: "PackageVersion",
        target_id: "v-2",
        actor_email: "pm@bdren.ai",
        created_at: "2026-11-14T20:00:00Z",
      },
    ],
  };

  it("enforces RBAC tabs for product_manager vs platform_super_admin", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ products: SAMPLE_PRODUCTS }), { status: 200 })
    );
    const { rerender } = render(<AdminDashboard initialSummary={baseSummary} />);
    expect(screen.getByText("Product Management")).toBeInTheDocument();
    expect(screen.getByText("Package Versioning")).toBeInTheDocument();
    expect(screen.queryByText("User Management")).not.toBeInTheDocument();

    rerender(<AdminDashboard initialSummary={{ ...baseSummary, roles: ["platform_super_admin"] }} />);
    expect(screen.getByText("User Management")).toBeInTheDocument();
    expect(screen.getByText("Organizations & Federation")).toBeInTheDocument();
    expect(screen.getByText("Subscriptions & Payments")).toBeInTheDocument();
  });

  it("validates product creation and submits package versioning with migration policy", async () => {
    const fetchMock = vi.spyOn(global, "fetch").mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/v1/catalog/products/")) {
        return new Response(JSON.stringify({ products: SAMPLE_PRODUCTS }), { status: 200 });
      }
      if (url.includes("/api/v1/admin/catalog/")) {
        return new Response(JSON.stringify({ version: 3, migrated: 4, scheduled: 0, slug: "mailwizard" }), { status: 201 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    });

    render(<AdminDashboard initialSummary={baseSummary} />);

    // Product Management validation
    fireEvent.click(screen.getByText("Product Management"));
    fireEvent.click(screen.getByRole("button", { name: "Create Product" }));
    expect(screen.getByRole("status")).toHaveTextContent("Product name and slug are required.");

    fireEvent.change(screen.getByLabelText("Product Name"), { target: { value: "Mailwizard" } });
    fireEvent.change(screen.getByLabelText("Product Slug"), { target: { value: "mailwizard" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Product" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Created product mailwizard"));

    // Package Versioning with migration policy
    fireEvent.click(screen.getByText("Package Versioning"));
    await waitFor(() => expect(screen.getByLabelText("Select Package")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Select Package"), { target: { value: "pkg-pro" } });
    fireEvent.change(screen.getByLabelText("Subscriber Migration Policy"), { target: { value: "immediate" } });
    fireEvent.click(screen.getByRole("button", { name: "Publish New Version" }));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Published v3 (policy=immediate, migrated=4, scheduled=0).")
    );
    expect(fetchMock).toHaveBeenCalled();
  });
});
