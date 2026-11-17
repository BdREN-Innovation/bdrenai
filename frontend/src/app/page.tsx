import { PRODUCTS } from "@/content/products";
import { Shell } from "@/components/site/Shell";
import { ProductIcon } from "@/components/site/ProductIcon";

const REASONS = [
  {
    title: "Your data stays yours",
    body: "Each institution's members, chats, files and knowledge base are kept fully separate from every other institution.",
  },
  {
    title: "Bangla and English",
    body: "Write, read scans and search documents in both languages, for the letters and forms offices actually use.",
  },
  {
    title: "One sign-in, one bill",
    body: "Members use one BdREN account for every product. Admins see usage and spending per member, with weekly and monthly limits.",
  },
];

const STEPS = [
  { title: "Talk to us", body: "Tell us which products you need and how many people will use them." },
  {
    title: "We set up your institution",
    body: "Your own space, admin console and plan, with sign-in from your university if you have one.",
  },
  { title: "Members sign in", body: "Staff and students sign in with BdREN and start working the same day." },
];

const SYNAPSE_HIGHLIGHTS = [
  { title: "Office Assistant", body: "Letters, reports, decks; edits Word, Excel and PowerPoint" },
  { title: "Scan to Word", body: "Scanned pages become editable files, layout kept" },
  { title: "Knowledge base", body: "Answers from your own policies, with page citations" },
  { title: "Synapse Browser, built in", body: "Fills web forms from your files and stops before every submit" },
];

