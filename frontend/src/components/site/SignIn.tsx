"use client";
import React, { useState } from "react";
import { loginUrl } from "@/content/site";

/**
 * Website half of sign-in. The email goes to ZITADEL as `login_hint`, so the hosted login opens at
 * the password step; university addresses are routed to the university's own sign-in by ZITADEL.
 */
export function SignIn({ next = "/" }: { next?: string }) {
  const [email, setEmail] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    window.location.href = loginUrl(next, email);
  }

  return (
    <div className="w-full max-w-[420px]">
      <h1 className="font-display text-4xl font-bold tracking-tight">Sign in</h1>
      <p className="mt-2.5 leading-relaxed text-muted">Use your BdREN account to continue.</p>
      <form aria-label="Sign in" onSubmit={submit} className="mt-8 flex flex-col gap-2">
        <label htmlFor="si-id" className="text-[15px] font-semibold">
          Email or username
        </label>
        <input
          id="si-id"
          name="username"
          type="text"
          autoComplete="username"
          placeholder="you@university.edu.bd"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="input"
        />
        <p className="text-sm text-muted">University accounts go to your university&apos;s own sign-in page.</p>
        <button type="submit" className="btn-primary mt-3 min-h-[52px]">
          Continue
        </button>
      </form>
      <div aria-hidden="true" className="my-7 flex items-center gap-3.5 text-sm text-muted">
        <span className="h-px flex-1 bg-line" />
        or
        <span className="h-px flex-1 bg-line" />
      </div>
      <a href={loginUrl(next)} className="btn min-h-[52px] w-full gap-2.5 border border-field bg-white text-ink hover:border-ink">
        <svg
          aria-hidden="true"
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="9" cy="8" r="4" />
          <path d="M3 20c0-3.3 2.7-6 6-6M16 11a3 3 0 1 1 0 6 3 3 0 0 1 0-6zM18.5 16.5L22 20M20 18l1.5-1.5" />
        </svg>
        Sign in with a passkey
      </a>
      <p className="mt-8 text-[15px] text-muted">
        New to BdREN AI?{" "}
        <a href="/register" className="font-semibold text-brand-text hover:text-brand-strong">
          Create an account
        </a>
      </p>
    </div>
  );
}
