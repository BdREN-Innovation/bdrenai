import type { Metadata } from "next";
import { Shell } from "@/components/site/Shell";
import { Members } from "@/components/portal/Members";

export const metadata: Metadata = { title: "Members", robots: { index: false, follow: false } };

export default function MembersPage({ params }: { params: { slug: string } }) {
  return (
    <Shell>
      <div className="px-6 py-12 md:py-14">
        <div className="mx-auto max-w-site">
          <Members slug={params.slug} />
        </div>
      </div>
    </Shell>
  );
}
