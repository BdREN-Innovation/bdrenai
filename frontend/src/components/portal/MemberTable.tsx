"use client";
import React, { useState } from "react";
import { FormResult, postForm } from "@/lib/api";
import { Member, MemberStatus, ROLE_LABELS, errorMessage, formatDate, institutionPath, query } from "@/lib/portal";
import { usePaged } from "./paged";
import { Chip, ConfirmDialog, Notice, Pager, linkButton, selectClass, tdClass, thClass } from "./ui";

const PAGE_SIZE = 25;

type Change = { role?: "member" | "admin"; status?: "active" | "suspended" };
type Pending = { member: Member; kind: "suspend" | "remove" };
type Action = { label: string; change: Change } | { label: string; confirm: Pending["kind"] };

function actionsFor(m: Member): Action[] {
  const byStatus: Record<MemberStatus, Action[]> = {
    pending: [{ label: "Approve", change: { status: "active" } }],
    active: [
      m.role === "admin" ? { label: "Make member", change: { role: "member" } } : { label: "Make admin", change: { role: "admin" } },
      { label: "Suspend", confirm: "suspend" },
    ],
    suspended: [{ label: "Activate", change: { status: "active" } }],
    deprovisioned: [],
  };
  const remove: Action[] = m.status === "deprovisioned" ? [] : [{ label: "Remove", confirm: "remove" }];
  return [...byStatus[m.status], ...remove];
}

