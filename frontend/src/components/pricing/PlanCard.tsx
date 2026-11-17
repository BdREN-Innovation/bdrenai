import type { Plan } from "@/content/pricing";

export function PlanCard({ plan, href = "/about#contact" }: { plan: Plan; href?: string }) {
  const dark = !!plan.highlight;
  const muted = dark ? "text-mist" : "text-muted";
  return (
    <article
      className={`flex flex-col rounded-[18px] p-7 ${dark ? "bg-ink text-white" : "border border-line bg-white text-ink"}`}
    >
      {dark && (
        <p className="mb-3 self-start rounded-full bg-brand px-2.5 py-1 text-[13px] font-semibold text-white">
          Recommended
        </p>
      )}
      <h3 className="text-[22px] font-semibold">{plan.name}</h3>
      <p className={`mt-1.5 text-[15px] ${muted}`}>{plan.who}</p>
      <p className="mt-6 font-display text-[38px] font-bold leading-none">{plan.price}</p>
      <p className={`mt-1.5 text-[15px] ${muted}`}>{plan.period}</p>
      <ul className="mb-7 mt-6 flex flex-col gap-2.5 text-[15px] leading-snug">
        {plan.features.map((f) => (
          <li key={f} className="flex gap-2.5">
            <svg
              aria-hidden="true"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#C2501A"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="mt-0.5 flex-none"
            >
              <path d="M5 12l5 5 9-10" />
            </svg>
            <span>{f}</span>
          </li>
        ))}
      </ul>
      <a
        href={href}
        className={`mt-auto ${dark ? "btn-primary" : "btn-outline"}`}
        aria-label={`${plan.cta} (${plan.name})`}
      >
        {plan.cta}
      </a>
    </article>
  );
}

export function PlanGrid({ plans }: { plans: Plan[] }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {plans.map((p, i) => (
        <PlanCard key={`${p.name}-${i}`} plan={p} />
      ))}
    </div>
  );
}
