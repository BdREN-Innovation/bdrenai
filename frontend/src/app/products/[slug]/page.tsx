import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getListing } from "@/content/pricing";
import { PRODUCTS, getProduct } from "@/content/products";
import { Shell } from "@/components/site/Shell";
import { PlanGrid } from "@/components/pricing/PlanCard";

interface Params {
  params: { slug: string };
}

export function generateStaticParams() {
  return PRODUCTS.map((p) => ({ slug: p.slug }));
}

export function generateMetadata({ params }: Params): Metadata {
  const product = getProduct(params.slug);
  return product ? { title: product.name, description: product.summary } : {};
}

export default function ProductPage({ params }: Params) {
  const product = getProduct(params.slug);
  if (!product) notFound();
  const listing = getListing(product.slug);
  const others = PRODUCTS.filter((p) => p.slug !== product.slug);
  const sections = [
    { href: "#features", label: "Features" },
    ...(product.admin ? [{ href: "#admins", label: "For admins" }] : []),
    { href: "#suite", label: "Also in the Suite" },
    { href: "#plans", label: "Plans" },
    { href: "#faq", label: "FAQ" },
  ];

  return (
    <Shell current="/#products" overlayHeader>
      <section aria-labelledby="p-title" style={{ backgroundColor: product.color }} className="px-6 pt-36 text-white md:pt-28">
        <div className="mx-auto max-w-site">
          <nav aria-label="Breadcrumb" className="flex gap-2 text-sm text-white">
            <a href="/" className="underline-offset-4 hover:underline">
              Home
            </a>
            <span aria-hidden="true">/</span>
            <a href="/#products" className="underline-offset-4 hover:underline">
              Products
            </a>
            <span aria-hidden="true">/</span>
            <span aria-current="page" className="text-white">
              {product.name}
            </span>
          </nav>
          <div className="mt-14 flex flex-wrap items-end justify-between gap-12">
            <div className="min-w-0 flex-[1_1_560px]">
              <h1
                id="p-title"
                className="font-display text-6xl font-bold leading-none tracking-tight text-white md:text-[72px]"
              >
                {product.name}
              </h1>
              <p className="mt-6 max-w-[620px] text-lg leading-relaxed text-white md:text-xl">{product.intro}</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <a href="#plans" className="btn-primary min-h-[52px]">
                See {product.name} plans
              </a>
              <a href="/about#contact" className="btn-outline-dark min-h-[52px]">
                Book a demo
              </a>
            </div>
          </div>
          <figure className="mt-14 flex h-[150px] items-center justify-center rounded-t-[28px] border-2 border-b-0 border-white/40 bg-white/10 md:h-[200px]">
            <figcaption className="rounded-full border-2 border-dashed border-white/60 px-5 py-3.5 text-[15px] text-white">
              Product screenshot: {product.screenshot}
            </figcaption>
          </figure>
        </div>
      </section>

      <nav aria-label="On this page" className="sticky top-0 z-10 border-b border-line bg-white">
        <div className="mx-auto flex max-w-site flex-wrap gap-x-7 px-6 text-[15px] font-medium">
          {sections.map((s) => (
            <a key={s.href} href={s.href} className="py-4 text-muted hover:text-ink">
              {s.label}
            </a>
          ))}
        </div>
      </nav>

      <section id="features" aria-labelledby="f-title" className="scroll-mt-16 px-6 py-24">
        <div className="mx-auto max-w-site">
          <h2 id="f-title" className="h-section max-w-[680px]">
            {product.featuresTitle}
          </h2>
          <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {product.features.map((f) => (
              <article key={f.title} className="card p-7">
                <h3 className="text-xl font-semibold">{f.title}</h3>
                <p className="mt-2.5 leading-relaxed text-muted">{f.body}</p>
              </article>
            ))}
            {product.builtIn && (
              <article className="card flex flex-wrap items-center justify-between gap-6 p-7 sm:col-span-2 lg:col-span-3">
                <div className="min-w-0 flex-[1_1_420px]">
                  <h3 className="text-[22px] font-semibold">{product.builtIn.title}, built into Synapse</h3>
                  <p className="mt-2.5 leading-relaxed text-muted">{product.builtIn.body}</p>
                </div>
              </article>
            )}
          </div>
        </div>
      </section>

      {product.admin && (
        <section id="admins" aria-labelledby="a-title" className="scroll-mt-16 bg-ink px-6 py-24 text-fog">
          <div className="mx-auto flex max-w-site flex-wrap gap-14">
            <div className="min-w-0 flex-[1_1_380px]">
              <h2 id="a-title" className="h-section text-white">
                {product.admin.title}
              </h2>
              <p className="mt-4 text-lg leading-relaxed text-mist">{product.admin.intro}</p>
            </div>
            <ul className="grid min-w-0 flex-[1_1_560px] gap-4 sm:grid-cols-2">
              {product.admin.items.map((it) => (
                <li key={it.title} className="rounded-[14px] bg-night-card p-6">
                  <strong className="block text-lg text-white">{it.title}</strong>
                  <span className="mt-2 block leading-relaxed text-mist">{it.body}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      <section id="suite" aria-labelledby="t-title" className="scroll-mt-16 px-6 pt-24">
        <div className="mx-auto max-w-site">
          <h2 id="t-title" className="font-display text-3xl font-bold">
            Also in the BdREN AI Suite
          </h2>
          <div className="mt-7 grid gap-5 md:grid-cols-3">
            {others.map((p) => (
              <a
                key={p.slug}
                href={`/products/${p.slug}`}
                className="card flex items-center justify-between gap-4 p-6 hover:border-ink"
              >
                <span>
                  <strong className="block text-lg">{p.name}</strong>
                  <span className="mt-1.5 block leading-snug text-muted">{p.line}</span>
                </span>
                <span aria-hidden="true" className="text-brand-text">
                  <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
                </span>
              </a>
            ))}
          </div>
        </div>
      </section>

      <section id="plans" aria-labelledby="pl-title" className="scroll-mt-16 px-6 py-24">
        <div className="mx-auto max-w-site">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <h2 id="pl-title" className="h-section">
              {product.name} plans
            </h2>
            <a href="/pricing" className="font-semibold text-brand-text hover:text-brand-strong">
              Full comparison and institution plans
            </a>
          </div>
          <a
            href="/pricing"
            className="mt-7 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-[14px] bg-brand-tint px-6 py-4"
          >
            <span>
              <strong>Get every product for one price.</strong> The BdREN AI Suite includes Synapse, Mindspear, AI Mail
              Wizard and QuiGen.
            </span>
            <span className="font-semibold text-brand-strong">Compare with the Suite</span>
          </a>
          <p className="mb-4 mt-7 text-muted">{product.name} on its own:</p>
          {listing && <PlanGrid plans={listing.plans} />}
        </div>
      </section>

      <section id="faq" aria-labelledby="q-title" className="scroll-mt-16 border-t border-line bg-white px-6 py-24">
        <div className="mx-auto max-w-[860px]">
          <h2 id="q-title" className="h-section">
            Questions
          </h2>
          <div className="mt-8">
            {product.faqs.map((f, i) => (
              <details key={f.q} open={i === 0} className="border-t border-line py-5 last:border-b">
                <summary className="cursor-pointer text-[19px] font-semibold">{f.q}</summary>
                <p className="mt-3 leading-relaxed text-muted">{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>
    </Shell>
  );
}
