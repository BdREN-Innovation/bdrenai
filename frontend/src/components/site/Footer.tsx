import { PRODUCTS } from "@/content/products";

const COMPANY_LINKS = [
  { href: "/about", label: "About" },
  { href: "/about#team", label: "Team" },
  { href: "/about#contact", label: "Contact" },
  { href: "/pricing", label: "Pricing" },
];

export function Footer() {
  return (
    <footer className="bg-night px-6 pb-10 pt-16 text-[15px] text-haze">
      <div className="mx-auto grid max-w-site gap-10 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <p className="font-display text-xl font-bold text-white">BdREN AI</p>
          <p className="mt-3 leading-relaxed">AI services from the Bangladesh Research and Education Network.</p>
        </div>
        <nav aria-label="Products" className="flex flex-col gap-2.5">
          <span className="font-semibold text-white">Products</span>
          {PRODUCTS.map((p) => (
            <a key={p.slug} href={`/products/${p.slug}`} className="hover:text-white">
              {p.name}
            </a>
          ))}
        </nav>
        <nav aria-label="Company" className="flex flex-col gap-2.5">
          <span className="font-semibold text-white">Company</span>
          {COMPANY_LINKS.map((l) => (
            <a key={l.href} href={l.href} className="hover:text-white">
              {l.label}
            </a>
          ))}
        </nav>
        <nav aria-label="Legal" className="flex flex-col gap-2.5">
          <span className="font-semibold text-white">Legal</span>
          <a href="#" className="hover:text-white">
            Privacy policy
          </a>
          <a href="#" className="hover:text-white">
            Terms of service
          </a>
        </nav>
      </div>
      <p className="mx-auto mt-12 max-w-site border-t border-night-line pt-6 text-sm">
        © {new Date().getFullYear()} BdREN. All rights reserved.
      </p>
    </footer>
  );
}
