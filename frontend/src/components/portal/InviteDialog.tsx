"use client";
import React, { useState } from "react";
import { postForm } from "@/lib/api";
import { Invitation, PortalRole, errorMessage, institutionPath } from "@/lib/portal";
import { Dialog, Notice } from "./ui";

export function InviteDialog({ slug, institution, onClose, onSent }: {
  slug: string;
  institution: string;
  onClose: () => void;
  onSent: (n: Notice) => void;
}) {
  const [form, setForm] = useState<{ email: string; name: string; role: PortalRole }>({ email: "", name: "", role: "member" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const ready = /.+@.+\..+/.test(form.email.trim());

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setErrors({});
    const res = await postForm<{ invitation: Invitation; email_sent: boolean }>(`${institutionPath(slug)}invitations/`, {
      email: form.email.trim(),
      name: form.name.trim(),
      role: form.role,
    });
    setBusy(false);
    if (!res.ok) {
      const email = res.data.fields?.email;
      return setErrors(email ? { email } : { form: errorMessage(res, "We couldn't send the invitation. Try again.") });
    }
    const email = res.data.invitation.email;
    onSent(
      res.data.email_sent
        ? { tone: "ok", text: `Invitation sent to ${email}.` }
        : { tone: "error", text: `The invitation to ${email} is saved, but the email didn't go out. Use Resend on the Invitations tab.` }
    );
  }

  return (
    <Dialog title="Invite member" onClose={onClose}>
      <p className="mt-2 text-muted">They get an email with a link to join {institution}.</p>
      <form aria-label="Invite member" onSubmit={submit} noValidate className="mt-6 flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <label htmlFor="inv-email" className="text-[15px] font-semibold">
            Email
          </label>
          <input
            id="inv-email"
            type="email"
            autoComplete="off"
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            aria-invalid={!!errors.email}
            className="input min-h-[48px]"
          />
          {errors.email && <span role="alert" className="text-sm text-brand-strong">{errors.email}</span>}
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor="inv-name" className="text-[15px] font-semibold">
            Name <span className="font-normal text-muted">(optional)</span>
          </label>
          <input id="inv-name" autoComplete="off" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className="input min-h-[48px]" />
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor="inv-role" className="text-[15px] font-semibold">
            Role
          </label>
          <select
            id="inv-role"
            value={form.role}
            onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as PortalRole }))}
            className="input min-h-[48px] cursor-pointer"
          >
            <option value="member">Member</option>
            <option value="admin">Admin: can manage members</option>
          </select>
        </div>
        {errors.form && (
          <p role="alert" className="text-brand-strong">
            {errors.form}
          </p>
        )}
        <div className="mt-2 flex flex-wrap justify-end gap-3">
          <button type="button" onClick={onClose} className="btn-outline">
            Cancel
          </button>
          <button type="submit" disabled={!ready || busy} className="btn-primary disabled:cursor-not-allowed disabled:bg-line disabled:text-muted">
            {busy ? "Sending…" : "Send invitation"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
