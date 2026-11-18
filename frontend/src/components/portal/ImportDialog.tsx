"use client";
import React, { useState } from "react";
import { postForm } from "@/lib/api";
import { MAX_IMPORT_ROWS, rowsFromCsv } from "@/lib/csv";
import { ImportReason, ImportResult, ImportRow, errorMessage, institutionPath } from "@/lib/portal";
import { Dialog, Notice, tdClass, thClass } from "./ui";

const REASONS: Record<ImportReason, string> = {
  invalid_email: "Not a valid email",
  duplicate_in_file: "Listed twice in this file",
  already_member: "Already a member",
  already_invited: "Already has a pending invitation",
  bad_role: "Role must be member or admin",
  over_cap: "No seat left for this row",
  domain_not_allowed: "Email domain isn't allowed for your institution",
};

const OUTCOME: Record<ImportResult["rows"][number]["status"], string> = {
  ok: "Will be invited",
  skip: "Skipped",
  error: "Error",
};

function Preview({ rows, result }: { rows: ImportRow[]; result: ImportResult }) {
  const { summary } = result;
  return (
    <div className="mt-5">
      <p className="font-display text-xl font-bold">
        {summary.fits} of {rows.length} fit
      </p>
      <p className="text-sm text-muted">
        {summary.ok} ready · {summary.skip} skipped · {summary.error} with errors
        {summary.seats.cap !== null && ` · ${summary.seats.used} / ${summary.seats.cap} seats in use now`}
      </p>
      {summary.fits < summary.ok && (
        <p role="alert" className="mt-3 text-brand-strong">
          {summary.ok - summary.fits} ready rows won&apos;t fit in your seats. Remove members who no longer need access, or contact BdREN to upgrade your plan.
        </p>
      )}
      <div className="mt-4 max-h-[320px] overflow-auto rounded-xl border border-line">
        <table className="w-full border-collapse text-[15px]">
          <caption className="sr-only">Import preview</caption>
          <thead className="sticky top-0 bg-white text-muted">
            <tr>
              <th scope="col" className={thClass}>Row</th>
              <th scope="col" className={thClass}>Email</th>
              <th scope="col" className={thClass}>Result</th>
            </tr>
          </thead>
          <tbody>
            {result.rows.map((r) => (
              <tr key={r.index}>
                <td className={tdClass}>{r.index + 1}</td>
                <td className={`${tdClass} break-all`}>{r.email || "—"}</td>
                <td className={tdClass}>
                  <span className={r.status === "ok" ? "text-ink" : "text-brand-strong"}>{OUTCOME[r.status]}</span>
                  {r.reason && <span className="block text-sm text-muted">{REASONS[r.reason] || r.reason}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function ImportDialog({ slug, onClose, onDone }: { slug: string; onClose: () => void; onDone: (n: Notice) => void }) {
  const [text, setText] = useState("");
  const [rows, setRows] = useState<ImportRow[] | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const path = `${institutionPath(slug)}import/`;

  async function readFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setText(await file.text());
    setResult(null);
  }

  async function preview() {
    setError(null);
    const parsed = rowsFromCsv(text);
    if (parsed.length === 0) return setError("Add at least one row: email, name, role.");
    if (parsed.length > MAX_IMPORT_ROWS) return setError(`Import up to ${MAX_IMPORT_ROWS} rows at a time. This file has ${parsed.length}.`);
    setBusy(true);
    const res = await postForm<ImportResult>(path, { rows: parsed, dry_run: true });
    setBusy(false);
    if (!res.ok) return setError(errorMessage(res, "We couldn't check this file. Try again."));
    setRows(parsed);
    setResult(res.data);
  }

  async function confirm() {
    if (!rows) return;
    setBusy(true);
    const res = await postForm<ImportResult>(path, { rows, dry_run: false });
    setBusy(false);
    if (!res.ok) return setError(errorMessage(res, "We couldn't import these rows. Try again."));
    const { created, email_failures } = res.data;
    const failures = email_failures ? ` ${email_failures} emails didn't go out; use Resend on the Invitations tab.` : "";
    onDone({ tone: email_failures ? "error" : "ok", text: `${created} ${created === 1 ? "invitation" : "invitations"} created.${failures}` });
  }

  const fits = result?.summary.fits ?? 0;
  return (
    <Dialog title="Import members from CSV" onClose={onClose} wide>
      <p className="mt-2 text-muted">
        One person per line: <code className="rounded bg-ground px-1.5 py-0.5 text-sm">email,name,role</code>. Role is member or admin;
        leave it empty for member. A header row is fine.
      </p>
      <div className="mt-5 flex flex-col gap-2">
        <label htmlFor="imp-file" className="text-[15px] font-semibold">
          CSV file
        </label>
        <input id="imp-file" type="file" accept=".csv,text/csv,text/plain" onChange={readFile} className="text-[15px]" />
      </div>
      <div className="mt-4 flex flex-col gap-2">
        <label htmlFor="imp-text" className="text-[15px] font-semibold">
          Or paste rows
        </label>
        <textarea
          id="imp-text"
          rows={6}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setResult(null);
          }}
          placeholder={"email,name,role\nrahim@du.ac.bd,Rahim Uddin,member"}
          className="input py-3 font-mono text-sm"
        />
      </div>
      {error && (
        <p role="alert" className="mt-4 text-brand-strong">
          {error}
        </p>
      )}
      {result && rows && <Preview rows={rows} result={result} />}
      <div className="mt-6 flex flex-wrap justify-end gap-3">
        <button type="button" onClick={onClose} className="btn-outline">
          Cancel
        </button>
        {result ? (
          <button type="button" onClick={confirm} disabled={busy || fits === 0} className="btn-primary disabled:cursor-not-allowed disabled:bg-line disabled:text-muted">
            {busy ? "Sending…" : `Send ${fits} ${fits === 1 ? "invitation" : "invitations"}`}
          </button>
        ) : (
          <button type="button" onClick={preview} disabled={busy || !text.trim()} className="btn-primary disabled:cursor-not-allowed disabled:bg-line disabled:text-muted">
            {busy ? "Checking…" : "Preview"}
          </button>
        )}
      </div>
    </Dialog>
  );
}
