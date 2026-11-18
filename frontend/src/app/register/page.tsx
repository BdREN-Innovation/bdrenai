import type { Metadata } from "next";
import { Register } from "@/components/site/Register";

export const metadata: Metadata = { title: "Create your account" };

const BENEFITS = [
  { title: "Synapse, Mindspear, AI Mail Wizard and QuiGen", body: "Sign in once, move between them freely." },
  {
    title: "Join your institution",
    body: "Pick your university or office and its admin can add you to their plan.",
  },
  { title: "Passkeys and two-step login", body: "Add them from your account settings any time." },
];

export default function RegisterPage() {
  return (
    <div className="flex min-h-screen flex-wrap">
      <aside
        aria-label="About your BdREN account"
        className="flex min-w-0 flex-[1_1_480px] flex-col gap-12 bg-night px-8 py-12 text-fog md:px-14"
      >
        <div className="my-auto max-w-[520px]">
          <h2 className="font-display text-4xl font-bold leading-tight tracking-tight text-white md:text-[44px]">
            One account. Four AI products.
          </h2>
          <p className="mt-4 text-lg leading-relaxed text-haze">
            Your BdREN account works with every product, now and as new ones arrive.
          </p>
          <ul className="mt-9 flex flex-col gap-4">
            {BENEFITS.map((b) => (
              <li key={b.title} className="flex items-start gap-3.5">
                <span
                  aria-hidden="true"
                  className="flex h-9 w-9 flex-none items-center justify-center rounded-[10px] border border-night-edge bg-night-raised"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#F08A4B" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 12l5 5 9-10" />
                  </svg>
                </span>
                <span>
                  <strong className="block text-white">{b.title}</strong>
                  <span className="mt-0.5 block text-[15px] text-haze">{b.body}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <p className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-haze">
          <span>© {new Date().getFullYear()} BdREN</span>
          <a href="#" className="hover:text-white">
            Privacy policy
          </a>
          <a href="#" className="hover:text-white">
            Terms of service
          </a>
        </p>
      </aside>
      <main className="flex min-w-0 flex-[1_1_560px] flex-col px-6 pb-12 pt-8">
        <p className="text-[15px] text-muted">
          Already have an account?{" "}
          <a href="/sign-in" className="font-semibold text-brand-text hover:text-brand-strong">
            Sign in
          </a>
        </p>
        <div className="flex flex-1 items-center justify-center py-10">
          <Register />
        </div>
      </main>
    </div>
  );
}
