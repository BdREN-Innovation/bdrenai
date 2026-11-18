export const SLUG_PATTERN = /^[a-z0-9-]{2,64}$/;

export function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/g, '');
}

/** Accepts "example.edu, @foo.ac.bd" and returns ["example.edu", "foo.ac.bd"]; bad entries are reported. */
export function parseDomains(value: string): { domains: string[]; invalid: string[] } {
  const entries = value
    .split(/[\s,;]+/)
    .map((entry) => entry.trim().toLowerCase().replace(/^@/, ''))
    .filter(Boolean);
  const valid = /^(?!-)[a-z0-9-]+(\.[a-z0-9-]+)+$/;
  return {
    domains: [...new Set(entries.filter((entry) => valid.test(entry)))],
    invalid: entries.filter((entry) => !valid.test(entry)),
  };
}
