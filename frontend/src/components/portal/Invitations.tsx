"use client";
import React, { useState } from "react";
import { postForm } from "@/lib/api";
import { Invitation, ROLE_LABELS, errorMessage, formatDate, institutionPath, query } from "@/lib/portal";
import { usePaged } from "./paged";
import { Chip, ConfirmDialog, Notice, Pager, linkButton, selectClass, tdClass, thClass } from "./ui";

const PAGE_SIZE = 25;

export function Invitations({ slug, version, onChanged, notify }: {
  slug: string;
  version: number;
  onChanged: () => void;
  notify: (n: Notice) => void;
}) {
  const [filters, setFilters] = useState({ status: "pending", page: 1 });
  const [busy, setBusy] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<Invitation | null>(null);
  const { data, failed, reload: load } = usePaged<Invitation>(
    `${institutionPath(slug)}invitations/${query({ ...filters, page_size: PAGE_SIZE })}`,
    version
  );

  const path = (inv: Invitation, action: string) => `${institutionPath(slug)}invitations/${encodeURIComponent(inv.id)}/${action}/`;

  async function resend(inv: Invitation) {
    setBusy(inv.id);
    const res = await postForm<{ email_sent?: boolean }>(path(inv, "resend"), {});
    setBusy(null);
    if (!res.ok) return notify({ tone: "error", text: errorMessage(res, `We couldn't resend the invitation to ${inv.email}.`) });
    notify(
      res.data.email_sent === false
        ? { tone: "error", text: `The invitation to ${inv.email} is renewed, but the email didn't go out. Try Resend again shortly.` }
        : { tone: "ok", text: `A new invitation link went to ${inv.email}. The old link no longer works.` }
    );
    load();
    onChanged();
  }

  async function revoke(inv: Invitation) {
    setBusy(inv.id);
    const res = await postForm(path(inv, "revoke"), {});
    setBusy(null);
    setRevoking(null);
    if (!res.ok) return notify({ tone: "error", text: errorMessage(res, `We couldn't revoke the invitation to ${inv.email}.`) });
    notify({ tone: "ok", text: `The invitation to ${inv.email} is revoked.` });
    load();
    onChanged();
  }

  return (
    <div>
      <select
        aria-label="Invitation status"
        value={filters.status}
        onChange={(e) => setFilters({ status: e.target.value, page: 1 })}
        className={selectClass}
      >
        <option value="">All invitations</option>
        <option value="pending">Pending</option>
        <option value="expired">Expired</option>
        <option value="accepted">Accepted</option>
        <option value="revoked">Revoked</option>
      </select>

      {failed && (
        <p role="alert" className="mt-4 text-brand-strong">
          We couldn&apos;t load invitations.{" "}
          <button type="button" onClick={load} className={linkButton}>
            Try again
          </button>
        </p>
      )}
      {!data && !failed && <p className="mt-4 text-muted">Loading invitations…</p>}
      {data && data.results.length === 0 && (
        <p className="mt-6 rounded-xl border border-dashed border-field px-5 py-6 text-center text-muted">No invitations here.</p>
      )}
      {data && data.results.length > 0 && (
        <div className="mt-4 overflow-x-auto rounded-xl border border-line bg-white">
          <table className="w-full min-w-[820px] border-collapse text-[15px]">
            <caption className="sr-only">Invitations, {data.count} in all</caption>
            <thead className="text-muted">
              <tr>
                <th scope="col" className={thClass}>Email</th>
                <th scope="col" className={thClass}>Role</th>
                <th scope="col" className={thClass}>Status</th>
                <th scope="col" className={thClass}>Invited by</th>
                <th scope="col" className={thClass}>Expires</th>
                <th scope="col" className={thClass}><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {data.results.map((inv) => {
                const open = inv.status === "pending" || inv.status === "expired";
                return (
                  <tr key={inv.id}>
                    <th scope="row" className={`${tdClass} text-left font-medium`}>
                      {inv.email}
                      {inv.name && <span className="block text-sm font-normal text-muted">{inv.name}</span>}
                    </th>
                    <td className={tdClass}>{inv.role ? ROLE_LABELS[inv.role] : "—"}</td>
                    <td className={tdClass}>
                      <Chip status={inv.status} />
                      <span className="mt-1 block text-sm text-muted">Sent {inv.sent_count}×</span>
                    </td>
                    <td className={tdClass}>{inv.invited_by?.name || "—"}</td>
                    <td className={tdClass}>{formatDate(inv.expires_at)}</td>
                    <td className={`${tdClass} text-right`}>
                      {open && (
                        <div className="flex justify-end gap-x-4" aria-label={`Actions for ${inv.email}`}>
                          <button type="button" disabled={busy === inv.id} onClick={() => resend(inv)} className={linkButton}>
                            Resend
                          </button>
                          <button type="button" disabled={busy === inv.id} onClick={() => setRevoking(inv)} className={linkButton}>
                            Revoke
                          </button>
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

      {revoking && (
        <ConfirmDialog
          title={`Revoke the invitation to ${revoking.email}?`}
          body="The link in their email stops working and the seat it held is freed."
          action="Revoke"
          busy={busy === revoking.id}
          onConfirm={() => revoke(revoking)}
          onClose={() => setRevoking(null)}
        />
      )}
    </div>
  );
}
