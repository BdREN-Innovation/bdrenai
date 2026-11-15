"use client";
import React, { useEffect, useState } from "react";
import { AccountContextItem, CatalogPackage, CatalogProduct, UserProfile, apiFetch } from "@/lib/api";

export function LandingPortal({ initialProducts }: { initialProducts?: CatalogProduct[] }) {
  const [products, setProducts] = useState<CatalogProduct[]>(initialProducts || []);
  const [user, setUser] = useState<UserProfile | null>(null);
  const [contexts, setContexts] = useState<AccountContextItem[]>([]);
  const [selectedPkg, setSelectedPkg] = useState<CatalogPackage | null>(null);
  const [paymentRef, setPaymentRef] = useState("");
  const [useTrial, setUseTrial] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!initialProducts) {
      apiFetch<{ products: CatalogProduct[] }>("/api/v1/catalog/products/")
        .then((d) => setProducts(d.products))
        .catch(() => {});
    }
    apiFetch<UserProfile>("/api/v1/auth/me/")
      .then((u) => {
        setUser(u);
        return apiFetch<{ contexts: AccountContextItem[] }>("/api/v1/accounts/contexts/");
      })
      .then((c) => setContexts(c.contexts))
      .catch(() => setUser(null));
  }, [initialProducts]);

  async function handleSwitchContext(accountId: string) {
    setErrorMsg(null);
    try {
      await apiFetch("/api/v1/accounts/switch-context/", {
        method: "POST",
        body: JSON.stringify({ account_id: accountId }),
      });
      const c = await apiFetch<{ contexts: AccountContextItem[] }>("/api/v1/accounts/contexts/");
      setContexts(c.contexts);
      setStatusMsg("Switched active account context.");
    } catch (e: any) {
      setErrorMsg(e.message);
    }
  }

  async function handleSubscribe(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedPkg) return;
    setErrorMsg(null);
    setStatusMsg(null);
    const isPaid = parseFloat(selectedPkg.price) > 0 && !(useTrial && selectedPkg.trial_days > 0);
    if (isPaid && !paymentRef.trim()) {
      setErrorMsg("Payment reference is required for paid packages.");
      return;
    }
    try {
      const res = await apiFetch("/api/v1/catalog/subscribe/", {
        method: "POST",
        body: JSON.stringify({
          package_id: selectedPkg.id,
          use_trial: useTrial,
          payment_reference: paymentRef.trim(),
        }),
      });
      setStatusMsg(
        res.status === "activated"
          ? `Subscription activated on ${selectedPkg.name} (v${res.package_version}).`
          : `Manual payment reference ${res.reference} submitted for administrator verification.`
      );
      setSelectedPkg(null);
      setPaymentRef("");
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {/* Top Navbar */}
      <header className="border-b border-slate-800 bg-slate-900/70 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <span className="rounded-lg bg-emerald-500/20 px-3 py-1 text-sm font-bold text-emerald-400 border border-emerald-500/30">
              BDREN
            </span>
            <span className="text-lg font-semibold tracking-tight">
              Centralized Identity &amp; SaaS Platform
            </span>
          </div>
          <nav className="flex items-center gap-6 text-sm">
            <a href="#about" className="text-slate-300 hover:text-white">About</a>
            <a href="#catalog" className="text-slate-300 hover:text-white">Products &amp; Pricing</a>
            <a href="#docs" className="text-slate-300 hover:text-white">Documentation</a>
            <a href="#support" className="text-slate-300 hover:text-white">Support</a>
            <a href="/admin" className="text-emerald-400 hover:text-emerald-300 font-medium">Admin Console</a>
            {user ? (
              <div className="flex items-center gap-3">
                <span className="text-xs text-slate-300" data-testid="authenticated-user">
                  {user.email || user.name}
                </span>
                <select
                  aria-label="Account Context Switcher"
                  className="rounded border border-slate-700 bg-slate-800 px-2 py-1 text-xs"
                  value={contexts.find((c) => c.is_active_context)?.account_id || user.active_account_id}
                  onChange={(e) => handleSwitchContext(e.target.value)}
                >
                  {contexts.map((c) => (
                    <option key={c.account_id} value={c.account_id}>
                      {c.account_type === "personal"
                        ? "Personal Account"
                        : `Org: ${c.organization?.name} (${c.role})`}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <a
                href="/api/v1/auth/login/?next=/"
                className="rounded-lg bg-emerald-500 px-4 py-2 font-semibold text-slate-950 hover:bg-emerald-400"
              >
                Sign In / Register (SSO)
              </a>
            )}
          </nav>
        </div>
      </header>

      {/* Hero Section */}
      <section className="mx-auto max-w-7xl px-6 py-16 text-center">
        <h1 className="text-4xl font-extrabold tracking-tight sm:text-5xl">
          Unified Academic &amp; Enterprise SSO + Entitlements for{" "}
          <span className="text-emerald-400">BDREN</span>
        </h1>
        <p className="mx-auto mt-4 max-w-3xl text-lg text-slate-300">
          Authenticate once via ZITADEL v4 at <code>auth.bdren.ai</code> using Passkeys, TOTP MFA, or Institutional
          University SAML 2.0 / OIDC Federation. Manage personal and organizational subscriptions across Mindspear,
          Synapse, and future BDREN applications.
        </p>
        <div className="mt-8 flex justify-center gap-4">
          <a
            href="/api/v1/auth/login/?next=/"
            className="rounded-lg bg-emerald-500 px-6 py-3 font-semibold text-slate-950 hover:bg-emerald-400"
          >
            Single Sign-On Portal
          </a>
          <a
            href="#catalog"
            className="rounded-lg border border-slate-700 bg-slate-900 px-6 py-3 font-semibold text-slate-200 hover:border-slate-500"
          >
            Explore SaaS Packages
          </a>
        </div>
      </section>

      {statusMsg && (
        <div role="status" className="mx-auto mb-6 max-w-4xl rounded-lg border border-emerald-500/40 bg-emerald-950/60 p-4 text-emerald-200">
          {statusMsg}
        </div>
      )}
      {errorMsg && (
        <div role="alert" className="mx-auto mb-6 max-w-4xl rounded-lg border border-rose-500/40 bg-rose-950/60 p-4 text-rose-200">
          {errorMsg}
        </div>
      )}

      {/* About BDREN */}
      <section id="about" className="mx-auto max-w-7xl px-6 py-8">
        <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
          <h2 className="text-2xl font-bold">About BDREN Centralized Identity &amp; Entitlement Architecture</h2>
          <p className="mt-2 text-sm text-slate-300">
            BDREN separates identity verification (ZITADEL v4 OIDC/SAML broker, WebAuthn Passkeys, TOTP MFA) from
            business authorization (Django Entitlement Engine with versioned packages and mixed personal +
            institutional quota pools).
          </p>
        </div>
      </section>

      {/* Product Catalog & Pricing */}
      <section id="catalog" className="mx-auto max-w-7xl px-6 py-10">
        <h2 className="text-3xl font-bold">SaaS Product Catalog &amp; Packages</h2>
        <p className="mt-1 text-slate-400">
          Transparent quotas for personal researchers and federated university organizations.
        </p>

        <div className="mt-8 space-y-12">
          {products.map((prod) => (
            <div key={prod.id} className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
              <div className="border-b border-slate-800 pb-4">
                <h3 className="text-2xl font-bold text-emerald-400">{prod.name}</h3>
                <p className="mt-1 text-sm text-slate-300">{prod.description}</p>
              </div>

              <div className="mt-6 grid gap-6 md:grid-cols-3">
                {prod.packages.map((pkg) => (
                  <div
                    key={pkg.id}
                    className="flex flex-col justify-between rounded-xl border border-slate-800 bg-slate-950/80 p-5"
                  >
                    <div>
                      <div className="flex items-center justify-between">
                        <h4 className="text-lg font-semibold">{pkg.name}</h4>
                        {pkg.latest_version && (
                          <span className="rounded bg-slate-800 px-2 py-0.5 text-xs text-slate-400">
                            v{pkg.latest_version}
                          </span>
                        )}
                      </div>
                      <p className="mt-3 text-2xl font-bold">
                        {parseFloat(pkg.price) === 0 ? "Free" : `${pkg.currency} ${pkg.price}`}
                        <span className="text-xs font-normal text-slate-400"> / {pkg.billing_interval}</span>
                      </p>
                      {pkg.trial_days > 0 && (
                        <p className="mt-1 text-xs text-emerald-400">{pkg.trial_days}-day trial available</p>
                      )}
                      <ul className="mt-4 space-y-2 text-sm text-slate-300">
                        {pkg.limits.map((lim) => (
                          <li key={lim.feature_key} className="flex justify-between border-b border-slate-900 pb-1">
                            <span>{lim.feature_name}</span>
                            <span className="font-mono font-semibold text-white">
                              {lim.limit_value.toLocaleString()} {lim.unit}/{lim.limit_period}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div className="mt-6">
                      {user ? (
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedPkg(pkg);
                            setUseTrial(false);
                            setErrorMsg(null);
                          }}
                          className="w-full rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-emerald-400"
                        >
                          Select {pkg.name}
                        </button>
                      ) : (
                        <a
                          href="/api/v1/auth/login/?next=/"
                          className="block w-full rounded-lg border border-emerald-500/50 px-4 py-2 text-center text-sm font-semibold text-emerald-300 hover:bg-emerald-500/10"
                        >
                          Sign in to Subscribe
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Subscription Modal */}
      {selectedPkg && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <form
            onSubmit={handleSubscribe}
            aria-label="Subscription Checkout Form"
            className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-6"
          >
            <h3 className="text-xl font-bold">Subscribe to {selectedPkg.name}</h3>
            <p className="mt-1 text-sm text-slate-300">
              Price: {selectedPkg.currency} {selectedPkg.price} ({selectedPkg.billing_interval})
            </p>
            {selectedPkg.trial_days > 0 && (
              <label className="mt-4 flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={useTrial}
                  onChange={(e) => setUseTrial(e.target.checked)}
                />
                Start with {selectedPkg.trial_days}-day trial
              </label>
            )}
            {parseFloat(selectedPkg.price) > 0 && !(useTrial && selectedPkg.trial_days > 0) && (
              <div className="mt-4">
                <label className="block text-xs font-medium text-slate-300">
                  Offline / Institutional Payment Reference (Bank Transfer / PO #)
                </label>
                <input
                  type="text"
                  placeholder="e.g. BDREN-INV-2026-991"
                  value={paymentRef}
                  onChange={(e) => setPaymentRef(e.target.value)}
                  className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                />
              </div>
            )}
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setSelectedPkg(null)}
                className="rounded border border-slate-700 px-4 py-2 text-sm"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rounded bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950"
              >
                Confirm Subscription
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Documentation & Contact */}
      <section id="docs" className="mx-auto max-w-7xl px-6 py-10 grid gap-6 md:grid-cols-2">
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-6">
          <h3 className="text-lg font-bold">Integration Documentation</h3>
          <p className="mt-2 text-sm text-slate-300">
            Downstream SaaS applications integrate using standard OIDC Authorization Code Flow with PKCE (S256) against
            <code> https://auth.bdren.ai</code> and query quotas via <code>POST /api/v1/entitlements/check/</code>.
          </p>
        </div>
        <div id="support" className="rounded-xl border border-slate-800 bg-slate-900/40 p-6">
          <h3 className="text-lg font-bold">BDREN Support &amp; Institutional Onboarding</h3>
          <p className="mt-2 text-sm text-slate-300">
            Universities connecting Shibboleth SAML 2.0 or OIDC Identity Providers can contact BDREN NOC &amp; Identity
            Operations at <code>noc@bdren.edu.bd</code>.
          </p>
        </div>
      </section>
    </div>
  );
}
