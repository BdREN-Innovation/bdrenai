"use client";
import React, { useCallback, useEffect, useState } from "react";
import { getJson, logout, postForm } from "@/lib/api";
import { loginUrl, safeNext } from "@/content/site";
import {
  AcceptResult,
  INVITATION_PATH,
  InvitationPreview,
  ROLE_LABELS,
  errorMessage,
  formatDate,
  siteUrl,
} from "@/lib/portal";

type View =
  | { kind: "loading" }
  | { kind: "unknown" }
  | { kind: "failed" }
  | { kind: "invite"; invite: InvitationPreview }
  | { kind: "joined"; result: AcceptResult };

const ACCEPT_ERRORS: Record<string, string> = {
  email_mismatch: "This invitation was sent to a different email address than the one you're signed in with.",
  email_unverified: "Confirm your email address with BdREN first, then accept the invitation.",
};

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby="invite-title" className="card p-7 md:p-9">
      <h1 id="invite-title" className="font-display text-3xl font-bold tracking-tight">
        {title}
      </h1>
      {children}
    </section>
  );
}

function Details({ invite }: { invite: InvitationPreview }) {
  const rows: [string, string][] = [
    ["Institution", invite.institution?.name || "Personal account"],
    ...(invite.role ? [["Role", ROLE_LABELS[invite.role] || invite.role] as [string, string]] : []),
    ["Invited by", invite.invited_by_name || "BdREN"],
    ["Sent to", invite.email || invite.email_masked],
    [invite.status === "expired" ? "Expired on" : "Expires", formatDate(invite.expires_at)],
  ];
  return (
    <dl className="mt-6 divide-y divide-line rounded-xl border border-line">
      {rows.map(([label, value]) => (
        <div key={label} className="flex flex-wrap justify-between gap-2 px-4 py-3">
          <dt className="text-muted">{label}</dt>
          <dd className="font-semibold">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function headline(invite: InvitationPreview): string {
  return invite.institution ? `Join ${invite.institution.name} on BdREN AI` : "Join BdREN AI";
}

function planEnd(invite: InvitationPreview): string {
  return invite.personal_plan_ends_at ? `until ${formatDate(invite.personal_plan_ends_at)}` : "until its current period ends";
}

function PersonalPlanConsent({ invite, agreed, onChange }: {
  invite: InvitationPreview;
  agreed: boolean;
  onChange: (agreed: boolean) => void;
}) {
  return (
    <div role="note" aria-labelledby="plan-title" className="mt-6 rounded-xl border border-brand bg-brand-tint p-4">
      <h2 id="plan-title" className="font-semibold text-ink">
        Your personal plan will stop renewing
      </h2>
      <p className="mt-2 leading-relaxed text-ink">
        You pay for your own BdREN AI plan. If you join {invite.institution?.name || "this institution"}&apos;s package,
        your plan won&apos;t renew. It keeps working {planEnd(invite)}, then ends. You won&apos;t get a refund for the time
        left.
      </p>
      <label className="mt-4 flex cursor-pointer items-start gap-3 text-[15px] leading-normal text-ink">
        <input
          type="checkbox"
          checked={agreed}
          onChange={(e) => onChange(e.target.checked)}
          className="mt-0.5 h-5 w-5 flex-none accent-brand"
        />
        <span>I understand that my personal plan won&apos;t renew.</span>
      </label>
    </div>
  );
}

function Pending({ token, invite, onJoined, onStale }: {
  token: string;
  invite: InvitationPreview;
  onJoined: (r: AcceptResult) => void;
  onStale: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [agreed, setAgreed] = useState(false);
  const here = `/invite/${token}`;
  const consent = invite.ends_personal_plan;

  async function accept() {
    setBusy(true);
    setError(null);
    const body = consent ? { end_personal_plan: agreed } : {};
    const res = await postForm<AcceptResult>(`${INVITATION_PATH}${encodeURIComponent(token)}/accept/`, body);
    setBusy(false);
    if (res.ok) return onJoined(res.data);
    const stale = res.data.error === "invitation_not_pending" || res.data.error === "personal_plan_consent_required";
    if (stale || res.status === 404) return onStale();
    setError(ACCEPT_ERRORS[res.data.error || ""] || errorMessage(res, "We couldn't accept the invitation. Try again in a moment."));
  }

  if (!invite.signed_in) {
    const register = `/register?${new URLSearchParams({ ...(invite.email ? { email: invite.email } : {}), next: here })}`;
    return (
      <Panel title={headline(invite)}>
        <p className="mt-3 leading-relaxed text-muted">
          Sign in with the BdREN account for <strong className="text-ink">{invite.email_masked}</strong> to accept, or
          create one with that email.
        </p>
        <Details invite={invite} />
        <div className="mt-7 flex flex-wrap gap-3">
          <a href={loginUrl(here)} className="btn-primary">
            Sign in
          </a>
          <a href={register} className="btn-outline">
            Create account
          </a>
        </div>
      </Panel>
    );
  }

  if (!invite.email_matches) {
    return (
      <Panel title="This invitation is for another email">
        <p className="mt-3 leading-relaxed text-muted">
          It was sent to <strong className="text-ink">{invite.email_masked}</strong>, but you&apos;re signed in with a
          different account. Sign out, then open this link again and sign in with that email.
        </p>
        <Details invite={invite} />
        <button type="button" onClick={() => logout()} className="btn-primary mt-7">
          Sign out
        </button>
      </Panel>
    );
  }

  return (
    <Panel title={headline(invite)}>
      <p className="mt-3 leading-relaxed text-muted">You&apos;re signed in with the email this invitation was sent to.</p>
      <Details invite={invite} />
      {consent && <PersonalPlanConsent invite={invite} agreed={agreed} onChange={setAgreed} />}
      {error && (
        <p role="alert" className="mt-5 text-brand-strong">
          {error}
        </p>
      )}
      <button type="button" onClick={accept} disabled={busy || (consent && !agreed)} className="btn-primary mt-7 disabled:cursor-not-allowed disabled:bg-line disabled:text-muted">
        {busy ? "Accepting…" : consent ? "Accept and stop my plan renewing" : "Accept invitation"}
      </button>
    </Panel>
  );
}

function Closed({ invite }: { invite: InvitationPreview }) {
  if (invite.status === "accepted") {
    return (
      <Panel title="This invitation has already been accepted">
        <p className="mt-3 leading-relaxed text-muted">
          {invite.signed_in ? "You can find your institutions on your profile." : "Sign in to use your account."}
        </p>
        <a href={invite.signed_in ? "/profile" : loginUrl("/profile")} className="btn-primary mt-7">
          {invite.signed_in ? "Go to my profile" : "Sign in"}
        </a>
      </Panel>
    );
  }
  const expired = invite.status === "expired";
  return (
    <Panel title={expired ? "This invitation has expired" : "This invitation was withdrawn"}>
      <p className="mt-3 leading-relaxed text-muted">
        {expired
          ? `Ask ${invite.invited_by_name || "the person who invited you"} to send a new invitation.`
          : `${invite.invited_by_name || "The sender"} cancelled it. If you still need access, ask them to invite you again.`}
      </p>
      <Details invite={invite} />
    </Panel>
  );
}

/** Invitation acceptance: shows what the invite is for and the one next step that fits the visitor. */
export function Invite({ token }: { token: string }) {
  const [view, setView] = useState<View>({ kind: "loading" });

  const load = useCallback(async () => {
    setView({ kind: "loading" });
    const res = await getJson<InvitationPreview>(`${INVITATION_PATH}${encodeURIComponent(token)}/`);
    if (res.ok) return setView({ kind: "invite", invite: res.data });
    setView({ kind: res.status === 404 ? "unknown" : "failed" });
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  if (view.kind === "loading") return <p className="text-muted">Loading your invitation…</p>;
  if (view.kind === "unknown") {
    return (
      <Panel title="This invitation link isn't valid">
        <p className="mt-3 leading-relaxed text-muted">
          The link may be mistyped, or it was replaced by a newer invitation. Ask the person who invited you to send it
          again.
        </p>
      </Panel>
    );
  }
  if (view.kind === "failed") {
    return (
      <Panel title="We couldn't load this invitation">
        <p role="alert" className="mt-3 text-brand-strong">
          Something went wrong on our side. Try again in a moment.
        </p>
        <button type="button" onClick={load} className="btn-outline mt-6">
          Try again
        </button>
      </Panel>
    );
  }
  if (view.kind === "joined") {
    const { result } = view;
    return (
      <Panel title={result.institution ? `You've joined ${result.institution.name}` : "Your BdREN AI account is ready"}>
        <p className="mt-3 leading-relaxed text-muted">
          {result.institution
            ? `You're now part of ${result.institution.name} as ${(result.role && ROLE_LABELS[result.role]) || "a member"}.`
            : "Your invitation is accepted."}
        </p>
        {result.renewal_stopped && (
          <p className="mt-3 leading-relaxed text-muted">
            Your personal plan won&apos;t renew. It keeps working until its current period ends.
          </p>
        )}
        <a href={siteUrl(safeNext(result.redirect))} className="btn-primary mt-7">
          Continue
        </a>
      </Panel>
    );
  }
  if (view.invite.status !== "pending") return <Closed invite={view.invite} />;
  return (
    <Pending
      token={token}
      invite={view.invite}
      onJoined={(result) => setView({ kind: "joined", result })}
      onStale={load}
    />
  );
}
