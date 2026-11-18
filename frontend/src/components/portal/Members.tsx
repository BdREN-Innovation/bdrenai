"use client";
import React, { useCallback, useEffect, useState } from "react";
import { FormResult, MyProfile, PROFILE_PATH, getJson } from "@/lib/api";
import { loginUrl } from "@/content/site";
import { PortalInstitution, institutionPath, membersPagePath, seatCapMessage, seatsFull } from "@/lib/portal";
import { Banner, Notice } from "./ui";
import { SeatMeter } from "./SeatMeter";
import { MemberTable } from "./MemberTable";
import { Invitations } from "./Invitations";
import { InviteDialog } from "./InviteDialog";
import { ImportDialog } from "./ImportDialog";

type Load =
  | { kind: "loading" }
  | { kind: "signed-out" }
  | { kind: "forbidden"; suspended: boolean }
  | { kind: "missing" }
  | { kind: "failed" }
  | { kind: "ready"; institution: PortalInstitution };

function Message({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card mx-auto max-w-lg p-8 text-center">
      <h1 className="font-display text-3xl font-bold">{title}</h1>
      {children}
    </div>
  );
}

function TabButton({ id, active, onSelect, children }: { id: string; active: boolean; onSelect: () => void; children: React.ReactNode }) {
  return (
    <button
      id={`tab-${id}`}
      type="button"
      role="tab"
      aria-selected={active}
      aria-controls={`panel-${id}`}
      onClick={onSelect}
      className={`min-h-[44px] border-b-2 px-1 font-semibold ${active ? "border-brand text-ink" : "border-transparent text-muted hover:text-ink"}`}
    >
      {children}
    </button>
  );
}

/** Institution-admin Members page: seats, members, invitations, invite and CSV import. */
export function Members({ slug }: { slug: string }) {
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [selfId, setSelfId] = useState<string | null>(null);
  const [tab, setTab] = useState<"members" | "invitations">("members");
  const [dialog, setDialog] = useState<"invite" | "import" | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [version, setVersion] = useState(0);

  const apply = useCallback((res: FormResult<PortalInstitution>, signedIn: boolean) => {
    if (res.ok) return setLoad({ kind: "ready", institution: res.data });
    if (res.status === 401 || (res.status === 403 && !signedIn)) return setLoad({ kind: "signed-out" });
    if (res.status === 403) return setLoad({ kind: "forbidden", suspended: res.data.error === "institution_suspended" });
    setLoad({ kind: res.status === 404 ? "missing" : "failed" });
  }, []);

  const refresh = useCallback(async () => {
    apply(await getJson<PortalInstitution>(institutionPath(slug)), true);
  }, [apply, slug]);

  useEffect(() => {
    Promise.all([getJson<PortalInstitution>(institutionPath(slug)), getJson<MyProfile>(PROFILE_PATH)]).then(([res, me]) => {
      setSelfId(me.ok ? me.data.id : null);
      apply(res, me.ok);
    });
  }, [apply, slug]);

  if (load.kind === "loading") return <p className="text-muted">Loading members…</p>;
  if (load.kind === "signed-out") {
    return (
      <Message title="Sign in to manage members">
        <p className="mt-3 text-muted">Institution admins add, invite and manage their members here.</p>
        <a href={loginUrl(membersPagePath(slug))} className="btn-primary mt-6">
          Sign in
        </a>
      </Message>
    );
  }
  if (load.kind === "forbidden") {
    return (
      <Message title={load.suspended ? "This institution is suspended" : "You don't manage this institution"}>
        <p className="mt-3 text-muted">
          {load.suspended
            ? "Member management is paused while the institution is suspended. Contact BdREN to restore access."
            : "Only its admins can manage members. If you should be one, ask an existing admin or contact BdREN."}
        </p>
        <a href="/profile" className="btn-outline mt-6">
          Go to my profile
        </a>
      </Message>
    );
  }
  if (load.kind === "missing") {
    return (
      <Message title="Institution not found">
        <p className="mt-3 text-muted">Check the link, or open Members from your profile menu.</p>
      </Message>
    );
  }
  if (load.kind === "failed") {
    return (
      <Message title="We couldn't load this page">
        <p role="alert" className="mt-3 text-brand-strong">Something went wrong on our side.</p>
        <button type="button" onClick={refresh} className="btn-outline mt-6">
          Try again
        </button>
      </Message>
    );
  }

  const { institution } = load;
  const full = seatsFull(institution.seats);
  const finish = (n: Notice) => {
    setDialog(null);
    setNotice(n);
    setVersion((v) => v + 1);
    refresh();
  };
  const disabledClass = "disabled:cursor-not-allowed disabled:bg-line disabled:text-muted disabled:border-line";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="eyebrow text-brand-text">{institution.name}</p>
          <h1 className="mt-1 font-display text-4xl font-bold tracking-tight">Members</h1>
        </div>
        <SeatMeter seats={institution.seats} />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => setDialog("invite")} disabled={full} className={`btn-primary ${disabledClass}`}>
          Invite member
        </button>
        <button type="button" onClick={() => setDialog("import")} disabled={full} className={`btn-outline ${disabledClass}`}>
          Import CSV
        </button>
        {full && <p className="text-brand-strong">{seatCapMessage(institution.seats.used, institution.seats.cap ?? undefined)}</p>}
      </div>

      {institution.counts.pending_requests > 0 && (
        <p className="rounded-xl border border-line bg-white px-4 py-3">
          {institution.counts.pending_requests === 1 ? "1 person is" : `${institution.counts.pending_requests} people are`} waiting
          for approval. Filter members by &ldquo;Waiting for approval&rdquo; to approve them.
        </p>
      )}

      <Banner notice={notice} onClose={() => setNotice(null)} />

      <div role="tablist" aria-label="Members and invitations" className="flex gap-6 border-b border-line">
        <TabButton id="members" active={tab === "members"} onSelect={() => setTab("members")}>
          Members ({institution.counts.members})
        </TabButton>
        <TabButton id="invitations" active={tab === "invitations"} onSelect={() => setTab("invitations")}>
          Invitations ({institution.counts.pending_invitations} pending)
        </TabButton>
      </div>
      <div id={`panel-${tab}`} role="tabpanel" aria-labelledby={`tab-${tab}`}>
        {tab === "members" ? (
          <MemberTable slug={slug} selfId={selfId} version={version} onChanged={refresh} notify={setNotice} />
        ) : (
          <Invitations slug={slug} version={version} onChanged={refresh} notify={setNotice} />
        )}
      </div>

      {dialog === "invite" && (
        <InviteDialog slug={slug} institution={institution.name} onClose={() => setDialog(null)} onSent={finish} />
      )}
      {dialog === "import" && <ImportDialog slug={slug} onClose={() => setDialog(null)} onDone={finish} />}
    </div>
  );
}
