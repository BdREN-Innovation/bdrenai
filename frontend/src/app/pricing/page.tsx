import type { Metadata } from "next";
import { Shell } from "@/components/site/Shell";
import { Pricing } from "@/components/pricing/Pricing";
import { Checkout } from "@/components/pricing/Checkout";

export const metadata: Metadata = {
  title: "Pricing and packages",
  description: "The BdREN AI Suite with every product in one plan, or a package for a single product.",
};

const FAQS = [
  {
    q: "Should I buy the Suite or one product?",
    a: "The Suite gives every product under one plan and one bill. If your team only needs one product, its own package costs less. You can move to the Suite later.",
  },
  { q: "What happens when I reach my limit?", a: "Plans have weekly and monthly limits. [Describe what users see and how to top up.]" },
  { q: "How do institutions pay?", a: "[Invoice, bank transfer or online payment: confirm with finance.]" },
  { q: "Is VAT included?", a: "[State VAT treatment.]" },
];

export default function PricingPage() {
  return (
    <Shell current="/pricing">
      <div className="px-6 pb-24 pt-20 md:pt-24">
        <div className="mx-auto max-w-[760px] text-center">
          <h1 className="font-display text-5xl font-bold leading-[1.05] tracking-tight md:text-[56px]">
            Pricing and packages
          </h1>
          <p className="mt-4 text-lg leading-relaxed text-muted md:text-[19px]">
            One package gives you every BdREN AI product. If you only need one, buy it on its own. Prices are in BDT per
            person per month unless noted.
          </p>
        </div>

        <Pricing />

        <section
          aria-labelledby="inst-title"
          className="mx-auto mt-16 flex max-w-site flex-wrap items-center justify-between gap-8 rounded-[20px] bg-ink p-10 text-fog md:p-11"
        >
          <div className="min-w-0 flex-[1_1_520px]">
            <h2 id="inst-title" className="font-display text-3xl font-bold text-white md:text-[34px]">
              Institution pool or a custom contract
            </h2>
            <p className="mt-3.5 text-[17px] leading-relaxed text-mist">
              One shared budget for all your members, for the whole Suite or only the products you choose. Includes the
              admin console, per-member limits and usage reports.
            </p>
          </div>
          <a href="/about#contact" className="btn min-h-[52px] bg-white px-7 text-ink hover:bg-fog">
            Get an institution quote
          </a>
        </section>

        <Checkout />

        <section aria-labelledby="pf-title" className="mx-auto mt-24 max-w-[860px]">
          <h2 id="pf-title" className="font-display text-3xl font-bold">
            Billing questions
          </h2>
          <div className="mt-6">
            {FAQS.map((f, i) => (
              <details key={f.q} open={i === 0} className="border-t border-line py-5 last:border-b">
                <summary className="cursor-pointer text-lg font-semibold">{f.q}</summary>
                <p className="mt-2.5 leading-relaxed text-muted">{f.a}</p>
              </details>
            ))}
          </div>
        </section>
      </div>
    </Shell>
  );
}
