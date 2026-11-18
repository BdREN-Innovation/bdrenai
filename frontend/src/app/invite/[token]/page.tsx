import type { Metadata } from "next";
import { Shell } from "@/components/site/Shell";
import { Invite } from "@/components/site/Invite";

export const metadata: Metadata = { title: "Your invitation", robots: { index: false, follow: false } };

export default function InvitePage({ params }: { params: { token: string } }) {
  return (
    <Shell>
      <div className="px-6 py-14 md:py-20">
        <div className="mx-auto max-w-[600px]">
          <Invite token={params.token} />
        </div>
      </div>
    </Shell>
  );
}
