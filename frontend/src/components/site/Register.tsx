"use client";
import React, { useEffect, useState } from "react";
import { Institution, apiFetch, postForm } from "@/lib/api";
import { loginUrl } from "@/content/site";

type Step = "details" | "verify" | "done";
type Errors = Record<string, string>;

const PASSWORD_RULES: { label: string; test: (p: string) => boolean }[] = [
  { label: "At least 8 characters", test: (p) => p.length >= 8 },
  { label: "An upper-case letter", test: (p) => /[A-Z]/.test(p) },
  { label: "A lower-case letter", test: (p) => /[a-z]/.test(p) },
  { label: "A number", test: (p) => /[0-9]/.test(p) },
  { label: "A symbol", test: (p) => /[^A-Za-z0-9]/.test(p) },
];

const NONE = "none";
const OTHER = "other";
const GENERIC_ERROR = "Something went wrong. Please try again in a moment.";

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <span id={id} role="alert" className="text-sm text-brand-strong">
      {message}
    </span>
  );
}

function Progress({ step }: { step: Step }) {
  const at = step === "details" ? 0 : 1;
  return (
    <ol aria-label="Progress" className="mb-7 grid grid-cols-2 gap-2">
      {["Your details", "Confirm email"].map((label, i) => (
        <li key={label} aria-current={i === at ? "step" : undefined} className="flex flex-col gap-2">
          <span className={`block h-1 rounded ${i <= at ? "bg-brand" : "bg-line"}`} />
          <span className={`text-[13px] ${i === at ? "font-semibold text-ink" : "font-medium text-muted"}`}>{label}</span>
        </li>
      ))}
    </ol>
  );
}

