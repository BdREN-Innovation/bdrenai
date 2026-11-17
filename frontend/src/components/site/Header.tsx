"use client";
import React, { useEffect, useState } from "react";
import { NAV_LINKS } from "@/content/site";
import { AccountContextItem, UserProfile, apiFetch, logout } from "@/lib/api";
import { Logo } from "./Logo";

export function Header({ current }: { current?: string }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [contexts, setContexts] = useState<AccountContextItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<UserProfile>("/api/v1/auth/me/")
      .then((u) => {
        setUser(u);
        return apiFetch<{ contexts: AccountContextItem[] }>("/api/v1/accounts/contexts/");
      })
      .then((c) => setContexts(c.contexts))
      .catch(() => setUser(null));
  }, []);

  async function switchContext(accountId: string) {
    setError(null);
    try {
      await apiFetch("/api/v1/accounts/switch-context/", {
        method: "POST",
        body: JSON.stringify({ account_id: accountId }),
      });
      const c = await apiFetch<{ contexts: AccountContextItem[] }>("/api/v1/accounts/contexts/");
      setContexts(c.contexts);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not switch account");
    }
  }

  const activeAccount = contexts.find((c) => c.is_active_context)?.account_id || user?.active_account_id;

  return (
    <header className="border-b border-night-line bg-night">
      <div className="mx-auto flex min-h-[72px] max-w-site flex-wrap items-center justify-between gap-4 px-6 py-3">
        <Logo />
        <nav aria-label="Main" className="flex flex-wrap items-center gap-x-7 gap-y-2 text-[15px] font-medium">
          {NAV_LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              aria-current={current === l.href ? "page" : undefined}
              className={current === l.href ? "text-white" : "text-fog hover:text-white"}
            >
              {l.label}
            </a>
          ))}
        </nav>
        {user ? (
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm text-fog" data-testid="authenticated-user">
              {user.email || user.name}
            </span>
            <label className="sr-only" htmlFor="account-context">
              Account
            </label>
            <select
              id="account-context"
              aria-label="Account Context Switcher"
              className="min-h-[44px] rounded-lg border border-night-stroke bg-night-raised px-2 text-sm text-white"
              value={activeAccount}
              onChange={(e) => switchContext(e.target.value)}
            >
              {contexts.map((c) => (
                <option key={c.account_id} value={c.account_id}>
                  {c.account_type === "personal" ? "Personal account" : `${c.organization?.name} (${c.role})`}
                </option>
              ))}
            </select>
            <a href="/admin" className="text-sm font-medium text-brand-glow hover:text-white">
              Admin
            </a>
            <button
              type="button"
              onClick={() => logout()}
              className="min-h-[44px] rounded-lg border border-night-stroke px-3 text-sm text-fog hover:border-white hover:text-white"
            >
              Sign out
            </button>
            {error && (
              <p role="alert" className="w-full text-sm text-brand-glow">
                {error}
              </p>
            )}
          </div>
        ) : (
          <a href="/sign-in" className="btn-primary min-h-[44px] px-5 text-[15px]">
            Sign in with BdREN
          </a>
        )}
      </div>
    </header>
  );
}
