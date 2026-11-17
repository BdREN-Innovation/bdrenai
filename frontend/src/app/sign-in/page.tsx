import type { Metadata } from "next";
import { PRODUCTS } from "@/content/products";
import { Logo } from "@/components/site/Logo";
import { SignIn } from "@/components/site/SignIn";

export const metadata: Metadata = { title: "Sign in" };

function safeNext(value: string | string[] | undefined): string {
  const v = Array.isArray(value) ? value[0] : value;
  return v && v.startsWith("/") && !v.startsWith("//") ? v : "/";
}

export default function SignInPage({ searchParams }: { searchParams: { next?: string | string[] } }) {
  const next = safeNext(searchParams.next);
  return (
    <div className="flex min-h-screen flex-wrap">
      <aside
        aria-label="About your BdREN account"
        className="flex min-w-0 flex-[1_1_480px] flex-col gap-12 bg-night px-8 py-12 text-fog md:px-14"
      >
        <Logo />
        <div className="my-auto max-w-[520px]">
          <h2 className="font-display text-4xl font-bold leading-tight tracking-tight text-white md:text-[44px]">
            One account for every BdREN AI product
          </h2>
          <p className="mt-4 text-lg leading-relaxed text-haze">
            Sign in once and move between products without signing in again.
          </p>
          <ul className="mt-9 grid gap-3 sm:grid-cols-2">
            {PRODUCTS.map((p, i) => (
              <li
                key={p.slug}
                className="flex items-center gap-3 rounded-xl border border-night-edge bg-night-raised p-3.5"
              >
                <span
                  aria-hidden="true"
                  className={`flex h-[34px] w-[34px] flex-none items-center justify-center rounded-lg font-display font-bold text-white ${i === 0 ? "bg-brand" : "bg-night-card"}`}
                >
                  {p.initial}
                </span>
                <span className="font-semibold text-white">{p.name}</span>
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
      <main className="flex min-w-0 flex-[1_1_520px] items-center justify-center px-6 py-16">
        <SignIn next={next} />
      </main>
    </div>
  );
}