/** `initialEmail` and `next` come from an invitation link: the email is prefilled and sign-in returns to `next`. */
export function Register({ initialEmail = "", next = "/" }: { initialEmail?: string; next?: string }) {
  const [step, setStep] = useState<Step>("details");
  const [institutions, setInstitutions] = useState<Institution[]>([]);
  const [enabled, setEnabled] = useState(true);
  const [form, setForm] = useState({
    first_name: "",
    last_name: "",
    email: initialEmail,
    institution: "",
    institution_other: "",
    password: "",
    confirm_password: "",
    accepted_terms: false,
  });
  const [showPw, setShowPw] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [email, setEmail] = useState("");

  useEffect(() => {
    apiFetch<{ institutions: Institution[]; signup_enabled: boolean }>("/api/v1/auth/institutions/")
      .then((d) => {
        setInstitutions(d.institutions);
        setEnabled(d.signup_enabled);
      })
      .catch(() => setInstitutions([]));
  }, []);

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.type === "checkbox" ? (e.target as HTMLInputElement).checked : e.target.value }));

  const rules = PASSWORD_RULES.map((r) => ({ label: r.label, ok: r.test(form.password) }));
  const passwordOk = rules.every((r) => r.ok);
  const matched = form.confirm_password.length > 0 && form.confirm_password === form.password;
  const mismatch = form.confirm_password.length > 0 && !matched;
  const ready =
    !!form.first_name.trim() &&
    !!form.last_name.trim() &&
    /.+@.+\..+/.test(form.email) &&
    !!form.institution &&
    (form.institution !== OTHER || form.institution_other.trim().length >= 2) &&
    passwordOk &&
    matched &&
    form.accepted_terms;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setErrors({});
    const res = await postForm<{ email: string }>("/api/v1/auth/register/", form);
    setBusy(false);
    if (res.ok) {
      setEmail(res.data.email);
      setStep("verify");
      return;
    }
    if (res.data.error === "signup_unavailable") setEnabled(false);
    setErrors(res.data.fields || { form: GENERIC_ERROR });
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setErrors({});
    const res = await postForm("/api/v1/auth/register/verify/", { code });
    setBusy(false);
    if (res.ok) {
      setStep("done");
      return;
    }
    setErrors(res.data.fields || { form: res.data.error === "no_signup" ? "This sign-up has expired. Start again." : GENERIC_ERROR });
  }

  async function resend() {
    setNotice(null);
    const res = await postForm("/api/v1/auth/register/resend/", {});
    setNotice(res.ok ? `We sent a new code to ${email}.` : GENERIC_ERROR);
  }

  if (!enabled) {
    return (
      <div className="w-full max-w-[480px]">
        <h1 className="font-display text-4xl font-bold tracking-tight">Create your account</h1>
        <p className="mt-3 leading-relaxed text-muted">
          Sign-up on this page isn&apos;t switched on yet. You can still create your BdREN account on the sign-in page.
        </p>
        <a href={loginUrl(next)} className="btn-primary mt-7 min-h-[52px] w-full">
          Continue to BdREN sign-in
        </a>
      </div>
    );
  }

  if (step === "done") {
    return (
      <div className="w-full max-w-[480px]">
        <span aria-hidden="true" className="flex h-16 w-16 items-center justify-center rounded-full bg-ink">
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12l5 5 9-10" />
          </svg>
        </span>
        <h1 className="mt-5 font-display text-4xl font-bold tracking-tight">Welcome, {form.first_name.trim()}</h1>
        <p className="mt-2.5 leading-relaxed text-muted">
          {form.institution && form.institution !== NONE
            ? "Your BdREN account is ready. Your institution's admin will review your request to join its plan."
            : "Your BdREN account is ready. Sign in to pick a plan and start using BdREN AI."}
        </p>
        <div className="mt-7 flex flex-wrap gap-3">
          <a href={loginUrl(next, email)} className="btn-primary min-h-[52px]">
            Sign in
          </a>
          <a href="/pricing" className="btn-outline min-h-[52px]">
            See plans
          </a>
        </div>
      </div>
    );
  }

  if (step === "verify") {
    return (
      <div className="w-full max-w-[480px]">
        <Progress step={step} />
        <h1 className="font-display text-4xl font-bold tracking-tight">Check your email</h1>
        <p className="mt-2.5 leading-relaxed text-muted">
          We sent a code to <strong className="text-ink">{email}</strong>.
        </p>
        <form aria-label="Confirm your email" onSubmit={verify} className="mt-6 flex flex-col gap-2">
          <label htmlFor="r-code" className="text-[15px] font-semibold">
            Code
          </label>
          <input
            id="r-code"
            name="code"
            autoComplete="one-time-code"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={12}
            value={code}
            onChange={(e) => setCode(e.target.value.trim().toUpperCase())}
            aria-invalid={!!errors.code}
            aria-describedby={errors.code ? "r-code-err" : undefined}
            className="input min-h-[56px] font-display text-2xl font-semibold tracking-[0.3em]"
          />
          <FieldError id="r-code-err" message={errors.code || errors.form} />
          <button type="submit" disabled={busy || code.length < 4} className="btn-primary mt-3 min-h-[52px] disabled:cursor-not-allowed disabled:bg-line disabled:text-muted">
            {busy ? "Checking…" : "Confirm email"}
          </button>
        </form>
        <p className="mt-5 flex flex-wrap items-center gap-x-5 text-[15px] text-muted">
          <span>Didn&apos;t get it?</span>
          <button type="button" onClick={resend} className="min-h-[44px] font-semibold text-brand-text hover:text-brand-strong">
            Resend code
          </button>
        </p>
        {notice && (
          <p role="status" className="text-sm text-muted">
            {notice}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="w-full max-w-[480px]">
      <Progress step={step} />
      <h1 className="font-display text-4xl font-bold tracking-tight">Create your account</h1>
      <p className="mt-2.5 leading-relaxed text-muted">Free to create. Choose a plan when you&apos;re ready.</p>

      <form aria-label="Create your account" onSubmit={submit} noValidate className="mt-8 flex flex-col gap-[18px]">
        <div className="grid grid-cols-2 gap-3">
          <div className="flex min-w-0 flex-col gap-2">
            <label htmlFor="r-first" className="text-[15px] font-semibold">
              First name
            </label>
            <input id="r-first" autoComplete="given-name" value={form.first_name} onChange={set("first_name")} aria-invalid={!!errors.first_name} className="input min-h-[50px]" />
            <FieldError id="r-first-err" message={errors.first_name} />
          </div>
          <div className="flex min-w-0 flex-col gap-2">
            <label htmlFor="r-last" className="text-[15px] font-semibold">
              Last name
            </label>
            <input id="r-last" autoComplete="family-name" value={form.last_name} onChange={set("last_name")} aria-invalid={!!errors.last_name} className="input min-h-[50px]" />
            <FieldError id="r-last-err" message={errors.last_name} />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="r-email" className="text-[15px] font-semibold">
            Email
          </label>
          <input
            id="r-email"
            type="email"
            autoComplete="email"
            placeholder="you@university.edu.bd"
            value={form.email}
            onChange={set("email")}
            aria-invalid={!!errors.email}
            aria-describedby="r-email-hint"
            className="input min-h-[50px]"
          />
          <span id="r-email-hint" className="text-sm text-muted">
            We&apos;ll send a code to confirm it.
          </span>
          <FieldError id="r-email-err" message={errors.email} />
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="r-inst" className="text-[15px] font-semibold">
            Institution
          </label>
          <select
            id="r-inst"
            value={form.institution}
            onChange={set("institution")}
            aria-invalid={!!errors.institution}
            aria-describedby="r-inst-hint"
            className="input min-h-[50px] cursor-pointer"
          >
            <option value="">Select your institution</option>
            {institutions.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
            <option value={OTHER}>Other (not listed)</option>
            <option value={NONE}>None, personal account</option>
          </select>
          {form.institution === OTHER && (
            <input
              aria-label="Institution name"
              placeholder="Type your institution's name"
              value={form.institution_other}
              onChange={set("institution_other")}
              aria-invalid={!!errors.institution_other}
              className="input min-h-[50px]"
            />
          )}
          <span id="r-inst-hint" className="text-sm text-muted">
            Your institution&apos;s admin approves members before you join its plan.
          </span>
          <FieldError id="r-inst-err" message={errors.institution || errors.institution_other} />
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="r-pw" className="text-[15px] font-semibold">
            Password
          </label>
          <div className="flex items-center rounded-xl border border-field bg-white">
            <input
              id="r-pw"
              type={showPw ? "text" : "password"}
              autoComplete="new-password"
              value={form.password}
              onChange={set("password")}
              aria-invalid={!!errors.password}
              aria-describedby="r-pw-rules"
              className="min-h-[50px] min-w-0 flex-1 rounded-xl border-0 bg-transparent px-3.5 text-base text-ink"
            />
            <button
              type="button"
              onClick={() => setShowPw((s) => !s)}
              aria-label={showPw ? "Hide passwords" : "Show passwords"}
              className="flex min-h-[48px] min-w-[48px] items-center justify-center"
            >
              <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#4A4E63" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </button>
          </div>
          <ul id="r-pw-rules" aria-label="Password rules" className="mt-1 grid grid-cols-1 gap-x-4 gap-y-2 rounded-xl border border-line bg-white px-3.5 py-3 text-sm sm:grid-cols-2">
            {rules.map((r) => (
              <li key={r.label} className={`flex items-center gap-2 ${r.ok ? "text-ink" : "text-muted"}`}>
                <span
                  aria-hidden="true"
                  className={`flex h-[18px] w-[18px] flex-none items-center justify-center rounded-full text-[12px] font-bold ${r.ok ? "bg-ink text-white" : "border-[1.5px] border-field"}`}
                >
                  {r.ok ? <svg aria-hidden="true" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12.5l5 5L20 6" /></svg> : null}
                </span>
                {r.label}
                <span className="sr-only">{r.ok ? " (met)" : " (not yet)"}</span>
              </li>
            ))}
          </ul>
          <FieldError id="r-pw-err" message={errors.password} />
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="r-pw2" className="text-[15px] font-semibold">
            Confirm password
          </label>
          <input
            id="r-pw2"
            type={showPw ? "text" : "password"}
            autoComplete="new-password"
            value={form.confirm_password}
            onChange={set("confirm_password")}
            aria-invalid={mismatch}
            className={`input min-h-[50px] ${mismatch ? "border-2 border-brand-strong" : ""}`}
          />
          {mismatch && <FieldError id="r-pw2-err" message="The passwords don't match." />}
          {matched && <span className="text-sm text-ink">Passwords match.</span>}
          <FieldError id="r-pw2-srv" message={!mismatch ? errors.confirm_password : undefined} />
        </div>

        <label className="flex cursor-pointer items-start gap-3 text-[15px] leading-normal text-muted">
          <input
            type="checkbox"
            checked={form.accepted_terms}
            onChange={set("accepted_terms")}
            className="mt-0.5 h-5 w-5 flex-none accent-brand"
          />
          <span>
            I agree to the{" "}
            <a href="#" className="font-semibold text-brand-text hover:text-brand-strong">
              Terms of Service
            </a>{" "}
            and{" "}
            <a href="#" className="font-semibold text-brand-text hover:text-brand-strong">
              Privacy Policy
            </a>
            .
          </span>
        </label>
        <FieldError id="r-terms-err" message={errors.accepted_terms} />
        <FieldError id="r-form-err" message={errors.form} />

        <button type="submit" disabled={!ready || busy} className="btn-primary mt-1.5 min-h-[52px] disabled:cursor-not-allowed disabled:bg-line disabled:text-muted">
          {busy ? "Creating account…" : "Create account"}
        </button>
      </form>
    </div>
  );
}
