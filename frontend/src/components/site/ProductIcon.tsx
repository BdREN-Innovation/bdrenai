import type { ProductSlug } from "@/content/products";

const PATHS: Record<ProductSlug, React.ReactNode> = {
  synapse: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v6M12 15v6M3 12h6M15 12h6" />
    </>
  ),
  mindspear: (
    <>
      <path d="M4 19V6a2 2 0 0 1 2-2h12v15H6a2 2 0 0 0-2 2z" />
      <path d="M9 8h6M9 12h4" />
    </>
  ),
  "mail-wizard": (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 7l9 6 9-6" />
    </>
  ),
  quigen: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17h.01" />
    </>
  ),
};

export function ProductIcon({ slug, size = 40 }: { slug: ProductSlug; size?: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="#1846C9"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {PATHS[slug]}
    </svg>
  );
}
