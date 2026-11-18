import type { Metadata } from "next";
import { Shell } from "@/components/site/Shell";
import { Profile } from "@/components/site/Profile";

export const metadata: Metadata = { title: "My profile" };

export default function ProfilePage() {
  return (
    <Shell>
      <div className="px-6 py-14 md:py-16">
        <div className="mx-auto max-w-[880px]">
          <Profile />
        </div>
      </div>
    </Shell>
  );
}
