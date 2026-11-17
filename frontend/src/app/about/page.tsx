import type { Metadata } from "next";
import { CONTACT, TEAM_SIZE } from "@/content/site";
import { Shell } from "@/components/site/Shell";
import { ContactForm } from "@/components/site/ContactForm";

export const metadata: Metadata = {
  title: "About, team and contact",
  description: "BdREN AI is built by the Bangladesh Research and Education Network. Meet the team or get in touch.",
};

const VALUES = [
  { title: "Institutions own their data", body: "Every institution's work is kept apart and under its admins' control." },
  {
    title: "Built for local work",
    body: "Bangla and English, official letters, scanned forms and the documents offices really use.",
  },
  {
    title: "Affordable at scale",
    body: "Plans for students, staff and whole institutions, with clear limits and usage reports.",
  },
];

const TEAM = Array.from({ length: TEAM_SIZE }, (_, i) => ({ id: i, name: "[Name]", role: "[Role]" }));

const DETAILS = [
  { label: "Email", value: CONTACT.email, href: `mailto:${CONTACT.email}` },
  { label: "Phone", value: CONTACT.phone },
  { label: "Office", value: CONTACT.office },
  { label: "Hours", value: CONTACT.hours },
];

export default function AboutPage() {
  return (
    <Shell current="/about">
      <section id="about" aria-labelledby="ab-title" className="bg-night px-6 py-24 text-fog">
        <div className="mx-auto flex max-w-site flex-wrap gap-14">
          <div className="min-w-0 flex-[1_1_560px]">
            <p className="eyebrow text-brand-glow">About BdREN AI</p>
            <h1
              id="ab-title"
              className="mt-4 font-display text-5xl font-bold leading-[1.05] tracking-tight text-white md:text-6xl"
            >
              AI from the network that connects Bangladesh&apos;s universities
            </h1>
          </div>
          <div className="min-w-0 flex-[1_1_420px] text-lg leading-[1.7] text-mist">
            <p>
              BdREN, the Bangladesh Research and Education Network, links the country&apos;s universities and research
              institutions. BdREN AI brings that network useful, affordable AI built for the way Bangladeshi offices and
              campuses work.
            </p>
            <p className="mt-5">[Add founding year, mission statement and the number of member institutions once confirmed.]</p>
          </div>
        </div>
      </section>

      <section aria-labelledby="val-title" className="px-6 py-24">
        <div className="mx-auto max-w-site">
          <h2 id="val-title" className="h-section">
            What we care about
          </h2>
          <div className="mt-11 grid gap-5 md:grid-cols-3">
            {VALUES.map((v) => (
              <div key={v.title} className="card p-7">
                <h3 className="text-xl font-semibold">{v.title}</h3>
                <p className="mt-2.5 leading-relaxed text-muted">{v.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="team" aria-labelledby="tm-title" className="scroll-mt-6 border-y border-line bg-white px-6 py-24">
        <div className="mx-auto max-w-site">
          <h2 id="tm-title" className="h-section">
            Our team
          </h2>
          <p className="mt-3 text-lg text-muted">The people who build and run BdREN AI.</p>
          <ul className="mt-11 grid grid-cols-2 gap-x-5 gap-y-7 md:grid-cols-3 lg:grid-cols-4">
            {TEAM.map((m) => (
              <li key={m.id}>
                <div
                  role="img"
                  aria-label="Photo to come"
                  className="flex aspect-[4/5] items-center justify-center rounded-2xl border border-dashed border-field bg-ground text-sm text-muted"
                >
                  Photo
                </div>
                <p className="mt-3.5 text-lg font-semibold">{m.name}</p>
                <p className="mt-1 text-[15px] text-muted">{m.role}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section id="contact" aria-labelledby="ct-title" className="scroll-mt-6 px-6 py-24">
        <div className="mx-auto flex max-w-site flex-wrap gap-12">
          <div className="min-w-0 flex-[1_1_360px]">
            <h2 id="ct-title" className="h-section">
              Contact us
            </h2>
            <p className="mt-3.5 text-lg leading-relaxed text-muted">
              Ask about a product, a demo or a plan for your institution. We reply within {CONTACT.replyTime}.
            </p>
            <dl className="mt-9 grid gap-5">
              {DETAILS.map((d) => (
                <div key={d.label}>
                  <dt className="font-semibold">{d.label}</dt>
                  <dd className="mt-1 text-muted">
                    {d.href ? (
                      <a href={d.href} className="text-brand-text hover:text-brand-strong">
                        {d.value}
                      </a>
                    ) : (
                      d.value
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
          <ContactForm />
        </div>
      </section>
    </Shell>
  );
}
