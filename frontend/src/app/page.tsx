import { PRODUCTS } from "@/content/products";
import { Shell } from "@/components/site/Shell";
import { Sleeve } from "@/components/home/Sleeve";

const FACTS = [
  { title: "One BdREN account", body: "Sign in once for every product." },
  { title: "Your data stays apart", body: "Each institution's work is kept separate from every other." },
  { title: "বাংলা and English", body: "Letters, forms and documents in both languages.", bn: true },
  { title: "Suite or single product", body: "All four in one plan, or only the one you need." },
];

const STEPS = [
  { title: "Talk to us", body: "Tell us which products your university or office needs and how many people will use them." },
  {
    title: "We set up your institution",
    body: "Your own space, admin console and plan, with sign-in through your university's login if you have one.",
  },
  {
    title: "Members join and start",
    body: "Staff and students create a BdREN account, choose your institution, and start once an admin approves.",
  },
];

function Arrow() {
  return (
    <svg
      aria-hidden="true"
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="transition-transform duration-300 group-hover:translate-x-1"
    >
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

export default function HomePage() {
  return (
    <Shell overlayHeader>
      <Sleeve />

      <section aria-label="Why BdREN AI" className="border-b border-line bg-white px-6">
        <ul className="mx-auto grid max-w-site sm:grid-cols-2 lg:grid-cols-4">
          {FACTS.map((f) => (
            <li
              key={f.title}
              className="border-b border-line py-7 sm:px-6 sm:[&:nth-child(odd)]:border-r lg:border-b-0 lg:border-r lg:px-8 lg:first:pl-0 lg:last:border-r-0"
            >
              <p className={`text-xl font-semibold ${f.bn ? "font-bengali" : "font-display"}`}>{f.title}</p>
              <p className="mt-1.5 leading-relaxed text-muted">{f.body}</p>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="tracks-title" className="bg-white px-6 py-24 md:py-28">
        <div className="mx-auto max-w-site">
          <h2 id="tracks-title" className="h-section max-w-[16ch]">
            Four products, one account
          </h2>
          <p className="mt-4 max-w-[60ch] text-lg leading-relaxed text-muted">
            Each has its own page with features, plans and setup help. Sign in once and move between them.
          </p>
          <ol className="mt-14 border-b-2 border-ink">
            {PRODUCTS.map((p, i) => (
              <li
                key={p.slug}
                className="grid gap-x-10 gap-y-5 border-t-2 border-ink py-10 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.3fr)_240px] md:items-start"
              >
                <div className="flex items-start gap-4">
                  <span
                    aria-hidden="true"
                    style={{ backgroundColor: p.color }}
                    className="mt-1.5 flex h-11 w-11 flex-none items-center justify-center rounded-full font-display text-lg font-semibold text-white"
                  >
                    {i + 1}
                  </span>
                  <div>
                    <h3 className="font-display text-4xl font-bold leading-none tracking-tight md:text-[44px]">{p.name}</h3>
                    <p className="mt-2 font-display font-medium" style={{ color: p.color }}>
                      {p.category}
                    </p>
                  </div>
                </div>
                <div>
                  <p className="text-lg leading-relaxed">{p.summary}</p>
                  <ul className="mt-4 grid gap-2 text-muted">
                    {p.points.map((pt) => (
                      <li key={pt} className="flex gap-3">
                        <span aria-hidden="true" style={{ backgroundColor: p.color }} className="mt-2 block h-2 w-2 flex-none rounded-full" />
                        <span>{pt}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <a
                  href={`/products/${p.slug}`}
                  className="group inline-flex items-center gap-2 self-start whitespace-nowrap font-display text-lg font-semibold underline decoration-2 underline-offset-4 hover:text-brand-text md:justify-self-end"
                >
                  About {p.name}
                  <Arrow />
                </a>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section aria-labelledby="join-title" className="px-6 py-24 md:py-28">
        <div className="mx-auto max-w-site">
          <h2 id="join-title" className="h-section">
            How your institution joins
          </h2>
          <ol className="mt-12 grid gap-10 md:grid-cols-3 md:gap-0">
            {STEPS.map((s, i) => (
              <li key={s.title} className="md:border-l-2 md:border-line md:px-8 md:first:border-l-0 md:first:pl-0">
                <p className="font-display text-7xl font-bold leading-none text-brand-text">{i + 1}</p>
                <h3 className="mt-5 font-display text-2xl font-semibold">{s.title}</h3>
                <p className="mt-2 leading-relaxed text-muted">{s.body}</p>
              </li>
            ))}
          </ol>
          <a href="/about#contact" className="btn-primary mt-12 min-h-[52px] px-7">
            Talk to us about your institution
          </a>
        </div>
      </section>

      <section aria-labelledby="suite-title" className="bg-night px-6 py-20 text-white md:py-24">
        <div className="mx-auto flex max-w-site flex-wrap items-end justify-between gap-8">
          <div className="max-w-[640px]">
            <h2 id="suite-title" className="font-display text-5xl font-bold leading-[0.95] tracking-tight [text-wrap:balance] md:text-6xl">
              One package for all four products
            </h2>
            <p className="mt-5 text-lg leading-relaxed text-haze">
              The BdREN AI Suite includes Synapse, Mindspear, AI Mail Wizard and QuiGen. Need only one? Each product is
              also sold on its own.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <a href="/pricing" className="btn min-h-[54px] bg-white px-7 text-ink hover:bg-fog">
              See pricing
            </a>
            <a href="/register" className="btn-outline-dark min-h-[54px] px-7">
              Create your account
            </a>
          </div>
        </div>
      </section>
    </Shell>
  );
}