export default function HomePage() {
  const [flagship, ...others] = PRODUCTS;
  return (
    <Shell>
      <section aria-labelledby="hero-title" className="bg-night px-6 pt-20 text-fog md:pt-24">
        <div className="mx-auto flex max-w-site flex-wrap items-center gap-14">
          <div className="min-w-0 flex-[1_1_520px]">
            <p className="eyebrow text-brand-glow">Bangladesh Research and Education Network</p>
            <h1
              id="hero-title"
              className="mt-5 font-display text-5xl font-bold leading-[1.04] tracking-tight text-white md:text-[64px]"
            >
              AI tools for the universities and offices of Bangladesh
            </h1>
            <p className="mt-6 max-w-[560px] text-lg leading-relaxed text-haze md:text-[19px]">
              Write, read, research and automate in Bangla and English. Every BdREN AI product runs under one sign-in,
              with each institution&apos;s data kept apart from every other.
            </p>
            <div className="mt-9 flex flex-wrap gap-3">
              <a href="#products" className="btn-primary min-h-[52px]">
                Explore products
              </a>
              <a href="/pricing" className="btn-outline-dark min-h-[52px]">
                See pricing
              </a>
            </div>
          </div>
          <div aria-hidden="true" className="grid min-w-0 flex-[1_1_440px] grid-cols-2 gap-3.5">
            {PRODUCTS.map((p, i) => (
              <div
                key={p.slug}
                className={`rounded-2xl border border-night-edge bg-night-raised p-5 ${i === 0 || i === 3 ? "col-span-2" : ""}`}
              >
                <div className="flex items-center gap-2.5 font-display text-base font-semibold text-white">
                  <span className={`h-2.5 w-2.5 rounded-full ${i === 0 ? "bg-brand-glow" : "bg-night-stroke"}`} />
                  {p.name}
                </div>
                <div className="mt-4 h-2.5 w-4/5 rounded bg-night-edge" />
                <div className="mt-2 h-2.5 w-3/5 rounded bg-night-edge" />
              </div>
            ))}
          </div>
        </div>
        <div className="mx-auto mt-16 flex max-w-site flex-wrap gap-x-10 gap-y-3 border-t border-night-line py-6 text-[15px] text-haze">
          <span className="font-semibold text-white">One BdREN account for every product</span>
          <span>Institution sign-in</span>
          <span>Passkeys and two-step login</span>
          <span>Separate data per institution</span>
        </div>
      </section>

      <section id="products" aria-labelledby="products-title" className="scroll-mt-6 px-6 py-24 md:py-28">
        <div className="mx-auto max-w-site">
          <div className="flex flex-wrap items-end justify-between gap-6">
            <div className="max-w-[640px]">
              <h2 id="products-title" className="h-section">
                Our AI products
              </h2>
              <p className="mt-4 text-lg leading-relaxed text-muted">
                Each product has its own page with features, plans and setup help.
              </p>
            </div>
            <a href="/pricing" className="font-semibold text-brand-text hover:text-brand-strong">
              Compare all plans
            </a>
          </div>

          <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            <article className="flex flex-wrap items-center gap-10 rounded-[20px] bg-ink p-8 text-fog sm:col-span-2 md:p-10 lg:col-span-3">
              <div className="min-w-0 flex-[1_1_420px]">
                <p className="eyebrow text-[13px] text-brand-glow">Flagship · {flagship.category}</p>
                <h3 className="mt-3 font-display text-4xl font-bold text-white">{flagship.name}</h3>
                <p className="mt-3.5 text-[17px] leading-relaxed text-mist">{flagship.summary}</p>
                <a href={`/products/${flagship.slug}`} className="btn-primary mt-7">
                  Learn about {flagship.name}
                </a>
              </div>
              <ul className="grid min-w-0 flex-[1_1_360px] gap-3 sm:grid-cols-2">
                {SYNAPSE_HIGHLIGHTS.map((h) => (
                  <li key={h.title} className="rounded-xl bg-night-card p-[18px] text-[15px] leading-snug">
                    <strong className="mb-1 block text-white">{h.title}</strong>
                    {h.body}
                  </li>
                ))}
              </ul>
            </article>

            {others.map((p) => (
              <article key={p.slug} className="card flex flex-col gap-3.5 rounded-[20px] p-8">
                <ProductIcon slug={p.slug} />
                <p className="eyebrow text-[13px] text-muted">{p.category}</p>
                <h3 className="font-display text-[26px] font-bold">{p.name}</h3>
                <p className="leading-relaxed text-muted">{p.summary}</p>
                <a
                  href={`/products/${p.slug}`}
                  className="mt-auto font-semibold text-brand-text hover:text-brand-strong"
                  aria-label={`Learn more about ${p.name}`}
                >
                  Learn more
                </a>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section aria-labelledby="why-title" className="border-y border-line bg-white px-6 py-24 md:py-28">
        <div className="mx-auto max-w-site">
          <h2 id="why-title" className="h-section max-w-[720px]">
            Built for institutions, not just individuals
          </h2>
          <div className="mt-14 grid gap-12 md:grid-cols-3">
            {REASONS.map((r, i) => (
              <div key={r.title}>
                <p className="font-display text-lg font-bold text-brand-text">{String(i + 1).padStart(2, "0")}</p>
                <h3 className="mt-3 text-[21px] font-semibold">{r.title}</h3>
                <p className="mt-2.5 leading-relaxed text-muted">{r.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section aria-labelledby="steps-title" className="px-6 py-24 md:py-28">
        <div className="mx-auto max-w-site">
          <h2 id="steps-title" className="h-section">
            Getting your institution started
          </h2>
          <ol className="mt-12 grid gap-5 md:grid-cols-3">
            {STEPS.map((s, i) => (
              <li key={s.title} className="card p-7">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-ink font-semibold text-white">
                  {i + 1}
                </span>
                <h3 className="mt-4 text-xl font-semibold">{s.title}</h3>
                <p className="mt-2 leading-relaxed text-muted">{s.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section aria-labelledby="cta-title" className="px-6 pb-24 md:pb-28">
        <div className="mx-auto flex max-w-site flex-wrap items-center justify-between gap-8 rounded-3xl bg-brand p-10 text-white md:p-14">
          <div className="max-w-[620px]">
            <h2 id="cta-title" className="font-display text-3xl font-bold leading-tight md:text-[38px]">
              One package for all four products
            </h2>
            <p className="mt-3.5 text-lg leading-relaxed text-brand-tint">
              The BdREN AI Suite includes Synapse, Mindspear, AI Mail Wizard and QuiGen. Need only one? Each product is
              also sold on its own.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <a href="/pricing" className="btn min-h-[52px] bg-white text-brand-strong hover:bg-brand-tint">
              View pricing
            </a>
            <a href="/about#contact" className="btn min-h-[52px] border border-white text-white hover:bg-brand-strong">
              Talk to sales
            </a>
          </div>
        </div>
      </section>
    </Shell>
  );
}
