"use client";
import React, { useEffect, useState } from "react";
import { apiFetch, logout } from "@/lib/api";

export interface AdminSummaryData {
  roles: string[];
  metrics: {
    total_users: number;
    active_organizations: number;
    active_subscriptions: number;
    total_products: number;
    completed_revenue_bdt: string;
    pending_payments: number;
  };
  recent_events: {
    id: string;
    action: string;
    target_type: string;
    target_id: string;
    actor_email: string | null;
    created_at: string;
  }[];
}

export function AdminDashboard({ initialSummary }: { initialSummary?: AdminSummaryData | null }) {
  const [summary, setSummary] = useState<AdminSummaryData | null>(initialSummary ?? null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<
    "overview" | "users" | "organizations" | "products" | "packages" | "subscriptions" | "usage"
  >("overview");

  // Data lists
  const [users, setUsers] = useState<any[]>([]);
  const [orgs, setOrgs] = useState<any[]>([]);
  const [catalog, setCatalog] = useState<any[]>([]);
  const [subs, setSubs] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [usageAudit, setUsageAudit] = useState<{ usage_counters: any[]; audit_logs: any[] }>({
    usage_counters: [],
    audit_logs: [],
  });

  // Forms
  const [newProdName, setNewProdName] = useState("");
  const [newProdSlug, setNewProdSlug] = useState("");
  const [pkgIdToVersion, setPkgIdToVersion] = useState("");
  const [newLimitFeature, setNewLimitFeature] = useState("ai_requests");
  const [newLimitValue, setNewLimitValue] = useState("10000");
  const [migrationPolicy, setMigrationPolicy] = useState("new_only");
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    if (initialSummary !== undefined) {
      setSummary(initialSummary);
    } else {
      apiFetch<AdminSummaryData>("/api/v1/admin/summary/")
        .then(setSummary)
        .catch((e) => setAuthError(e.message));
    }
    apiFetch<{ products: any[] }>("/api/v1/catalog/products/")
      .then((d) => setCatalog(d.products))
      .catch(() => {});
  }, [initialSummary]);

  function hasRole(...allowed: string[]): boolean {
    if (!summary) return false;
    if (summary.roles.includes("platform_super_admin")) return true;
    return allowed.some((r) => summary.roles.includes(r));
  }

  async function loadTab(tab: typeof activeTab) {
    setActiveTab(tab);
    setFeedback(null);
    try {
      if (tab === "users") {
        const d = await apiFetch<{ users: any[] }>("/api/v1/admin/users/");
        setUsers(d.users);
      } else if (tab === "organizations") {
        const d = await apiFetch<{ organizations: any[] }>("/api/v1/admin/organizations/");
        setOrgs(d.organizations);
      } else if (tab === "subscriptions") {
        const d = await apiFetch<{ subscriptions: any[]; payments: any[] }>("/api/v1/admin/subscriptions/");
        setSubs(d.subscriptions);
        setPayments(d.payments);
      } else if (tab === "usage") {
        const d = await apiFetch<{ usage_counters: any[]; audit_logs: any[] }>("/api/v1/admin/usage-audit/");
        setUsageAudit(d);
      }
    } catch (e: any) {
      setFeedback(`Error: ${e.message}`);
    }
  }

  async function handleCreateProduct(e: React.FormEvent) {
    e.preventDefault();
    setFeedback(null);
    if (!newProdName.trim() || !newProdSlug.trim()) {
      setFeedback("Product name and slug are required.");
      return;
    }
    try {
      const res = await apiFetch("/api/v1/admin/catalog/", {
        method: "POST",
        body: JSON.stringify({
          action: "create_product",
          name: newProdName.trim(),
          slug: newProdSlug.trim(),
        }),
      });
      setFeedback(`Created product ${res.slug} (API key provisioned).`);
      setNewProdName("");
      setNewProdSlug("");
    } catch (err: any) {
      setFeedback(`Error: ${err.message}`);
    }
  }

  async function handlePublishVersion(e: React.FormEvent) {
    e.preventDefault();
    setFeedback(null);
    if (!pkgIdToVersion) {
      setFeedback("Please select a package to version.");
      return;
    }
    try {
      const res = await apiFetch("/api/v1/admin/catalog/", {
        method: "POST",
        body: JSON.stringify({
          action: "publish_package_version",
          package_id: pkgIdToVersion,
          migration_policy: migrationPolicy,
          limits: [
            {
              feature_key: newLimitFeature,
              limit_value: parseInt(newLimitValue, 10),
              limit_period: "monthly",
            },
          ],
        }),
      });
      setFeedback(
        `Published v${res.version} (policy=${migrationPolicy}, migrated=${res.migrated}, scheduled=${res.scheduled}).`
      );
    } catch (err: any) {
      setFeedback(`Error: ${err.message}`);
    }
  }

  if (authError) {
    return (
      <div className="mx-auto max-w-xl p-10 text-center">
        <h1 className="text-2xl font-bold text-rose-400">Administrator Access Required</h1>
        <p className="mt-2 text-sm text-slate-300">
          You must sign in with an account assigned a BDREN platform administrative role and MFA.
        </p>
        <a
          href="/api/v1/auth/login/?next=/admin"
          className="mt-6 inline-block rounded-lg bg-emerald-500 px-5 py-2.5 font-semibold text-slate-950"
        >
          Sign In with ZITADEL SSO
        </a>
        <button
          type="button"
          onClick={() => logout()}
          className="mt-6 ml-3 inline-block rounded-lg border border-slate-700 px-5 py-2.5 font-semibold text-slate-300 hover:border-rose-400 hover:text-rose-300"
        >
          Sign out / switch account
        </button>
      </div>
    );
  }

  if (!summary) {
    return <div className="p-10 text-slate-400">Loading BDREN Admin Console...</div>;
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 bg-slate-900 px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-emerald-400">BDREN Centralized Administration</h1>
          <p className="text-xs text-slate-400" data-testid="admin-roles">
            Active RBAC Roles: {summary.roles.join(", ")}
          </p>
        </div>
        <div className="flex items-center gap-4">
          <a href="/" className="text-sm text-slate-300 hover:text-white">
            &larr; Public Portal
          </a>
          <button
            type="button"
            onClick={() => logout()}
            className="whitespace-nowrap rounded-lg border border-slate-700 px-3 py-1 text-sm text-slate-300 hover:border-rose-400 hover:text-rose-300"
          >
            Sign out
          </button>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-6 py-6">
        {/* RBAC Navigation Tabs */}
        <div className="flex flex-wrap gap-2 border-b border-slate-800 pb-4" role="tablist">
          <button
            type="button"
            onClick={() => loadTab("overview")}
            className={`rounded px-3 py-1.5 text-sm font-medium ${
              activeTab === "overview" ? "bg-emerald-500 text-slate-950" : "bg-slate-900 text-slate-300"
            }`}
          >
            Dashboard Overview
          </button>
          {hasRole("identity_administrator", "support_administrator") && (
            <button
              type="button"
              onClick={() => loadTab("users")}
              className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-slate-300 hover:bg-slate-800"
            >
              User Management
            </button>
          )}
          {hasRole("organization_administrator", "identity_administrator") && (
            <button
              type="button"
              onClick={() => loadTab("organizations")}
              className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-slate-300 hover:bg-slate-800"
            >
              Organizations &amp; Federation
            </button>
          )}
          {hasRole("product_manager") && (
            <>
              <button
                type="button"
                onClick={() => loadTab("products")}
                className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-slate-300 hover:bg-slate-800"
              >
                Product Management
              </button>
              <button
                type="button"
                onClick={() => loadTab("packages")}
                className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-slate-300 hover:bg-slate-800"
              >
                Package Versioning
              </button>
            </>
          )}
          {hasRole("billing_administrator", "support_administrator") && (
            <button
              type="button"
              onClick={() => loadTab("subscriptions")}
              className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-slate-300 hover:bg-slate-800"
            >
              Subscriptions &amp; Payments
            </button>
          )}
          <button
            type="button"
            onClick={() => loadTab("usage")}
            className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-slate-300 hover:bg-slate-800"
          >
            Usage &amp; Audit Logs
          </button>
        </div>

        {feedback && (
          <div role="status" className="mt-4 rounded border border-emerald-500/40 bg-emerald-950/50 p-3 text-sm text-emerald-200">
            {feedback}
          </div>
        )}

        {/* Overview Tab */}
        {activeTab === "overview" && (
          <div className="mt-6 space-y-6">
            <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
              <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
                <div className="text-xs text-slate-400">Total Users</div>
                <div className="mt-1 text-2xl font-bold">{summary.metrics.total_users}</div>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
                <div className="text-xs text-slate-400">Active Organizations</div>
                <div className="mt-1 text-2xl font-bold">{summary.metrics.active_organizations}</div>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
                <div className="text-xs text-slate-400">Active Subscriptions</div>
                <div className="mt-1 text-2xl font-bold">{summary.metrics.active_subscriptions}</div>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
                <div className="text-xs text-slate-400">Active Products</div>
                <div className="mt-1 text-2xl font-bold">{summary.metrics.total_products}</div>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
                <div className="text-xs text-slate-400">Verified Revenue (BDT)</div>
                <div className="mt-1 text-2xl font-bold">{summary.metrics.completed_revenue_bdt}</div>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
                <div className="text-xs text-slate-400">Pending Payments</div>
                <div className="mt-1 text-2xl font-bold text-amber-400">{summary.metrics.pending_payments}</div>
              </div>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-5">
              <h2 className="text-lg font-semibold">Recent Security &amp; Administrative Events</h2>
              <ul className="mt-3 divide-y divide-slate-800 text-sm">
                {summary.recent_events.map((ev) => (
                  <li key={ev.id} className="flex justify-between py-2">
                    <span>
                      <strong className="text-emerald-400">{ev.action}</strong> on {ev.target_type} ({ev.target_id})
                    </span>
                    <span className="text-xs text-slate-400">
                      {ev.actor_email || "system"} &middot; {ev.created_at}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {/* Product Management Tab */}
        {activeTab === "products" && hasRole("product_manager") && (
          <form onSubmit={handleCreateProduct} aria-label="Create Product Form" className="mt-6 max-w-lg space-y-4 rounded-xl border border-slate-800 bg-slate-900 p-6">
            <h2 className="text-lg font-bold">Create New SaaS Product</h2>
            <div>
              <label className="block text-xs text-slate-300">Product Name</label>
              <input
                aria-label="Product Name"
                value={newProdName}
                onChange={(e) => setNewProdName(e.target.value)}
                className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-300">Product Slug</label>
              <input
                aria-label="Product Slug"
                value={newProdSlug}
                onChange={(e) => setNewProdSlug(e.target.value)}
                className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
              />
            </div>
            <button type="submit" className="rounded bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950">
              Create Product
            </button>
          </form>
        )}

        {/* Package Versioning & Migration Policy Tab */}
        {activeTab === "packages" && hasRole("product_manager") && (
          <form onSubmit={handlePublishVersion} aria-label="Publish Package Version Form" className="mt-6 max-w-lg space-y-4 rounded-xl border border-slate-800 bg-slate-900 p-6">
            <h2 className="text-lg font-bold">Publish New Package Version &amp; Migration Policy</h2>
            <div>
              <label className="block text-xs text-slate-300">Select Package</label>
              <select
                aria-label="Select Package"
                value={pkgIdToVersion}
                onChange={(e) => setPkgIdToVersion(e.target.value)}
                className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
              >
                <option value="">-- Choose Package --</option>
                {catalog.flatMap((p) =>
                  p.packages.map((pkg: any) => (
                    <option key={pkg.id} value={pkg.id}>
                      {p.name} - {pkg.name} (current v{pkg.latest_version})
                    </option>
                  ))
                )}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-slate-300">Feature Key</label>
                <input
                  aria-label="Feature Key"
                  value={newLimitFeature}
                  onChange={(e) => setNewLimitFeature(e.target.value)}
                  className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-300">New Monthly Limit</label>
                <input
                  aria-label="New Monthly Limit"
                  type="number"
                  value={newLimitValue}
                  onChange={(e) => setNewLimitValue(e.target.value)}
                  className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs text-slate-300">Subscriber Migration Policy</label>
              <select
                aria-label="Subscriber Migration Policy"
                value={migrationPolicy}
                onChange={(e) => setMigrationPolicy(e.target.value)}
                className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
              >
                <option value="new_only">Apply only to new subscribers (isolate existing)</option>
                <option value="immediate">Migrate all existing active subscribers immediately</option>
                <option value="on_renewal">Migrate existing subscribers at next renewal</option>
                <option value="selected_only">Apply only to explicitly selected subscriptions</option>
              </select>
            </div>
            <button type="submit" className="rounded bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950">
              Publish New Version
            </button>
          </form>
        )}

        {/* Users Tab */}
        {activeTab === "users" && (
          <div className="mt-6 rounded-xl border border-slate-800 bg-slate-900/50 p-5">
            <h2 className="text-lg font-bold">Platform Users &amp; Linked Identities</h2>
            <table className="mt-4 w-full text-left text-sm">
              <thead className="border-b border-slate-800 text-xs text-slate-400">
                <tr>
                  <th className="py-2">Email / Name</th>
                  <th>ZITADEL Subject</th>
                  <th>Status</th>
                  <th>Memberships</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {users.map((u) => (
                  <tr key={u.id}>
                    <td className="py-2">{u.email || u.name}</td>
                    <td className="font-mono text-xs">{u.zitadel_subject}</td>
                    <td>{u.status}</td>
                    <td>{u.memberships?.map((m: any) => `${m.org} (${m.role})`).join(", ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Organizations Tab */}
        {activeTab === "organizations" && (
          <div className="mt-6 rounded-xl border border-slate-800 bg-slate-900/50 p-5">
            <h2 className="text-lg font-bold">Organizations &amp; Institutional SAML/OIDC Federation</h2>
            <ul className="mt-3 divide-y divide-slate-800 text-sm">
              {orgs.map((o) => (
                <li key={o.id} className="py-3 flex justify-between">
                  <div>
                    <strong>{o.name}</strong> ({o.slug}) &mdash; ZITADEL Org ID:{" "}
                    <code>{o.zitadel_organization_id || "none"}</code>
                  </div>
                  <div className="text-xs text-slate-400">
                    Members: {o.member_count} &middot; IdPs: {o.identity_providers?.length || 0}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Subscriptions & Payments Tab */}
        {activeTab === "subscriptions" && (
          <div className="mt-6 grid gap-6 md:grid-cols-2">
            <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-5">
              <h2 className="text-lg font-bold">Active &amp; Historical Subscriptions</h2>
              <ul className="mt-3 divide-y divide-slate-800 text-sm">
                {subs.map((s) => (
                  <li key={s.id} className="py-2">
                    {s.product} &mdash; {s.package} v{s.version} ({s.status}) [{s.account_type}]
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-5">
              <h2 className="text-lg font-bold">Manual / Institutional Payment Records</h2>
              <ul className="mt-3 divide-y divide-slate-800 text-sm">
                {payments.map((p) => (
                  <li key={p.id} className="py-2">
                    Ref <code>{p.reference}</code> &mdash; {p.currency} {p.amount} ({p.status})
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {/* Usage & Audit Tab */}
        {activeTab === "usage" && (
          <div className="mt-6 grid gap-6 md:grid-cols-2">
            <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-5">
              <h2 className="text-lg font-bold">Quota Consumption Counters</h2>
              <ul className="mt-3 divide-y divide-slate-800 text-sm">
                {usageAudit.usage_counters.map((c, idx) => (
                  <li key={idx} className="py-2">
                    {c.product}/{c.feature} [{c.account_type}] &mdash; used: {c.used}, reserved: {c.reserved}
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-5">
              <h2 className="text-lg font-bold">Audit Trail</h2>
              <ul className="mt-3 divide-y divide-slate-800 text-sm">
                {usageAudit.audit_logs.map((a) => (
                  <li key={a.id} className="py-2">
                    {a.action} on {a.target_type} by {a.actor} ({a.created_at})
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
