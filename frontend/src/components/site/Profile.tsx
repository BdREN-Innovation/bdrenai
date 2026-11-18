"use client";
import React, { useEffect, useRef, useState } from "react";
import {
  ADMIN_CONSOLE_URL,
  AccountContextItem,
  BillingSummary,
  MyProfile,
  PROFILE_PATH,
  announceProfile,
  apiFetch,
  postForm,
} from "@/lib/api";
import { loginUrl } from "@/content/site";
import { AdminInstitution, fetchAdminInstitutions, membersPagePath } from "@/lib/portal";
import { Avatar } from "./Avatar";

const AVATAR_TYPES = ["image/png", "image/jpeg", "image/webp"];
const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

const STATUS_LABELS: Record<string, string> = {
  active: "Active",
  pending: "Waiting for approval",
  trial: "Trial",
  expired: "Expired",
  cancelled: "Cancelled",
  past_due: "Payment overdue",
  completed: "Paid",
  rejected: "Rejected",
  suspended: "Suspended",
  deprovisioned: "Removed",
};

function StatusBadge({ status }: { status: string }) {
  const good = status === "active" || status === "completed" || status === "trial";
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-0.5 text-[13px] font-semibold ${good ? "bg-ink text-white" : "border border-field text-muted"}`}
    >
      {STATUS_LABELS[status] || status}
    </span>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="card scroll-mt-6 p-6 md:p-8">
      <h2 id={`${id}-title`} className="font-display text-2xl font-bold">
        {title}
      </h2>
      {children}
    </section>
  );
}

function PhotoCard({ user, onChange }: { user: MyProfile; onChange: (url: string | null) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function upload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    if (!AVATAR_TYPES.includes(file.type)) return setError("Use a PNG, JPEG or WebP image.");
    if (file.size > MAX_AVATAR_BYTES) return setError("Images must be 2 MB or smaller.");
    const form = new FormData();
    form.append("avatar", file);
    setBusy(true);
    const res = await postForm<{ avatar_url: string }>(`${PROFILE_PATH}avatar/`, form);
    setBusy(false);
    if (res.ok) onChange(res.data.avatar_url);
    else setError(res.data.fields?.avatar || "Upload failed. Try again.");
  }

  async function remove() {
    setError(null);
    const res = await postForm(`${PROFILE_PATH}avatar/`, {}, "DELETE");
    if (res.ok) onChange(null);
    else setError("Couldn't remove the photo. Try again.");
  }

  return (
    <div className="card flex flex-wrap items-center gap-6 p-6 md:p-8">
      <Avatar name={user.name} email={user.email} url={user.avatar_url} size={96} />
      <div className="min-w-0 flex-1">
        <h1 className="truncate font-display text-3xl font-bold">{user.name || "Your profile"}</h1>
        <p className="mt-1 truncate text-muted">{user.email}</p>
        <p className="mt-1 text-sm text-muted">Member since {new Date(user.member_since).toLocaleDateString("en-GB", { year: "numeric", month: "long", day: "numeric" })}</p>
      </div>
      <div className="flex flex-wrap gap-3">
        <input ref={input} type="file" accept={AVATAR_TYPES.join(",")} onChange={upload} className="sr-only" aria-label="Upload a profile photo" aria-hidden="true" tabIndex={-1} />
        <button type="button" onClick={() => input.current?.click()} disabled={busy} className="btn-primary">
          {busy ? "Uploading…" : user.avatar_url ? "Change photo" : "Upload photo"}
        </button>
        {user.avatar_url && (
          <button type="button" onClick={remove} className="btn-outline">
            Remove
          </button>
        )}
      </div>
      <p className="w-full text-sm text-muted">PNG, JPEG or WebP, up to 2 MB.</p>
      {error && (
        <p role="alert" className="w-full text-sm text-brand-strong">
          {error}
        </p>
      )}
    </div>
  );
}

function DetailsForm({ user, onSaved }: { user: MyProfile; onSaved: (u: MyProfile) => void }) {
  const [first, setFirst] = useState(user.first_name);
  const [last, setLast] = useState(user.last_name);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const dirty = first.trim() !== user.first_name || last.trim() !== user.last_name;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!dirty || busy) return;
    setBusy(true);
    setErrors({});
    setSaved(false);
    const res = await postForm<MyProfile>(PROFILE_PATH, { first_name: first, last_name: last }, "PATCH");
    setBusy(false);
    if (res.ok) {
      onSaved(res.data);
      setSaved(true);
      return;
    }
    setErrors(res.data.fields || { form: "Couldn't save your details. Try again in a moment." });
  }

  return (
    <form aria-label="Personal details" onSubmit={save} className="mt-6 grid gap-5 sm:grid-cols-2">
      <div className="flex flex-col gap-2">
        <label htmlFor="p-first" className="text-[15px] font-semibold">
          First name
        </label>
        <input id="p-first" autoComplete="given-name" value={first} onChange={(e) => { setFirst(e.target.value); setSaved(false); }} disabled={!user.can_edit_name} className="input min-h-[50px] disabled:bg-ground" />
        {errors.first_name && <span role="alert" className="text-sm text-brand-strong">{errors.first_name}</span>}
      </div>
      <div className="flex flex-col gap-2">
        <label htmlFor="p-last" className="text-[15px] font-semibold">
          Last name
        </label>
        <input id="p-last" autoComplete="family-name" value={last} onChange={(e) => { setLast(e.target.value); setSaved(false); }} disabled={!user.can_edit_name} className="input min-h-[50px] disabled:bg-ground" />
        {errors.last_name && <span role="alert" className="text-sm text-brand-strong">{errors.last_name}</span>}
      </div>
      <div className="flex flex-col gap-2 sm:col-span-2">
        <label htmlFor="p-email" className="text-[15px] font-semibold">
          Email
        </label>
        <div className="relative">
          <input id="p-email" value={user.email} readOnly aria-describedby="p-email-note" className="input min-h-[50px] cursor-not-allowed bg-ground pr-12 text-muted" />
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#4A5C60" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="absolute right-4 top-4">
            <rect x="5" y="11" width="14" height="10" rx="2" />
            <path d="M8 11V8a4 4 0 0 1 8 0v3" />
          </svg>
        </div>
        <span id="p-email-note" className="text-sm text-muted">
          Your email can&apos;t be changed. {user.email_verified ? "It is verified." : "It isn't verified yet."}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-4 sm:col-span-2">
        {user.can_edit_name ? (
          <button type="submit" disabled={!dirty || busy} className="btn-primary disabled:cursor-not-allowed disabled:bg-line disabled:text-muted">
            {busy ? "Saving…" : "Save changes"}
          </button>
        ) : (
          <p className="text-sm text-muted">Your name comes from your institution&apos;s sign-in and can&apos;t be changed here.</p>
        )}
        {saved && <p role="status" className="text-sm text-ink">Your details are saved.</p>}
        {errors.form && <p role="alert" className="text-sm text-brand-strong">{errors.form}</p>}
      </div>
    </form>
  );
}

function AccessSection({ user }: { user: MyProfile }) {
  const [contexts, setContexts] = useState<AccountContextItem[]>([]);
  const [administered, setAdministered] = useState<AdminInstitution[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchAdminInstitutions().then(setAdministered);
    apiFetch<{ contexts: AccountContextItem[] }>("/api/v1/accounts/contexts/")
      .then((c) => setContexts(c.contexts))
      .catch(() => setContexts([]));
  }, []);

  async function switchTo(accountId: string) {
    setError(null);
    const res = await postForm("/api/v1/accounts/switch-context/", { account_id: accountId });
    if (!res.ok) return setError("Couldn't switch account. Try again.");
    const c = await apiFetch<{ contexts: AccountContextItem[] }>("/api/v1/accounts/contexts/");
    setContexts(c.contexts);
  }

  const active = contexts.find((c) => c.is_active_context)?.account_id;
  return (
    <Section id="access" title="Institutions and access">
      {user.memberships.length === 0 ? (
        <p className="mt-3 text-muted">You aren&apos;t part of an institution yet.</p>
      ) : (
        <ul className="mt-4 divide-y divide-line rounded-xl border border-line">
          {user.memberships.map((m) => (
            <li key={m.organization} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <span>
                <strong className="block">{m.organization}</strong>
                <span className="text-sm capitalize text-muted">{m.role}</span>
              </span>
              <StatusBadge status={m.status} />
            </li>
          ))}
        </ul>
      )}
      {contexts.length > 1 && (
        <div className="mt-5 flex flex-col gap-2">
          <label htmlFor="p-account" className="text-[15px] font-semibold">
            Account in use
          </label>
          <select id="p-account" value={active} onChange={(e) => switchTo(e.target.value)} className="input min-h-[50px] max-w-md cursor-pointer">
            {contexts.map((c) => (
              <option key={c.account_id} value={c.account_id}>
                {c.account_type === "personal" ? "Personal account" : `${c.organization?.name} (${c.role})`}
              </option>
            ))}
          </select>
          <span className="text-sm text-muted">Plans and usage are charged to the account in use.</span>
          {error && <span role="alert" className="text-sm text-brand-strong">{error}</span>}
        </div>
      )}
      {administered.length > 0 && (
        <ul aria-label="Institutions you manage" className="mt-5 flex flex-wrap gap-3">
          {administered.map((i) => (
            <li key={i.slug}>
              <a href={membersPagePath(i.slug)} className="btn-outline">
                Manage members of {i.name}
              </a>
            </li>
          ))}
        </ul>
      )}
      {user.is_superadmin && (
        <a href={ADMIN_CONSOLE_URL} className="btn-outline mt-5">
          Open admin console
        </a>
      )}
    </Section>
  );
}

function Money({ amount, currency }: { amount: string; currency: string }) {
  return <>{parseFloat(amount) === 0 ? "Free" : `${currency} ${Number(amount).toLocaleString("en-US", { minimumFractionDigits: 2 })}`}</>;
}

function BillingSection() {
  const [billing, setBilling] = useState<BillingSummary | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    apiFetch<BillingSummary>(`${PROFILE_PATH}billing/`)
      .then(setBilling)
      .catch(() => setFailed(true));
  }, []);

  return (
    <Section id="billing" title="Billing">
      {failed && <p role="alert" className="mt-3 text-brand-strong">Couldn&apos;t load billing. Refresh to try again.</p>}
      {!billing && !failed && <p className="mt-3 text-muted">Loading billing…</p>}
      {billing && (
        <>
          <h3 className="mt-6 text-lg font-semibold">Plans</h3>
          {billing.subscriptions.length === 0 ? (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-dashed border-field px-5 py-4">
              <p className="text-muted">You don&apos;t have a plan yet.</p>
              <a href="/pricing" className="btn-primary">
                Browse plans
              </a>
            </div>
          ) : (
            <div className="mt-3 overflow-x-auto rounded-xl border border-line">
              <table className="w-full min-w-[640px] border-collapse text-[15px]">
                <caption className="sr-only">Your plans</caption>
                <thead>
                  <tr className="text-left text-muted">
                    <th scope="col" className="border-b border-line px-4 py-3 font-semibold">Plan</th>
                    <th scope="col" className="border-b border-line px-4 py-3 font-semibold">Account</th>
                    <th scope="col" className="border-b border-line px-4 py-3 font-semibold">Price</th>
                    <th scope="col" className="border-b border-line px-4 py-3 font-semibold">Renews / ends</th>
                    <th scope="col" className="border-b border-line px-4 py-3 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {billing.subscriptions.map((s) => (
                    <tr key={s.id}>
                      <th scope="row" className="border-b border-ground px-4 py-3 text-left font-medium">
                        {s.product} · {s.package}
                        <span className="block text-sm font-normal text-muted">Version {s.version}</span>
                      </th>
                      <td className="border-b border-ground px-4 py-3">{s.account}</td>
                      <td className="border-b border-ground px-4 py-3">
                        <Money amount={s.price} currency={s.currency} />
                        <span className="text-sm text-muted"> / {s.billing_interval}</span>
                      </td>
                      <td className="border-b border-ground px-4 py-3">{s.expires_at || "—"}</td>
                      <td className="border-b border-ground px-4 py-3"><StatusBadge status={s.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <h3 className="mt-8 text-lg font-semibold">Payments</h3>
          {billing.payments.length === 0 ? (
            <p className="mt-3 text-muted">No payments yet.</p>
          ) : (
            <div className="mt-3 overflow-x-auto rounded-xl border border-line">
              <table className="w-full min-w-[560px] border-collapse text-[15px]">
                <caption className="sr-only">Your payments</caption>
                <thead>
                  <tr className="text-left text-muted">
                    <th scope="col" className="border-b border-line px-4 py-3 font-semibold">Date</th>
                    <th scope="col" className="border-b border-line px-4 py-3 font-semibold">Amount</th>
                    <th scope="col" className="border-b border-line px-4 py-3 font-semibold">Reference</th>
                    <th scope="col" className="border-b border-line px-4 py-3 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {billing.payments.map((p) => (
                    <tr key={p.id}>
                      <td className="border-b border-ground px-4 py-3">{p.created_at}</td>
                      <td className="border-b border-ground px-4 py-3"><Money amount={p.amount} currency={p.currency} /></td>
                      <td className="border-b border-ground px-4 py-3 font-mono text-sm">{p.reference}</td>
                      <td className="border-b border-ground px-4 py-3"><StatusBadge status={p.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </Section>
  );
}

export function Profile() {
  const [user, setUser] = useState<MyProfile | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "signed-out">("loading");

  useEffect(() => {
    apiFetch<MyProfile>(PROFILE_PATH)
      .then((u) => {
        setUser(u);
        setState("ready");
      })
      .catch(() => setState("signed-out"));
  }, []);

  if (state === "loading") return <p className="text-muted">Loading your profile…</p>;
  if (state === "signed-out" || !user) {
    return (
      <div className="card mx-auto max-w-lg p-8 text-center">
        <h1 className="font-display text-3xl font-bold">Sign in to see your profile</h1>
        <p className="mt-3 text-muted">Your details, institutions and billing are here once you&apos;re signed in.</p>
        <a href={loginUrl("/profile")} className="btn-primary mt-6">
          Sign in
        </a>
      </div>
    );
  }

  const update = (next: MyProfile) => {
    setUser(next);
    announceProfile(next);
  };

  return (
    <div className="flex flex-col gap-6">
      <PhotoCard user={user} onChange={(url) => update({ ...user, avatar_url: url })} />
      <Section id="details" title="Personal details">
        <DetailsForm user={user} onSaved={update} />
      </Section>
      <AccessSection user={user} />
      <BillingSection />
    </div>
  );
}
