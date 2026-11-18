import { useMemo } from 'react';
import type { ProductRef } from './types';
import { Field, Select } from '@/components/ui';
import { useCatalog } from './queries';

/** Every BDREN app from the catalog, plus any in `known` (for example apps with usage) the catalog lacks. */
export function useApps(known: ProductRef[]): ProductRef[] {
  const catalog = useCatalog();
  return useMemo(() => {
    const apps = new Map<string, ProductRef>();
    for (const product of catalog.data?.products ?? []) apps.set(product.slug, { slug: product.slug, name: product.name });
    for (const product of known) if (!apps.has(product.slug)) apps.set(product.slug, product);
    return Array.from(apps.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [catalog.data, known]);
}

/** "All apps" or one app; `value` is a product slug, "" for all. */
export function AppSwitcher({ apps, value, onChange }: { apps: ProductRef[]; value: string; onChange: (slug: string) => void }) {
  return (
    <Field label="App" className="w-56">
      {(props) => (
        <Select {...props} value={value} onChange={(event) => onChange(event.target.value)}>
          <option value="">All apps</option>
          {apps.map((app) => (
            <option key={app.slug} value={app.slug}>
              {app.name}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
}
