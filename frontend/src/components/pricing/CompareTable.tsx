import type { Listing } from "@/content/pricing";

export function CompareTable({ listing }: { listing: Listing }) {
  return (
    <div className="mt-6 overflow-x-auto rounded-2xl border border-line bg-white">
      <table className="w-full min-w-[720px] border-collapse text-[15px]">
        <caption className="sr-only">Compare {listing.label} plans</caption>
        <thead>
          <tr className="text-left">
            <th scope="col" className="border-b border-line px-6 py-4 font-semibold text-muted">
              {listing.rowHead}
            </th>
            {listing.plans.map((p, i) => (
              <th key={`${p.name}-${i}`} scope="col" className="border-b border-line px-6 py-4 font-semibold">
                {p.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {listing.rows.map((row) => (
            <tr key={row.label}>
              <th scope="row" className="border-b border-ground px-6 py-4 text-left font-medium">
                {row.label}
              </th>
              {row.cells.map((cell, i) => (
                <td key={i} className="border-b border-ground px-6 py-4 text-muted">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