export function MemberTable({ slug, selfId, version, onChanged, notify }: {
  slug: string;
  selfId: string | null;
  version: number;
  onChanged: () => void;
  notify: (n: Notice) => void;
}) {
  const [filters, setFilters] = useState({ q: "", status: "", role: "", page: 1 });
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Pending | null>(null);
  const { data, failed, reload: load } = usePaged<Member>(
    `${institutionPath(slug)}members/${query({ ...filters, page_size: PAGE_SIZE })}`,
    version
  );

  async function run(member: Member, request: () => Promise<FormResult<object>>, done: string, failure: string) {
    setBusy(member.membership_id);
    const res = await request();
    setBusy(null);
    setConfirm(null);
    if (!res.ok) return notify({ tone: "error", text: errorMessage(res, failure) });
    notify({ tone: "ok", text: done });
    load();
    onChanged();
  }

  const memberPath = (m: Member) => `${institutionPath(slug)}members/${encodeURIComponent(m.membership_id)}/`;
  const who = (m: Member) => m.user.name || m.user.email;

  function change(m: Member, body: Change) {
    const done = body.role
      ? `${who(m)} is now ${body.role === "admin" ? "an admin" : "a member"}.`
      : m.status === "pending"
        ? `${who(m)} is approved.`
        : `${who(m)} is active again.`;
    return run(m, () => postForm(memberPath(m), body, "PATCH"), done, `We couldn't update ${who(m)}. Try again.`);
  }

  function confirmed(p: Pending) {
    if (p.kind === "suspend") {
      return run(p.member, () => postForm(memberPath(p.member), { status: "suspended" }, "PATCH"), `${who(p.member)} is suspended.`, `We couldn't suspend ${who(p.member)}. Try again.`);
    }
    return run(p.member, () => postForm(`${memberPath(p.member)}remove/`, {}), `${who(p.member)} is removed.`, `We couldn't remove ${who(p.member)}. Try again.`);
  }

  const set = (key: "status" | "role") => (e: React.ChangeEvent<HTMLSelectElement>) =>
    setFilters((f) => ({ ...f, [key]: e.target.value, page: 1 }));

  return (
    <div>
      <div className="flex flex-wrap items-end gap-3">
        <form
          role="search"
          aria-label="Search members"
          onSubmit={(e) => {
            e.preventDefault();
            setFilters((f) => ({ ...f, q: search.trim(), page: 1 }));
          }}
          className="flex min-w-[240px] flex-1 gap-2"
        >
          <input
            type="search"
            aria-label="Name or email"
            placeholder="Search by name or email"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input min-h-[44px] text-[15px]"
          />
          <button type="submit" className="btn-outline min-h-[44px] px-4">
            Search
          </button>
        </form>
        <select aria-label="Status" value={filters.status} onChange={set("status")} className={selectClass}>
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="pending">Waiting for approval</option>
          <option value="suspended">Suspended</option>
          <option value="deprovisioned">Removed</option>
        </select>
        <select aria-label="Role" value={filters.role} onChange={set("role")} className={selectClass}>
          <option value="">All roles</option>
          <option value="owner">Owner</option>
          <option value="admin">Admin</option>
          <option value="member">Member</option>
        </select>
      </div>

      {failed && (
        <p role="alert" className="mt-4 text-brand-strong">
          We couldn&apos;t load members.{" "}
          <button type="button" onClick={load} className={linkButton}>
            Try again
          </button>
        </p>
      )}
      {!data && !failed && <p className="mt-4 text-muted">Loading members…</p>}
      {data && data.results.length === 0 && <p className="mt-6 rounded-xl border border-dashed border-field px-5 py-6 text-center text-muted">No members match these filters.</p>}
      {data && data.results.length > 0 && (
        <div className="mt-4 overflow-x-auto rounded-xl border border-line bg-white">
          <table className="w-full min-w-[760px] border-collapse text-[15px]">
            <caption className="sr-only">Members, {data.count} in all</caption>
            <thead className="text-muted">
              <tr>
                <th scope="col" className={thClass}>Member</th>
                <th scope="col" className={thClass}>Role</th>
                <th scope="col" className={thClass}>Status</th>
                <th scope="col" className={thClass}>Joined</th>
                <th scope="col" className={thClass}><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {data.results.map((m) => {
                const locked = m.role === "owner" || m.user.id === selfId;
                return (
                  <tr key={m.membership_id}>
                    <th scope="row" className={`${tdClass} text-left font-medium`}>
                      {m.user.name || "—"}
                      <span className="block text-sm font-normal text-muted">{m.user.email}</span>
                    </th>
                    <td className={tdClass}>{ROLE_LABELS[m.role] || m.role}</td>
                    <td className={tdClass}>
                      <Chip status={m.status} />
                    </td>
                    <td className={tdClass}>{formatDate(m.joined_at)}</td>
                    <td className={`${tdClass} text-right`}>
                      {locked ? (
                        <span className="text-sm text-muted">{m.user.id === selfId ? "You" : "Owner"}</span>
                      ) : (
                        <div className="flex flex-wrap justify-end gap-x-4" aria-label={`Actions for ${who(m)}`}>
                          {actionsFor(m).map((a) => (
                            <button
                              key={a.label}
                              type="button"
                              disabled={busy === m.membership_id}
                              onClick={() => ("confirm" in a ? setConfirm({ member: m, kind: a.confirm }) : change(m, a.change))}
                              className={linkButton}
                            >
                              {a.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {data && <Pager page={data.page} pageSize={data.page_size} count={data.count} onPage={(page) => setFilters((f) => ({ ...f, page }))} />}

      {confirm && (
        <ConfirmDialog
          title={confirm.kind === "suspend" ? `Suspend ${who(confirm.member)}?` : `Remove ${who(confirm.member)}?`}
          body={
            confirm.kind === "suspend"
              ? "They lose access to every BdREN AI product until you activate them again. Their seat is freed meanwhile, so activating them needs a free seat."
              : "They lose access to every BdREN AI product and their seat is freed. To bring them back, invite them again."
          }
          action={confirm.kind === "suspend" ? "Suspend" : "Remove"}
          busy={busy === confirm.member.membership_id}
          onConfirm={() => confirmed(confirm)}
          onClose={() => setConfirm(null)}
        />
      )}
    </div>
  );
}
