"use client";
import React, { useEffect, useState } from "react";
import { CatalogPackage, CatalogProduct, UserProfile, apiFetch } from "@/lib/api";

function priceLabel(pkg: CatalogPackage): string {
  return parseFloat(pkg.price) === 0 ? "Free" : `${pkg.currency} ${pkg.price}`;
}

/** Live packages from the platform catalog, with online subscription for signed-in users. */
export function Checkout({ initialProducts }: { initialProducts?: CatalogProduct[] }) {
  const [products, setProducts] = useState<CatalogProduct[]>(initialProducts || []);
  const [user, setUser] = useState<UserProfile | null>(null);
  const [selected, setSelected] = useState<CatalogPackage | null>(null);
  const [paymentRef, setPaymentRef] = useState("");
  const [useTrial, setUseTrial] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!initialProducts) {
      apiFetch<{ products: CatalogProduct[] }>("/api/v1/catalog/products/")
        .then((d) => setProducts(d.products))
        .catch(() => {});
    }
    apiFetch<UserProfile>("/api/v1/auth/me/")
      .then(setUser)
      .catch(() => setUser(null));
  }, [initialProducts]);

  async function subscribe(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) return;
    setError(null);
    setStatus(null);
    const isPaid = parseFloat(selected.price) > 0 && !(useTrial && selected.trial_days > 0);
    if (isPaid && !paymentRef.trim()) {
      setError("Payment reference is required for paid packages.");
      return;
    }
    try {
      const res = await apiFetch<{ status: string; package_version?: number; reference?: string }>(
        "/api/v1/catalog/subscribe/",
        {
          method: "POST",
          body: JSON.stringify({ package_id: selected.id, use_trial: useTrial, payment_reference: paymentRef.trim() }),
        }
      );
      setStatus(
        res.status === "activated"
          ? `Subscription activated on ${selected.name} (v${res.package_version}).`
          : `Payment reference ${res.reference} sent for verification.`
      );
      setSelected(null);
      setPaymentRef("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Subscription failed");
    }
  }

  if (products.length === 0) return null;

  return (
    <section id="subscribe" aria-labelledby="sub-title" className="mx-auto mt-20 max-w-site scroll-mt-6">
      <h2 id="sub-title" className="font-display text-3xl font-bold">
        Subscribe online
      </h2>
      <p className="mt-3 text-muted">Packages you can start today with your BdREN account.</p>

      {status && (
        <p role="status" className="mt-6 rounded-xl border border-line bg-white p-4">
          {status}
        </p>
      )}
      {error && !selected && (
        <p role="alert" className="mt-6 rounded-xl border border-brand bg-brand-tint p-4 text-brand-strong">
          {error}
        </p>
      )}

      <div className="mt-8 space-y-8">
        {products.map((prod) => (
          <div key={prod.id} className="card p-6">
            <h3 className="font-display text-2xl font-bold">{prod.name}</h3>
            <p className="mt-1 text-muted">{prod.description}</p>
            <div className="mt-6 grid gap-4 md:grid-cols-3">
              {prod.packages.map((pkg) => (
                <div key={pkg.id} className="flex flex-col rounded-xl border border-line p-5">
                  <h4 className="text-lg font-semibold">{pkg.name}</h4>
                  <p className="mt-2 font-display text-2xl font-bold">
                    {priceLabel(pkg)}
                    <span className="font-sans text-sm font-normal text-muted"> / {pkg.billing_interval}</span>
                  </p>
                  {pkg.trial_days > 0 && <p className="mt-1 text-sm text-brand-text">{pkg.trial_days}-day trial available</p>}
                  <ul className="mb-5 mt-4 space-y-1.5 text-sm text-muted">
                    {pkg.limits.map((lim) => (
                      <li key={lim.feature_key} className="flex justify-between gap-3">
                        <span>{lim.feature_name}</span>
                        <span className="font-semibold text-ink">
                          {lim.limit_value.toLocaleString()} {lim.unit}/{lim.limit_period}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {user ? (
                    <button
                      type="button"
                      onClick={() => {
                        setSelected(pkg);
                        setUseTrial(false);
                        setError(null);
                      }}
                      className="btn-primary mt-auto"
                    >
                      Select {pkg.name}
                    </button>
                  ) : (
                    <a href={`/sign-in?next=${encodeURIComponent("/pricing#subscribe")}`} className="btn-outline mt-auto">
                      Sign in to Subscribe
                    </a>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/70 p-4">
          <form
            onSubmit={subscribe}
            aria-label="Subscription Checkout Form"
            className="w-full max-w-md rounded-2xl bg-white p-6 text-ink"
          >
            <h3 className="font-display text-xl font-bold">Subscribe to {selected.name}</h3>
            <p className="mt-1 text-sm text-muted">
              {priceLabel(selected)} ({selected.billing_interval})
            </p>
            {selected.trial_days > 0 && (
              <label className="mt-4 flex min-h-[44px] items-center gap-2 text-sm">
                <input type="checkbox" checked={useTrial} onChange={(e) => setUseTrial(e.target.checked)} />
                Start with {selected.trial_days}-day trial
              </label>
            )}
            {parseFloat(selected.price) > 0 && !(useTrial && selected.trial_days > 0) && (
              <div className="mt-4">
                <label htmlFor="payment-ref" className="block text-sm font-semibold">
                  Payment reference (bank transfer or purchase order)
                </label>
                <input
                  id="payment-ref"
                  type="text"
                  placeholder="e.g. BDREN-INV-2026-991"
                  value={paymentRef}
                  onChange={(e) => setPaymentRef(e.target.value)}
                  className="input mt-1.5"
                />
              </div>
            )}
            {error && (
              <p role="alert" className="mt-4 rounded-lg bg-brand-tint p-3 text-sm text-brand-strong">
                {error}
              </p>
            )}
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" onClick={() => setSelected(null)} className="btn-outline">
                Cancel
              </button>
              <button type="submit" className="btn-primary">
                Confirm Subscription
              </button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}
